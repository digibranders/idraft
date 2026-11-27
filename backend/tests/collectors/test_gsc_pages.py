"""Clicks and impressions per page and day (plan 04 Task 8, decision D10)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_pages import (
    page_clicks,
    page_day_rows,
    prune_pages,
    replace_page_day,
    stored_page_days,
)
from idraft.collectors.gsc_store import load_integration
from idraft.collectors.gsc_sync import sync_integration
from idraft.db.engine import workspace_transaction
from idraft.domain.gsc_pull import history_start
from idraft.providers.google.client import AnalyticsRow
from idraft.providers.google.errors import GoogleResponseError
from tests.api.auth.support import execute, fetch
from tests.api.internal_links.support import url_id
from tests.collectors.gsc_support import (
    SITE,
    FakeSearchConsole,
    Property,
    fill,
    make_property,
    sync_context,
)
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]
DAY = date(2026, 11, 10)


def row(page: str, clicks: int, impressions: int, day: date = DAY) -> AnalyticsRow:
    return AnalyticsRow(
        keys=(day.isoformat(), page), clicks=clicks, impressions=impressions, position=3.0
    )


def test_two_spellings_of_one_page_are_added_together_and_a_bad_address_is_set_aside() -> None:
    rows, skipped = page_day_rows(
        [
            row("https://example.com/pricing", 4, 40),
            row("https://EXAMPLE.com/pricing", 1, 10),
            row("not a url", 9, 90),
        ],
        DAY,
    )
    assert skipped == 1
    assert len(rows) == 1
    assert (rows[0].clicks, rows[0].impressions) == (5, 50)


def test_a_row_of_another_day_is_refused() -> None:
    with pytest.raises(GoogleResponseError):
        page_day_rows([row("https://example.com/", 1, 1, day=DAY + timedelta(days=1))], DAY)


async def test_a_day_replaces_the_day_and_only_known_urls_are_kept(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    known = await url_id(migrated, "https://example.com/pricing")
    rows, _ = page_day_rows(
        [
            row("https://example.com/pricing", 4, 40),
            row("https://example.com/never-seen-xyz", 1, 5),
        ],
        DAY,
    )
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        written, unknown = await replace_page_day(db, facts, DAY, rows)
        again, _ = await replace_page_day(db, facts, DAY, rows)
        days = await stored_page_days(db, facts, DAY - timedelta(days=2), DAY)
        totals = await page_clicks(
            db, prop.workspace_id, prop.project_id, prop.integration_id, (DAY, DAY), None
        )
    assert (written, unknown, again) == (1, 1, 1)
    assert days == {DAY}
    assert (totals[known].clicks, totals[known].impressions) == (4, 40)


async def test_old_days_are_pruned(migrated: PostgresServer, worker_db: Sessions) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    await url_id(migrated, "https://example.com/pricing")
    old, new = DAY - timedelta(days=40), DAY
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        for day in (old, new):
            rows, _ = page_day_rows([row("https://example.com/pricing", 1, 1, day)], day)
            await replace_page_day(db, facts, day, rows)
        await prune_pages(db, facts, DAY - timedelta(days=35))
        days = await stored_page_days(db, facts, old, new)
    assert days == {new}


async def test_a_pass_with_page_totals_asks_for_page_rows_over_the_window_and_stores_them(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    await url_id(migrated, "https://example.com/pricing")
    days = fill(fake, SITE, days=40)
    for day in days:
        fake.set_page_day(SITE, day, [("https://example.com/pricing", 3, 30)])

    report = await sync_integration(
        sync_context(worker_db, fake, page_totals=True), prop.workspace_id, prop.integration_id
    )

    assert report.more is False
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        stored = await stored_page_days(db, facts, days[0], days[-1])
    # The 28 days that end the window, not the older history.
    assert stored == set(days[-28:])
    asked = {body["startDate"] for body in fake.page_requests() if body["startRow"] == 0}
    assert asked == {day.isoformat() for day in days[-28:]}


async def test_a_pass_without_page_totals_makes_no_page_request(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=5)
    await sync_integration(sync_context(worker_db, fake), prop.workspace_id, prop.integration_id)
    assert fake.page_requests() == []


PRICING = "https://example.com/pricing"


async def _pass_with_pages(worker_db: Sessions, fake: FakeSearchConsole, prop: Property) -> None:
    fill(fake, SITE, days=40)
    await sync_integration(
        sync_context(worker_db, fake, page_totals=True), prop.workspace_id, prop.integration_id
    )


async def _stored(migrated: PostgresServer, prop: Property, table: str) -> list[dict[str, object]]:
    rows = await fetch(
        migrated, f"SELECT * FROM {table} WHERE integration_id = $1", prop.integration_id
    )
    return [dict(row) for row in rows]


async def test_a_page_day_keeps_position_times_impressions(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    await url_id(migrated, PRICING)
    fake.page_positions[PRICING] = 4.0
    fake.set_page_day(SITE, fake.final_through, [(PRICING, 2, 10)])

    await _pass_with_pages(worker_db, fake, prop)

    rows = await _stored(migrated, prop, "fp.gsc_page_daily")
    assert [row["position_sum"] for row in rows] == [Decimal("40.00")]


async def test_two_spellings_of_one_page_are_summed_and_both_kept_as_forms(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    page_id = await url_id(migrated, PRICING)
    fake.page_positions.update({PRICING: 4.0, PRICING + "/": 2.0})
    fake.set_page_day(SITE, fake.final_through, [(PRICING, 1, 10), (PRICING + "/", 3, 30)])

    await _pass_with_pages(worker_db, fake, prop)

    [total] = await _stored(migrated, prop, "fp.gsc_page_daily")
    assert (total["url_id"], total["impressions"], total["position_sum"]) == (
        page_id,
        40,
        Decimal("100.00"),
    )
    forms = await _stored(migrated, prop, "fp.gsc_page_forms")
    assert {(form["page"], form["last_seen"]) for form in forms} == {
        (PRICING, fake.final_through),
        (PRICING + "/", fake.final_through),
    }


async def test_a_form_seen_again_moves_its_last_seen(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    await url_id(migrated, PRICING)
    earlier, later = fake.final_through - timedelta(days=1), fake.final_through
    for day in (earlier, later):
        fake.set_page_day(SITE, day, [(PRICING, 1, 10)])

    await _pass_with_pages(worker_db, fake, prop)

    [form] = await _stored(migrated, prop, "fp.gsc_page_forms")
    assert (form["page"], form["last_seen"]) == (PRICING, later)


async def _old_row(migrated: PostgresServer, prop: Property, page: int, day: date) -> None:
    await execute(
        migrated,
        "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
        "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, 1, 1)",
        prop.integration_id,
        day,
        page,
        prop.workspace_id,
        prop.project_id,
    )


async def test_rows_older_than_sixteen_months_go_and_a_tracked_page_keeps_them(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    tracked = await url_id(migrated, PRICING)
    other = await url_id(migrated, "https://example.com/other")
    await execute(
        migrated,
        "INSERT INTO core.tracked_pages (project_id, url_id, workspace_id) VALUES ($1, $2, $3)",
        prop.project_id,
        tracked,
        prop.workspace_id,
    )
    old = history_start(fake.final_through + timedelta(days=3)) - timedelta(days=5)
    for page in (tracked, other):
        await _old_row(migrated, prop, page, old)

    await _pass_with_pages(worker_db, fake, prop)

    kept = [
        row["url_id"]
        for row in await _stored(migrated, prop, "fp.gsc_page_daily")
        if row["metric_date"] == old
    ]
    assert kept == [tracked]


async def test_rows_of_forty_days_ago_are_kept(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    page = await url_id(migrated, PRICING)
    day = fake.final_through - timedelta(days=40)
    await _old_row(migrated, prop, page, day)

    await _pass_with_pages(worker_db, fake, prop)

    rows = await _stored(migrated, prop, "fp.gsc_page_daily")
    assert [row["metric_date"] for row in rows] == [day]
