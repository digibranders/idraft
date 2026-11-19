"""Clicks and impressions per page and day (plan 04 Task 8, decision D10)."""

from __future__ import annotations

from datetime import date, timedelta

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
from idraft.providers.google.client import AnalyticsRow
from idraft.providers.google.errors import GoogleResponseError
from tests.api.internal_links.support import url_id
from tests.collectors.gsc_support import (
    SITE,
    FakeSearchConsole,
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
