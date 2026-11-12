"""Cited sources and the citations behind them (docs/16 section 7, docs/19 section 3.7.7 cut to
slice 1; plan D2): what the Citations page and the prompt inspector's Citations tab read, over a
window of project-local days and the answers the prompts summary counts."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import source_repository as repository
from idraft.api.ai.source_repository import CitationFilter, Counted, SourceScope, Totals
from idraft.api.ai.summary import summary_dates
from idraft.api.pagination import (
    CursorPageInfo,
    CursorParams,
    OffsetPageInfo,
    OffsetParams,
    cursor_instant,
    decode_cursor,
    encode_cursor,
    invalid_cursor,
)
from idraft.api.problems import NotFoundError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.ai_sources import (
    CitationPage,
    CitationRow,
    DomainRole,
    EngineUnits,
    PreviousUnits,
    RoleUnits,
    SourceCompare,
    SourceDomainPage,
    SourceDomainRow,
    SourcePagePage,
    SourcePageRow,
    SourcesMeta,
    SourceSort,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import EngineCode


@dataclass(frozen=True, slots=True)
class SourceQuery:
    """The scope parameters every source route takes."""

    start: date | None = None
    end: date | None = None
    engine_codes: Sequence[EngineCode] | None = None
    include_branded: bool = False
    prompt_id: UUID | None = None
    term_id: UUID | None = None
    roles: Sequence[DomainRole] | None = None


@dataclass(frozen=True, slots=True)
class Scoped:
    """A request's scope, with its window as local days and as the answer states it."""

    scope: SourceScope
    window: MetricWindow
    first: date
    last: date
    zone: ZoneInfo


def out_of_range(field: str) -> RequestValidationError:
    return RequestValidationError(
        [{"loc": ("query", field), "type": "out_of_range", "msg": f"`{field}` is out of range."}]
    )


def local_instants(first: date, last: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    try:
        return instants(first, last, zone)
    except (OverflowError, ValueError):
        raise out_of_range("to") from None


def shown_engines(asked: Sequence[EngineCode] | None) -> list[str]:
    """The engines a read counts: those asked for, else the three of slice 1, in code order."""
    return sorted({str(code) for code in (asked or list(EngineCode))})


async def scoped(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    query: SourceQuery,
    engines: Sequence[str],
) -> Scoped:
    """The request's scope in the project's timezone; `404` for a deleted or unknown project."""
    zone_row = await project_zone(db, access.workspace_id, project_id)
    if zone_row is None:
        raise NotFoundError
    zone = ZoneInfo(zone_row.timezone)
    first, last = summary_dates(query.start, query.end, datetime.now(zone).date())
    since, until = local_instants(first, last, zone)
    prompt_ids = await repository.scope_prompts(
        db,
        access.workspace_id,
        project_id,
        include_branded=query.include_branded,
        prompt_id=query.prompt_id,
        term_id=query.term_id,
    )
    return Scoped(
        scope=SourceScope(
            workspace_id=access.workspace_id,
            project_id=project_id,
            since=since,
            until=until,
            engine_codes=tuple(engines),
            prompt_ids=prompt_ids,
        ),
        window=MetricWindow(
            from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
        ),
        first=first,
        last=last,
        zone=zone,
    )


def engine_units(counted: Counted, engines: Sequence[str]) -> list[EngineUnits]:
    return [
        EngineUnits(engine_code=EngineCode(code), citation_units=units)
        for code, units in zip(engines, counted.engine_units, strict=True)
    ]


def share(units: int, totals: Totals) -> MetricCell:
    """A source's units over every unit in scope (docs/16 C1)."""
    whole = totals.citation_units
    return MetricCell(
        value=None if whole == 0 else units / whole,
        numerator=units,
        denominator=whole,
        n_observations=totals.answers,
    )


def sources_meta(
    now: Scoped, query: SourceQuery, engines: Sequence[str], totals: Totals
) -> SourcesMeta:
    return SourcesMeta(
        window=now.window,
        include_branded=query.include_branded,
        engine_codes=[EngineCode(code) for code in engines],
        answers=totals.answers,
        answers_citing=totals.answers_citing,
        citation_units=totals.citation_units,
        by_role=[
            RoleUnits(domain_role=cast(DomainRole, role), citation_units=units, observations=seen)
            for role, (units, seen) in totals.by_role.items()
        ],
    )


def previous_dates(first: date, last: date) -> tuple[date, date]:
    """As many local days as `first` to `last`, ending the day before `first`."""
    try:
        return first - timedelta(days=(last - first).days + 1), first - timedelta(days=1)
    except OverflowError:
        raise out_of_range("from") from None


def before(now: Scoped) -> Scoped:
    """The scope over the window just before `now`'s."""
    first, last = previous_dates(now.first, now.last)
    since, until = local_instants(first, last, now.zone)
    return Scoped(
        scope=replace(now.scope, since=since, until=until),
        window=MetricWindow(
            from_=first.isoformat(), to=last.isoformat(), timezone=now.window.timezone
        ),
        first=first,
        last=last,
        zone=now.zone,
    )


def previous_units(found: tuple[int, int] | None) -> PreviousUnits:
    units, seen = found or (0, 0)
    return PreviousUnits(citation_units=units, observations=seen)


def compared(meta: SourcesMeta, prior: Scoped | None, answers: int | None) -> SourcesMeta:
    if prior is None:
        return meta
    return meta.model_copy(update={"compare_window": prior.window, "previous_answers": answers})


def _cursor_scope(
    project_id: UUID,
    query: SourceQuery,
    engines: Sequence[str],
    registrable_domain: str | None,
    url_id: int | None,
) -> dict[str, object]:
    """What a citation cursor is bound to: the project and every filter."""
    return {
        "project_id": str(project_id),
        "from": query.start,
        "to": query.end,
        "engines": list(engines),
        "prompt": query.prompt_id,
        "term": query.term_id,
        "branded": query.include_branded,
        "roles": sorted(query.roles or []),
        "domain": registrable_domain,
        "url": url_id,
    }


_SMALLINT_MAX = 2**15 - 1


def _after(cursor: str, bound: dict[str, object]) -> tuple[datetime, int, int]:
    key = decode_cursor(cursor, scope=bound)
    if len(key) != 3:
        raise invalid_cursor()
    at_text, observation_id, index = key
    # `citations.citation_index` is a smallint counted from 1 and ids a bigint from 1: a key
    # outside them could only come from a forged cursor, and would fail in the database.
    if (
        not isinstance(observation_id, int)
        or not isinstance(index, int)
        or observation_id < 0
        or not 1 <= index <= _SMALLINT_MAX
    ):
        raise invalid_cursor()
    return cursor_instant(at_text), observation_id, index


class SourceService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    @asynccontextmanager
    async def _transaction(self, access: WorkspaceAccess) -> AsyncIterator[AsyncSession]:
        # One snapshot for the rows, the answer count and the role rollup, so a page and its
        # `meta` and shares agree even while an answer is being ingested.
        async with workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        ) as db:
            # The citations join their answers on a key, but a planner without statistics (a
            # new month's partition, a backfill) thinks the answers are one row and picks, for
            # some statements, a nested loop that compares every answer with every citation
            # (130 million comparisons, 7 s, for 3,600 answers). Hash and merge joins do not
            # depend on that estimate. Local to this transaction, so the pool is untouched.
            await db.execute(text("SET LOCAL enable_nestloop = off"))
            yield db

    async def domains(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        sort: SourceSort,
        compare: SourceCompare = "none",
        page: OffsetParams,
    ) -> SourceDomainPage:
        engines = shown_engines(query.engine_codes)
        prior: Scoped | None = None
        found: dict[tuple[str, str, UUID | None], tuple[int, int]] = {}
        prior_answers: int | None = None
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows, total = await repository.domain_counts(
                db, now.scope, roles=query.roles, sort=sort, offset=page.offset, limit=page.limit
            )
            whole = await repository.totals(db, now.scope)
            if compare == "previous_period":
                prior = before(now)
                found = await repository.previous_domains(
                    db, prior.scope, {row.registrable_domain for row in rows}
                )
                prior_answers = await repository.answer_count(db, prior.scope)
        return SourceDomainPage(
            data=[
                SourceDomainRow(
                    registrable_domain=row.registrable_domain,
                    domain_role=cast(DomainRole, row.domain_role),
                    role_entity_id=row.role_entity_id,
                    citation_units=row.counted.citation_units,
                    observations=row.counted.observations,
                    prompts=row.counted.prompts,
                    engines=engine_units(row.counted, engines),
                    source_share=share(row.counted.citation_units, whole),
                    first_seen_at=row.counted.first_seen_at,
                    last_seen_at=row.counted.last_seen_at,
                    previous=None
                    if prior is None
                    else previous_units(
                        found.get((row.registrable_domain, row.domain_role, row.role_entity_id))
                    ),
                )
                for row in rows
            ],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
            meta=compared(sources_meta(now, query, engines, whole), prior, prior_answers),
        )

    async def pages(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        registrable_domain: str | None,
        sort: SourceSort,
        compare: SourceCompare = "none",
        page: OffsetParams,
    ) -> SourcePagePage:
        engines = shown_engines(query.engine_codes)
        prior: Scoped | None = None
        found: dict[tuple[int, str, UUID | None], tuple[int, int]] = {}
        prior_answers: int | None = None
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows, total = await repository.page_counts(
                db,
                now.scope,
                roles=query.roles,
                registrable_domain=registrable_domain,
                sort=sort,
                offset=page.offset,
                limit=page.limit,
            )
            whole = await repository.totals(db, now.scope)
            if compare == "previous_period":
                prior = before(now)
                found = await repository.previous_pages(
                    db, prior.scope, {row.url_id for row in rows}
                )
                prior_answers = await repository.answer_count(db, prior.scope)
        return SourcePagePage(
            data=[
                SourcePageRow(
                    url_id=row.url_id,
                    url=row.url,
                    host=row.host,
                    registrable_domain=row.registrable_domain,
                    title=row.title,
                    domain_role=cast(DomainRole, row.domain_role),
                    role_entity_id=row.role_entity_id,
                    citation_units=row.counted.citation_units,
                    observations=row.counted.observations,
                    prompts=row.counted.prompts,
                    engines=engine_units(row.counted, engines),
                    source_share=share(row.counted.citation_units, whole),
                    first_seen_at=row.counted.first_seen_at,
                    last_seen_at=row.counted.last_seen_at,
                    previous=None
                    if prior is None
                    else previous_units(
                        found.get((row.url_id, row.domain_role, row.role_entity_id))
                    ),
                )
                for row in rows
            ],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
            meta=compared(sources_meta(now, query, engines, whole), prior, prior_answers),
        )

    async def citations(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        registrable_domain: str | None,
        url_id: int | None,
        page: CursorParams,
    ) -> CitationPage:
        engines = shown_engines(query.engine_codes)
        bound = _cursor_scope(project_id, query, engines, registrable_domain, url_id)
        after = None if page.cursor is None else _after(page.cursor, bound)
        given = CitationFilter(
            roles=query.roles, registrable_domain=registrable_domain, url_id=url_id
        )
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows = await repository.citation_rows(
                db, now.scope, given, after=after, limit=page.limit + 1
            )
        shown = rows[: page.limit]
        next_cursor = None
        if len(rows) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor(
                [last.observed_at.isoformat(), last.observation_id, last.citation_index],
                scope=bound,
            )
        return CitationPage(
            data=[
                CitationRow(
                    observation_id=str(row.observation_id),
                    observed_at=row.observed_at,
                    prompt_id=row.prompt_id,
                    engine_code=EngineCode(row.engine_code),
                    citation_index=row.citation_index,
                    url_id=row.url_id,
                    url=row.canonical_url,
                    raw_url=row.raw_url,
                    host=row.host,
                    registrable_domain=row.registrable_domain,
                    title=row.title,
                    citation_kind=row.citation_kind,
                    domain_role=cast(DomainRole, row.domain_role),
                    role_entity_id=row.role_entity_id,
                    occurrences=row.occurrences,
                )
                for row in shown
            ],
            page=CursorPageInfo(
                limit=page.limit, next_cursor=next_cursor, has_more=next_cursor is not None
            ),
        )
