"""One page's history and breakdowns, asked of Google with a page filter and stored once
(plan 01 task 5, spec D21 and sections 5 and 6)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import gsc_page_detail
from idraft.collectors.gsc_page_detail import (
    MAX_FORMS,
    PageRef,
    ensure_breakdown,
    ensure_history,
    page_pattern,
    prune,
    store_breakdown,
    store_history,
)
from idraft.collectors.gsc_store import IntegrationFacts, load_integration
from idraft.db.engine import workspace_transaction
from idraft.domain.gsc_pull import history_start
from idraft.providers.google.client import AnalyticsRow, Dimension, DimensionFilter
from idraft.providers.google.errors import GoogleResponseError
from tests.api.auth.support import execute, fetch
from tests.api.internal_links.support import url_id
from tests.collectors.gsc_support import FakeSearchConsole, make_property
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]
PAGE_URL = "https://example.com/pricing"
TODAY = date(2026, 11, 26)
FINAL = date(2026, 11, 22)
START, END = date(2026, 10, 1), date(2026, 10, 31)
NOW = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)


def test_stored_forms_are_matched_exactly() -> None:
    pattern = page_pattern(
        "https://acme.example/pricing",
        ["https://acme.example/pricing", "https://acme.example/pricing/"],
    )
    assert pattern == r"^(https://acme\.example/pricing|https://acme\.example/pricing/)$"


def test_without_forms_either_scheme_and_the_trailing_slash_match() -> None:
    assert page_pattern("https://acme.example/pricing", []) == r"^https?://acme\.example/pricing/?$"
    assert page_pattern("https://acme.example/", []) == r"^https?://acme\.example/?$"


def test_an_address_with_a_query_is_matched_as_it_is() -> None:
    assert page_pattern("https://acme.example/p?id=7", []) == r"^https?://acme\.example/p\?id=7$"


def test_at_most_eight_forms_are_named() -> None:
    forms = [f"https://acme.example/p?x={n}" for n in range(12)]
    assert page_pattern("https://acme.example/p", forms).count("|") == MAX_FORMS - 1


class RecordingQuery:
    """A `PageQuery` that records every call and answers by the first dimension asked for."""

    def __init__(self, answers: dict[str, list[AnalyticsRow]] | None = None) -> None:
        self.answers = answers or {}
        self.calls: list[dict[str, Any]] = []

    async def __call__(
        self,
        *,
        start: date,
        end: date,
        dimensions: Sequence[Dimension],
        filters: Sequence[DimensionFilter],
        row_limit: int,
    ) -> list[AnalyticsRow]:
        self.calls.append(
            {
                "start": start,
                "end": end,
                "dimensions": tuple(dimensions),
                "filters": tuple(filters),
                "row_limit": row_limit,
            }
        )
        return list(self.answers.get(dimensions[0], []))


def hit(key: str, clicks: int, impressions: int = 10, position: float = 2.0) -> AnalyticsRow:
    return AnalyticsRow(keys=(key,), clicks=clicks, impressions=impressions, position=position)


async def start(
    pg: PostgresServer, worker_db: Sessions, url: str = PAGE_URL
) -> tuple[uuid.UUID, IntegrationFacts, PageRef]:
    prop = await make_property(pg, FakeSearchConsole())
    found = await url_id(pg, url)
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
    assert facts is not None
    return prop.integration_id, facts, PageRef(found, url)


async def breakdown_rows(
    pg: PostgresServer, integration: uuid.UUID, page: PageRef, dimension: str
) -> dict[str, tuple[int, int, Decimal]]:
    rows = await fetch(
        pg,
        "SELECT key, clicks, impressions, position_sum FROM fp.gsc_page_breakdown "
        "WHERE integration_id = $1 AND url_id = $2 AND dimension = $3",
        integration,
        page.url_id,
        dimension,
    )
    return {r["key"]: (r["clicks"], r["impressions"], r["position_sum"]) for r in rows}


async def markers(pg: PostgresServer, integration: uuid.UUID, page: PageRef) -> dict[str, Any]:
    rows = await fetch(
        pg,
        "SELECT kind, date_from, date_to, row_count, truncated, query_count, query_count_capped "
        "FROM fp.gsc_page_fetches WHERE integration_id = $1 AND url_id = $2",
        integration,
        page.url_id,
    )
    return {r["kind"]: r for r in rows}


async def test_history_fills_missing_days_and_never_replaces_a_stored_day(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    day = date(2026, 11, 10)
    await execute(
        migrated,
        "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
        "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, 9, 90)",
        integration,
        day,
        page.url_id,
        facts.workspace_id,
        facts.project_id,
    )
    query = RecordingQuery(
        {
            "date": [
                AnalyticsRow((day.isoformat(),), 1, 10, 2.0),
                AnalyticsRow(((day + timedelta(days=1)).isoformat(),), 4, 20, 3.0),
            ]
        }
    )

    assert await ensure_history(worker_db, query, facts, page, today=TODAY, final_through=FINAL)

    rows = await fetch(
        migrated,
        "SELECT metric_date, clicks, position_sum FROM fp.gsc_page_daily "
        "WHERE integration_id = $1 AND url_id = $2 ORDER BY metric_date",
        integration,
        page.url_id,
    )
    assert [(r["metric_date"], r["clicks"], r["position_sum"]) for r in rows] == [
        (day, 9, Decimal("20.00")),
        (day + timedelta(days=1), 4, Decimal("60.00")),
    ]
    marker = (await markers(migrated, integration, page))["history"]
    assert marker["date_from"] == history_start(TODAY)
    assert marker["date_to"] == FINAL
    (call,) = query.calls
    assert call["dimensions"] == ("date",)
    (page_filter,) = call["filters"]
    assert (page_filter.dimension, page_filter.operator) == ("page", "includingRegex")
    assert (call["start"], call["end"]) == (history_start(TODAY), FINAL)


async def test_history_is_fetched_once(migrated: PostgresServer, worker_db: Sessions) -> None:
    _, facts, page = await start(migrated, worker_db)
    query = RecordingQuery({"date": [AnalyticsRow(("2026-11-10",), 1, 10, 2.0)]})

    assert await ensure_history(worker_db, query, facts, page, today=TODAY, final_through=FINAL)
    assert not await ensure_history(worker_db, query, facts, page, today=TODAY, final_through=FINAL)

    assert len(query.calls) == 1


async def test_a_page_google_knows_nothing_about_still_gets_its_marker(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    query = RecordingQuery()

    await ensure_history(worker_db, query, facts, page, today=TODAY, final_through=FINAL)

    assert (await markers(migrated, integration, page))["history"]["row_count"] == 0


async def test_a_history_row_with_an_unreadable_date_is_refused(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, facts, page = await start(migrated, worker_db)
    query = RecordingQuery({"date": [AnalyticsRow(("yesterday",), 1, 10, 2.0)]})

    with pytest.raises(GoogleResponseError):
        await ensure_history(worker_db, query, facts, page, today=TODAY, final_through=FINAL)


async def test_a_breakdown_stores_three_dimensions_and_their_markers(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    query = RecordingQuery(
        {
            "query": [hit("crm software", 7, 70, 3.0), hit("crm", 2, 40, 5.0)],
            "country": [hit("usa", 6, 60, 4.0)],
            "device": [hit("MOBILE", 5, 50, 4.0), hit("DESKTOP", 4, 40, 4.0)],
        }
    )

    calls = await ensure_breakdown(worker_db, query, facts, page, START, END)

    assert calls == 3
    assert [c["row_limit"] for c in query.calls] == [25_000, 50, 25]
    assert [c["dimensions"] for c in query.calls] == [("query",), ("country",), ("device",)]
    assert [(c["start"], c["end"]) for c in query.calls] == [(START, END)] * 3
    assert await breakdown_rows(migrated, integration, page, "query") == {
        "crm software": (7, 70, Decimal("210.00")),
        "crm": (2, 40, Decimal("200.00")),
    }
    assert set(await breakdown_rows(migrated, integration, page, "country")) == {"USA"}
    assert set(await breakdown_rows(migrated, integration, page, "device")) == {"MOBILE", "DESKTOP"}
    found = await markers(migrated, integration, page)
    assert set(found) == {"query", "country", "device"}
    assert (found["query"]["row_count"], found["query"]["query_count"]) == (2, 2)
    for kind in ("country", "device"):
        assert (found[kind]["truncated"], found[kind]["query_count"]) == (False, None)
        assert found[kind]["query_count_capped"] is False


async def test_a_country_answer_of_exactly_its_limit_is_truncated(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    query = RecordingQuery({"country": [hit(f"c{n:02d}", 100 - n) for n in range(50)]})

    await ensure_breakdown(worker_db, query, facts, page, START, END, only=("country",))

    marker = (await markers(migrated, integration, page))["country"]
    assert (marker["row_count"], marker["truncated"]) == (50, True)


async def test_the_query_read_keeps_the_top_100_and_counts_every_row_it_got(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    query = RecordingQuery({"query": [hit(f"query {n:03d}", 1_000 - n) for n in range(130)]})

    await ensure_breakdown(worker_db, query, facts, page, START, END, only=("query",))

    kept = await breakdown_rows(migrated, integration, page, "query")
    assert set(kept) == {f"query {n:03d}" for n in range(100)}
    marker = (await markers(migrated, integration, page))["query"]
    assert (marker["row_count"], marker["truncated"]) == (100, True)
    assert (marker["query_count"], marker["query_count_capped"]) == (130, False)
    # One request, never paged: the page's query count is the number of rows it returned.
    (call,) = query.calls
    assert call["row_limit"] == 25_000


async def test_a_query_answer_of_exactly_the_limit_is_capped(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    monkeypatch.setitem(gsc_page_detail.FETCH_LIMITS, "query", 40)
    query = RecordingQuery({"query": [hit(f"query {n:02d}", 100 - n) for n in range(40)]})

    await ensure_breakdown(worker_db, query, facts, page, START, END, only=("query",))

    marker = (await markers(migrated, integration, page))["query"]
    assert (marker["query_count"], marker["query_count_capped"]) == (40, True)


async def test_a_page_with_no_queries_has_a_count_of_zero(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)

    await ensure_breakdown(worker_db, RecordingQuery(), facts, page, START, END, only=("query",))

    assert await breakdown_rows(migrated, integration, page, "query") == {}
    marker = (await markers(migrated, integration, page))["query"]
    assert (marker["query_count"], marker["query_count_capped"], marker["row_count"]) == (
        0,
        False,
        0,
    )
    assert marker["truncated"] is False


async def test_fetching_the_queries_again_replaces_the_count(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    for given in (130, 90):
        rows = [hit(f"query {n:03d}", 1_000 - n) for n in range(given)]
        async with workspace_transaction(worker_db, facts.workspace_id) as db:
            await store_breakdown(db, facts, page.url_id, START, END, "query", rows)

    assert len(await breakdown_rows(migrated, integration, page, "query")) == 90
    marker = (await markers(migrated, integration, page))["query"]
    assert (marker["query_count"], marker["row_count"], marker["truncated"]) == (90, 90, False)


async def test_a_breakdown_already_fetched_asks_nothing_and_a_missing_dimension_alone_is_asked(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    query = RecordingQuery({"device": [hit("MOBILE", 1)]})
    await ensure_breakdown(worker_db, query, facts, page, START, END)
    query.calls.clear()

    assert await ensure_breakdown(worker_db, query, facts, page, START, END) == 0
    assert query.calls == []

    await execute(
        migrated,
        "DELETE FROM fp.gsc_page_fetches WHERE integration_id = $1 AND kind = 'device'",
        integration,
    )
    assert await ensure_breakdown(worker_db, query, facts, page, START, END) == 1
    assert [c["dimensions"] for c in query.calls] == [("device",)]


async def test_fetching_a_breakdown_again_replaces_its_rows(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    for rows in ([hit("MOBILE", 5), hit("DESKTOP", 4)], [hit("TABLET", 3)]):
        async with workspace_transaction(worker_db, facts.workspace_id) as db:
            await store_breakdown(db, facts, page.url_id, START, END, "device", rows)

    assert set(await breakdown_rows(migrated, integration, page, "device")) == {"TABLET"}


async def test_a_device_or_country_the_tables_have_no_place_for_is_left_out(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, page = await start(migrated, worker_db)
    async with workspace_transaction(worker_db, facts.workspace_id) as db:
        await store_breakdown(
            db, facts, page.url_id, START, END, "device", [hit("SMART_TV", 5), hit("MOBILE", 1)]
        )
        await store_breakdown(
            db, facts, page.url_id, START, END, "country", [hit("x", 5), hit("gbr", 1)]
        )

    assert set(await breakdown_rows(migrated, integration, page, "device")) == {"MOBILE"}
    assert set(await breakdown_rows(migrated, integration, page, "country")) == {"GBR"}


async def test_prune_drops_old_fetches_except_a_tracked_page_s_calendar_months(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    integration, facts, untracked = await start(migrated, worker_db)
    tracked = PageRef(await url_id(migrated, "https://example.com/tracked"), "x")
    today_page = PageRef(await url_id(migrated, "https://example.com/today"), "x")
    await execute(
        migrated,
        "INSERT INTO core.tracked_pages (project_id, url_id, workspace_id) VALUES ($1, $2, $3)",
        facts.project_id,
        tracked.url_id,
        facts.workspace_id,
    )
    old = NOW - timedelta(days=31)
    kept_rows = [hit("MOBILE", 1)]
    plan = [
        (untracked, START, END, old),
        (tracked, date(2026, 10, 5), date(2026, 10, 11), old),
        (tracked, START, END, old),
        (today_page, START, END, NOW),
    ]
    async with workspace_transaction(worker_db, facts.workspace_id) as db:
        for page, first, last, _ in plan:
            await store_breakdown(db, facts, page.url_id, first, last, "device", kept_rows)
        await store_history(db, facts, untracked.url_id, history_start(TODAY), FINAL, [])
    for page, first, _, stamp in plan:
        await execute(
            migrated,
            "UPDATE fp.gsc_page_fetches SET fetched_at = $1 WHERE integration_id = $2 "
            "AND url_id = $3 AND date_from = $4 AND kind <> 'history'",
            stamp,
            integration,
            page.url_id,
            first,
        )
    await execute(
        migrated,
        "UPDATE fp.gsc_page_fetches SET fetched_at = $1 WHERE integration_id = $2 "
        "AND kind = 'history'",
        old,
        integration,
    )

    async with workspace_transaction(worker_db, facts.workspace_id) as db:
        await prune(db, facts, now=NOW)

    left = await fetch(
        migrated,
        "SELECT url_id, kind, date_from, date_to FROM fp.gsc_page_fetches "
        "WHERE integration_id = $1",
        integration,
    )
    assert {(r["url_id"], r["kind"], r["date_from"], r["date_to"]) for r in left} == {
        (untracked.url_id, "history", history_start(TODAY), FINAL),
        (tracked.url_id, "device", START, END),
        (today_page.url_id, "device", START, END),
    }
    rows = await fetch(
        migrated,
        "SELECT url_id, date_from FROM fp.gsc_page_breakdown WHERE integration_id = $1",
        integration,
    )
    assert {(r["url_id"], r["date_from"]) for r in rows} == {
        (tracked.url_id, START),
        (today_page.url_id, START),
    }
