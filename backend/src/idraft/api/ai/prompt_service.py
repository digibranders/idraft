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
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.pricing import task_prices
from idraft.ai.text import text_hash
from idraft.api import audit
from idraft.api.ai import engine_repository as engines
from idraft.api.ai import prompt_repository as prompts
from idraft.api.ai import run_repository as ai_runs
from idraft.api.ai.engine_service import live_project
from idraft.api.ai.prompt_lint import Named, check, suggest_prompt_type
from idraft.api.ai.prompt_repository import (
    LintRow,
    NewPrompt,
    PromptFilter,
    PromptKey,
    PromptRecord,
)
from idraft.api.entities.project_repository import MatcherEntity
from idraft.api.entities.project_service import MatcherRules, matcher_rules, to_utf16
from idraft.api.keywords import repository as keywords
from idraft.api.operations import runs_repository as runs
from idraft.api.operations.runs import MANUAL_RUNS_PER_DAY
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
from idraft.api.schemas.ai import (
    LintRule,
    LintSeverity,
    PromptBulkCreate,
    PromptCreate,
    PromptLintItem,
    PromptLintItems,
    PromptLintRequest,
    PromptPatch,
    PromptType,
)
from idraft.api.schemas.ai_bulk import PromptBulkArchive
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import (
    BASE_PLAN,
    ENGINES,
    PROMPT_TEXT_MAX,
    EngineCode,
    monthly_cost,
)
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
class LintedAlias:
    entity: MatcherEntity
    alias: str


@dataclass(frozen=True, slots=True)
class LintNote:
    rule: LintRule
    severity: LintSeverity
    message: str
    engine_code: EngineCode | None
    # UTF-16 code units.
    span: tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class LintedPrompt:
    text: str
    is_branded: bool
    aliases: list[LintedAlias]
    notes: list[LintNote]
    # What the type rule gives the text, as `write` would set it when the caller names none.
    suggested_prompt_type: PromptType
    # The prompt with this identity: its id and whether it is active (`items` shape only).
    tracked: tuple[UUID, bool] | None = None
    # A prompt of the market that differs only in case and spacing: its id and text.
    near_duplicate_of: tuple[UUID, str] | None = None


@dataclass(frozen=True, slots=True)
class EngineCost:
    engine_code: EngineCode
    prompts_fit: int
    answers_per_month: int
    # None when the price book has no price for the engine today.
    monthly_cost: Decimal | None
    run_now_answers: int
    run_now_cost: Decimal | None


@dataclass(frozen=True, slots=True)
class LintCost:
    engines: list[EngineCost]
    # The engines' monthly costs added; None when none has a price.
    total_monthly_cost: Decimal | None


@dataclass(frozen=True, slots=True)
class LintOutcome:
    prompts: list[LintedPrompt]
    limit: int
    used: int
    # Items neither tracked nor repeated nor too long to save; `items` shape only.
    would_create: int | None = None
    # What those items cost; `items` shape only.
    estimate: LintCost | None = None


@dataclass(frozen=True, slots=True)
class Limit:
    limit: int
    used: int


@dataclass(frozen=True, slots=True)
class Limits:
    prompts: Limit
    ai_observations_month: Limit
    manual_runs_today: Limit


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


def fold(text: str) -> str:
    """Case and spacing set aside: what makes two texts near duplicates."""
    return " ".join(text.casefold().split())


@dataclass(frozen=True, slots=True)
class ItemMatches:
    """What the project already has for each linted item, in the order of the items."""

    tracked: list[tuple[UUID, bool] | None]
    near_duplicate_of: list[tuple[UUID, str] | None]
    # Whether saving the item would create a prompt: not tracked, not a repeat of an earlier
    # item and not too long to save.
    creates: list[bool]


def match_items(items: Sequence[PromptLintItem], rows: Sequence[LintRow]) -> ItemMatches:
    """For each item the prompt it is (`tracked`) or, when none is, the one it nearly is
    (`near_duplicate_of`), and whether saving it would create a prompt. Rows come oldest first,
    so the oldest wins."""
    by_key: dict[PromptKey, LintRow] = {}
    by_fold: dict[tuple[str, str | None, str], LintRow] = {}
    for row in rows:
        by_key.setdefault((row.text_hash, row.language_code, row.country_iso), row)
        by_fold.setdefault((row.language_code, row.country_iso, fold(row.text)), row)
    tracked: list[tuple[UUID, bool] | None] = []
    near: list[tuple[UUID, str] | None] = []
    seen: set[PromptKey] = set()
    creates: list[bool] = []
    for item in items:
        key = (text_hash(item.text), item.language_code, item.country_iso)
        found = by_key.get(key)
        similar = (
            None
            if found is not None
            else by_fold.get((item.language_code, item.country_iso, fold(item.text)))
        )
        tracked.append(None if found is None else (found.id, found.is_active))
        near.append(None if similar is None else (similar.id, similar.text))
        creates.append(found is None and key not in seen and len(item.text) <= PROMPT_TEXT_MAX)
        seen.add(key)
    return ItemMatches(tracked=tracked, near_duplicate_of=near, creates=creates)


def estimate_cost(
    creating: Sequence[str], codes: Sequence[EngineCode], prices: Mapping[str, Decimal]
) -> LintCost:
    """What the texts to be created cost on each engine of `codes` in the base plan: the texts
    the engine takes, asked `runs_per_week` times a week. The monthly cost is the engines'
    `monthly_cost`; an engine with no price has no cost, never a guess of zero."""
    engines: list[EngineCost] = []
    for code in codes:
        engine = ENGINES[code]
        fit = sum(1 for text in creating if engine.fits(text))
        price = prices.get(engine.endpoint)
        run_now = fit * BASE_PLAN.answers_per_engine
        engines.append(
            EngineCost(
                engine_code=code,
                prompts_fit=fit,
                # Whole answers: 52 weeks over 12 months, as `monthly_cost`, rounded down.
                answers_per_month=run_now * BASE_PLAN.runs_per_week * 52 // 12,
                monthly_cost=None if price is None else monthly_cost(fit, price),
                run_now_answers=run_now,
                run_now_cost=None if price is None else price * run_now,
            )
        )
    costs = [engine.monthly_cost for engine in engines if engine.monthly_cost is not None]
    return LintCost(engines=engines, total_monthly_cost=sum(costs, Decimal(0)) if costs else None)


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


def _named(result: MatchResult, entities: Mapping[UUID, MatcherEntity]) -> list[Named]:
    """The own and competitor names found, with the places the matcher accepted."""
    found: list[Named] = []
    for mention in result.mentions:
        entity = entities[mention.entity_id]
        if mention.status != "accepted" or entity.role not in ("own", "competitor"):
            continue
        spans = tuple((span.start, span.end) for span in mention.spans if span.status == "accepted")
        if spans:
            found.append(
                Named(
                    name=entity.canonical_name,
                    is_competitor=entity.role == "competitor",
                    spans=spans,
                )
            )
    return found


def _lint(
    text: str,
    language_code: str | None,
    result: MatchResult,
    entities: Mapping[UUID, MatcherEntity],
    own: set[UUID],
    codes: Sequence[EngineCode],
) -> LintedPrompt:
    """Own brand names found (each once, with the first place it is named, in UTF-16 units), the
    rules that read the text (`prompt_lint`) and the engines the text is too long for."""
    shown = to_utf16(result, text)
    aliases: list[LintedAlias] = []
    notes: list[LintNote] = []
    seen: set[tuple[UUID, str]] = set()
    for mention, units in zip(result.mentions, shown.mentions, strict=True):
        if mention.status != "accepted" or mention.entity_id not in own:
            continue
        entity = entities[mention.entity_id]
        for span in mention.spans:
            found = text[span.start : span.end]
            if span.status == "accepted" and (entity.id, found) not in seen:
                seen.add((entity.id, found))
                aliases.append(LintedAlias(entity=entity, alias=found))
        first = next((span for span in units.spans if span.status == "accepted"), units.spans[0])
        notes.append(
            LintNote(
                rule="contains_brand_alias",
                severity="warning",
                message=f"Names {entity.canonical_name}. Answers to a branded prompt are left "
                "out of the rates unless they are asked for.",
                engine_code=None,
                span=(first.start, first.end),
            )
        )
    notes.extend(
        LintNote(
            rule=found.rule,
            severity=found.severity,
            message=found.message,
            engine_code=None,
            span=found.span,
        )
        for found in check(text, _named(result, entities), language_code)
    )
    for code in codes:
        engine = ENGINES[code]
        if engine.fits(text):
            continue
        unsavable = len(text) > PROMPT_TEXT_MAX
        notes.append(
            LintNote(
                rule="engine_limit",
                severity="error" if unsavable else "warning",
                message=f"{engine.label} takes up to {engine.max_prompt_chars} characters; "
                + ("the prompt cannot be saved." if unsavable else "it skips this prompt."),
                engine_code=code,
                span=None,
            )
        )
    return LintedPrompt(
        text=text,
        is_branded=names_own(result, own),
        aliases=aliases,
        notes=notes,
        suggested_prompt_type=suggest_prompt_type(text),
    )


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
        "prompt_type_source": record.prompt_type_source,
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
    # A type left out (absent or null) takes the wording rule; one sent is a person's.
    types: list[tuple[PromptType, str]] = [
        (suggest_prompt_type(item.text), "rule")
        if item.prompt_type is None
        else (item.prompt_type, "person")
        for item in items
    ]
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
                prompt_type=typed[0],
                prompt_type_source=typed[1],
                importance=item.importance,
                is_branded=names_own(result, own),
                term_ids=tuple(sorted(set(item.term_ids))),
            )
            for item, result, typed in zip(items, results, types, strict=True)
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
    """What a cursor is bound to: the project and the filters. A filter joins the scope only
    when it is used, so a cursor issued before the filter existed still decodes."""
    scope: dict[str, object] = {
        "project_id": str(project_id),
        "q": given.q,
        "term": None if given.term is None else str(given.term),
        "intents": sorted(given.intents),
        "country_iso": given.country_iso,
        "language_code": given.language_code,
        "is_active": given.is_active,
    }
    if given.prompt_types:
        scope["prompt_types"] = sorted(given.prompt_types)
    return scope


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

    async def limits(self, access: WorkspaceAccess, project_id: UUID) -> Limits:
        """What the writes check, read without taking part in them: the workspace's active
        prompts, its AI answers this UTC month as Run now counts them, and the project's manual
        runs today. Nothing is written, locked or created, so a workspace without a quota row
        shows the defaults."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            row = await prompts.limits_row(db, access.workspace_id)
            today = row.now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
            prompt_limit, prompt_count = await prompts.quota_usage(db, access.workspace_id)
            answers = await ai_runs.ai_tasks_since(db, access.workspace_id, today.replace(day=1))
            manual = await runs.manual_runs_since(db, access.workspace_id, project_id, today)
        return Limits(
            prompts=Limit(limit=prompt_limit, used=prompt_count),
            ai_observations_month=Limit(limit=row.ai_observations_limit, used=answers),
            manual_runs_today=Limit(limit=MANUAL_RUNS_PER_DAY, used=manual),
        )

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

    async def bulk_create(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptBulkCreate, info: RequestInfo
    ) -> BulkOutcome:
        """Items that cannot be saved are rejected one by one; the rest are written together,
        all or none: past the quota, nothing is written."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            await prompts.lock_prompt_writes(db, access.workspace_id)
            checks = await checks_for(db, access, project_id, body.items)
            keys = [key_of(item) for item in body.items]
            found = await prompts.existing(db, access.workspace_id, project_id, keys)
            rejected: list[Rejected] = []
            skipped: list[tuple[int, UUID]] = []
            accepted: list[PromptCreate] = []
            first: dict[PromptKey, int] = {}
            for index, (item, key) in enumerate(zip(body.items, keys, strict=True)):
                error = checks.error(item)
                if error is not None:
                    rejected.append(Rejected(index, error.code, error.message))
                elif key in found:
                    if body.on_duplicate == "skip":
                        skipped.append((index, found[key]))
                    else:
                        rejected.append(Rejected(index, "duplicate", DUPLICATE))
                elif key in first:
                    rejected.append(
                        Rejected(
                            index, "duplicate_in_request", f"The same prompt as item {first[key]}."
                        )
                    )
                else:
                    first[key] = index
                    accepted.append(item)
            limit, used = await prompts.quota_usage(db, access.workspace_id)
            if accepted and used + len(accepted) > limit:
                raise quota_error(limit, used, len(accepted))
            created = await write(db, access, project_id, accepted, info)
        return BulkOutcome(
            created=[record.id for record in created], skipped=skipped, rejected=rejected
        )

    async def lint(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptLintRequest | PromptLintItems
    ) -> LintOutcome:
        """What saving these texts would meet, with nothing stored: own brand names (the
        prompt would be branded), the rules that read the text (`prompt_lint`, with the
        language of the item or of the body) and engine limits, and the workspace's prompt
        quota. With `items`, also which of them the project tracks already, which nearly, and
        how many saving them would create and what those cost on each engine (`estimate_cost`)."""
        items: list[PromptLintItem] | None = None
        if isinstance(body, PromptLintItems):
            items = body.items
            texts = [item.text for item in items]
            languages: list[str | None] = [item.language_code for item in items]
        else:
            texts = body.texts
            languages = [body.language_code] * len(texts)
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            rules = await matcher_rules(db, access.workspace_id, project_id)
            limit, used = await prompts.quota_usage(db, access.workspace_id)
            rows: Sequence[LintRow] = ()
            priced_engines: set[EngineCode] = set()
            prices: Mapping[str, Decimal] = {}
            if items is not None:
                rows = await prompts.lint_matches(
                    db,
                    access.workspace_id,
                    project_id,
                    {(item.language_code, item.country_iso) for item in items},
                )
                # The estimate's engines are the ones asked for, else the enabled ones; one
                # price lookup serves them all.
                priced_engines = set(
                    body.engine_codes
                    or await engines.enabled_countries(db, access.workspace_id, project_id)
                )
                prices = await task_prices(db, queue=BASE_PLAN.queue, on=datetime.now(UTC).date())
        own = own_entities(rules)
        entities = {entity.id: entity for entity in rules.entities}
        codes = body.engine_codes or list(EngineCode)
        results = await matched(rules, texts)
        linted = [
            _lint(text, language_code, result, entities, own, codes)
            for text, language_code, result in zip(texts, languages, results, strict=True)
        ]
        if items is None:
            return LintOutcome(prompts=linted, limit=limit, used=used)
        found = match_items(items, rows)
        return LintOutcome(
            prompts=[
                replace(item, tracked=tracked, near_duplicate_of=near)
                for item, tracked, near in zip(
                    linted, found.tracked, found.near_duplicate_of, strict=True
                )
            ],
            limit=limit,
            used=used,
            would_create=sum(found.creates),
            estimate=estimate_cost(
                [item.text for item, creates in zip(items, found.creates, strict=True) if creates],
                [code for code in EngineCode if code in priced_engines],
                prices,
            ),
        )

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
            if "prompt_type" in values:
                values["prompt_type_source"] = "person"
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

    async def bulk_archive(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptBulkArchive, info: RequestInfo
    ) -> tuple[int, int]:
        """Archives or brings back the given prompts as `archive` and `PATCH is_active` do one:
        answers, versions and terms stay, and a prompt brought back is not checked against the
        engines' countries again. Ids the project does not have are not matched. Bringing back
        counts against the active prompt quota, all or none. How many matched and how many
        changed."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            if not body.archive:
                # Same order as create and PATCH: the workspace lock, then the prompt rows.
                await prompts.lock_prompt_writes(db, access.workspace_id)
            found = await prompts.lock_prompts(
                db, access.workspace_id, project_id, sorted(set(body.ids))
            )
            changing = [prompt_id for prompt_id, active in found.items() if active == body.archive]
            if changing and not body.archive:
                limit, used = await prompts.quota_usage(db, access.workspace_id)
                if used + len(changing) > limit:
                    raise quota_error(limit, used, len(changing))
            await prompts.set_active(
                db, access.workspace_id, changing, not body.archive, datetime.now(UTC)
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.bulk_changed",
                target_type="project",
                target_id=project_id,
                info=info,
                after={
                    "is_active": not body.archive,
                    "matched": len(found),
                    "changed": len(changing),
                },
            )
            await audit.record_each(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.archived" if body.archive else "prompt.updated",
                target_type="prompt",
                info=info,
                entries=[
                    audit.Entry(
                        target_id=prompt_id,
                        before={"is_active": body.archive},
                        after={"is_active": not body.archive, "bulk": True},
                    )
                    for prompt_id in changing
                ],
            )
        return len(found), len(changing)
