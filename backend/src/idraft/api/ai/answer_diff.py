"""The answer compare of the evidence viewer (WP-26 T2; contract
docs/ai-visibility/contracts/evidence.md): what one answer gained, lost and kept against the
newest earlier valid answer of the same prompt and engine that named the own brand.

Entities are compared by id over the accepted mentions of each answer's current derivation, in
any tracked role. Sources are compared by registrable domain; citations flagged
`unresolved_redirect` or `engine_internal` are left out. The lists are bounded by the two
answers' own mentions and citations. A compare sends five statements (not counting
`set_config`), whatever the size of the answers: the baseline, the mentions of both answers and
the citations of both are one grouped read each."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final
from uuid import UUID

from sqlalchemy import and_, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.problems import ProblemError
from idraft.api.schemas.ai_evidence import (
    AnswerCompare,
    CompareEntities,
    CompareEntity,
    CompareSide,
    CompareSource,
    CompareSources,
)
from idraft.api.schemas.ai_sources import DomainRole
from idraft.db.tables import (
    ai_citations,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observations,
    domains,
    entities,
)

_O, _F, _M, _C = (
    ai_observations.c,
    ai_observation_facts.c,
    ai_entity_mentions.c,
    ai_citations.c,
)
# Citations carrying either flag are not the answer's own sources (docs/14 section 9).
_FLAGGED: Final = ["unresolved_redirect", "engine_internal"]


class NoBaselineError(ProblemError):
    """The answer exists, but there is no earlier answer to compare it with."""

    status, code, title = 404, "no_baseline", "No earlier answer to compare"


@dataclass(frozen=True, slots=True)
class Seen:
    """One answer to compare: its key, and the derivation its mentions are read under."""

    id: int
    observed_at: datetime
    derivation_id: int


@dataclass(frozen=True, slots=True)
class Source:
    registrable_domain: str
    host: str
    domain_role: DomainRole
    title: str | None


def _side(row: Any) -> CompareSide:
    return CompareSide(
        observation_id=str(row.id),
        observed_at=row.observed_at,
        own_mentioned=row.own_mentioned,
        own_domain_cited=row.own_domain_cited,
    )


def _name_key(entity: CompareEntity) -> tuple[str, str]:
    return entity.name.casefold(), str(entity.entity_id)


def diff_entities(
    latest: Iterable[CompareEntity], baseline: Iterable[CompareEntity]
) -> CompareEntities:
    """Set arithmetic over entity ids, each list by name. A kept entity shows its role now."""
    now = {entity.entity_id: entity for entity in latest}
    before = {entity.entity_id: entity for entity in baseline}
    return CompareEntities(
        gained=sorted((now[key] for key in now.keys() - before.keys()), key=_name_key),
        lost=sorted((before[key] for key in before.keys() - now.keys()), key=_name_key),
        kept=sorted((now[key] for key in now.keys() & before.keys()), key=_name_key),
    )


def diff_sources(latest: Iterable[Source], baseline: Iterable[Source]) -> CompareSources:
    """Set arithmetic over registrable domains, each list by domain. The first citation of a
    domain (the iterables come in citation order) gives its host, role and title."""
    now: dict[str, Source] = {}
    for source in latest:
        now.setdefault(source.registrable_domain, source)
    before: dict[str, Source] = {}
    for source in baseline:
        before.setdefault(source.registrable_domain, source)

    def shown(found: dict[str, Source], keys: Iterable[str]) -> list[CompareSource]:
        return [
            CompareSource(
                registrable_domain=key,
                host=found[key].host,
                domain_role=found[key].domain_role,
                title=found[key].title,
            )
            for key in sorted(keys)
        ]

    return CompareSources(
        gained=shown(now, now.keys() - before.keys()),
        lost=shown(before, before.keys() - now.keys()),
        kept_count=len(now.keys() & before.keys()),
    )


async def baseline_of(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, latest: Any
) -> Any | None:
    """D1: the newest answer of the project to the same prompt on the same engine that is not
    superseded, whose current facts are valid and name the own brand, strictly before `latest`."""
    return (
        await db.execute(
            select(
                _O.id,
                _O.observed_at,
                _F.derivation_id,
                _F.own_mentioned,
                _F.own_domain_cited,
            )
            .select_from(
                ai_observations.join(
                    ai_observation_facts,
                    and_(
                        _F.observation_id == _O.id,
                        _F.observed_at == _O.observed_at,
                        _F.workspace_id == _O.workspace_id,
                        _F.is_current,
                    ),
                )
            )
            .where(
                _O.workspace_id == workspace_id,
                _O.project_id == project_id,
                _F.project_id == project_id,
                _O.prompt_id == latest.prompt_id,
                _O.engine_code == latest.engine_code,
                _O.superseded_by.is_(None),
                _F.is_valid,
                _F.own_mentioned,
                tuple_(_O.observed_at, _O.id) < tuple_(latest.observed_at, latest.id),
            )
            .order_by(_O.observed_at.desc(), _O.id.desc())
            .limit(1)
        )
    ).first()


async def mentions_of(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, answers: Sequence[Seen]
) -> dict[int, list[CompareEntity]]:
    """The accepted mentions of tracked entities of each answer's current derivation, in one
    statement."""
    found: dict[int, list[CompareEntity]] = {seen.id: [] for seen in answers}
    rows = await db.execute(
        select(_M.observation_id, _M.entity_id, entities.c.canonical_name, _M.role)
        .join(
            entities,
            and_(entities.c.id == _M.entity_id, entities.c.workspace_id == _M.workspace_id),
        )
        .where(
            _M.workspace_id == workspace_id,
            _M.project_id == project_id,
            or_(
                *(
                    and_(
                        _M.observation_id == seen.id,
                        _M.observed_at == seen.observed_at,
                        _M.derivation_id == seen.derivation_id,
                    )
                    for seen in answers
                )
            ),
            _M.is_current,
            _M.mention_status == "accepted",
            _M.role.in_(["own", "competitor", "watch"]),
        )
    )
    for row in rows:
        found[row.observation_id].append(
            CompareEntity(entity_id=row.entity_id, name=row.canonical_name, role=row.role)
        )
    return found


async def citations_of(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, answers: Sequence[Seen]
) -> dict[int, list[Source]]:
    """The citations of both answers that are not flagged, in citation order, in one statement."""
    found: dict[int, list[Source]] = {seen.id: [] for seen in answers}
    rows = await db.execute(
        select(
            _C.observation_id,
            domains.c.registrable_domain,
            domains.c.host,
            _C.domain_role,
            _C.title,
        )
        .join(domains, domains.c.id == _C.domain_id)
        .where(
            _C.workspace_id == workspace_id,
            _C.project_id == project_id,
            or_(
                *(
                    and_(_C.observation_id == seen.id, _C.observed_at == seen.observed_at)
                    for seen in answers
                )
            ),
            ~_C.flags.overlap(_FLAGGED),
        )
        .order_by(_C.observation_id, _C.citation_index)
    )
    for row in rows:
        found[row.observation_id].append(
            Source(row.registrable_domain, row.host, row.domain_role, row.title)
        )
    return found


async def compare(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, latest: Any
) -> AnswerCompare:
    """`latest` is a row of `observation_repository.get_observation`: a live project's answer,
    with its facts. Raises `NoBaselineError` when it has none to compare with, or no current
    facts of its own (its entities and sources are then unknown, not empty)."""
    if latest.derivation_id is None:
        raise NoBaselineError("This answer has not been analysed yet.")
    baseline = await baseline_of(db, workspace_id, project_id, latest)
    if baseline is None:
        raise NoBaselineError
    answers = [
        Seen(latest.id, latest.observed_at, latest.derivation_id),
        Seen(baseline.id, baseline.observed_at, baseline.derivation_id),
    ]
    people = await mentions_of(db, workspace_id, project_id, answers)
    sources = await citations_of(db, workspace_id, project_id, answers)
    return AnswerCompare(
        prompt_id=latest.prompt_id,
        engine_code=latest.engine_code,
        latest=_side(latest),
        baseline=_side(baseline),
        entities=diff_entities(people[latest.id], people[baseline.id]),
        sources=diff_sources(sources[latest.id], sources[baseline.id]),
    )
