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

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Date,
    Float,
    Uuid,
    and_,
    any_,
    cast,
    column,
    func,
    literal,
    or_,
    select,
    tuple_,
    union_all,
)
from sqlalchemy.dialects.postgresql import ARRAY, distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai.source_repository import EXCLUDED_FLAGS
from idraft.db.tables import (
    ai_citations,
    ai_derivations,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observation_screenshots,
    ai_observations,
    ai_project_engines,
    ai_prompt_terms,
    ai_prompt_versions,
    ai_prompts,
    domains,
    entities,
    keyword_metrics_current,
    keyword_prompt_links,
    keywords,
    project_entities,
    projects,
    taxonomy_terms,
    taxonomy_vocabularies,
    tracked_keywords,
    urls,
)
from idraft.keywords.prompt_links import prompt_location_id
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
    # Valid answers that name a given competitor and not the own brand; read only when asked
    # for (`counts_by_prompt(lost_to=...)`), 0 otherwise.
    lost_to: int = 0
    # Valid answers that recommend the own brand, and those whose recommendation is classified at
    # all (an answer of an earlier extractor has none, and is neither).
    recommended: int = 0
    recommendation_classified: int = 0
    # Valid answers that name the own brand, by the tone of the sentences that name it.
    positive: int = 0
    neutral: int = 0
    negative: int = 0
    mixed: int = 0
    # The small cells' counts (C-9), read only with `counts_by_prompt(detail=True)`, 0 otherwise:
    # valid answers with a citation, and of them those that cite the own domain; the own and all
    # citation units of the valid answers; valid answers that name the own brand first; valid
    # answers with fan-out queries and those queries.
    n_citing: int = 0
    citing_own: int = 0
    own_units: int = 0
    all_units: int = 0
    first_mentions: int = 0
    fanout_answers: int = 0
    fanout_queries: int = 0


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
        count(valid, c.own_recommended.is_(True)).label("recommended"),
        count(valid, c.own_recommended.is_not(None)).label("recommendation_classified"),
        count(valid, c.own_mentioned, c.own_sentiment == "positive").label("positive"),
        count(valid, c.own_mentioned, c.own_sentiment == "neutral").label("neutral"),
        count(valid, c.own_mentioned, c.own_sentiment == "negative").label("negative"),
        count(valid, c.own_mentioned, c.own_sentiment == "mixed").label("mixed"),
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
    asked = row._mapping  # the columns only some reads add
    return Counts(
        lost_to=asked.get("lost_to", 0),
        n_citing=asked.get("n_citing", 0),
        citing_own=asked.get("citing_own", 0),
        own_units=asked.get("own_units", 0),
        all_units=asked.get("all_units", 0),
        first_mentions=asked.get("first_mentions", 0),
        fanout_answers=asked.get("fanout_answers", 0),
        fanout_queries=asked.get("fanout_queries", 0),
        n_observations=row.n_observations,
        n_valid=row.n_valid,
        mentioned=row.mentioned,
        cited=row.cited,
        mentioned_and_cited=row.mentioned_and_cited,
        mentioned_only=row.mentioned_only,
        cited_only=row.cited_only,
        neither=row.neither,
        sov_answers=row.sov_answers,
        recommended=row.recommended,
        recommendation_classified=row.recommendation_classified,
        positive=row.positive,
        neutral=row.neutral,
        negative=row.negative,
        mixed=row.mixed,
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


# The prompt each keyword speaks for on Google AI Overview (`aio_summary.chosen_keywords`).
AioKeywords = Mapping[UUID, UUID]
AIO_ENGINE = "google_ai_overview"


def _bounds(
    workspace_id: UUID, project_id: UUID, since: datetime, until: datetime, c: Any = _F
) -> list[Any]:
    """The fact rows `c` that are current, inside the window, and whose answer is not superseded."""
    return [
        c.workspace_id == workspace_id,
        c.project_id == project_id,
        c.is_current,
        c.observed_at >= since,
        c.observed_at < until,
        # A fact's date is its answer's UTC date: a day either side of the instants is safe, and
        # it is what the (project, date, engine) index is searched with.
        c.observed_date >= _shifted(since, -1),
        c.observed_date <= _shifted(until, 1),
        # A superseded answer is left out: its facts are looked up in the set of the window's
        # superseded answers, which is small and bounded like the facts (0020 indexes it).
        tuple_(c.observation_id, c.observed_at).not_in(
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


def _window(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> list[Any]:
    conditions = [
        *_bounds(workspace_id, project_id, since, until),
        _F.prompt_id.in_(list(prompt_ids)),
    ]
    if engine_codes is not None:
        conditions.append(_F.engine_code.in_(list(engine_codes)))
    return conditions


def _overview_facts(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    aio_keywords: AioKeywords,
) -> Any:
    """The fact rows of the Google AI Overview answers of the prompts, as rows of the prompts.

    An overview is kept by keyword, not by prompt: its fact rows have no prompt. A prompt's
    answer is the newest valid one inside the window of the keyword it speaks for (any tracked
    variant of it, so the newest of desktop and mobile), and each prompt that shares the keyword
    gets the same answer. One statement for all the prompts: the keywords' newest answers are
    picked once, then joined to the (prompt, keyword) pairs."""
    tk = tracked_keywords.c
    pairs = [(prompt, aio_keywords[prompt]) for prompt in prompt_ids if prompt in aio_keywords]
    newest = (
        select(ai_observation_facts, tk.keyword_id.label("aio_keyword_id"))
        .join(
            tracked_keywords,
            and_(tk.id == _F.tracked_keyword_id, tk.workspace_id == _F.workspace_id),
        )
        .where(
            *_bounds(workspace_id, project_id, since, until),
            _F.engine_code == AIO_ENGINE,
            _F.is_valid,
            tk.project_id == project_id,
            tk.keyword_id.in_({keyword for _, keyword in pairs}),
        )
        .ext(distinct_on(tk.keyword_id))
        .order_by(tk.keyword_id, _F.observed_at.desc(), _F.observation_id.desc())
        .subquery("aio_newest")
    )
    asked = (
        func.unnest(
            literal([prompt for prompt, _ in pairs], ARRAY(Uuid)),
            literal([keyword for _, keyword in pairs], ARRAY(Uuid)),
        )
        .table_valued(column("prompt_id", Uuid), column("keyword_id", Uuid))
        .render_derived(name="aio_asked")
    )
    return select(
        *(
            (asked.c.prompt_id if col.name == "prompt_id" else newest.c[col.name]).label(col.name)
            for col in ai_observation_facts.c
        )
    ).select_from(newest.join(asked, asked.c.keyword_id == newest.c.aio_keyword_id))


def _facts(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    aio_keywords: AioKeywords | None,
) -> Any:
    """The fact rows of the window the prompts' counts are read from, with every column of the
    facts table: the answers the prompts were asked, and, when `aio_keywords` says which keyword
    each prompt's Google AI Overview comes from, those answers too. A subquery to select from in
    place of the facts table."""
    branches = [
        select(ai_observation_facts).where(
            *_window(workspace_id, project_id, prompt_ids, since, until, engine_codes)
        )
    ]
    asked = aio_keywords and (engine_codes is None or AIO_ENGINE in engine_codes)
    if asked and aio_keywords and any(prompt in aio_keywords for prompt in prompt_ids):
        branches.append(
            _overview_facts(workspace_id, project_id, prompt_ids, since, until, aio_keywords)
        )
    return (
        branches[0].subquery("facts")
        if len(branches) == 1
        else union_all(*branches).subquery("facts")
    )


async def counts_by_prompt(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    lost_to: UUID | None = None,
    detail: bool = False,
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str], Counts]:
    """The counts by prompt and engine. With `lost_to` (a competitor of the project) each also
    holds `Counts.lost_to`: the valid answers that name that competitor and not the own brand,
    one more column of the same statement. With `detail` it holds the small cells' counts too
    (C-9): more columns of the same statement, and the answers' own table joined for the fan-out
    count, so a read without `detail` neither reads the columns nor makes the join."""
    if not prompt_ids:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    extra = (
        []
        if lost_to is None
        else [
            func.count()
            .filter(
                and_(
                    f.is_valid,
                    ~f.own_mentioned,
                    literal(lost_to, Uuid) == any_(f.competitor_mentions),
                )
            )
            .label("lost_to")
        ]
    )
    statement = select(f.prompt_id, f.engine_code, *_counts_columns(f), *extra)
    if detail:
        # An alias, so that the window's subquery of superseded answers is not correlated to it.
        answers = ai_observations.alias("answers")
        a = answers.c
        statement = (
            statement.add_columns(*_detail_columns(f, a))
            .select_from(
                facts.join(
                    answers,
                    and_(
                        a.id == f.observation_id,
                        a.observed_at == f.observed_at,
                        a.workspace_id == f.workspace_id,
                    ),
                )
            )
            .where(a.project_id == project_id, a.observed_at >= since, a.observed_at < until)
        )
    rows = await db.execute(statement.group_by(f.prompt_id, f.engine_code))
    return {(row.prompt_id, row.engine_code): _counts(row) for row in rows}


@dataclass(frozen=True, slots=True)
class LatestRow:
    """The newest valid answer of a prompt on an engine, and whether its screenshot is stored."""

    observation_id: int
    observed_at: datetime
    stored: bool


async def latest_answers(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str], LatestRow]:
    """The newest valid answer by prompt and engine over the window: one statement for all the
    prompts, whatever their number, with the screenshot table joined to say whether one is
    stored."""
    if not prompt_ids:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    shots = ai_observation_screenshots.c
    statement = (
        select(
            f.prompt_id,
            f.engine_code,
            f.observation_id,
            f.observed_at,
            shots.observation_id.is_not(None).label("stored"),
        )
        .select_from(
            facts.outerjoin(
                ai_observation_screenshots,
                and_(
                    shots.observation_id == f.observation_id,
                    shots.observed_at == f.observed_at,
                    shots.workspace_id == f.workspace_id,
                ),
            )
        )
        .where(f.is_valid)
        .ext(distinct_on(f.prompt_id, f.engine_code))
        .order_by(f.prompt_id, f.engine_code, f.observed_at.desc(), f.observation_id.desc())
    )
    return {
        (row.prompt_id, row.engine_code): LatestRow(row.observation_id, row.observed_at, row.stored)
        for row in await db.execute(statement)
    }


# The most brands and pages the facts list for one prompt on one engine (backend requests of the
# Prompts page: at most 20, most named or cited first). Bounds the rows whatever the answers hold.
FACT_LIST_LIMIT = 20


@dataclass(frozen=True, slots=True)
class PositionSums:
    """The answers of a prompt on an engine that name the own brand with a place, and the sum of
    those places."""

    ordered_answers: int = 0
    rank_sum: int = 0


async def position_sums(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str], PositionSums]:
    """By prompt and engine: the valid answers that name the own brand first, second, ... among
    the tracked brands (`own_mention_order`, 1 first), and the sum of those places, in one
    statement. The place is the order among the brands the project tracks: the extraction does
    not parse lists yet, so `had_structured_list` is never true and is not asked."""
    if not prompt_ids:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    placed = and_(f.is_valid, f.own_mentioned, f.own_mention_order.is_not(None))
    rows = await db.execute(
        select(
            f.prompt_id,
            f.engine_code,
            func.count().filter(placed).label("ordered_answers"),
            func.coalesce(func.sum(f.own_mention_order).filter(placed), 0).label("rank_sum"),
        ).group_by(f.prompt_id, f.engine_code)
    )
    return {
        (row.prompt_id, row.engine_code): PositionSums(row.ordered_answers, int(row.rank_sum))
        for row in rows
    }


@dataclass(frozen=True, slots=True)
class BrandNamed:
    name: str
    answers: int


async def named_brands(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str], list[BrandNamed]]:
    """By prompt and engine: the brands other than the own that the valid answers name, with
    how many answers name each, most named first, then by name; at most `FACT_LIST_LIMIT`, in one
    statement. Only the entities the project tracks leave mentions (the extraction keeps no
    others): competitors and watched brands. An uncertain mention counts in no rate, so it is not
    here; nor is a product that counts as its brand (a competitor mention with no order)."""
    if not prompt_ids:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    m = ai_entity_mentions.c
    answers = func.count()
    place = (
        func.row_number()
        .over(
            partition_by=[f.prompt_id, f.engine_code],
            order_by=[answers.desc(), entities.c.canonical_name, m.entity_id],
        )
        .label("place")
    )
    ranked = (
        select(
            f.prompt_id,
            f.engine_code,
            entities.c.canonical_name.label("name"),
            answers.label("answers"),
            place,
        )
        .select_from(
            facts.join(
                ai_entity_mentions,
                and_(
                    m.observation_id == f.observation_id,
                    m.observed_at == f.observed_at,
                    m.derivation_id == f.derivation_id,
                    m.workspace_id == f.workspace_id,
                ),
            ).join(
                entities,
                and_(entities.c.id == m.entity_id, entities.c.workspace_id == m.workspace_id),
            )
        )
        .where(
            f.is_valid,
            m.project_id == project_id,
            m.is_current,
            m.observed_at >= since,
            m.observed_at < until,
            m.mention_status == "accepted",
            m.role != "own",
            or_(m.mention_order.is_not(None), m.role.in_(("watch", "untracked"))),
        )
        .group_by(f.prompt_id, f.engine_code, m.entity_id, entities.c.canonical_name)
        .subquery()
    )
    rows = await db.execute(
        select(ranked)
        .where(ranked.c.place <= FACT_LIST_LIMIT)
        .order_by(ranked.c.prompt_id, ranked.c.engine_code, ranked.c.place)
    )
    found: dict[tuple[UUID, str], list[BrandNamed]] = {}
    for row in rows:
        found.setdefault((row.prompt_id, row.engine_code), []).append(
            BrandNamed(row.name, row.answers)
        )
    return found


@dataclass(frozen=True, slots=True)
class LinkCited:
    url: str
    domain: str
    domain_role: str
    answers: int


async def cited_links(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str], list[LinkCited]]:
    """By prompt and engine: the pages the valid answers cite, with how many answers cite each
    (a page counts once per answer), most cited first, then by address; at most
    `FACT_LIST_LIMIT`, in one statement. The citations the Sources page leaves out by default
    (`EXCLUDED_FLAGS`) are left out here too."""
    if not prompt_ids:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    c = ai_citations.c
    answers = func.count(c.observation_id.distinct())
    place = (
        func.row_number()
        .over(
            partition_by=[f.prompt_id, f.engine_code],
            order_by=[answers.desc(), urls.c.canonical_url],
        )
        .label("place")
    )
    ranked = (
        select(
            f.prompt_id,
            f.engine_code,
            urls.c.canonical_url.label("url"),
            domains.c.host.label("domain"),
            c.domain_role.label("domain_role"),
            answers.label("answers"),
            place,
        )
        .select_from(
            facts.join(
                ai_citations,
                and_(
                    c.observation_id == f.observation_id,
                    c.observed_at == f.observed_at,
                    c.workspace_id == f.workspace_id,
                ),
            )
            .join(urls, urls.c.id == c.url_id)
            .join(domains, domains.c.id == c.domain_id)
        )
        .where(
            f.is_valid,
            c.project_id == project_id,
            c.observed_at >= since,
            c.observed_at < until,
            ~c.flags.overlap(list(EXCLUDED_FLAGS)),
        )
        .group_by(
            f.prompt_id,
            f.engine_code,
            c.url_id,
            urls.c.canonical_url,
            domains.c.host,
            c.domain_role,
        )
        .subquery()
    )
    rows = await db.execute(
        select(ranked)
        .where(ranked.c.place <= FACT_LIST_LIMIT)
        .order_by(ranked.c.prompt_id, ranked.c.engine_code, ranked.c.place)
    )
    found: dict[tuple[UUID, str], list[LinkCited]] = {}
    for row in rows:
        found.setdefault((row.prompt_id, row.engine_code), []).append(
            LinkCited(row.url, row.domain, row.domain_role, row.answers)
        )
    return found


def _detail_columns(f: Any, answers: Any) -> list[Any]:
    """The small cells' counts of the valid fact rows `f` (C-9), with the fan-out count of
    `answers`, the answers' own columns."""
    valid = f.is_valid

    def units(column: Any) -> Any:
        return func.coalesce(func.sum(column).filter(valid), 0)

    return [
        func.count().filter(and_(valid, f.total_citation_count > 0)).label("n_citing"),
        func.count()
        .filter(and_(valid, f.own_domain_cited, f.total_citation_count > 0))
        .label("citing_own"),
        units(f.own_citation_count).label("own_units"),
        units(f.total_citation_count).label("all_units"),
        func.count()
        .filter(and_(valid, f.own_mentioned, f.own_mention_order == 1))
        .label("first_mentions"),
        func.count().filter(and_(valid, answers.fanout_count > 0)).label("fanout_answers"),
        units(answers.fanout_count).label("fanout_queries"),
    ]


def _weekly_facts(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    timezone: str,
    aio_keywords: AioKeywords | None,
) -> Any:
    """The fact rows of the window with their week: a Monday at midnight in the project's
    timezone. The week is a column of this subquery, so that a read can group by it (see
    `weekly_counts`)."""
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    return select(
        facts,
        cast(func.date_trunc("week", func.timezone(timezone, facts.c.observed_at)), Date).label(
            "week_start"
        ),
    ).subquery()


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
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str, date], Counts]:
    """The counts by prompt, engine and week. A week starts on Monday at midnight in the
    project's timezone (docs/19 section 2.5, granularity `week`), the zone the Monday and
    Thursday schedules run in, so one week holds one run of each. The week is worked out in a
    subquery and grouped by its column there: grouped by the expression, its bound timezone
    would be a second parameter, which PostgreSQL reads as a different expression."""
    if not prompt_ids:
        return {}
    facts = _weekly_facts(
        workspace_id, project_id, prompt_ids, since, until, engine_codes, timezone, aio_keywords
    )
    c = facts.c
    rows = await db.execute(
        select(c.prompt_id, c.engine_code, c.week_start, *_counts_columns(c)).group_by(
            c.prompt_id, c.engine_code, c.week_start
        )
    )
    return {(row.prompt_id, row.engine_code, row.week_start): _counts(row) for row in rows}


async def weekly_position_sums(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
    timezone: str,
) -> dict[tuple[UUID, str, date], PositionSums]:
    """`position_sums` by week as well, in one statement: the places of the own brand by prompt,
    engine and week (a Monday at midnight in the project's timezone, as in `weekly_counts`)."""
    if not prompt_ids:
        return {}
    c = _weekly_facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, timezone).c
    placed = and_(c.is_valid, c.own_mentioned, c.own_mention_order.is_not(None))
    rows = await db.execute(
        select(
            c.prompt_id,
            c.engine_code,
            c.week_start,
            func.count().filter(placed).label("ordered_answers"),
            func.coalesce(func.sum(c.own_mention_order).filter(placed), 0).label("rank_sum"),
        ).group_by(c.prompt_id, c.engine_code, c.week_start)
    )
    return {
        (row.prompt_id, row.engine_code, row.week_start): PositionSums(
            row.ordered_answers, int(row.rank_sum)
        )
        for row in rows
    }


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
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str, UUID], EntityCounts]:
    """Per prompt, engine and entity: the valid answers whose share of voice set holds the
    entity, and its share of each, 1 / the entities the set holds (docs/16 section 5). The set
    is the mentions with an order (`extraction.ai_facts`: accepted, own or competitor, a product
    counted as its brand), the same set `tracked_entities_mentioned` counts, so across all the
    entities an answer names its shares add up to 1 and the own entities' add up to the fact
    row's own share. The caller may ask for fewer entities than the answer names."""
    if not prompt_ids or not entity_ids:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    rows = await db.execute(
        _named(facts, f, [f.prompt_id, f.engine_code], project_id, entity_ids, since, until)
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
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[UUID, str, date, UUID], EntityCounts]:
    """`entity_counts` by week too, the weeks being those of `weekly_counts` (worked out in a
    subquery, for the reason given there), in one statement. Over the weeks, the entity counts of
    the window are the sum of these."""
    if not prompt_ids or not entity_ids:
        return {}
    facts = _weekly_facts(
        workspace_id, project_id, prompt_ids, since, until, engine_codes, timezone, aio_keywords
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
    aio_keywords: AioKeywords | None = None,
) -> dict[tuple[str, UUID, UUID], int]:
    """Per engine and pair of entities `(a, b)`, `a` below `b` by id: the valid answers whose
    share of voice set holds both (the mentions with an order, as `entity_counts` reads them),
    one statement. One mention row exists per entity and answer, so each answer counts a pair
    once; `b > a` leaves out an entity with itself and the pair the other way round. Fewer than
    two entities make no pair, and nothing is read."""
    if not prompt_ids or len(entity_ids) < 2:
        return {}
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
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
            m.observation_id == f.observation_id,
            m.observed_at == f.observed_at,
            m.derivation_id == f.derivation_id,
            m.workspace_id == f.workspace_id,
        )

    rows = await db.execute(
        select(
            f.engine_code,
            a.entity_id.label("first_id"),
            b.entity_id.label("second_id"),
            func.count().label("answers"),
        )
        .select_from(
            facts.join(first, joined(a)).join(second, and_(joined(b), b.entity_id > a.entity_id))
        )
        .where(
            f.is_valid,
            *named(a),
            *named(b),
        )
        .group_by(f.engine_code, a.entity_id, b.entity_id)
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
    aio_keywords: AioKeywords | None = None,
) -> list[int]:
    """The entity configuration versions the counted answers were derived under."""
    if not prompt_ids:
        return []
    facts = _facts(workspace_id, project_id, prompt_ids, since, until, engine_codes, aio_keywords)
    f = facts.c
    d = ai_derivations.c
    rows = await db.execute(
        select(d.entity_config_version)
        .select_from(
            facts.join(
                ai_derivations,
                and_(d.id == f.derivation_id, d.workspace_id == f.workspace_id),
            )
        )
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


@dataclass(frozen=True, slots=True)
class LinkedRow:
    keyword: str
    search_volume: int | None
    measured: bool


async def linked_keywords(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_ids: Collection[UUID]
) -> dict[UUID, LinkedRow]:
    """The keyword each prompt is linked to, in one statement for all the prompts: the active
    link with the most searches at the prompt's place (a keyword with no metrics last), then
    the primary one, then the first by text. A prompt without an active link is absent."""
    if not prompt_ids:
        return {}
    link, k, m = keyword_prompt_links.c, keywords.c, keyword_metrics_current.c
    volume = func.max(m.search_volume)
    measured = func.count(m.keyword_id) > 0
    statement = (
        select(link.prompt_id, k.text, volume.label("search_volume"), measured.label("measured"))
        .select_from(
            keyword_prompt_links.join(
                keywords, and_(k.id == link.keyword_id, k.workspace_id == link.workspace_id)
            )
            .join(
                ai_prompts,
                and_(
                    ai_prompts.c.id == link.prompt_id,
                    ai_prompts.c.workspace_id == link.workspace_id,
                ),
            )
            .join(
                projects,
                and_(
                    projects.c.id == ai_prompts.c.project_id,
                    projects.c.workspace_id == ai_prompts.c.workspace_id,
                ),
            )
            .outerjoin(
                keyword_metrics_current,
                and_(
                    m.keyword_id == link.keyword_id,
                    m.workspace_id == link.workspace_id,
                    m.language_code == k.language_code,
                    m.location_id == prompt_location_id(),
                ),
            )
        )
        .where(
            link.workspace_id == workspace_id,
            link.project_id == project_id,
            link.prompt_id.in_(list(prompt_ids)),
            link.status == "active",
        )
        .group_by(link.id, link.prompt_id, link.is_primary, k.text)
        .order_by(
            link.prompt_id,
            volume.desc().nulls_last(),
            measured.desc(),
            link.is_primary.desc(),
            k.text,
        )
        .ext(distinct_on(link.prompt_id))
    )
    return {
        row.prompt_id: LinkedRow(row.text, row.search_volume, row.measured)
        for row in await db.execute(statement)
    }
