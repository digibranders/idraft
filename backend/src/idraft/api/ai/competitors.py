"""The competitors read (contract C5, docs/ai-visibility/contracts/c5-competitors.md).

Every number is a cell of the prompts summary's `total` row, relabelled for each tracked entity
(`include=entities`), so a figure is the same here, on the Topics & Prompts page and in a topic
row (rule R12). The numbers the summary does not hold are read from the sources lane's scope: an
entity's citation share and top domains (citation units by the entity that is the role of the cited
domain, flagged citations left out) and the answers lost to each competitor, over the same prompts
and window. The valid and total answers of each prompt, and its text, are the summary's prompt
rows'. The top competitor rule and the ranking of lost prompts are pure and tested alone."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import competitor_repository as repository
from idraft.api.ai import metrics_repository
from idraft.api.ai.competitor_repository import LostAnswers
from idraft.api.ai.metrics import (
    EXCLUDED_FLAGS,
    Frame,
    cell_value,
    citation_share_value,
    suppressed_value,
)
from idraft.api.ai.source_repository import SourceScope
from idraft.api.ai.summary import SummaryQuery, SummaryService, entity_cell_ids
from idraft.api.ai.summary_repository import TrackedEntity
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import (
    NOT_ASKED,
    EngineSummary,
    EntityCells,
    EntityPreviousCells,
    MetricCell,
    PromptsSummary,
    SummaryTotal,
    _NotAsked,
)
from idraft.api.schemas.ai_metrics import (
    AiCompetitor,
    AiCompetitorEngine,
    AiCompetitorsResponse,
    AiEntityConfigChange,
    AiFilters,
    AiMetricMeta,
    AiMetricValue,
    CompetitorSource,
    LostPrompt,
    OverviewCompetitorEngine,
    OverviewCompetitorRow,
    OverviewCompetitors,
    OverviewCompetitorsResponse,
)
from idraft.api.schemas.entities import EntityRef
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

_MENTION = "Valid answers that name the entity, prompt weighted."
_SHARE_OF_VOICE = (
    "The entity's share of the tracked entities each answer names, summed over the answers that "
    "name one."
)
_CITATION_SHARE = (
    "The entity's citation units over all citation units of the engine; each unit is a distinct "
    "canonical URL of an answer."
)
# A prompt counts for "of N prompts" beside the lost prompts when it has at least this many valid
# answers on the engine (the CH-05 floor: fewer say nothing about a prompt).
MIN_ANSWERS = 4


@dataclass(frozen=True, slots=True)
class Contender:
    """One tracked entity on one engine, as the top competitor rule reads it: the numerators of
    its share of voice and of its mention rate."""

    entity_id: UUID
    name: str
    role: str
    share_of_voice: float
    mentioned: float


def top_competitor(contenders: Sequence[Contender]) -> UUID | None:
    """The competitor with the largest share of voice numerator on an engine; ties go to the
    larger mention numerator, then to the name, then to the id. The own entity is never the top
    competitor, and none is named when no competitor has a numerator above 0: the product never
    names a competitor that was never named."""
    named = [c for c in contenders if c.role == "competitor" and c.share_of_voice > 0]
    if not named:
        return None
    # Numerators are sums of shares: float noise must not decide a tie (9 decimals), and the name
    # order is explicit, not the collation's (case-folded).
    best = min(
        named,
        key=lambda c: (
            -round(c.share_of_voice, 9),
            -round(c.mentioned, 9),
            c.name.casefold(),
            c.entity_id,
        ),
    )
    return best.entity_id


@dataclass(frozen=True, slots=True)
class PromptAnswers:
    """What the summary's prompt row says of one prompt on one engine: its current text, its valid
    answers and every answer."""

    text: str
    valid: int
    answers: int


@dataclass(frozen=True, slots=True)
class Lost:
    """A prompt lost to a competitor on an engine: the lost answers beside what the prompt has."""

    prompt_id: UUID
    text: str
    importance: int
    lost: int
    valid: int
    answers: int


def prompt_answers(data: PromptsSummary) -> dict[tuple[UUID, str], PromptAnswers]:
    """The valid and all answers of each prompt in scope on each engine shown, from the summary's
    prompt rows (in a prompt row the Mentioned cell counts answers: its denominator is the valid
    ones and `n_observations` every one)."""
    return {
        (row.prompt_id, engine.engine_code): PromptAnswers(
            text=row.text,
            valid=engine.mentioned.denominator,
            answers=engine.mentioned.n_observations,
        )
        for row in data.prompts
        for engine in row.engines
    }


def rank_lost(found: Sequence[Lost], limit: int) -> list[Lost]:
    """The prompts to list: by importance descending, then lost answers descending, then text, then
    id, at most `limit`."""
    ordered = sorted(
        found, key=lambda lost: (-lost.importance, -lost.lost, lost.text, lost.prompt_id)
    )
    return ordered[:limit]


def lost_prompt(found: Lost) -> LostPrompt:
    """The prompt as the response lists it: `lost` is lost answers of the valid ones, with every
    answer of the prompt on the engine counted; it is a count of one prompt, so it is not pooled.
    The lost answers come from a read of their own and the valid ones from the summary's, two
    transactions: an answer ingested between them could make the first the larger, so it is held
    to the valid answers and the cell stays a share."""
    lost = min(found.lost, found.valid)
    return LostPrompt(
        prompt_id=found.prompt_id,
        text=found.text,
        importance=found.importance,
        lost=MetricCell(
            value=None if found.valid == 0 else lost / found.valid,
            numerator=lost,
            denominator=found.valid,
            n_observations=found.answers,
        ),
    )


@dataclass(frozen=True, slots=True)
class LostBlock:
    """One competitor's lost prompts on one engine: the listed ones, every one lost before the
    cap, and the prompts in scope with enough valid answers to be judged."""

    prompts: list[LostPrompt]
    total: int
    with_min_answers: int


def lost_block(
    entity_id: UUID,
    code: str,
    lost: Mapping[tuple[UUID, str, UUID], LostAnswers],
    answers: Mapping[tuple[UUID, str], PromptAnswers],
    limit: int,
) -> LostBlock:
    """The lost prompts of one competitor on one engine from the lost answers of every competitor
    and engine and the prompt rows."""
    found = [
        Lost(prompt, card.text, counted.importance, counted.answers, card.valid, card.answers)
        for (prompt, engine, entity), counted in lost.items()
        if engine == code and entity == entity_id and (card := answers.get((prompt, engine)))
    ]
    return LostBlock(
        prompts=[lost_prompt(item) for item in rank_lost(found, limit)],
        total=len(found),
        with_min_answers=sum(
            1
            for (_, engine), card in answers.items()
            if engine == code and card.valid >= MIN_ANSWERS
        ),
    )


def _earlier(
    previous: EntityPreviousCells | _NotAsked | None,
    pick: Callable[[EntityPreviousCells], MetricCell],
) -> MetricCell | _NotAsked | None:
    """`previous` of an entity cell: absent without compare, null when the engine had no answer in
    the window compared with, else the cell there."""
    if isinstance(previous, _NotAsked):
        return NOT_ASKED
    return None if previous is None else pick(previous)


def _valid_answers(engine: EngineSummary) -> int:
    """The engine's valid answers in scope: the answers behind its Mentioned cell. The same as
    `_valid_answers` of metrics.py, which is private there (kept apart, not imported)."""
    pooled = engine.mentioned.pooled
    return 0 if pooled is None else pooled.trials


def _about(value: AiMetricValue, entity_id: UUID, method: str | None = None) -> AiMetricValue:
    update: dict[str, object] = {"entity_id": entity_id}
    if method is not None:
        update["method"] = method
    return value.model_copy(update=update)


def mention_value(entity_id: UUID, cells: EntityCells, frame: Frame, code: str) -> AiMetricValue:
    """The entity's `ai.mention_rate` on one engine, with `previous` when compare was asked."""
    return _about(
        cell_value(
            "ai.mention_rate",
            cells.mentioned,
            frame,
            code,
            _earlier(cells.previous, lambda before: before.mentioned),
        ),
        entity_id,
        _MENTION,
    )


def share_of_voice_value(
    entity_id: UUID, cells: EntityCells, frame: Frame, code: str
) -> AiMetricValue:
    """The entity's `ai.share_of_voice` on one engine, with `previous` when compare was asked."""
    return _about(
        cell_value(
            "ai.share_of_voice",
            cells.share_of_voice,
            frame,
            code,
            _earlier(cells.previous, lambda before: before.share_of_voice),
        ),
        entity_id,
        _SHARE_OF_VOICE,
    )


def entity_entry(
    entity_id: UUID,
    cells: EntityCells,
    engine: EngineSummary,
    frame: Frame,
    units: tuple[int, int],
    *,
    is_top: bool,
    lost: LostBlock | None = None,
) -> AiCompetitorEngine:
    """One engine's entry of an entity row. `units` are the entity's citation units on the engine
    and all of them; `lost` is the competitor's lost prompts when they were asked for."""
    code, valid = engine.engine_code, _valid_answers(engine)
    return AiCompetitorEngine(
        engine_code=code,
        mention_rate=mention_value(entity_id, cells, frame, code),
        recommendation_rate=_about(
            suppressed_value("ai.recommendation_rate", valid, frame, code), entity_id
        ),
        citation_share=_about(
            citation_share_value(*units, valid, frame, code), entity_id, _CITATION_SHARE
        ),
        share_of_voice=share_of_voice_value(entity_id, cells, frame, code),
        is_top_competitor=is_top,
        lost_prompts=None if lost is None else lost.prompts,
        lost_prompts_total=None if lost is None else lost.total,
        lost_prompts_with_min_answers=None if lost is None else lost.with_min_answers,
    )


@dataclass(frozen=True, slots=True)
class Blocks:
    """Which reads beyond the references a request needs: the citation units (the competitors read
    only), and the lost prompts and the top sources with their caps when asked for."""

    units: bool = True
    lost_limit: int | None = None
    sources_limit: int | None = None


@dataclass(frozen=True, slots=True)
class Reads:
    """What the second transaction read. `units` and `lost` are empty when no prompt is in scope
    or the block was not asked for."""

    refs: dict[UUID, EntityRef]
    units: dict[tuple[str, UUID | None], int]
    lost: dict[tuple[UUID, str, UUID], LostAnswers]
    sources: dict[UUID, list[CompetitorSource]]
    starts: dict[int, datetime]


@dataclass(frozen=True, slots=True)
class Tracked:
    """The entities the summary gave cells for, the rows to show among them, and each engine's
    top competitor."""

    shown: list[UUID]
    cells: dict[str, dict[UUID, EntityCells]]
    top: dict[str, UUID | None]


def tracked_rows(
    data: PromptsSummary, total: SummaryTotal, entity_ids: Collection[UUID] | None
) -> Tracked:
    """The rows: the tracked set of the summary (the own entities first, then the rest, at most
    20), narrowed to `entity_ids`. The top competitor of each engine is read over the whole cut
    set, before the narrowing: narrowing never moves the flag, and may leave no row with it."""
    tracked = entity_cell_ids([TrackedEntity(e.entity_id, e.name, e.role) for e in data.entities])
    by_name = {e.entity_id: e for e in data.entities}
    cells = {
        engine.engine_code: {c.entity_id: c for c in engine.entities or []}
        for engine in total.engines
    }
    top = {
        code: top_competitor(
            [
                Contender(
                    i,
                    by_name[i].name,
                    by_name[i].role,
                    found[i].share_of_voice.numerator,
                    found[i].mentioned.numerator,
                )
                for i in tracked
                if i in found
            ]
        )
        for code, found in cells.items()
    }
    wanted = None if entity_ids is None else set(entity_ids)
    return Tracked(
        shown=[i for i in tracked if wanted is None or i in wanted], cells=cells, top=top
    )


def _total(data: PromptsSummary) -> SummaryTotal:
    if data.total is None:
        raise RuntimeError("The summary was asked for its total row and has none.")
    return data.total


def _frame(data: PromptsSummary, query: SummaryQuery) -> Frame:
    return Frame(
        window=data.window,
        filters=AiFilters(
            include_branded=data.include_branded,
            branded_only=data.branded_only,
            country_iso=query.country_iso,
            term_id=query.term_id,
        ),
    )


class CompetitorService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], summaries: SummaryService
    ) -> None:
        self._sessions = sessions
        self._summaries = summaries

    async def competitors(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SummaryQuery,
        entity_ids: Sequence[UUID] | None = None,
        *,
        lost_limit: int | None = None,
        sources_limit: int | None = None,
    ) -> AiCompetitorsResponse:
        """One summary read for the scope (`rows` left out, so that the prompts in scope are
        known), then the entity references, the citation units and, when asked for, the lost
        answers (`lost_limit`) and the top sources (`sources_limit`) in a second transaction."""
        data = await self._summaries.summary(
            access,
            project_id,
            replace(
                query,
                include=frozenset({"total", "entities"}),
                rows=None,
                group_by=None,
                outcome=None,
                opportunity=None,
            ),
        )
        total = _total(data)
        rows = tracked_rows(data, total, entity_ids)
        reads = await self._reads(
            access,
            project_id,
            data,
            rows.shown,
            Blocks(lost_limit=lost_limit, sources_limit=sources_limit),
            {e.entity_id for e in data.entities if e.role == "competitor"},
        )
        frame = _frame(data, query)
        # Every unit of each engine, whoever is its role: the denominator of every row.
        whole: Counter[str] = Counter()
        for (code, _), n in reads.units.items():
            whole[code] += n
        roles = {e.entity_id: e.role for e in data.entities}
        answers = prompt_answers(data) if lost_limit is not None else {}

        def block(entity_id: UUID, code: str) -> LostBlock | None:
            if lost_limit is None or roles[entity_id] != "competitor":
                return None
            return lost_block(entity_id, code, reads.lost, answers, lost_limit)

        found = [
            AiCompetitor(
                entity=reads.refs[entity_id],
                by_engine=[
                    entity_entry(
                        entity_id,
                        rows.cells[engine.engine_code][entity_id],
                        engine,
                        frame,
                        (
                            reads.units.get((engine.engine_code, entity_id), 0),
                            whole[engine.engine_code],
                        ),
                        is_top=rows.top[engine.engine_code] == entity_id,
                        lost=block(entity_id, engine.engine_code),
                    )
                    for engine in total.engines
                ],
                top_sources=None if sources_limit is None else reads.sources.get(entity_id, []),
            )
            for entity_id in rows.shown
            if entity_id in reads.refs
        ]
        return AiCompetitorsResponse(data=found, meta=_meta(data, reads.starts))

    async def overview(
        self, access: WorkspaceAccess, project_id: UUID, query: SummaryQuery
    ) -> OverviewCompetitorsResponse:
        """The AI half of the Overview competitor table: the summary's entity cells of the total
        row (no prompt rows are read) and the entity references. The SEO members are declared and
        never returned: SEO share of voice is built nowhere (decision D13)."""
        data = await self._summaries.summary(
            access,
            project_id,
            replace(
                query,
                include=frozenset({"total", "entities"}),
                rows="none",
                group_by=None,
                outcome=None,
                opportunity=None,
            ),
        )
        total = _total(data)
        rows = tracked_rows(data, total, None)
        reads = await self._reads(access, project_id, data, rows.shown, Blocks(units=False), set())
        frame = _frame(data, query)
        found = [
            OverviewCompetitorRow(
                entity=reads.refs[entity_id],
                ai=[
                    OverviewCompetitorEngine(
                        engine_code=engine.engine_code,
                        share_of_voice=share_of_voice_value(
                            entity_id,
                            rows.cells[engine.engine_code][entity_id],
                            frame,
                            engine.engine_code,
                        ),
                        mention_rate=mention_value(
                            entity_id,
                            rows.cells[engine.engine_code][entity_id],
                            frame,
                            engine.engine_code,
                        ),
                    )
                    for engine in total.engines
                ],
            )
            for entity_id in rows.shown
            if entity_id in reads.refs
        ]
        return OverviewCompetitorsResponse(
            data=OverviewCompetitors(rows=found), meta=_meta(data, reads.starts)
        )

    async def _reads(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        data: PromptsSummary,
        shown: Sequence[UUID],
        blocks: Blocks,
        competitors: Collection[UUID],
    ) -> Reads:
        """What the summary does not hold, in one transaction: the references of the rows, the
        citation units of each engine by entity, the lost answers of the competitors shown and the
        top domains of the entities shown (the last two only when asked for), over the prompts and
        window the summary counted, and when each entity configuration version took effect. No
        citation or answer is read when no prompt is in scope."""
        ids = tuple(row.prompt_id for row in data.prompts)
        scope = None
        if ids and data.engine_codes:
            since, until = instants(
                date.fromisoformat(data.window.from_),
                date.fromisoformat(data.window.to),
                ZoneInfo(data.window.timezone),
            )
            scope = SourceScope(
                workspace_id=access.workspace_id,
                project_id=project_id,
                since=since,
                until=until,
                engine_codes=tuple(data.engine_codes),
                prompt_ids=ids,
                excluded_flags=EXCLUDED_FLAGS,
            )
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            if scope and (
                blocks.units or blocks.lost_limit is not None or blocks.sources_limit is not None
            ):
                # The citation reads join answers to citations on a key; a planner without table
                # statistics (a new month's partition, a backfill) nests loops there and is 30 to
                # 100 times slower. Local to this transaction, as in the sources service.
                await db.execute(text("SET LOCAL enable_nestloop = off"))
            refs = await repository.entity_refs(db, access.workspace_id, project_id, shown)
            units = await repository.entity_units(db, scope) if scope and blocks.units else {}
            lost = (
                await repository.lost_counts(db, scope, [i for i in shown if i in competitors])
                if scope and blocks.lost_limit is not None
                else {}
            )
            sources = (
                await repository.top_sources(db, scope, shown, blocks.sources_limit)
                if scope and blocks.sources_limit is not None
                else {}
            )
            starts = await metrics_repository.version_starts(
                db, access.workspace_id, project_id, data.entity_config_versions
            )
        return Reads(refs, units, lost, sources, starts)


def _meta(data: PromptsSummary, starts: Mapping[int, datetime]) -> AiMetricMeta:
    """What the body says about its scope: the summary's, and when each entity configuration took
    effect when the window holds more than one."""
    zone = ZoneInfo(data.window.timezone)
    changes = (
        [
            AiEntityConfigChange(version=version, from_=starts[version].astimezone(zone).date())
            for version in data.entity_config_versions
            if version in starts
        ]
        if len(data.entity_config_versions) > 1
        else []
    )
    return AiMetricMeta(
        window=data.window,
        compare_window=data.compare_window,
        previous_answers=data.previous_answers,
        include_branded=data.include_branded,
        branded_only=data.branded_only,
        engine_codes=data.engine_codes,
        entities=data.entities,
        entity_config_versions=data.entity_config_versions,
        entity_config_changes=changes or None,
        notes=[],
    )
