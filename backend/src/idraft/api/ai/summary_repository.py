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

from sqlalchemy import Date, Float, and_, cast, func, literal, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_derivations,
    ai_entity_mentions,
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
from idraft.keywords.trees import descendants

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
    # The newest counted answer of the group, of any status, and the newest valid one.
    last_observed_at: datetime | None = None
    last_valid_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class EntityCounts:
    # Valid answers whose share of voice set holds the entity, and the entity's shares of them.
    mentioned: int = 0
    sov_share: float = 0.0


@dataclass(frozen=True, slots=True)
class SummaryPrompt:
    id: UUID
    text: str
    is_branded: bool
    # The prompt's market, null when it has none.
    country_iso: str | None
    topic_term_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class TrackedEntity:
    id: UUID
    name: str
    role: str


def _counts_columns(c: Any = _F) -> list[Any]:
    """The counts of the fact rows `c`: the facts table, or a subquery of all its columns."""
    valid = c.is_valid

    def count(*conditions: Any) -> Any:
        return func.count().filter(and_(*conditions))

    return [
        func.count().label("n_observations"),
        count(valid).label("n_valid"),
        count(valid, c.own_mentioned).label("mentioned"),
        count(valid, c.own_domain_cited).label("cited"),
        count(valid, c.own_mentioned, c.own_domain_cited).label("mentioned_and_cited"),
        count(valid, c.own_mentioned, ~c.own_domain_cited).label("mentioned_only"),
        count(valid, ~c.own_mentioned, c.own_domain_cited).label("cited_only"),
        count(valid, ~c.own_mentioned, ~c.own_domain_cited).label("neither"),
        count(valid, c.tracked_entities_mentioned >= 1).label("sov_answers"),
        # The own share of an answer is the sum of sov_o(e) over the own entities (docs/16
        # section 5): each one named is 1 / |M_o|, and |M_o| counts every tracked entity named,
        # so the own entities are the tracked ones that are not competitors. A project may own
        # several brands. The filter keeps |M_o| at 1 or more, so the division is safe.
        func.coalesce(
            func.sum(
                cast(
                    c.tracked_entities_mentioned - func.cardinality(c.competitor_mentions),
                    Float,
                )
                / c.tracked_entities_mentioned
            ).filter(and_(valid, c.tracked_entities_mentioned >= 1)),
            0.0,
        ).label("sov_share"),
        func.max(c.observed_at).label("last_observed_at"),
        func.max(c.observed_at).filter(valid).label("last_valid_at"),
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
        last_observed_at=row.last_observed_at,
        last_valid_at=row.last_valid_at,
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
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    *,
    include_branded: bool,
    branded_only: bool = False,
    country_iso: str | None = None,
    term_id: UUID | None = None,
) -> list[SummaryPrompt]:
    """The project's active prompts (not archived), oldest first, with their topics. Branded
    prompts only with `include_branded`, or alone with `branded_only`; of one country; given
    `term_id` or a term under it (as the prompt list's `filter[term]`)."""
    p, v = ai_prompts.c, ai_prompt_versions.c
    statement = (
        select(p.id, v.text, p.is_branded, p.country_iso)
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
    if branded_only:
        statement = statement.where(p.is_branded)
    elif not include_branded:
        statement = statement.where(~p.is_branded)
    if country_iso is not None:
        statement = statement.where(p.country_iso == country_iso)
    if term_id is not None:
        tagged = select(ai_prompt_terms.c.prompt_id).where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            ai_prompt_terms.c.term_id.in_(
                descendants("term", [term_id], workspace_id, "term_tree")
            ),
        )
        statement = statement.where(p.id.in_(tagged))
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
            country_iso=row.country_iso,
            topic_term_ids=tuple(sorted(assigned.get(row.id, []), key=str)),
        )
        for row in rows
    ]


async def term_subtree(db: AsyncSession, workspace_id: UUID, term_id: UUID) -> set[UUID]:
    """The term and every term under it, in the caller's workspace (none for another's)."""
    rows = await db.execute(descendants("term", [term_id], workspace_id, "term_tree"))
    return {row.id for row in rows}


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
        # A superseded answer is left out: its facts are looked up in the set of the window's
        # superseded answers, which is small and bounded like the facts (0020 indexes it).
        tuple_(_F.observation_id, _F.observed_at).not_in(
            select(_O.id, _O.observed_at).where(
                _O.workspace_id == workspace_id,
                _O.project_id == project_id,
                _O.observed_at >= since,
                _O.observed_at < until,
                _O.observed_date >= _shifted(since, -1),
                _O.observed_date <= _shifted(until, 1),
                _O.superseded_by.is_not(None),
            )
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


def _weekly_facts(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    timezone: str,
) -> Any:
    """The fact rows of the window with their week: a Monday at midnight in the project's
    timezone. The week is a column of this subquery, so that a read can group by it (see
    `weekly_counts`)."""
    return (
        select(
            ai_observation_facts,
            cast(func.date_trunc("week", func.timezone(timezone, _F.observed_at)), Date).label(
                "week_start"
            ),
        )
        .where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
        .subquery()
    )


async def weekly_counts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    timezone: str,
) -> dict[tuple[UUID, str, date], Counts]:
    """The counts by prompt, engine and week. A week starts on Monday at midnight in the
    project's timezone (docs/19 section 2.5, granularity `week`), the zone the Monday and
    Thursday schedules run in, so one week holds one run of each. The week is worked out in a
    subquery and grouped by its column there: grouped by the expression, its bound timezone
    would be a second parameter, which PostgreSQL reads as a different expression."""
    if not prompt_ids:
        return {}
    facts = _weekly_facts(
        workspace_id, project_id, prompt_ids, since, until, engine_codes, timezone
    )
    c = facts.c
    rows = await db.execute(
        select(c.prompt_id, c.engine_code, c.week_start, *_counts_columns(c)).group_by(
            c.prompt_id, c.engine_code, c.week_start
        )
    )
    return {(row.prompt_id, row.engine_code, row.week_start): _counts(row) for row in rows}


async def entity_counts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    entity_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> dict[tuple[UUID, str, UUID], EntityCounts]:
    """Per prompt, engine and entity: the valid answers whose share of voice set holds the
    entity, and its share of each, 1 / the entities the set holds (docs/16 section 5). The set
    is the mentions with an order (`extraction.ai_facts`: accepted, own or competitor, a product
    counted as its brand), the same set `tracked_entities_mentioned` counts, so across all the
    entities an answer names its shares add up to 1 and the own entities' add up to the fact
    row's own share. The caller may ask for fewer entities than the answer names."""
    if not prompt_ids or not entity_ids:
        return {}
    rows = await db.execute(
        _named(
            ai_observation_facts,
            _F,
            [_F.prompt_id, _F.engine_code],
            project_id,
            entity_ids,
            since,
            until,
        ).where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
    )
    return {(row.prompt_id, row.engine_code, row.entity_id): _entity_counts(row) for row in rows}


def _named(
    facts: Any,
    c: Any,
    keys: Sequence[Any],
    project_id: UUID,
    entity_ids: Collection[UUID],
    since: datetime,
    until: datetime,
) -> Any:
    """Per `keys` (columns of the fact rows `c`, the facts table or a subquery of all its columns
    that `facts` is) and entity: the valid answers whose share of voice set holds the entity, and
    its shares of them. The caller bounds the fact rows by the window."""
    m = ai_entity_mentions.c
    return (
        select(
            *keys,
            m.entity_id,
            func.count().label("mentioned"),
            func.sum(cast(literal(1), Float) / c.tracked_entities_mentioned).label("sov_share"),
        )
        .select_from(
            facts.join(
                ai_entity_mentions,
                and_(
                    m.observation_id == c.observation_id,
                    m.observed_at == c.observed_at,
                    m.derivation_id == c.derivation_id,
                    m.workspace_id == c.workspace_id,
                ),
            )
        )
        .where(
            c.is_valid,
            c.tracked_entities_mentioned >= 1,
            m.project_id == project_id,
            m.is_current,
            # The mentions' own partitions, bounded by the same instants.
            m.observed_at >= since,
            m.observed_at < until,
            m.mention_order.is_not(None),
            m.entity_id.in_(list(entity_ids)),
        )
        .group_by(*keys, m.entity_id)
    )


def _entity_counts(row: Any) -> EntityCounts:
    return EntityCounts(mentioned=row.mentioned, sov_share=float(row.sov_share))


async def weekly_entity_counts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    entity_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    timezone: str,
) -> dict[tuple[UUID, str, date, UUID], EntityCounts]:
    """`entity_counts` by week too, the weeks being those of `weekly_counts` (worked out in a
    subquery, for the reason given there), in one statement. Over the weeks, the entity counts of
    the window are the sum of these."""
    if not prompt_ids or not entity_ids:
        return {}
    facts = _weekly_facts(
        workspace_id, project_id, prompt_ids, since, until, engine_codes, timezone
    )
    c = facts.c
    rows = await db.execute(
        _named(
            facts,
            c,
            [c.prompt_id, c.engine_code, c.week_start],
            project_id,
            entity_ids,
            since,
            until,
        )
    )
    return {
        (row.prompt_id, row.engine_code, row.week_start, row.entity_id): _entity_counts(row)
        for row in rows
    }


async def comention_pairs(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    entity_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> dict[tuple[str, UUID, UUID], int]:
    """Per engine and pair of entities `(a, b)`, `a` below `b` by id: the valid answers whose
    share of voice set holds both (the mentions with an order, as `entity_counts` reads them),
    one statement. One mention row exists per entity and answer, so each answer counts a pair
    once; `b > a` leaves out an entity with itself and the pair the other way round. Fewer than
    two entities make no pair, and nothing is read."""
    if not prompt_ids or len(entity_ids) < 2:
        return {}
    first, second = ai_entity_mentions.alias("first"), ai_entity_mentions.alias("second")
    a, b = first.c, second.c

    def named(m: Any) -> list[Any]:
        return [
            m.project_id == project_id,
            m.is_current,
            # The mentions' own partitions, bounded by the same instants.
            m.observed_at >= since,
            m.observed_at < until,
            m.mention_order.is_not(None),
            m.entity_id.in_(list(entity_ids)),
        ]

    def joined(m: Any) -> Any:
        return and_(
            m.observation_id == _F.observation_id,
            m.observed_at == _F.observed_at,
            m.derivation_id == _F.derivation_id,
            m.workspace_id == _F.workspace_id,
        )

    rows = await db.execute(
        select(
            _F.engine_code,
            a.entity_id.label("first_id"),
            b.entity_id.label("second_id"),
            func.count().label("answers"),
        )
        .select_from(
            ai_observation_facts.join(first, joined(a)).join(
                second, and_(joined(b), b.entity_id > a.entity_id)
            )
        )
        .where(
            *_window(workspace_id, project_id, prompt_ids, since, until, engine_codes),
            _F.is_valid,
            *named(a),
            *named(b),
        )
        .group_by(_F.engine_code, a.entity_id, b.entity_id)
    )
    return {(row.engine_code, row.first_id, row.second_id): row.answers for row in rows}


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
