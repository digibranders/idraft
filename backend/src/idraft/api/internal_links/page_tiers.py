"""Tiers and tags on a project's pages, and its tier rules (spec 5.2 and 5.3; decisions D16 and
D18). Every write locks the project row first, so two at once do not interleave, re-applies
the rules where they may have changed, recomputes the latest crawl's tier flow, and is audited.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, cast
from uuid import UUID

from sqlalchemy import case, delete, func, insert, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.page_filter import PageScope, page_conditions, page_rows
from idraft.api.internal_links.problems import NoCrawlError
from idraft.api.problems import NotFoundError, TooManySubjectsError, invalid_field
from idraft.api.projects import repository as project_repository
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import (
    BULK_MATCH_MAX,
    CSV_ROWS_MAX,
    ImportPending,
    ImportProblem,
    MatchTypeName,
    PageSelection,
    PageTagChange,
    PageTierSet,
    TierImportResult,
    TierRuleCreate,
    TierRulePatch,
    TierRulePreview,
    TierRulePreviewRequest,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.crawl_store import apply_rules, latest_run, project_rules, tiers_changed
from idraft.crawl.hosts import site_hosts
from idraft.crawl.tiers import MatchType, TierRule, check_rule_value, first_match, rule_matches
from idraft.db import dictionaries
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    crawl_pages,
    crawl_runs,
    page_terms,
    page_tier_levels,
    project_pages,
    projects,
    taxonomy_terms,
    taxonomy_vocabularies,
    tier_rules,
    urls,
)
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize

# One statement takes at most 32,767 parameters; 5,000 rows of 6 columns stay under it.
_ROWS: Final = 5_000


@dataclass(frozen=True, slots=True)
class RuleRecord:
    rule_id: UUID
    position: int
    match_type: MatchTypeName
    value: str
    tier_id: UUID
    tier_position: int
    tier_name: str
    created_at: datetime


async def crawl_scope(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, run: UUID | None
) -> PageScope:
    """The crawl a read or a bulk change is about: `run`, or the latest finished one."""
    run_id = run if run is not None else await latest_run(db, access.workspace_id, project_id)
    if run_id is None:
        raise NoCrawlError
    row = (
        await db.execute(
            select(crawl_runs.c.equity_p25, crawl_runs.c.state).where(
                crawl_runs.c.workspace_id == access.workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_runs.c.id == run_id,
            )
        )
    ).one_or_none()
    if row is None or row.state not in ("ready", "stopped_at_ceiling"):
        raise NotFoundError
    return PageScope(access.workspace_id, project_id, run_id, row.equity_p25)


async def select_pages(db: AsyncSession, scope: PageScope, selection: PageSelection) -> list[int]:
    """The latest crawl's pages a bulk body names: its ids that are in the crawl (an id the
    crawl does not hold is left out), or every page the filter matches (`422
    too_many_subjects` over 20,000)."""
    statement = select(crawl_pages.c.url_id).select_from(page_rows(scope))
    if selection.url_ids is not None:
        statement = statement.where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id.in_(selection.url_ids),
        )
    else:
        assert selection.filter is not None
        statement = statement.where(*page_conditions(selection.filter, scope))
    found: list[int] = list((await db.execute(statement.limit(BULK_MATCH_MAX + 1))).scalars())
    if len(found) > BULK_MATCH_MAX:
        raise TooManySubjectsError(limit=BULK_MATCH_MAX)
    return found


async def _tier_ids(db: AsyncSession, workspace_id: UUID) -> dict[UUID, tuple[int, str]]:
    rows = await db.execute(
        select(page_tier_levels.c.id, page_tier_levels.c.position, page_tier_levels.c.name).where(
            page_tier_levels.c.workspace_id == workspace_id
        )
    )
    return {row.id: (row.position, row.name) for row in rows}


async def _check_tier(db: AsyncSession, workspace_id: UUID, tier_id: UUID | None) -> None:
    if tier_id is not None and tier_id not in await _tier_ids(db, workspace_id):
        raise invalid_field(
            "tier_id", code="tier_unknown", message="No such tier in the workspace."
        )


async def _set_manual(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    url_ids: Sequence[int],
    tier_id: UUID | None,
) -> int:
    """Manual rows for these URLs; returns how many were added or changed."""
    changed = 0
    for start in range(0, len(url_ids), _ROWS):
        statement = upsert(project_pages).values(
            [
                {
                    "project_id": project_id,
                    "url_id": url_id,
                    "workspace_id": access.workspace_id,
                    "tier_id": tier_id,
                    "tier_source": "manual",
                    "set_by": access.user_id,
                }
                for url_id in url_ids[start : start + _ROWS]
            ]
        )
        statement = statement.on_conflict_do_update(
            index_elements=[project_pages.c.project_id, project_pages.c.url_id],
            set_={
                "tier_id": statement.excluded.tier_id,
                "tier_source": "manual",
                "rule_id": None,
                "set_by": statement.excluded.set_by,
                "set_at": func.now(),
            },
            where=(project_pages.c.tier_source != "manual")
            | project_pages.c.tier_id.is_distinct_from(statement.excluded.tier_id),
        )
        result = await db.execute(statement.returning(project_pages.c.url_id))
        changed += len(result.all())
    return changed


_RULE_MESSAGES = {
    "starts_with_slash": "A rule matches a path, which starts with `/`.",
    "too_long": "At most 500 characters.",
    "star_in_exact": "`*` is for pattern rules; an exact rule matches one path.",
    "star_in_prefix": "`*` is for pattern rules; a prefix rule matches the start of a path.",
    "too_many_stars": "At most 10 `*` in a pattern.",
}
RULES_MAX = 500
_CLOSE_POSITIONS = text(
    """
    UPDATE core.tier_rules r SET position = o.n
    FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY position) AS n
          FROM core.tier_rules
          WHERE workspace_id = CAST(:workspace_id AS uuid)
            AND project_id = CAST(:project_id AS uuid)) o
    WHERE r.id = o.id AND r.workspace_id = CAST(:workspace_id AS uuid) AND r.position <> o.n
    """
)


def _check_value(match_type: str, value: str) -> None:
    problem = check_rule_value(MatchType(match_type), value)
    if problem is not None:
        raise invalid_field("value", code=problem, message=_RULE_MESSAGES[problem])


async def close_rule_positions(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> None:
    """Positions 1 to N again after rules were removed."""
    await db.execute(
        _CLOSE_POSITIONS, {"workspace_id": str(workspace_id), "project_id": str(project_id)}
    )


async def rule_records(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[RuleRecord]:
    rows = await db.execute(
        select(
            tier_rules,
            page_tier_levels.c.position.label("tier_position"),
            page_tier_levels.c.name.label("tier_name"),
        )
        .join(page_tier_levels, page_tier_levels.c.id == tier_rules.c.tier_id)
        .where(tier_rules.c.workspace_id == workspace_id, tier_rules.c.project_id == project_id)
        .order_by(tier_rules.c.position)
    )
    return [
        RuleRecord(
            rule_id=row.id,
            position=row.position,
            match_type=cast(MatchTypeName, row.match_type),
            value=row.value,
            tier_id=row.tier_id,
            tier_position=row.tier_position,
            tier_name=row.tier_name,
            created_at=row.created_at,
        )
        for row in rows
    ]


async def _site_hosts(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> frozenset[str]:
    project = await project_repository.get_project(db, workspace_id, project_id)
    if project is None:
        raise NotFoundError
    if project.primary_host is None:
        return frozenset()
    settings: dict[str, Any] | None = (
        await db.execute(
            select(projects.c.settings).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one()
    allowed = (settings or {}).get("internal_links", {}).get("allowed_subdomains", [])
    return site_hosts(project.primary_host, allowed)


def _tier_names(tiers: dict[UUID, tuple[int, str]]) -> dict[str, UUID | None]:
    """What a CSV `tier` cell may say, lower case: a code, a name, a label, or Untiered."""
    names: dict[str, UUID | None] = {"none": None, "untiered": None}
    for tier_id, (position, name) in tiers.items():
        for spelling in (f"t{position}", name.lower(), f"t{position} {name.lower()}"):
            names[spelling] = tier_id
    return names


def parse_tier_csv(
    text_in: str, tiers: dict[UUID, tuple[int, str]], hosts: frozenset[str]
) -> tuple[list[tuple[int, CanonicalUrl, UUID | None]], list[ImportProblem]]:
    """Rows as (line, URL, tier), the last row of a URL winning, and the problems by line."""
    # A spreadsheet export may start with a byte order mark.
    reader = csv.reader(io.StringIO(text_in.removeprefix("﻿")))
    header = [cell.strip().lower() for cell in next(reader, [])]
    if "url" not in header or "tier" not in header:
        return [], [
            ImportProblem(
                line=1, code="missing_column", message="The first line names `url` and `tier`."
            )
        ]
    names = _tier_names(tiers)
    rows: dict[bytes, tuple[int, CanonicalUrl, UUID | None]] = {}
    problems: list[ImportProblem] = []
    for line, record in enumerate(reader, start=2):
        if not any(cell.strip() for cell in record):
            continue
        if len(rows) + len(problems) >= CSV_ROWS_MAX:
            problems.append(
                ImportProblem(
                    line=line, code="too_many_rows", message=f"At most {CSV_ROWS_MAX} rows."
                )
            )
            break
        cells = dict(zip(header, record, strict=False))
        tier_text = " ".join((cells.get("tier") or "").split()).lower()
        try:
            url = canonicalize((cells.get("url") or "").strip())
        except UrlRejectedError:
            problems.append(
                ImportProblem(line=line, code="invalid_url", message="Not an http or https URL.")
            )
            continue
        if url.host.name not in hosts:
            problems.append(
                ImportProblem(line=line, code="other_site", message="Not a page of this site.")
            )
            continue
        if tier_text not in names:
            problems.append(
                ImportProblem(
                    line=line, code="unknown_tier", message=f"No tier is called {tier_text!r}."
                )
            )
            continue
        rows[url.url_hash] = (line, url, names[tier_text])
    return sorted(rows.values(), key=lambda row: row[0]), problems


class PageTierService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def _audit(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        info: RequestInfo,
        after: audit.Snapshot,
    ) -> None:
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action="page_tiers.changed",
            target_type="project",
            target_id=project_id,
            info=info,
            after=after,
        )

    async def set_tiers(
        self, access: WorkspaceAccess, project_id: UUID, body: PageTierSet, info: RequestInfo
    ) -> tuple[int, int]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await crawl_scope(db, access, project_id, None)
            await _check_tier(db, access.workspace_id, body.tier_id)
            ids = await select_pages(db, scope, body)
            changed = await _set_manual(db, access, project_id, ids, body.tier_id)
            await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
            await self._audit(
                db,
                access,
                project_id,
                info,
                {
                    "tier_id": None if body.tier_id is None else str(body.tier_id),
                    "pages": len(ids),
                    "changed": changed,
                },
            )
            return len(ids), changed

    async def reset(
        self, access: WorkspaceAccess, project_id: UUID, body: PageSelection, info: RequestInfo
    ) -> tuple[int, int]:
        """Manual tiers go; the rules decide again."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await crawl_scope(db, access, project_id, None)
            ids = await select_pages(db, scope, body)
            removed = 0
            for start in range(0, len(ids), _ROWS):
                result = await db.execute(
                    delete(project_pages)
                    .where(
                        project_pages.c.workspace_id == access.workspace_id,
                        project_pages.c.project_id == project_id,
                        project_pages.c.url_id.in_(ids[start : start + _ROWS]),
                        project_pages.c.tier_source == "manual",
                    )
                    .returning(project_pages.c.url_id)
                )
                removed += len(result.all())
            await apply_rules(db, workspace_id=access.workspace_id, project_id=project_id)
            await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
            await self._audit(db, access, project_id, info, {"reset": len(ids), "changed": removed})
            return len(ids), removed

    async def import_tiers(
        self, access: WorkspaceAccess, project_id: UUID, csv_text: str, info: RequestInfo
    ) -> TierImportResult:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            hosts = await _site_hosts(db, access.workspace_id, project_id)
            rows, problems = parse_tier_csv(
                csv_text, await _tier_ids(db, access.workspace_id), hosts
            )
            if problems:
                return TierImportResult(
                    accepted=len(rows), pending=[], errors=problems, applied=False
                )
            found = await dictionaries.urls_for(db, [url for _, url, _ in rows])
            run_id = await latest_run(db, access.workspace_id, project_id)
            crawled: set[int] = set()
            if run_id is not None:
                crawled = set(
                    (
                        await db.execute(
                            select(crawl_pages.c.url_id).where(
                                crawl_pages.c.workspace_id == access.workspace_id,
                                crawl_pages.c.run_id == run_id,
                            )
                        )
                    ).scalars()
                )
            by_tier: dict[UUID | None, list[int]] = {}
            pending = []
            for line, url, tier_id in rows:
                url_id = found[url.url_hash].id
                by_tier.setdefault(tier_id, []).append(url_id)
                if url_id not in crawled:
                    pending.append(ImportPending(line=line, url=url.url))
            for tier_id, ids in by_tier.items():
                await _set_manual(db, access, project_id, ids, tier_id)
            await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
            await self._audit(db, access, project_id, info, {"source": "csv", "pages": len(rows)})
            return TierImportResult(accepted=len(rows), pending=pending, errors=[], applied=True)

    async def change_tags(
        self, access: WorkspaceAccess, project_id: UUID, body: PageTagChange, info: RequestInfo
    ) -> tuple[int, int, int]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await crawl_scope(db, access, project_id, None)
            wanted = set(body.add) | set(body.remove)
            tags: set[UUID] = set()
            if wanted:
                tags = set(
                    (
                        await db.execute(
                            select(taxonomy_terms.c.id)
                            .join(
                                taxonomy_vocabularies,
                                taxonomy_vocabularies.c.id == taxonomy_terms.c.vocabulary_id,
                            )
                            .where(
                                taxonomy_terms.c.id.in_(sorted(wanted)),
                                taxonomy_vocabularies.c.workspace_id == access.workspace_id,
                                taxonomy_vocabularies.c.kind == "tag",
                                or_(
                                    taxonomy_vocabularies.c.project_id.is_(None),
                                    taxonomy_vocabularies.c.project_id == project_id,
                                ),
                            )
                        )
                    ).scalars()
                )
            if wanted - tags:
                field = "add" if set(body.add) - tags else "remove"
                raise invalid_field(
                    field, code="not_a_tag", message="Only terms of a tag vocabulary tag pages."
                )
            ids = await select_pages(db, scope, body)
            added = removed = 0
            pairs = [(url_id, term_id) for url_id in ids for term_id in body.add]
            for start in range(0, len(pairs), _ROWS):
                result = await db.execute(
                    upsert(page_terms)
                    .values(
                        [
                            {
                                "project_id": project_id,
                                "url_id": url_id,
                                "term_id": term_id,
                                "workspace_id": access.workspace_id,
                            }
                            for url_id, term_id in pairs[start : start + _ROWS]
                        ]
                    )
                    .on_conflict_do_nothing()
                    .returning(page_terms.c.url_id)
                )
                added += len(result.all())
            if body.remove:
                for start in range(0, len(ids), _ROWS):
                    result = await db.execute(
                        delete(page_terms)
                        .where(
                            page_terms.c.workspace_id == access.workspace_id,
                            page_terms.c.project_id == project_id,
                            page_terms.c.url_id.in_(ids[start : start + _ROWS]),
                            page_terms.c.term_id.in_(body.remove),
                        )
                        .returning(page_terms.c.url_id)
                    )
                    removed += len(result.all())
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_tags.changed",
                target_type="project",
                target_id=project_id,
                info=info,
                after={
                    "add": [str(term) for term in body.add],
                    "remove": [str(term) for term in body.remove],
                    "pages": len(ids),
                },
            )
            return len(ids), added, removed

    async def list_rules(self, access: WorkspaceAccess, project_id: UUID) -> list[RuleRecord]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            return await rule_records(db, access.workspace_id, project_id)

    async def _rule_changed(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        rule_id: UUID,
        action: audit.AuditAction,
        info: RequestInfo,
        before: audit.Snapshot | None,
        after: audit.Snapshot | None,
    ) -> None:
        await apply_rules(db, workspace_id=access.workspace_id, project_id=project_id)
        await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action=action,
            target_type="tier_rule",
            target_id=rule_id,
            info=info,
            before=before,
            after=after,
        )

    async def create_rule(
        self, access: WorkspaceAccess, project_id: UUID, body: TierRuleCreate, info: RequestInfo
    ) -> RuleRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            _check_value(body.match_type, body.value)
            await _check_tier(db, access.workspace_id, body.tier_id)
            rules = await rule_records(db, access.workspace_id, project_id)
            if len(rules) >= RULES_MAX:
                raise invalid_field("position", code="rule_limit", message="At most 500 rules.")
            position = min(body.position or len(rules) + 1, len(rules) + 1)
            await db.execute(
                update(tier_rules)
                .where(
                    tier_rules.c.workspace_id == access.workspace_id,
                    tier_rules.c.project_id == project_id,
                    tier_rules.c.position >= position,
                )
                .values(position=tier_rules.c.position + 1)
            )
            rule_id: UUID = (
                await db.execute(
                    insert(tier_rules)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        position=position,
                        match_type=body.match_type,
                        value=body.value,
                        tier_id=body.tier_id,
                        created_by=access.user_id,
                    )
                    .returning(tier_rules.c.id)
                )
            ).scalar_one()
            after: audit.Snapshot = {
                "match_type": body.match_type,
                "value": body.value,
                "position": position,
            }
            await self._rule_changed(
                db, access, project_id, rule_id, "tier_rule.created", info, None, after
            )
            return next(
                rule
                for rule in await rule_records(db, access.workspace_id, project_id)
                if rule.rule_id == rule_id
            )

    async def update_rule(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        rule_id: UUID,
        body: TierRulePatch,
        info: RequestInfo,
    ) -> RuleRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            rules = await rule_records(db, access.workspace_id, project_id)
            rule = next((found for found in rules if found.rule_id == rule_id), None)
            if rule is None:
                raise NotFoundError
            changes = body.model_dump(exclude_unset=True)
            _check_value(
                changes.get("match_type", rule.match_type), changes.get("value", rule.value)
            )
            if "tier_id" in changes:
                await _check_tier(db, access.workspace_id, changes["tier_id"])
            old = rule.position
            new: int = min(changes.pop("position", old), len(rules))
            # One statement, so the deferrable position key is checked once, after the move.
            await db.execute(
                update(tier_rules)
                .where(
                    tier_rules.c.workspace_id == access.workspace_id,
                    tier_rules.c.project_id == project_id,
                )
                .values(
                    position=case(
                        (tier_rules.c.id == rule_id, new),
                        (
                            (tier_rules.c.position >= new) & (tier_rules.c.position < old),
                            tier_rules.c.position + 1,
                        ),
                        (
                            (tier_rules.c.position > old) & (tier_rules.c.position <= new),
                            tier_rules.c.position - 1,
                        ),
                        else_=tier_rules.c.position,
                    )
                )
            )
            if changes:
                await db.execute(
                    update(tier_rules)
                    .where(
                        tier_rules.c.workspace_id == access.workspace_id, tier_rules.c.id == rule_id
                    )
                    .values(**changes)
                )
            await self._rule_changed(
                db,
                access,
                project_id,
                rule_id,
                "tier_rule.updated",
                info,
                {"match_type": rule.match_type, "value": rule.value, "position": old},
                {
                    "match_type": str(changes.get("match_type", rule.match_type)),
                    "value": str(changes.get("value", rule.value)),
                    "position": new,
                },
            )
            return next(
                found
                for found in await rule_records(db, access.workspace_id, project_id)
                if found.rule_id == rule_id
            )

    async def delete_rule(
        self, access: WorkspaceAccess, project_id: UUID, rule_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            gone = (
                await db.execute(
                    delete(tier_rules)
                    .where(
                        tier_rules.c.workspace_id == access.workspace_id,
                        tier_rules.c.project_id == project_id,
                        tier_rules.c.id == rule_id,
                    )
                    .returning(tier_rules.c.match_type, tier_rules.c.value)
                )
            ).one_or_none()
            if gone is None:
                raise NotFoundError
            await close_rule_positions(db, access.workspace_id, project_id)
            await self._rule_changed(
                db,
                access,
                project_id,
                rule_id,
                "tier_rule.deleted",
                info,
                {"match_type": gone.match_type, "value": gone.value},
                None,
            )

    async def preview_rule(
        self, access: WorkspaceAccess, project_id: UUID, body: TierRulePreviewRequest
    ) -> TierRulePreview:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            _check_value(body.match_type, body.value)
            scope = await crawl_scope(db, access, project_id, None)
            others = sorted(
                (
                    rule
                    for rule in await project_rules(db, access.workspace_id, project_id)
                    if rule.rule_id != body.rule_id
                ),
                key=lambda rule: rule.position,
            )
            candidate = TierRule(
                rule_id=body.rule_id or UUID(int=0),
                position=0,
                match_type=MatchType(body.match_type),
                value=body.value,
                tier_id=UUID(int=0),
            )
            at = min((body.position or len(others) + 1) - 1, len(others))
            ordered = [
                TierRule(rule.rule_id, position, rule.match_type, rule.value, rule.tier_id)
                for position, rule in enumerate([*others[:at], candidate, *others[at:]], start=1)
            ]
            chosen = ordered[at]
            rows = await db.execute(
                select(urls.c.path, project_pages.c.tier_source)
                .select_from(page_rows(scope))
                .where(
                    crawl_pages.c.workspace_id == scope.workspace_id,
                    crawl_pages.c.run_id == scope.run_id,
                )
            )
            matching = would = 0
            for row in rows:
                if not rule_matches(chosen, row.path):
                    continue
                matching += 1
                if row.tier_source != "manual" and first_match(ordered, row.path) == chosen:
                    would += 1
            return TierRulePreview(matching_pages=matching, would_apply=would)
