"""The pass fetches the history and the two default months of every tracked page (plan 01 task 6,
spec D21 and section 5)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_page_detail import page_pattern
from idraft.collectors.gsc_sync import Outcome, SyncReport, sync_integration
from idraft.domain.gsc_pull import PullState
from idraft.domain.page_search import compare_window, last_full_month
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.internal_links.support import url_id
from tests.collectors.gsc_support import (
    SITE,
    FakeSearchConsole,
    Property,
    fill,
    integration_row,
    make_property,
    sync_context,
    today,
)
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]
BASE = "https://example.com"


@pytest.fixture
def fake() -> FakeSearchConsole:
    return FakeSearchConsole()


def hits(count: int, *, key: str = "q") -> list[dict[str, Any]]:
    """`count` rows of one filtered read, the clicks falling with the row number."""
    return [
        {"keys": [f"{key} {n}"], "clicks": count - n, "impressions": 100, "position": 3.0}
        for n in range(count)
    ]


def give_defaults(fake: FakeSearchConsole, *, queries: int = 5) -> None:
    final = fake.final_through
    fake.set_filtered(
        SITE,
        ("date",),
        [
            {
                "keys": [(final - timedelta(days=back)).isoformat()],
                "clicks": 4,
                "impressions": 40,
                "position": 2.0,
            }
            for back in (1, 2)
        ],
    )
    fake.set_filtered(SITE, ("query",), hits(queries))
    for dimension, key in (("country", "usa"), ("device", "MOBILE")):
        fake.set_filtered(
            SITE, (dimension,), [{"keys": [key], "clicks": 3, "impressions": 30, "position": 4.0}]
        )


async def track(pg: PostgresServer, prop: Property, *paths: str) -> list[int]:
    """The pages at `paths` of the site, tracked by the property's project."""
    found: list[int] = []
    for path in paths:
        page = await url_id(pg, f"{BASE}/{path}")
        await execute(
            pg,
            "INSERT INTO core.tracked_pages (project_id, url_id, workspace_id) VALUES ($1, $2, $3)",
            prop.project_id,
            page,
            prop.workspace_id,
        )
        found.append(page)
    return found


async def run_pass(
    sessions: Sessions, fake: FakeSearchConsole, prop: Property, **changes: Any
) -> SyncReport:
    return await sync_integration(
        sync_context(sessions, fake, page_totals=True, **changes),
        prop.workspace_id,
        prop.integration_id,
    )


async def markers(pg: PostgresServer, prop: Property) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT url_id, kind, date_from, date_to, row_count, query_count, query_count_capped "
        "FROM fp.gsc_page_fetches WHERE integration_id = $1 ORDER BY url_id, kind, date_from",
        prop.integration_id,
    )
    return [dict(row) for row in rows]


def filtered(fake: FakeSearchConsole, dimension: str) -> list[dict[str, Any]]:
    return [body for body in fake.filtered_requests() if body["dimensions"] == [dimension]]


async def test_a_pass_fetches_the_history_of_a_tracked_page_once(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    (page,) = await track(migrated, prop, "pricing")
    give_defaults(fake)

    await run_pass(worker_db, fake, prop)

    days = await fetch(
        migrated,
        "SELECT metric_date, clicks, position_sum FROM fp.gsc_page_daily "
        "WHERE integration_id = $1 AND url_id = $2 ORDER BY metric_date",
        prop.integration_id,
        page,
    )
    assert [(row["clicks"], row["position_sum"]) for row in days] == [(4, 80), (4, 80)]
    assert [row["kind"] for row in await markers(migrated, prop) if row["kind"] == "history"] == [
        "history"
    ]
    assert len(filtered(fake, "date")) == 1

    await run_pass(worker_db, fake, prop)

    assert len(filtered(fake, "date")) == 1


async def test_a_pass_fetches_the_last_full_month_and_the_month_before_for_a_tracked_page(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    (page,) = await track(migrated, prop, "pricing")
    give_defaults(fake)
    month = last_full_month(fake.final_through)
    before = compare_window(*month, "previous_period")
    assert before is not None
    fake.set_filtered(SITE, ("query",), hits(130), period=month)
    fake.set_filtered(SITE, ("query",), hits(90), period=before)

    report = await run_pass(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    assert len(fake.filtered_requests()) == 7
    assert {body["rowLimit"] for body in filtered(fake, "query")} == {25_000}
    kept = {
        (row["kind"], row["date_from"], row["date_to"]): row
        for row in await markers(migrated, prop)
        if row["url_id"] == page and row["kind"] != "history"
    }
    assert set(kept) == {
        (kind, *window) for kind in ("query", "country", "device") for window in (month, before)
    }
    assert (kept["query", *month]["query_count"], kept["query", *month]["row_count"]) == (130, 100)
    assert kept["query", *before]["query_count"] == 90
    assert not kept["query", *month]["query_count_capped"]
    assert not kept["query", *before]["query_count_capped"]


async def test_a_later_month_costs_three_calls_because_the_month_before_is_already_stored(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await track(migrated, prop, "pricing")
    give_defaults(fake)
    last_month_end = today().replace(day=1) - timedelta(days=1)
    fake.final_through = last_month_end - timedelta(days=5)
    fill(fake, SITE, days=1)
    await run_pass(worker_db, fake, prop)
    asked = len(fake.filtered_requests())
    assert asked == 7

    fake.final_through = last_month_end
    fill(fake, SITE, days=1)
    report = await run_pass(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    later = fake.filtered_requests()[asked:]
    assert [body["dimensions"] for body in later] == [["query"], ["country"], ["device"]]
    assert {(body["startDate"], body["endDate"]) for body in later} == {
        (last_month_end.replace(day=1).isoformat(), last_month_end.isoformat())
    }
    newest = [
        row
        for row in await markers(migrated, prop)
        if row["kind"] == "query" and row["date_to"] == last_month_end
    ]
    assert [row["query_count"] for row in newest] == [5]


async def test_a_page_that_is_not_tracked_is_not_fetched(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await url_id(migrated, f"{BASE}/pricing")
    give_defaults(fake)

    await run_pass(worker_db, fake, prop)

    assert fake.filtered_requests() == []
    assert await markers(migrated, prop) == []


async def test_the_step_stops_on_the_budget_and_the_next_pass_goes_on(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    first, second, third = await track(migrated, prop, "a", "b", "c")
    give_defaults(fake)

    # The clock stands still until the first page is done: the probe and its seven calls.
    cut = await run_pass(
        worker_db, fake, prop, monotonic=lambda: 0.0 if len(fake.requests) < 8 else 1e9
    )

    assert cut.outcome is Outcome.DONE
    assert cut.more is True
    assert {row["url_id"] for row in await markers(migrated, prop)} == {first}

    rest = await run_pass(worker_db, fake, prop)

    assert rest.more is False
    assert {row["url_id"] for row in await markers(migrated, prop)} == {first, second, third}


async def test_a_quota_error_in_the_step_fails_the_pass_and_keeps_what_was_stored(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await track(migrated, prop, "pricing")
    give_defaults(fake)
    # The probe and the history are answered; the first breakdown call is refused.
    fake.quota_after = 2

    report = await run_pass(worker_db, fake, prop)

    assert report.outcome is Outcome.FAILED
    assert [row["kind"] for row in await markers(migrated, prop)] == ["history"]


async def test_filtered_calls_never_ask_for_property_aggregation(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await track(migrated, prop, "pricing")
    give_defaults(fake)

    report = await run_pass(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    assert {body["aggregationType"] for body in fake.filtered_requests()} == {"auto"}


async def test_one_page_google_cannot_answer_for_does_not_stop_the_others(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    first, second, third = await track(migrated, prop, "a", "b", "c")
    give_defaults(fake)
    broken = await fetchrow(migrated, "SELECT canonical_url FROM core.urls WHERE id = $1", second)
    fake.malformed_patterns.add(page_pattern(broken["canonical_url"], []))

    report = await run_pass(worker_db, fake, prop)

    assert report.outcome is Outcome.FAILED
    assert {row["url_id"] for row in await markers(migrated, prop)} == {first, third}
    state = PullState.read((await integration_row(migrated, prop.integration_id))["backfill_state"])
    assert state.failures == 1
    assert state.retry_after is not None


async def test_the_step_runs_after_the_history_sweep(
    migrated: PostgresServer, worker_db: Sessions, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await track(migrated, prop, "pricing")
    give_defaults(fake)
    fill(fake, SITE, days=40)
    ticks = iter(range(10_000))

    # Each check of the clock is a second: the 28 recent days, 28 page days, then the sweep.
    report = await run_pass(
        worker_db,
        fake,
        prop,
        monotonic=lambda: float(next(ticks)),
        budget=timedelta(seconds=62),
    )

    state = PullState.read((await integration_row(migrated, prop.integration_id))["backfill_state"])
    assert report.more is True
    assert state.recent_done
    assert not state.complete
    assert fake.filtered_requests() == []
