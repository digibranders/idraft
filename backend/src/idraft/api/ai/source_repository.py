"""Reads of cited sources and fan-out queries (docs/16 sections 7 and 9; plan D2). Row-level
security keeps every read in the caller's workspace; each query names the workspace and the
project as well.

An answer counts when its prompt is in scope, its current fact row says it is valid and it is
not superseded (docs/16 rule 3), as in the prompts summary; only the citations and fan-out
queries of counted answers are read. Every query bounds `observed_at` of each `ai.*` table it
reads with the window's instants, so the partitions of other months are not read. Sources are
aggregated by query: `ai.daily_domain_citations` is not built, and a 28 day window of a full
project is about 3,600 answers."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import Select, and_, desc, func, literal_column, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_citations,
    ai_observation_facts,
    ai_observations,
    ai_prompt_terms,
    ai_prompts,
    domains,
)
from idraft.keywords.trees import descendants

_F, _O, _C, _D = ai_observation_facts.c, ai_observations.c, ai_citations.c, domains.c
ROLES: Final = ("own", "competitor", "third_party")
# The sorts of the source routes and the output column each orders by.
SORT_COLUMNS: Final = {
    "-citation_units": "citation_units",
    "-observations": "observations",
    "-prompts": "prompts",
}


@dataclass(frozen=True, slots=True)
class SourceScope:
    """Which answers a read counts: the project's, in [since, until), on these engines."""

    workspace_id: UUID
    project_id: UUID
    since: datetime
    until: datetime
    engine_codes: tuple[str, ...]
    include_branded: bool = False
    prompt_id: UUID | None = None
    term_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class Counted:
    """What one group of citations holds."""

    citation_units: int
    observations: int
    prompts: int
    # In the order of the scope's engines.
    engine_units: tuple[int, ...]
    first_seen_at: datetime
    last_seen_at: datetime


@dataclass(frozen=True, slots=True)
class DomainCount:
    registrable_domain: str
    domain_role: str
    role_entity_id: UUID | None
    counted: Counted


@dataclass(frozen=True, slots=True)
class Totals:
    answers: int
    answers_citing: int
    citation_units: int
    # Each role: its citation units and the answers that cite a source of it.
    by_role: dict[str, tuple[int, int]]


def _shifted(instant: datetime, days: int) -> date:
    """The UTC date of `instant`, moved by `days`; the calendar's ends stay where they are."""
    day = instant.astimezone(UTC).date()
    try:
        return day + timedelta(days=days)
    except OverflowError:
        return day


def _prompts_in_scope(scope: SourceScope) -> Select[tuple[UUID]]:
    """The prompts whose answers count: with `prompt_id` that prompt alone, archived or branded
    (the inspector shows any prompt's sources); else the active prompts, the branded ones only
    with `include_branded`. `term_id` keeps those given the term or a term under it."""
    p = ai_prompts.c
    statement = select(p.id).where(
        p.workspace_id == scope.workspace_id,
        p.project_id == scope.project_id,
        p.deleted_at.is_(None),
    )
    if scope.prompt_id is not None:
        statement = statement.where(p.id == scope.prompt_id)
    else:
        statement = statement.where(p.is_active)
        if not scope.include_branded:
            statement = statement.where(~p.is_branded)
    if scope.term_id is not None:
        tagged = select(ai_prompt_terms.c.prompt_id).where(
            ai_prompt_terms.c.workspace_id == scope.workspace_id,
            ai_prompt_terms.c.term_id.in_(
                descendants("term", [scope.term_id], scope.workspace_id, "term_tree")
            ),
        )
        statement = statement.where(p.id.in_(tagged))
    return statement


def counted_answers(scope: SourceScope) -> Any:
    """The counted answers, one row each: `observation_id`, `observed_at`, `prompt_id`,
    `engine_code`, and for the fan-out reads `fanout_count` and the stored `fan_out` list."""
    return (
        select(
            _F.observation_id,
            _F.observed_at,
            _F.prompt_id,
            _F.engine_code,
            _O.fanout_count,
            _O.provider_extras["fan_out_queries"].label("fan_out"),
        )
        .select_from(
            ai_observation_facts.join(
                ai_observations,
                and_(
                    _O.id == _F.observation_id,
                    _O.observed_at == _F.observed_at,
                    _O.workspace_id == _F.workspace_id,
                ),
            )
        )
        .where(
            _F.workspace_id == scope.workspace_id,
            _F.project_id == scope.project_id,
            _F.is_current,
            _F.is_valid,
            _F.observed_at >= scope.since,
            _F.observed_at < scope.until,
            # A fact's date is its answer's UTC date: a day either side of the instants is safe,
            # and it is what the (project, date, engine) index is searched with.
            _F.observed_date >= _shifted(scope.since, -1),
            _F.observed_date <= _shifted(scope.until, 1),
            _F.engine_code.in_(list(scope.engine_codes)),
            _F.prompt_id.in_(_prompts_in_scope(scope)),
            _O.workspace_id == scope.workspace_id,
            _O.project_id == scope.project_id,
            _O.observed_at >= scope.since,
            _O.observed_at < scope.until,
            _O.superseded_by.is_(None),
        )
        .subquery("counted")
    )


def citation_bounds(scope: SourceScope) -> list[Any]:
    """The conditions that keep `ai.citations` to the project and the window's partitions."""
    return [
        _C.workspace_id == scope.workspace_id,
        _C.project_id == scope.project_id,
        _C.observed_at >= scope.since,
        _C.observed_at < scope.until,
    ]


def _cited(scope: SourceScope) -> tuple[Any, Any]:
    """The counted answers, and those answers joined to their citations and cited domains."""
    answers = counted_answers(scope)
    source = answers.join(
        ai_citations,
        and_(
            _C.observation_id == answers.c.observation_id,
            _C.observed_at == answers.c.observed_at,
        ),
    ).join(domains, _D.id == _C.domain_id)
    return answers, source


def unit() -> Any:
    """One citation unit: a URL of an answer (docs/16 C2), counted once however often listed."""
    return tuple_(_C.observation_id, _C.url_id).distinct()


def _measures(answers: Any, scope: SourceScope) -> list[Any]:
    return [
        func.count(unit()).label("citation_units"),
        func.count(_C.observation_id.distinct()).label("observations"),
        func.count(answers.c.prompt_id.distinct()).label("prompts"),
        *(
            func.count(unit()).filter(answers.c.engine_code == code).label(f"units_{index}")
            for index, code in enumerate(scope.engine_codes)
        ),
        func.min(_C.observed_at).label("first_seen_at"),
        func.max(_C.observed_at).label("last_seen_at"),
    ]


def _counted(row: Any, scope: SourceScope) -> Counted:
    values = row._mapping
    return Counted(
        citation_units=row.citation_units,
        observations=row.observations,
        prompts=row.prompts,
        engine_units=tuple(values[f"units_{index}"] for index in range(len(scope.engine_codes))),
        first_seen_at=row.first_seen_at,
        last_seen_at=row.last_seen_at,
    )


def order_by(sort: str, *keys: Any) -> list[Any]:
    """The sort's column, then units, then the row's keys: a page boundary never moves."""
    return [desc(literal_column(SORT_COLUMNS[sort])), desc(literal_column("citation_units")), *keys]


async def page_of(
    db: AsyncSession, grouped: Select[Any], order: Sequence[Any], *, offset: int, limit: int
) -> tuple[list[Any], int]:
    """A page of grouped rows and how many groups there are: the count comes with the rows
    (`count(*) OVER ()`), and is read on its own only for a page past the end."""
    rows = (
        await db.execute(
            grouped.add_columns(func.count().over().label("total"))
            .order_by(*order)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    if rows:
        return list(rows), int(rows[0].total)
    if offset == 0:
        return [], 0
    total = (await db.execute(select(func.count()).select_from(grouped.subquery()))).scalar_one()
    return [], int(total)


async def domain_counts(
    db: AsyncSession,
    scope: SourceScope,
    *,
    roles: Sequence[str] | None,
    sort: str,
    offset: int,
    limit: int,
) -> tuple[list[DomainCount], int]:
    """A page of sources by (registrable domain, role, entity), and how many there are."""
    answers, source = _cited(scope)
    keys = (_D.registrable_domain, _C.domain_role, _C.role_entity_id)
    grouped = (
        select(*keys, *_measures(answers, scope))
        .select_from(source)
        .where(*citation_bounds(scope))
        .group_by(*keys)
    )
    if roles:
        grouped = grouped.where(_C.domain_role.in_(list(roles)))
    rows, total = await page_of(
        db,
        grouped,
        order_by(
            sort, _D.registrable_domain, _C.domain_role, _C.role_entity_id.asc().nulls_first()
        ),
        offset=offset,
        limit=limit,
    )
    return [
        DomainCount(
            registrable_domain=row.registrable_domain,
            domain_role=row.domain_role,
            role_entity_id=row.role_entity_id,
            counted=_counted(row, scope),
        )
        for row in rows
    ], total


async def answer_count(db: AsyncSession, scope: SourceScope) -> int:
    """The counted answers, citing or not."""
    answers = counted_answers(scope)
    count: int = (await db.execute(select(func.count()).select_from(answers))).scalar_one()
    return count


async def totals(db: AsyncSession, scope: SourceScope) -> Totals:
    """The counted answers, and every citation unit in scope in all and by role (one `ROLLUP`
    statement: the row without a role is the whole)."""
    answers_in_scope = await answer_count(db, scope)
    _, source = _cited(scope)
    rows = await db.execute(
        select(
            _C.domain_role,
            func.count(unit()).label("units"),
            func.count(_C.observation_id.distinct()).label("observations"),
        )
        .select_from(source)
        .where(*citation_bounds(scope))
        .group_by(func.rollup(_C.domain_role))
    )
    by_role = dict.fromkeys(ROLES, (0, 0))
    units = citing = 0
    for row in rows:
        if row.domain_role is None:
            units, citing = row.units, row.observations
        else:
            by_role[row.domain_role] = (row.units, row.observations)
    return Totals(
        answers=answers_in_scope, answers_citing=citing, citation_units=units, by_role=by_role
    )
