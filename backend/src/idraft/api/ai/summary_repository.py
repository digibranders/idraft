"""Reads of the prompts summary (spec section 4.5): the prompts and their topics, the engines,
the tracked entity set, and counts of current fact rows by prompt or topic and engine. Row-level
security keeps every read in the caller's workspace; each query names the workspace and the
project as well.

A fact counts when it is current and its answer is not superseded (docs/16 rule 3). The counts
are one grouped query over the facts, by prompt and engine, whatever the number of prompts; the
topic rows are sums of these (the service), and `topic_rollup` says which prompts a topic holds.
The window bounds the answers' own table and the facts' date column too, so the partitions of
other months are not read and the partial index on (project, date, engine) can be used."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Float, and_, cast, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_derivations,
    ai_observation_facts,
    ai_observations,
    ai_project_engines,
    ai_prompt_terms,
    ai_prompt_versions,
    ai_prompts,
    entities,
    project_entities,
    taxonomy_terms,
    taxonomy_vocabularies,
)

_F, _O = ai_observation_facts.c, ai_observations.c


@dataclass(frozen=True, slots=True)
class Counts:
    n_observations: int = 0
    n_valid: int = 0
    mentioned: int = 0
    cited: int = 0
    mentioned_and_cited: int = 0
    mentioned_only: int = 0
    cited_only: int = 0
    neither: int = 0
    # Valid answers that name at least one tracked entity, and the own brands' shares of them.
    sov_answers: int = 0
    sov_share: float = 0.0


@dataclass(frozen=True, slots=True)
class SummaryPrompt:
    id: UUID
    text: str
    is_branded: bool
    topic_term_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class TrackedEntity:
    id: UUID
    name: str
    role: str


def _counts_columns() -> list[Any]:
    valid = _F.is_valid

    def count(*conditions: Any) -> Any:
        return func.count().filter(and_(*conditions))

    return [
        func.count().label("n_observations"),
        count(valid).label("n_valid"),
        count(valid, _F.own_mentioned).label("mentioned"),
        count(valid, _F.own_domain_cited).label("cited"),
        count(valid, _F.own_mentioned, _F.own_domain_cited).label("mentioned_and_cited"),
        count(valid, _F.own_mentioned, ~_F.own_domain_cited).label("mentioned_only"),
        count(valid, ~_F.own_mentioned, _F.own_domain_cited).label("cited_only"),
        count(valid, ~_F.own_mentioned, ~_F.own_domain_cited).label("neither"),
        count(valid, _F.tracked_entities_mentioned >= 1).label("sov_answers"),
        # The own share of an answer is the sum of sov_o(e) over the own entities (docs/16
        # section 5): each one named is 1 / |M_o|, and |M_o| counts every tracked entity named,
        # so the own entities are the tracked ones that are not competitors. A project may own
        # several brands. The filter keeps |M_o| at 1 or more, so the division is safe.
        func.coalesce(
            func.sum(
                cast(
                    _F.tracked_entities_mentioned - func.cardinality(_F.competitor_mentions),
                    Float,
                )
                / _F.tracked_entities_mentioned
            ).filter(and_(valid, _F.tracked_entities_mentioned >= 1)),
            0.0,
        ).label("sov_share"),
    ]


def _counts(row: Any) -> Counts:
    return Counts(
        n_observations=row.n_observations,
        n_valid=row.n_valid,
        mentioned=row.mentioned,
        cited=row.cited,
        mentioned_and_cited=row.mentioned_and_cited,
        mentioned_only=row.mentioned_only,
        cited_only=row.cited_only,
        neither=row.neither,
        sov_answers=row.sov_answers,
        sov_share=float(row.sov_share),
    )


def _topic_terms() -> Any:
    """(prompt, term) for terms of a `topic` vocabulary."""
    pt, t, v = ai_prompt_terms.c, taxonomy_terms.c, taxonomy_vocabularies.c
    return (
        select(pt.prompt_id, pt.term_id)
        .join(taxonomy_terms, and_(t.id == pt.term_id, t.workspace_id == pt.workspace_id))
        .join(
            taxonomy_vocabularies,
            and_(v.id == t.vocabulary_id, v.workspace_id == t.workspace_id),
        )
        .where(v.kind == "topic")
    )


async def summary_prompts(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, include_branded: bool
) -> list[SummaryPrompt]:
    """The project's active prompts (not archived), oldest first, with their topics."""
    p, v = ai_prompts.c, ai_prompt_versions.c
    statement = (
        select(p.id, v.text, p.is_branded)
        .join(
            ai_prompt_versions,
            and_(v.id == p.current_version_id, v.workspace_id == p.workspace_id),
        )
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.deleted_at.is_(None),
            p.is_active,
        )
        .order_by(p.created_at, p.id)
    )
    if not include_branded:
        statement = statement.where(~p.is_branded)
    rows = list(await db.execute(statement))
    if not rows:
        return []
    topics = _topic_terms().subquery()
    assigned: dict[UUID, list[UUID]] = {}
    for row in await db.execute(
        select(topics.c.prompt_id, topics.c.term_id).where(
            topics.c.prompt_id.in_([row.id for row in rows])
        )
    ):
        assigned.setdefault(row.prompt_id, []).append(row.term_id)
    return [
        SummaryPrompt(
            id=row.id,
            text=row.text,
            is_branded=row.is_branded,
            topic_term_ids=tuple(sorted(assigned.get(row.id, []), key=str)),
        )
        for row in rows
    ]


async def enabled_engine_codes(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[str]:
    e = ai_project_engines.c
    rows = await db.execute(
        select(e.engine_code).where(
            e.workspace_id == workspace_id, e.project_id == project_id, e.is_enabled
        )
    )
    return sorted(row.engine_code for row in rows)


async def tracked_entities(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> list[TrackedEntity]:
    """The own brand and the competitors the project tracks in AI answers now."""
    e, pe = entities.c, project_entities.c
    rows = await db.execute(
        select(e.id, e.canonical_name, pe.role)
        .join(
            project_entities,
            and_(pe.entity_id == e.id, pe.workspace_id == e.workspace_id),
        )
        .where(
            pe.workspace_id == workspace_id,
            pe.project_id == project_id,
            pe.removed_at.is_(None),
            pe.track_ai,
            pe.role.in_(("own", "competitor")),
        )
        .order_by(pe.role, e.canonical_name, e.id)
    )
    return [TrackedEntity(row.id, row.canonical_name, row.role) for row in rows]


def _shifted(instant: datetime, days: int) -> date:
    """The UTC date of `instant`, moved by `days`; the calendar's ends stay where they are."""
    day = instant.astimezone(UTC).date()
    try:
        return day + timedelta(days=days)
    except OverflowError:
        return day


def _window(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> list[Any]:
    conditions = [
        _F.workspace_id == workspace_id,
        _F.project_id == project_id,
        _F.is_current,
        _F.observed_at >= since,
        _F.observed_at < until,
        # A fact's date is its answer's UTC date: a day either side of the instants is safe, and
        # it is what the (project, date, engine) index is searched with.
        _F.observed_date >= _shifted(since, -1),
        _F.observed_date <= _shifted(until, 1),
        _F.prompt_id.in_(list(prompt_ids)),
        # A superseded answer is left out. Looked up as an anti-join over the few superseded
        # answers of the window, with the same bounds on the answers' table: a join of every
        # fact to every answer is read as a nested loop when the planner has no statistics.
        ~exists().where(
            _O.id == _F.observation_id,
            _O.observed_at == _F.observed_at,
            _O.workspace_id == workspace_id,
            _O.project_id == project_id,
            _O.observed_at >= since,
            _O.observed_at < until,
            _O.observed_date >= _shifted(since, -1),
            _O.observed_date <= _shifted(until, 1),
            _O.superseded_by.is_not(None),
        ),
    ]
    if engine_codes is not None:
        conditions.append(_F.engine_code.in_(list(engine_codes)))
    return conditions


async def counts_by_prompt(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> dict[tuple[UUID, str], Counts]:
    if not prompt_ids:
        return {}
    rows = await db.execute(
        select(_F.prompt_id, _F.engine_code, *_counts_columns())
        .where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
        .group_by(_F.prompt_id, _F.engine_code)
    )
    return {(row.prompt_id, row.engine_code): _counts(row) for row in rows}


async def topic_rollup(
    db: AsyncSession, workspace_id: UUID, prompt_ids: Collection[UUID]
) -> dict[UUID, set[UUID]]:
    """The prompts each topic term holds: the prompts given the term or any term below it (the
    terms whose path starts with its path, docs/16 section 4), each prompt once however many
    terms below it it was given."""
    if not prompt_ids:
        return {}
    pt, v = ai_prompt_terms.c, taxonomy_vocabularies.c
    given_terms, above_terms = taxonomy_terms.alias("given"), taxonomy_terms.alias("above")
    given, above = given_terms.c, above_terms.c
    rows = await db.execute(
        select(pt.prompt_id, above.id)
        .select_from(ai_prompt_terms)
        .join(given_terms, and_(given.id == pt.term_id, given.workspace_id == pt.workspace_id))
        .join(
            taxonomy_vocabularies,
            and_(
                v.id == given.vocabulary_id, v.workspace_id == given.workspace_id, v.kind == "topic"
            ),
        )
        .join(
            above_terms,
            and_(
                above.vocabulary_id == given.vocabulary_id,
                above.workspace_id == given.workspace_id,
                or_(above.id == given.id, func.starts_with(given.path, above.path + "/")),
            ),
        )
        .where(pt.workspace_id == workspace_id, pt.prompt_id.in_(list(prompt_ids)))
        .distinct()
    )
    held: dict[UUID, set[UUID]] = {}
    for row in rows:
        held.setdefault(row.id, set()).add(row.prompt_id)
    return held


async def entity_config_versions(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> list[int]:
    """The entity configuration versions the counted answers were derived under."""
    if not prompt_ids:
        return []
    d = ai_derivations.c
    rows = await db.execute(
        select(d.entity_config_version)
        .select_from(
            ai_observation_facts.join(
                ai_derivations,
                and_(d.id == _F.derivation_id, d.workspace_id == _F.workspace_id),
            )
        )
        .where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
        .distinct()
        .order_by(d.entity_config_version)
    )
    return [row.entity_config_version for row in rows]


async def topic_names(
    db: AsyncSession, workspace_id: UUID, term_ids: Collection[UUID]
) -> dict[UUID, str]:
    if not term_ids:
        return {}
    t = taxonomy_terms.c
    rows = await db.execute(
        select(t.id, t.name).where(t.workspace_id == workspace_id, t.id.in_(list(term_ids)))
    )
    return {row.id: row.name for row in rows}
