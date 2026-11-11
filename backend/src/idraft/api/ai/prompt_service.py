"""Rules for prompts (docs/19-api-specification.md section 3.7.1, cut to slice 1: spec
2026-11-11 sections 4.2 and 4.5).

A prompt's text is fixed once saved; to change one, archive it and add a new one. Its identity
is its composed text (`idraft.ai.text`) with its language and country: the same text twice in a
project is `409 duplicate`, archived prompts included, since they keep their answers (plan
decision A2). Writers of one workspace take a lock first, so the active prompt quota and the
duplicate check hold under concurrent writes. A prompt's country must be one every enabled
engine of the project runs in, so no prompt is saved to be skipped everywhere; a prompt brought
back from the archive is not checked again, and an engine without its country skips it.
`is_branded` is computed from the project's own aliases when a prompt is saved. Every change is
audited in its transaction.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.text import text_hash
from idraft.api import audit
from idraft.api.ai import engine_repository as engines
from idraft.api.ai import prompt_repository as prompts
from idraft.api.ai.engine_service import live_project
from idraft.api.ai.prompt_repository import NewPrompt, PromptFilter, PromptKey, PromptRecord
from idraft.api.entities.project_service import MatcherRules, matcher_rules
from idraft.api.keywords import repository as keywords
from idraft.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import (
    DuplicateError,
    FieldError,
    NotFoundError,
    QuotaExceededError,
    TooManyMatchesError,
    invalid_fields,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai import PromptCreate, PromptPatch
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import ENGINES, EngineCode
from idraft.extraction.aliases import AliasMatcher, MatchResult
from idraft.extraction.aliases import TooManyMatchesError as TooManyHitsError
from idraft.keywords.links import TermRecord

DUPLICATE: Final = "The project has this prompt already, in this language and country."
# What a change may set directly; terms are replaced through their own table.
_COLUMNS: Final = frozenset(
    {"intent", "funnel_stage", "prompt_type", "importance", "is_branded", "is_active"}
)


@dataclass(frozen=True, slots=True)
class PromptPageResult:
    prompts: list[PromptRecord]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class Rejected:
    index: int
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class BulkOutcome:
    created: list[UUID]
    skipped: list[tuple[int, UUID]]
    rejected: list[Rejected]


@dataclass(frozen=True, slots=True)
class Checks:
    """What items are checked against: the terms they name that the project may use, held
    until the transaction ends, and the countries of the project's enabled engines."""

    terms: Mapping[UUID, TermRecord]
    countries: Mapping[EngineCode, set[str]]

    def error(self, item: PromptCreate) -> FieldError | None:
        return term_error(item.term_ids, self.terms) or _country_error(
            item.country_iso, self.countries
        )


def term_error(term_ids: Sequence[UUID], usable: Mapping[UUID, TermRecord]) -> FieldError | None:
    if set(term_ids) - usable.keys():
        return FieldError("term_ids", "term_unknown", "A term the project cannot use.")
    per_vocabulary = Counter(
        usable[term_id].vocabulary_id
        for term_id in set(term_ids)
        if usable[term_id].is_single_valued
    )
    if any(count > 1 for count in per_vocabulary.values()):
        return FieldError(
            "term_ids", "single_valued_vocabulary", "Two terms of one single-valued vocabulary."
        )
    return None


def _country_error(country_iso: str, countries: Mapping[EngineCode, set[str]]) -> FieldError | None:
    for code in sorted(countries):
        if country_iso not in countries[code]:
            return FieldError(
                "country_iso",
                "location_not_supported",
                f"{ENGINES[code].label} runs in no location of this country. Add one in the "
                "project's engine settings, or turn the engine off.",
            )
    return None


def key_of(item: PromptCreate) -> PromptKey:
    return (text_hash(item.text), item.language_code, item.country_iso)


def quota_error(limit: int, used: int, requested: int) -> QuotaExceededError:
    return QuotaExceededError(
        f"The workspace has {used} of {limit} active prompts; {requested} more do not fit.",
        limit=limit,
        used=used,
        requested=requested,
    )


def own_entities(rules: MatcherRules) -> set[UUID]:
    return {entity.id for entity in rules.entities if entity.role == "own"}


def names_own(result: MatchResult, own: set[UUID]) -> bool:
    return any(
        mention.entity_id in own and mention.status == "accepted" for mention in result.mentions
    )


async def matched(rules: MatcherRules, texts: Sequence[str]) -> list[MatchResult]:
    """Each text matched against the project's aliases. Compiling and matching is CPU work, so
    it runs off the event loop."""

    def run() -> list[MatchResult]:
        matcher = AliasMatcher(rules.rules, rules.aliases)
        return [matcher.match(text) for text in texts]

    try:
        return await asyncio.to_thread(run)
    except TooManyHitsError:
        raise TooManyMatchesError(
            "The aliases match a prompt too many times. Narrow a substring alias."
        ) from None


async def checks_for(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, items: Sequence[PromptCreate]
) -> Checks:
    wanted = {term_id for item in items for term_id in item.term_ids}
    usable = await keywords.project_terms(db, access.workspace_id, project_id, wanted)
    return Checks(
        terms={term.term_id: term for term in usable},
        countries=await engines.enabled_countries(db, access.workspace_id, project_id),
    )


def _snapshot(record: PromptRecord) -> audit.Snapshot:
    return {
        "text": record.current_version.text,
        "language_code": record.language_code,
        "country_iso": record.country_iso,
        "intent": record.intent,
        "funnel_stage": record.funnel_stage,
        "prompt_type": record.prompt_type,
        "importance": record.importance,
        "is_branded": record.is_branded,
        "is_active": record.is_active,
        "term_ids": sorted(str(term.term_id) for term in record.terms),
    }


async def write(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    items: Sequence[PromptCreate],
    info: RequestInfo,
) -> list[PromptRecord]:
    """Checked prompts written with `is_branded` from the project's own aliases, each audited."""
    if not items:
        return []
    rules = await matcher_rules(db, access.workspace_id, project_id)
    own = own_entities(rules)
    results = await matched(rules, [item.text for item in items])
    ids = await prompts.insert_prompts(
        db,
        workspace_id=access.workspace_id,
        project_id=project_id,
        items=[
            NewPrompt(
                text=item.text,
                text_hash=text_hash(item.text),
                language_code=item.language_code,
                country_iso=item.country_iso,
                intent=item.intent,
                funnel_stage=item.funnel_stage,
                prompt_type=item.prompt_type,
                importance=item.importance,
                is_branded=names_own(result, own),
                term_ids=tuple(sorted(set(item.term_ids))),
            )
            for item, result in zip(items, results, strict=True)
        ],
        created_by=access.user_id,
        now=datetime.now(UTC),
    )
    records = await prompts.prompts_by_ids(db, access.workspace_id, project_id, ids)
    await audit.record_each(
        db,
        workspace_id=access.workspace_id,
        actor_id=access.user_id,
        action="prompt.created",
        target_type="prompt",
        info=info,
        entries=[audit.Entry(target_id=record.id, after=_snapshot(record)) for record in records],
    )
    return records


def _scope(project_id: UUID, given: PromptFilter) -> dict[str, object]:
    """What a cursor is bound to: the project and the filters."""
    return {
        "project_id": str(project_id),
        "q": given.q,
        "term": None if given.term is None else str(given.term),
        "intents": sorted(given.intents),
        "country_iso": given.country_iso,
        "language_code": given.language_code,
        "is_active": given.is_active,
    }


def _after(cursor: str, scope: dict[str, object]) -> UUID:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 1 or not isinstance(key[0], str):
        raise invalid_cursor()
    try:
        return UUID(key[0])
    except ValueError:
        raise invalid_cursor() from None


class PromptService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: PromptFilter,
        *,
        cursor: str | None,
        limit: int,
    ) -> PromptPageResult:
        scope = _scope(project_id, given)
        after = None if cursor is None else _after(cursor, scope)
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            found = await prompts.list_prompts(
                db, access.workspace_id, project_id, given, after=after, limit=limit + 1
            )
        shown = found[:limit]
        next_cursor = (
            encode_cursor([str(shown[-1].id)], scope=scope) if len(found) > limit else None
        )
        return PromptPageResult(prompts=shown, next_cursor=next_cursor)

    async def get(self, access: WorkspaceAccess, project_id: UUID, prompt_id: UUID) -> PromptRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            found = await prompts.get_prompt(db, access.workspace_id, project_id, prompt_id)
        if found is None:
            raise NotFoundError
        return found

    async def create(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptCreate, info: RequestInfo
    ) -> PromptRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            await prompts.lock_prompt_writes(db, access.workspace_id)
            checks = await checks_for(db, access, project_id, [body])
            error = checks.error(body)
            if error is not None:
                raise invalid_fields([error])
            key = key_of(body)
            found = await prompts.existing(db, access.workspace_id, project_id, [key])
            if key in found:
                raise DuplicateError(DUPLICATE, existing_id=found[key])
            limit, used = await prompts.quota_usage(db, access.workspace_id)
            if used + 1 > limit:
                raise quota_error(limit, used, 1)
            (created,) = await write(db, access, project_id, [body], info)
        return created

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        prompt_id: UUID,
        body: PromptPatch,
        info: RequestInfo,
    ) -> PromptRecord:
        given = body.model_fields_set
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            # Same order as create: the workspace lock, then the prompt row.
            if body.is_active is True:
                await prompts.lock_prompt_writes(db, access.workspace_id)
            current = await prompts.get_prompt(
                db, access.workspace_id, project_id, prompt_id, lock=True
            )
            if current is None:
                raise NotFoundError
            if body.term_ids is not None:
                usable = await keywords.project_terms(
                    db, access.workspace_id, project_id, set(body.term_ids)
                )
                error = term_error(body.term_ids, {term.term_id: term for term in usable})
                if error is not None:
                    raise invalid_fields([error])
                await prompts.replace_terms(
                    db, access.workspace_id, prompt_id, sorted(set(body.term_ids))
                )
            values = {name: getattr(body, name) for name in given & _COLUMNS}
            if values.get("is_active") is True and not current.is_active:
                limit, used = await prompts.quota_usage(db, access.workspace_id)
                if used + 1 > limit:
                    raise quota_error(limit, used, 1)
            if values:
                await prompts.update_prompt(
                    db, access.workspace_id, prompt_id, {**values, "updated_at": datetime.now(UTC)}
                )
            updated = await prompts.get_prompt(db, access.workspace_id, project_id, prompt_id)
            if updated is None:  # pragma: no cover - read in this transaction
                raise NotFoundError
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.updated",
                target_type="prompt",
                target_id=prompt_id,
                info=info,
                before=_snapshot(current),
                after=_snapshot(updated),
            )
        return updated

    async def archive(
        self, access: WorkspaceAccess, project_id: UUID, prompt_id: UUID, info: RequestInfo
    ) -> None:
        """The prompt stops being asked and keeps its answers (plan decision A7). Archiving an
        archived prompt changes nothing."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            current = await prompts.get_prompt(
                db, access.workspace_id, project_id, prompt_id, lock=True
            )
            if current is None:
                raise NotFoundError
            if not current.is_active:
                return
            await prompts.update_prompt(
                db,
                access.workspace_id,
                prompt_id,
                {"is_active": False, "updated_at": datetime.now(UTC)},
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.archived",
                target_type="prompt",
                target_id=prompt_id,
                info=info,
                before={"is_active": True},
                after={"is_active": False},
            )
