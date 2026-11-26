"""One page's Search Console history and its breakdown by query, location and device: asked of
Google with a page filter, stored once and marked as fetched (spec sections 5 and 6). The worker
calls this for tracked pages inside a pass; the API calls it when a page's Search tab asks.

The module never opens a transaction around a call to Google: it reads, calls, then writes. Every
statement names the workspace, because the worker's role bypasses row-level security. Query text is
customer data and is never logged.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Final, Literal, Protocol

from sqlalchemy import (
    Date,
    DateTime,
    and_,
    cast,
    delete,
    func,
    literal_column,
    not_,
    select,
    tuple_,
)
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_store import DEVICES, IntegrationFacts
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    gsc_page_breakdown,
    gsc_page_daily,
    gsc_page_fetches,
    gsc_page_forms,
    tracked_pages,
)
from idraft.domain.gsc_pull import history_start
from idraft.providers.google.client import (
    SEARCH_ANALYTICS_ROW_LIMIT,
    AnalyticsRow,
    Dimension,
    DimensionFilter,
)
from idraft.providers.google.errors import GoogleResponseError

HISTORY: Final = "history"
DIMENSIONS: Final = ("query", "country", "device")
# What a call asks for. The query read asks for the most Google allows, in one request, and never
# pages: the number of rows it returns is the page's query count (spec D21).
FETCH_LIMITS: Final[dict[str, int]] = {
    "query": SEARCH_ANALYTICS_ROW_LIMIT,
    "country": 50,
    "device": 25,
}
# What is kept: the top rows by clicks.
KEEP_LIMITS: Final[dict[str, int]] = {"query": 100, "country": 50, "device": 25}
MAX_FORMS: Final = 8
# A fetch on demand is kept this long; a tracked page's calendar months are kept for good.
KEEP_FETCH_DAYS: Final = 30
_COUNTRY_LENGTH: Final = 3
_CENTS: Final = Decimal("0.01")

type BreakdownDimension = Literal["query", "country", "device"]


class PageQuery(Protocol):
    """One `searchAnalytics.query` call for final data, within the caller's budget."""

    async def __call__(
        self,
        *,
        start: date,
        end: date,
        dimensions: Sequence[Dimension],
        filters: Sequence[DimensionFilter],
        row_limit: int,
    ) -> list[AnalyticsRow]: ...


@dataclass(frozen=True, slots=True)
class PageRef:
    url_id: int
    canonical_url: str


def page_pattern(canonical_url: str, forms: Sequence[str]) -> str:
    """The regular expression a page filter names: the stored addresses exactly, or, with none
    stored, the canonical address under either scheme, with or without its trailing slash."""
    if forms:
        return "^(" + "|".join(re.escape(form) for form in forms[:MAX_FORMS]) + ")$"
    rest = canonical_url.split("://", 1)[1]
    if "?" in rest:
        return "^https?://" + re.escape(rest) + "$"
    return "^https?://" + re.escape(rest.rstrip("/")) + "/?$"


async def page_filter(db: AsyncSession, facts: IntegrationFacts, page: PageRef) -> DimensionFilter:
    found = await db.execute(
        select(gsc_page_forms.c.page)
        .where(
            gsc_page_forms.c.workspace_id == facts.workspace_id,
            gsc_page_forms.c.integration_id == facts.integration_id,
            gsc_page_forms.c.url_id == page.url_id,
        )
        .order_by(gsc_page_forms.c.last_seen.desc(), gsc_page_forms.c.page)
        .limit(MAX_FORMS)
    )
    forms = [row.page for row in found]
    return DimensionFilter("page", "includingRegex", page_pattern(page.canonical_url, forms))


async def fetched(
    db: AsyncSession, facts: IntegrationFacts, url_id: int, start: date, end: date
) -> set[str]:
    """The breakdown kinds that have a marker for exactly this page and period."""
    found = await db.execute(
        select(gsc_page_fetches.c.kind).where(
            gsc_page_fetches.c.workspace_id == facts.workspace_id,
            gsc_page_fetches.c.integration_id == facts.integration_id,
            gsc_page_fetches.c.url_id == url_id,
            gsc_page_fetches.c.kind.in_(DIMENSIONS),
            gsc_page_fetches.c.date_from == start,
            gsc_page_fetches.c.date_to == end,
        )
    )
    return {row.kind for row in found}


async def history_from(db: AsyncSession, facts: IntegrationFacts, url_id: int) -> date | None:
    """The first day the page's history covers, or None before it was fetched."""
    found = await db.execute(
        select(func.min(gsc_page_fetches.c.date_from)).where(
            gsc_page_fetches.c.workspace_id == facts.workspace_id,
            gsc_page_fetches.c.integration_id == facts.integration_id,
            gsc_page_fetches.c.url_id == url_id,
            gsc_page_fetches.c.kind == HISTORY,
        )
    )
    first: date | None = found.scalar_one()
    return first


def _weighted(row: AnalyticsRow) -> Decimal:
    return Decimal(str(row.position)) * row.impressions


async def store_history(
    db: AsyncSession,
    facts: IntegrationFacts,
    url_id: int,
    start: date,
    end: date,
    rows: Sequence[AnalyticsRow],
) -> int:
    """Fill the page's days from `[date]` rows. A day the bulk pull already stored keeps its
    numbers and gains only the position it lacked. Returns the number of rows given."""
    days: dict[date, tuple[int, int, Decimal]] = {}
    for row in rows:
        if len(row.keys) != 1:
            raise GoogleResponseError("a history row does not have exactly a date")
        try:
            day = date.fromisoformat(row.keys[0])
        except ValueError as error:
            raise GoogleResponseError("a history row has a date that is not a date") from error
        clicks, impressions, position = days.get(day, (0, 0, Decimal(0)))
        days[day] = (
            clicks + row.clicks,
            impressions + row.impressions,
            position + _weighted(row),
        )
    if days:
        statement = upsert(gsc_page_daily).values(
            [
                {
                    "integration_id": facts.integration_id,
                    "metric_date": day,
                    "url_id": url_id,
                    "workspace_id": facts.workspace_id,
                    "project_id": facts.project_id,
                    "clicks": clicks,
                    "impressions": impressions,
                    "position_sum": position.quantize(_CENTS),
                }
                for day, (clicks, impressions, position) in days.items()
            ]
        )
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=["integration_id", "metric_date", "url_id"],
                set_={"position_sum": statement.excluded.position_sum},
                where=gsc_page_daily.c.position_sum.is_(None),
            )
        )
    await db.execute(
        upsert(gsc_page_fetches)
        .values(
            integration_id=facts.integration_id,
            url_id=url_id,
            kind=HISTORY,
            date_from=start,
            date_to=end,
            workspace_id=facts.workspace_id,
            project_id=facts.project_id,
            row_count=len(rows),
        )
        .on_conflict_do_nothing(
            index_elements=["integration_id", "url_id", "kind", "date_from", "date_to"]
        )
    )
    return len(rows)


def _breakdown_key(dimension: BreakdownDimension, raw: str) -> str | None:
    """The key a row is stored under, or None for one the tables have no place for."""
    if dimension == "country":
        return raw.upper() if len(raw) == _COUNTRY_LENGTH else None
    if dimension == "device":
        return raw.upper() if raw.upper() in DEVICES else None
    return raw


async def store_breakdown(
    db: AsyncSession,
    facts: IntegrationFacts,
    url_id: int,
    start: date,
    end: date,
    dimension: BreakdownDimension,
    rows: Sequence[AnalyticsRow],
) -> int:
    """Make the top rows of one read the rows of `(page, period, dimension)` and mark it fetched.
    For `query` the marker also carries the number of rows Google returned (spec D21). Returns the
    number of rows given."""
    given = len(rows)
    merged: dict[str, tuple[int, int, Decimal]] = {}
    for row in rows:
        if len(row.keys) != 1:
            raise GoogleResponseError("a breakdown row does not have exactly one key")
        key = _breakdown_key(dimension, row.keys[0])
        if key is None:
            continue
        clicks, impressions, position = merged.get(key, (0, 0, Decimal(0)))
        merged[key] = (
            clicks + row.clicks,
            impressions + row.impressions,
            position + _weighted(row),
        )
    top = sorted(merged.items(), key=lambda item: (-item[1][0], -item[1][1], item[0]))[
        : KEEP_LIMITS[dimension]
    ]
    await db.execute(
        delete(gsc_page_breakdown).where(
            gsc_page_breakdown.c.workspace_id == facts.workspace_id,
            gsc_page_breakdown.c.integration_id == facts.integration_id,
            gsc_page_breakdown.c.url_id == url_id,
            gsc_page_breakdown.c.date_from == start,
            gsc_page_breakdown.c.date_to == end,
            gsc_page_breakdown.c.dimension == dimension,
        )
    )
    if top:
        statement = upsert(gsc_page_breakdown).values(
            [
                {
                    "integration_id": facts.integration_id,
                    "url_id": url_id,
                    "date_from": start,
                    "date_to": end,
                    "dimension": dimension,
                    "key": key,
                    "workspace_id": facts.workspace_id,
                    "project_id": facts.project_id,
                    "clicks": clicks,
                    "impressions": impressions,
                    "position_sum": position.quantize(_CENTS),
                }
                for key, (clicks, impressions, position) in top
            ]
        )
        # Two first opens of one page at the same moment must not fail on each other.
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    "integration_id",
                    "url_id",
                    "date_from",
                    "date_to",
                    "dimension",
                    "key",
                ],
                set_={
                    "clicks": statement.excluded.clicks,
                    "impressions": statement.excluded.impressions,
                    "position_sum": statement.excluded.position_sum,
                },
            )
        )
    if dimension == "query":
        truncated = given > KEEP_LIMITS["query"]
        query_count: int | None = given
        capped = given >= FETCH_LIMITS["query"]
    else:
        truncated = given >= FETCH_LIMITS[dimension]
        query_count = None
        capped = False
    marker = upsert(gsc_page_fetches).values(
        integration_id=facts.integration_id,
        url_id=url_id,
        kind=dimension,
        date_from=start,
        date_to=end,
        workspace_id=facts.workspace_id,
        project_id=facts.project_id,
        row_count=len(top),
        truncated=truncated,
        query_count=query_count,
        query_count_capped=capped,
    )
    await db.execute(
        marker.on_conflict_do_update(
            index_elements=["integration_id", "url_id", "kind", "date_from", "date_to"],
            set_={
                "row_count": marker.excluded.row_count,
                "truncated": marker.excluded.truncated,
                "query_count": marker.excluded.query_count,
                "query_count_capped": marker.excluded.query_count_capped,
                "fetched_at": func.now(),
            },
        )
    )
    return given


async def ensure_history(
    sessions: async_sessionmaker[AsyncSession],
    query: PageQuery,
    facts: IntegrationFacts,
    page: PageRef,
    *,
    today: date,
    final_through: date,
) -> bool:
    """Fetch the page's history when it has none. True when a call was made."""
    async with workspace_transaction(sessions, facts.workspace_id) as db:
        if await history_from(db, facts, page.url_id) is not None:
            return False
        page_only = await page_filter(db, facts, page)
    first = history_start(today)
    rows = await query(
        start=first,
        end=final_through,
        dimensions=("date",),
        filters=(page_only,),
        row_limit=SEARCH_ANALYTICS_ROW_LIMIT,
    )
    async with workspace_transaction(sessions, facts.workspace_id) as db:
        await store_history(db, facts, page.url_id, first, final_through, rows)
    return True


async def ensure_breakdown(
    sessions: async_sessionmaker[AsyncSession],
    query: PageQuery,
    facts: IntegrationFacts,
    page: PageRef,
    start: date,
    end: date,
    *,
    only: Sequence[BreakdownDimension] = DIMENSIONS,
) -> int:
    """Fetch the dimensions of `only` that this page and period have no marker for. Returns the
    number of calls made. A call that fails leaves the dimensions already stored in place."""
    async with workspace_transaction(sessions, facts.workspace_id) as db:
        done = await fetched(db, facts, page.url_id, start, end)
        page_only = await page_filter(db, facts, page)
    calls = 0
    for dimension in only:
        if dimension in done:
            continue
        rows = await query(
            start=start,
            end=end,
            dimensions=(dimension,),
            filters=(page_only,),
            row_limit=FETCH_LIMITS[dimension],
        )
        calls += 1
        async with workspace_transaction(sessions, facts.workspace_id) as db:
            await store_breakdown(db, facts, page.url_id, start, end, dimension, rows)
    return calls


async def prune(db: AsyncSession, facts: IntegrationFacts, *, now: datetime) -> None:
    """Drop breakdown rows and markers fetched more than `KEEP_FETCH_DAYS` ago, except a tracked
    page's whole calendar months. History markers stay."""
    fetches = gsc_page_fetches
    # An alias, so that the subquery is not folded into the delete it sits in.
    old = fetches.alias("old")
    month_start = func.date_trunc("month", old.c.date_from, type_=DateTime)
    whole_month = and_(
        old.c.date_from == cast(month_start, Date),
        old.c.date_to == cast(month_start + literal_column("interval '1 month - 1 day'"), Date),
    )
    tracked = select(tracked_pages.c.url_id).where(
        tracked_pages.c.workspace_id == facts.workspace_id,
        tracked_pages.c.project_id == facts.project_id,
    )
    stale = select(old.c.url_id, old.c.kind, old.c.date_from, old.c.date_to).where(
        old.c.workspace_id == facts.workspace_id,
        old.c.integration_id == facts.integration_id,
        old.c.kind.in_(DIMENSIONS),
        old.c.fetched_at < now - timedelta(days=KEEP_FETCH_DAYS),
        not_(and_(old.c.url_id.in_(tracked), whole_month)),
    )
    rows = gsc_page_breakdown
    await db.execute(
        delete(rows).where(
            rows.c.workspace_id == facts.workspace_id,
            rows.c.integration_id == facts.integration_id,
            tuple_(rows.c.url_id, rows.c.dimension, rows.c.date_from, rows.c.date_to).in_(stale),
        )
    )
    await db.execute(
        delete(fetches).where(
            fetches.c.workspace_id == facts.workspace_id,
            fetches.c.integration_id == facts.integration_id,
            tuple_(fetches.c.url_id, fetches.c.kind, fetches.c.date_from, fetches.c.date_to).in_(
                stale
            ),
        )
    )
