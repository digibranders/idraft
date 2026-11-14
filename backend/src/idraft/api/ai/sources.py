"""Cited sources and the citations behind them (docs/16 section 7, docs/19 section 3.7.7 cut to
slice 1; plan D2): what the Citations page and the prompt inspector's Citations tab read, over a
window of project-local days and the answers the prompts summary counts."""

from __future__ import annotations

from collections.abc import AsyncIterator, Collection, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Any, Final, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import source_repository as repository
from idraft.api.ai.source_repository import (
    CitationFilter,
    Counted,
    DiversityCount,
    DomainCount,
    PageCount,
    SourceScope,
    Totals,
)
from idraft.api.ai.summary import summary_dates, summary_weeks
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
from idraft.api.problems import EngineHasNoFanoutError, NotFoundError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.ai_sources import (
    CITED_WITH_MAX,
    DETAIL_PAGES_MAX,
    DETAIL_PROMPTS_MAX,
    DETAIL_ROWS_MAX,
    TOPICS_MAX,
    AdPresence,
    CitationPage,
    CitationRow,
    CitedWith,
    DiversityWeek,
    DomainEngineSeries,
    DomainEngineWeek,
    DomainPrompt,
    DomainRole,
    EngineRoleUnits,
    EngineUnits,
    FanoutCitedDomain,
    FanoutMeta,
    FanoutQueryPage,
    FanoutQueryRow,
    FanoutTopic,
    OwnPage,
    PreviousUnits,
    PromptOwnPagesMeta,
    PromptOwnPagesPage,
    PromptOwnPagesRow,
    RoleAnswers,
    RoleUnits,
    SourceChangeKind,
    SourceChangePage,
    SourceChangeRow,
    SourceChangesMeta,
    SourceCompare,
    SourceDiversity,
    SourceDiversityEngine,
    SourceDiversityMeta,
    SourceDomainDetail,
    SourceDomainDetailData,
    SourceDomainPage,
    SourceDomainRow,
    SourcePagePage,
    SourcePageRow,
    SourcesMeta,
    SourceSort,
    SourcesWeek,
    SourceWeekUnits,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import ENGINES, EngineCode

# Fan-out rows name at most this many cited domains.
CITED_DOMAINS_MAX: Final = 5
# The engines that show the queries they issue (doc 07: ChatGPT), and the others.
FANOUT_ENGINES: Final = tuple(sorted(str(c) for c, e in ENGINES.items() if e.exposes_fanout))
NO_FANOUT: Final = tuple(sorted(str(c) for c, e in ENGINES.items() if not e.exposes_fanout))


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
    country_iso: str | None = None
    # The citation flags the aggregate reads leave out (docs/14 section 9): set by the routes
    # that take the toggles; the citation list and the fan-out never set it.
    excluded_flags: tuple[str, ...] = ()


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
        country_iso=query.country_iso,
    )
    return Scoped(
        scope=SourceScope(
            workspace_id=access.workspace_id,
            project_id=project_id,
            since=since,
            until=until,
            engine_codes=tuple(engines),
            prompt_ids=prompt_ids,
            excluded_flags=query.excluded_flags,
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


NO_DIVERSITY: Final = DiversityCount(
    answers=0, answers_citing=0, citation_units=0, distinct_domains=0, squares=0
)


def effective_sources(units: int, squares: int) -> float | None:
    """The effective number of sources (docs/16 C3): 1 over the sum of squared shares
    `u / units`, which is `units^2` over the sum of the squared units; null without a unit."""
    return units * units / squares if units else None


def diversity_series(
    engine: str, weeks: Sequence[date], counted: dict[tuple[str, date], tuple[int, int, int]]
) -> list[DiversityWeek]:
    """An engine's point for every week; a week without a citation has no value."""
    points = []
    for week in weeks:
        units, domains, squares = counted.get((engine, week), (0, 0, 0))
        points.append(
            DiversityWeek(
                week_start=week,
                citation_units=units,
                distinct_domains=domains,
                effective_sources=effective_sources(units, squares),
            )
        )
    return points


def ad_presence(counted: tuple[int, int, int]) -> AdPresence:
    answers, with_ads, ads = counted
    return AdPresence(
        answers_with_ads=MetricCell(
            value=None if answers == 0 else with_ads / answers,
            numerator=with_ads,
            denominator=answers,
            n_observations=answers,
        ),
        ads=ads,
    )


def diversity_engine(
    engine: str,
    counted: DiversityCount,
    series: list[DiversityWeek] | None,
    ads: AdPresence | None,
) -> SourceDiversityEngine:
    units = counted.citation_units
    return SourceDiversityEngine(
        engine_code=EngineCode(engine),
        answers=counted.answers,
        answers_citing=counted.answers_citing,
        citation_units=units,
        distinct_domains=counted.distinct_domains,
        effective_sources=MetricCell(
            value=effective_sources(units, counted.squares),
            numerator=units * units,
            denominator=counted.squares,
            n_observations=counted.answers,
        ),
        series=series,
        ads=ads,
    )


def domain_engine_series(
    engine: str, weeks: Sequence[date], counted: dict[tuple[str, date], tuple[int, int, int, int]]
) -> DomainEngineSeries:
    """A domain's weekly units on one engine, with the engine's units and answers of the week."""
    points = []
    for week in weeks:
        units, seen, all_units, answers = counted.get((engine, week), (0, 0, 0, 0))
        points.append(
            DomainEngineWeek(
                week_start=week,
                citation_units=units,
                observations=seen,
                all_citation_units=all_units,
                answers=answers,
            )
        )
    return DomainEngineSeries(engine_code=EngineCode(engine), series=points)


def domain_row(
    row: DomainCount,
    engines: Sequence[str],
    whole: Totals,
    *,
    previous: PreviousUnits | None = None,
    series: list[SourceWeekUnits] | None = None,
    cited_with: CitedWith | None = None,
) -> SourceDomainRow:
    return SourceDomainRow(
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
        previous=previous,
        series=series,
        cited_with=cited_with,
    )


def top_entity(found: list[tuple[UUID, int]] | None) -> CitedWith | None:
    """The entity a row is cited with; none when no counted answer citing it names one."""
    return CitedWith(entity_id=found[0][0], observations=found[0][1]) if found else None


def role_split(
    engines: Sequence[str], counted: dict[tuple[str, str], tuple[int, int]]
) -> list[EngineRoleUnits]:
    """Every engine of the scope with the three roles, zero where nothing was cited."""

    def role(engine: str, name: str) -> RoleAnswers:
        units, seen = counted.get((engine, name), (0, 0))
        return RoleAnswers(citation_units=units, answers_citing=seen)

    return [
        EngineRoleUnits(
            engine_code=EngineCode(engine),
            own=role(engine, "own"),
            competitor=role(engine, "competitor"),
            third_party=role(engine, "third_party"),
        )
        for engine in engines
    ]


def page_row(
    row: PageCount,
    engines: Sequence[str],
    whole: Totals,
    *,
    previous: PreviousUnits | None = None,
    series: list[SourceWeekUnits] | None = None,
) -> SourcePageRow:
    return SourcePageRow(
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
        previous=previous,
        series=series,
    )


@dataclass(frozen=True, slots=True)
class Series:
    """What `include=series` reads: the weeks of the window, the page's rows by week and the
    scope's totals by week."""

    weeks: list[date]
    rows: dict[tuple[Any, str, UUID | None], dict[date, tuple[int, int]]]
    totals: dict[date, tuple[int, int, int]]

    def points(self, key: tuple[Any, str, UUID | None]) -> list[SourceWeekUnits]:
        """A row's point for every week; a week it was not cited in is a zero point."""
        found = self.rows.get(key, {})
        points = []
        for week in self.weeks:
            units, seen = found.get(week, (0, 0))
            points.append(SourceWeekUnits(week_start=week, citation_units=units, observations=seen))
        return points

    def meta(self) -> list[SourcesWeek]:
        points = []
        for week in self.weeks:
            answers, units, domains = self.totals.get(week, (0, 0, 0))
            points.append(
                SourcesWeek(
                    week_start=week, answers=answers, citation_units=units, distinct_domains=domains
                )
            )
        return points


async def weekly(
    db: AsyncSession,
    now: Scoped,
    *,
    by_page: bool,
    names: Collection[str] = (),
    url_ids: Collection[int] = (),
) -> Series:
    """The weekly points of a page's rows and of the scope: two statements."""
    zone = now.window.timezone
    return Series(
        weeks=summary_weeks(now.first, now.last),
        rows=await repository.row_weeks(
            db, now.scope, zone, by_page=by_page, names=names, url_ids=url_ids
        ),
        totals=await repository.scope_weeks(db, now.scope, zone),
    )


def sources_meta(
    now: Scoped,
    query: SourceQuery,
    engines: Sequence[str],
    totals: Totals,
    series: Series | None = None,
    by_role_by_engine: list[EngineRoleUnits] | None = None,
) -> SourcesMeta:
    return SourcesMeta(
        series=None if series is None else series.meta(),
        by_role_by_engine=by_role_by_engine,
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
    """What a citation cursor is bound to: the project and every filter. The country is added
    only when it is set, so a cursor made without it keeps the hash it had before the filter."""
    bound: dict[str, object] = {
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
    if query.country_iso is not None:
        bound["country"] = query.country_iso
    return bound


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


_ENGINE_CODES: Final = frozenset(str(code) for code in EngineCode)


def _prompts_cursor_scope(
    project_id: UUID, query: SourceQuery, engines: Sequence[str], own_cited: bool | None
) -> dict[str, object]:
    """What a prompts cursor is bound to: the project and every filter, the country only when
    set (as `_cursor_scope`)."""
    bound: dict[str, object] = {
        "project_id": str(project_id),
        "from": query.start,
        "to": query.end,
        "engines": list(engines),
        "prompt": query.prompt_id,
        "term": query.term_id,
        "branded": query.include_branded,
        "own_cited": own_cited,
        "flags": sorted(query.excluded_flags),
    }
    if query.country_iso is not None:
        bound["country"] = query.country_iso
    return bound


def _prompt_after(cursor: str, bound: dict[str, object]) -> tuple[UUID, str]:
    """The key of a prompts cursor, `[prompt id, engine code]`: a forged key the database could
    not take (text that is no uuid, an engine that does not exist) is `400 invalid_cursor`."""
    key = decode_cursor(cursor, scope=bound)
    if len(key) != 2:
        raise invalid_cursor()
    prompt_id, engine_code = key
    if not isinstance(prompt_id, str) or engine_code not in _ENGINE_CODES:
        raise invalid_cursor()
    try:
        return UUID(prompt_id), str(engine_code)
    except ValueError:
        raise invalid_cursor() from None


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
        include: Collection[str] = (),
        min_support: int | None = None,
        page: OffsetParams,
    ) -> SourceDomainPage:
        engines = shown_engines(query.engine_codes)
        prior: Scoped | None = None
        found: dict[tuple[str, str, UUID | None], tuple[int, int]] = {}
        prior_answers: int | None = None
        series: Series | None = None
        named: dict[tuple[str, str | None, UUID | None], list[tuple[UUID, int]]] = {}
        split: list[EngineRoleUnits] | None = None
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows, total = await repository.domain_counts(
                db,
                now.scope,
                roles=query.roles,
                sort=sort,
                min_support=min_support,
                offset=page.offset,
                limit=page.limit,
            )
            whole = await repository.totals(db, now.scope)
            if "series" in include:
                series = await weekly(
                    db, now, by_page=False, names={row.registrable_domain for row in rows}
                )
            if "cited_with" in include:
                named = await repository.cited_with(
                    db, now.scope, {row.registrable_domain for row in rows}, top=1, by_row=True
                )
            if "by_role_by_engine" in include:
                split = role_split(engines, await repository.role_engine_totals(db, now.scope))
            if compare == "previous_period":
                prior = before(now)
                found = await repository.previous_domains(
                    db, prior.scope, {row.registrable_domain for row in rows}
                )
                prior_answers = await repository.answer_count(db, prior.scope)
        return SourceDomainPage(
            data=[
                domain_row(
                    row,
                    engines,
                    whole,
                    previous=None
                    if prior is None
                    else previous_units(
                        found.get((row.registrable_domain, row.domain_role, row.role_entity_id))
                    ),
                    series=None
                    if series is None
                    else series.points(
                        (row.registrable_domain, row.domain_role, row.role_entity_id)
                    ),
                    cited_with=top_entity(
                        named.get((row.registrable_domain, row.domain_role, row.role_entity_id))
                    ),
                )
                for row in rows
            ],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
            meta=compared(
                sources_meta(now, query, engines, whole, series, split), prior, prior_answers
            ),
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
        include: Collection[str] = (),
        min_support: int | None = None,
        page: OffsetParams,
    ) -> SourcePagePage:
        engines = shown_engines(query.engine_codes)
        prior: Scoped | None = None
        found: dict[tuple[int, str, UUID | None], tuple[int, int]] = {}
        prior_answers: int | None = None
        series: Series | None = None
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows, total = await repository.page_counts(
                db,
                now.scope,
                roles=query.roles,
                registrable_domain=registrable_domain,
                sort=sort,
                min_support=min_support,
                offset=page.offset,
                limit=page.limit,
            )
            whole = await repository.totals(db, now.scope)
            if "series" in include:
                series = await weekly(db, now, by_page=True, url_ids={row.url_id for row in rows})
            if compare == "previous_period":
                prior = before(now)
                found = await repository.previous_pages(
                    db, prior.scope, {row.url_id for row in rows}
                )
                prior_answers = await repository.answer_count(db, prior.scope)
        return SourcePagePage(
            data=[
                page_row(
                    row,
                    engines,
                    whole,
                    previous=None
                    if prior is None
                    else previous_units(
                        found.get((row.url_id, row.domain_role, row.role_entity_id))
                    ),
                    series=None
                    if series is None
                    else series.points((row.url_id, row.domain_role, row.role_entity_id)),
                )
                for row in rows
            ],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
            meta=compared(sources_meta(now, query, engines, whole, series), prior, prior_answers),
        )

    async def changes(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        kind: SourceChangeKind,
        min_support: int,
        page: OffsetParams,
    ) -> SourceChangePage:
        """New and lost sources (docs/16 C5 and C6). New: `min_support` units in the asked
        window and none in as many days before. Lost: `min_support` units in a support window
        and none in each of the 2 windows after it, which the asked window and the one before
        it are: so `meta.window` is those 2 windows and `meta.compare_window` the support one."""
        engines = shown_engines(query.engine_codes)
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            gap = before(now)
            if kind == "new":
                answered, support = now, gap
            else:
                support = before(gap)
                answered = Scoped(
                    scope=replace(now.scope, since=gap.scope.since),
                    window=MetricWindow(
                        from_=gap.window.from_, to=now.window.to, timezone=now.window.timezone
                    ),
                    first=gap.first,
                    last=now.last,
                    zone=now.zone,
                )
            span = replace(now.scope, since=support.scope.since)
            rows, total = await repository.changes(
                db,
                span,
                split=answered.scope.since,
                kind=kind,
                min_support=min_support,
                roles=query.roles,
                offset=page.offset,
                limit=page.limit,
            )
        return SourceChangePage(
            data=[
                SourceChangeRow(
                    registrable_domain=row.registrable_domain,
                    domain_role=cast(DomainRole, row.domain_role),
                    role_entity_id=row.role_entity_id,
                    current_units=row.current_units,
                    previous_units=row.previous_units,
                    first_seen_at=row.first_seen_at,
                    last_seen_at=row.last_seen_at,
                )
                for row in rows
            ],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
            meta=SourceChangesMeta(
                window=answered.window,
                compare_window=support.window,
                include_branded=query.include_branded,
                engine_codes=[EngineCode(code) for code in engines],
                kind=kind,
                min_support=min_support,
            ),
        )

    async def diversity(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        include: Collection[str] = (),
    ) -> SourceDiversity:
        """The effective number of sources per engine (docs/16 C3), engines never pooled."""
        engines = shown_engines(query.engine_codes)
        weekly_counts: dict[tuple[str, date], tuple[int, int, int]] | None = None
        ads: dict[str, tuple[int, int, int]] | None = None
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            counts, pooled = await repository.diversity(db, now.scope)
            if "series" in include:
                weekly_counts = await repository.diversity_weeks(db, now.scope, now.window.timezone)
            if "ads" in include:
                ads = await repository.ads_presence(db, now.scope)
        weeks = summary_weeks(now.first, now.last)
        entries = [
            diversity_engine(
                code,
                counts.get(code, NO_DIVERSITY),
                None if weekly_counts is None else diversity_series(code, weeks, weekly_counts),
                None if ads is None else ad_presence(ads.get(code, (0, 0, 0))),
            )
            for code in engines
        ]
        values = [
            entry.effective_sources.value
            for entry in entries
            if entry.effective_sources.value is not None
        ]
        return SourceDiversity(
            data=entries,
            meta=SourceDiversityMeta(
                window=now.window,
                include_branded=query.include_branded,
                engine_codes=[EngineCode(code) for code in engines],
                distinct_domains=pooled,
                effective_sources_engine_average=sum(values) / len(values) if values else None,
            ),
        )

    async def domain(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        registrable_domain: str,
    ) -> SourceDomainDetail:
        """One registrable domain: its rows, pages, prompts, weekly units per engine and the
        entities named with it, each list bounded; empty lists when it is not cited in scope.
        The project is looked up first: an unknown or deleted one is `404`."""
        name = registrable_domain.lower()
        engines = shown_engines(query.engine_codes)
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows, _ = await repository.domain_counts(
                db,
                now.scope,
                roles=None,
                registrable_domain=name,
                sort="-citation_units",
                offset=0,
                limit=DETAIL_ROWS_MAX,
            )
            whole = await repository.totals(db, now.scope)
            pages, _ = await repository.page_counts(
                db,
                now.scope,
                roles=None,
                registrable_domain=name,
                sort="-citation_units",
                offset=0,
                limit=DETAIL_PAGES_MAX,
            )
            prompts = await repository.domain_prompts(db, now.scope, name, top=DETAIL_PROMPTS_MAX)
            weekly_counts = await repository.domain_engine_weeks(
                db, now.scope, name, now.window.timezone
            )
            named = await repository.cited_with(db, now.scope, [name], top=CITED_WITH_MAX)
        weeks = summary_weeks(now.first, now.last)
        return SourceDomainDetail(
            data=SourceDomainDetailData(
                registrable_domain=name,
                rows=[domain_row(row, engines, whole) for row in rows],
                engines=[domain_engine_series(code, weeks, weekly_counts) for code in engines]
                if rows
                else [],
                top_pages=[page_row(row, engines, whole) for row in pages],
                prompts=[
                    DomainPrompt(prompt_id=prompt_id, citation_units=units, observations=seen)
                    for prompt_id, units, seen in prompts
                ],
                cited_with=[
                    CitedWith(entity_id=entity_id, observations=seen)
                    for entity_id, seen in named.get((name, None, None), [])
                ],
            ),
            meta=sources_meta(now, query, engines, whole),
        )

    async def prompts(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        own_cited: bool | None,
        page: CursorParams,
    ) -> PromptOwnPagesPage:
        """Per prompt and engine of the counted answers, which own pages they cite (BE-SOURCES-20).
        The project is looked up first by `scoped`: an unknown or deleted one is `404`."""
        engines = shown_engines(query.engine_codes)
        bound = _prompts_cursor_scope(project_id, query, engines, own_cited)
        after = None if page.cursor is None else _prompt_after(page.cursor, bound)
        async with self._transaction(access) as db:
            now = await scoped(db, access, project_id, query, engines)
            rows = await repository.prompt_own_pages(
                db, now.scope, own_cited=own_cited, after=after, limit=page.limit + 1
            )
        shown = rows[: page.limit]
        next_cursor = None
        if len(rows) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([str(last.prompt_id), last.engine_code], scope=bound)
        return PromptOwnPagesPage(
            data=[
                PromptOwnPagesRow(
                    prompt_id=row.prompt_id,
                    engine_code=EngineCode(row.engine_code),
                    answers=row.answers,
                    answers_citing_own=row.answers_citing_own,
                    own_citation_units=row.own_citation_units,
                    own_pages=row.own_pages,
                    top_own_page=None
                    if row.top_url_id is None
                    else OwnPage(url_id=row.top_url_id, url=row.canonical_url),
                )
                for row in shown
            ],
            page=CursorPageInfo(
                limit=page.limit, next_cursor=next_cursor, has_more=next_cursor is not None
            ),
            meta=PromptOwnPagesMeta(
                window=now.window,
                include_branded=query.include_branded,
                engine_codes=[EngineCode(code) for code in engines],
            ),
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
                    quote=row.quote,
                )
                for row in shown
            ],
            page=CursorPageInfo(
                limit=page.limit, next_cursor=next_cursor, has_more=next_cursor is not None
            ),
        )

    async def fanout(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SourceQuery,
        *,
        min_support: int,
        include: Collection[str] = (),
        page: OffsetParams,
    ) -> FanoutQueryPage:
        """The queries the engines issued while answering (docs/16 F4), the most issued first;
        with `include=topics` each names the topics of the prompts that issued it. An engine
        that does not show them is refused, never read as zero."""
        engines = shown_engines(query.engine_codes) if query.engine_codes else list(FANOUT_ENGINES)
        async with self._transaction(access) as db:
            # The project is looked up first: an unknown or deleted one is 404 whatever engines
            # the request names.
            now = await scoped(db, access, project_id, query, engines)
            refused = [code for code in engines if code in NO_FANOUT]
            if refused:
                raise EngineHasNoFanoutError(
                    "These engines do not show the queries they issue.", engine_codes=refused
                )
            rows, total = await repository.fanout_counts(
                db, now.scope, min_support=min_support, offset=page.offset, limit=page.limit
            )
            cited = await repository.fanout_cited(
                db,
                now.scope,
                [(row.normalized_text, row.engine_code) for row in rows],
                top=CITED_DOMAINS_MAX,
            )
            topics = (
                await repository.fanout_topics(
                    db,
                    now.scope,
                    [(row.normalized_text, row.engine_code) for row in rows],
                    top=TOPICS_MAX,
                )
                if "topics" in include
                else None
            )
            counts = await repository.fanout_totals(db, now.scope)
        return FanoutQueryPage(
            data=[
                FanoutQueryRow(
                    query_text=row.query_text,
                    normalized_text=row.normalized_text,
                    engine_code=EngineCode(row.engine_code),
                    observations=row.observations,
                    prompts=row.prompts,
                    prompt_ids=list(row.prompt_ids),
                    first_seen_at=row.first_seen_at,
                    last_seen_at=row.last_seen_at,
                    cited_domains=[
                        FanoutCitedDomain(
                            registrable_domain=domain.registrable_domain,
                            domain_role=cast(DomainRole, domain.domain_role),
                            role_entity_id=domain.role_entity_id,
                            citation_units=domain.citation_units,
                        )
                        for domain in cited.get((row.normalized_text, row.engine_code), [])
                    ],
                    topics=(
                        None
                        if topics is None
                        else [
                            FanoutTopic(term_id=term_id, observations=seen)
                            for term_id, seen in topics.get(
                                (row.normalized_text, row.engine_code), []
                            )
                        ]
                    ),
                )
                for row in rows
            ],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
            meta=FanoutMeta(
                window=now.window,
                include_branded=query.include_branded,
                engine_codes=[EngineCode(code) for code in engines],
                min_support=min_support,
                answers=counts.answers,
                answers_with_fanout=counts.answers_with_fanout,
                answers_truncated=counts.answers_truncated,
                engines_without_fanout=[EngineCode(code) for code in NO_FANOUT],
            ),
        )
