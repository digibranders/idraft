"""The competitors read (contract C5, docs/ai-visibility/contracts/c5-competitors.md).

Every number is a cell of the prompts summary's `total` row, relabelled for each tracked entity
(`include=entities`), so a figure is the same here, on the Topics & Prompts page and in a topic
row (rule R12). The one number the summary does not hold is an entity's citation share, which is
read from the sources lane (citation units by the entity that is the role of the cited domain,
flagged citations left out) over the same prompts and window. The top competitor rule is pure and
tested alone."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import competitor_repository as repository
from idraft.api.ai import metrics_repository
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
    best = min(named, key=lambda c: (-c.share_of_voice, -c.mentioned, c.name, c.entity_id))
    return best.entity_id


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
    """The engine's valid answers in scope: the answers behind its Mentioned cell."""
    pooled = engine.mentioned.pooled
    return 0 if pooled is None else pooled.trials


def entity_entry(
    entity_id: UUID,
    cells: EntityCells,
    engine: EngineSummary,
    frame: Frame,
    units: tuple[int, int],
    *,
    is_top: bool,
) -> AiCompetitorEngine:
    """One engine's entry of an entity row. `units` are the entity's citation units on the engine
    and all of them."""
    code, valid = engine.engine_code, _valid_answers(engine)

    def about(value: AiMetricValue, method: str | None = None) -> AiMetricValue:
        update: dict[str, object] = {"entity_id": entity_id}
        if method is not None:
            update["method"] = method
        return value.model_copy(update=update)

    return AiCompetitorEngine(
        engine_code=code,
        mention_rate=about(
            cell_value(
                "ai.mention_rate",
                cells.mentioned,
                frame,
                code,
                _earlier(cells.previous, lambda before: before.mentioned),
            ),
            _MENTION,
        ),
        recommendation_rate=about(suppressed_value("ai.recommendation_rate", valid, frame, code)),
        citation_share=about(citation_share_value(*units, valid, frame, code), _CITATION_SHARE),
        share_of_voice=about(
            cell_value(
                "ai.share_of_voice",
                cells.share_of_voice,
                frame,
                code,
                _earlier(cells.previous, lambda before: before.share_of_voice),
            ),
            _SHARE_OF_VOICE,
        ),
        is_top_competitor=is_top,
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
    ) -> AiCompetitorsResponse:
        """One summary read for the scope (`rows` left out, so that the prompts in scope are
        known), then the entity references and the citation units in a second transaction."""
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
        total = data.total
        if total is None:
            raise RuntimeError("The summary was asked for its total row and has none.")
        # The set the summary gives cells for: the own entities first, then the rest, at most 20.
        tracked = entity_cell_ids(
            [TrackedEntity(e.entity_id, e.name, e.role) for e in data.entities]
        )
        shown = [i for i in tracked if entity_ids is None or i in set(entity_ids)]
        refs, units, starts = await self._reads(access, project_id, data, shown)
        frame = Frame(
            window=data.window,
            filters=AiFilters(
                include_branded=data.include_branded,
                branded_only=data.branded_only,
                country_iso=query.country_iso,
                term_id=query.term_id,
            ),
        )
        by_name = {e.entity_id: e for e in data.entities}
        # Every unit of each engine, whoever is its role: the denominator of every row.
        whole: Counter[str] = Counter()
        for (code, _), n in units.items():
            whole[code] += n
        cells = {
            engine.engine_code: {c.entity_id: c for c in engine.entities or []}
            for engine in total.engines
        }
        # The flag is read over the whole tracked set, so narrowing the rows never moves it.
        top = {
            engine.engine_code: top_competitor(
                [
                    Contender(
                        i,
                        by_name[i].name,
                        by_name[i].role,
                        cells[engine.engine_code][i].share_of_voice.numerator,
                        cells[engine.engine_code][i].mentioned.numerator,
                    )
                    for i in tracked
                    if i in cells[engine.engine_code]
                ]
            )
            for engine in total.engines
        }
        rows = [
            AiCompetitor(
                entity=refs[entity_id],
                by_engine=[
                    entity_entry(
                        entity_id,
                        cells[engine.engine_code][entity_id],
                        engine,
                        frame,
                        (units.get((engine.engine_code, entity_id), 0), whole[engine.engine_code]),
                        is_top=top[engine.engine_code] == entity_id,
                    )
                    for engine in total.engines
                ],
            )
            for entity_id in shown
            if entity_id in refs
        ]
        return AiCompetitorsResponse(data=rows, meta=_meta(data, starts))

    async def _reads(
        self, access: WorkspaceAccess, project_id: UUID, data: PromptsSummary, shown: Sequence[UUID]
    ) -> tuple[dict[UUID, EntityRef], dict[tuple[str, UUID | None], int], dict[int, datetime]]:
        """What the summary does not hold, in one transaction: the references of the rows, the
        citation units of each engine by entity over the prompts and window the summary counted,
        and when each entity configuration version took effect. No citation is read when no
        prompt is in scope."""
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
            refs = await repository.entity_refs(db, access.workspace_id, project_id, shown)
            units = {} if scope is None else await repository.entity_units(db, scope)
            starts = await metrics_repository.version_starts(
                db, access.workspace_id, project_id, data.entity_config_versions
            )
        return refs, units, starts


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
