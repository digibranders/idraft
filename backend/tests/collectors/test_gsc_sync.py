"""The Search Console pull (docs/18 sections 4.2 to 4.6): what one pass stores, in what order,
and what each way of failing leaves behind."""

from __future__ import annotations

import itertools
import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_store import DayRow, load_integration, replace_day
from idraft.collectors.gsc_sync import (
    Outcome,
    SyncReport,
    day_rows,
    sync_integration,
)
from idraft.db.engine import workspace_transaction
from idraft.domain.gsc_pull import ALL_PAGES, PullState, history_start, window_of
from idraft.providers.google.client import AnalyticsRow
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.collectors.gsc_support import (
    SITE,
    FakeSearchConsole,
    Property,
    crm_rows,
    fill,
    integration_row,
    make_property,
    stored,
    sync_context,
    today,
)
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _pull(
    sessions: Sessions, fake: FakeSearchConsole, prop: Property, **changes: Any
) -> SyncReport:
    return await sync_integration(
        sync_context(sessions, fake, **changes), prop.workspace_id, prop.integration_id
    )


def _state(row: dict[str, Any]) -> PullState:
    return PullState.read(row["backfill_state"])


@pytest.fixture
def fake() -> FakeSearchConsole:
    return FakeSearchConsole()


async def test_a_first_pass_stores_every_final_day_and_says_the_window_is_ready(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    days = fill(fake, SITE, days=40, skip=frozenset({5, 6, 30}))

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    assert report.more is False
    assert report.days_written == len(days)
    rows = await stored(migrated, prop.integration_id)
    assert {row[0] for row in rows} == set(days)
    assert {row[9] for row in rows} == {"final"}
    assert {row[10] for row in rows} == {"web"}
    # five rows a day: two raw spellings of one query, whose spellings are kept apart
    assert len(rows) == len(days) * 5
    # every row is the query's numbers over all pages
    assert {row[3] for row in rows} == {ALL_PAGES}
    first_day = [row for row in rows if row[0] == days[0]]
    assert {row[1] for row in first_day} == {"crm software", "CRM  Software", "erp"}
    assert {row[2] for row in first_day} == {"crm software", "erp"}
    assert {(row[4], row[5]) for row in first_day} == {
        ("USA", "DESKTOP"),
        ("USA", "MOBILE"),
        ("GBR", "DESKTOP"),
    }
    # the position is stored as position x impressions
    erp = next(row for row in first_day if row[1] == "erp")
    assert float(erp[8]) == 2.5 * 90

    row = await integration_row(migrated, prop.integration_id)
    state = _state(row)
    assert state.recent_done
    assert state.complete
    assert state.window_end == days[-1]
    assert state.window == window_of(days[-1])
    assert state.days_stored == len(days)
    assert state.rows_stored == len(rows)
    assert state.oldest_day == days[0]
    assert row["last_error"] is None
    assert row["last_success_at"] is not None
    assert row["status"] == "active"


async def test_the_window_comes_first_then_the_history_oldest_day_first(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    days = fill(fake, SITE, days=40)

    await _pull(worker_db, fake, prop)

    fetched = fake.detail_days(SITE)
    window_start, window_end = window_of(days[-1])
    recent = [day for day in days if window_start <= day <= window_end]
    older = [day for day in days if day < window_start]
    assert [day.isoformat() for day in recent + older] == fetched
    assert older == sorted(older)
    assert len(older) == 12


async def test_the_pull_asks_only_for_final_data_one_day_at_a_time(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=5)
    # numbers of days that are not final yet exist, and are never stored
    provisional = fake.final_through + timedelta(days=1)
    fake.set_day(SITE, provisional, crm_rows())

    await _pull(worker_db, fake, prop)

    assert {body["dataState"] for _, body in fake.requests} == {"final"}
    for body in fake.detail_requests():
        assert body["startDate"] == body["endDate"]
        # No page: grouped by page, a search that shows two pages counts an impression for each
        assert body["dimensions"] == ["date", "query", "country", "device"]
        assert body["type"] == "web"
    probe = [body for _, body in fake.requests if body["dimensions"] == ["date"]]
    assert len(probe) == 1
    assert probe[0]["startDate"] == history_start(today()).isoformat()
    assert provisional not in {row[0] for row in await stored(migrated, prop.integration_id)}


async def test_a_second_pass_changes_nothing_and_asks_for_no_stored_day_again(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=20)
    await _pull(worker_db, fake, prop)
    before = await stored(migrated, prop.integration_id)
    state_before = _state(await integration_row(migrated, prop.integration_id))
    fake.requests.clear()

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    assert report.days_written == 0
    assert await stored(migrated, prop.integration_id) == before
    assert fake.detail_requests() == []
    assert _state(await integration_row(migrated, prop.integration_id)) == state_before


async def test_days_stored_per_page_by_the_first_version_are_fetched_again_over_all_pages(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    days = fill(fake, SITE, days=12)
    # What the first version left: a finished pull, version 1, with every day stored per page and
    # the impressions of a search counted once for each page that showed
    legacy = {"gsc": {"version": 1, "recent_done": True, "complete": True, "days_stored": 12}}
    await execute(
        migrated,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        prop.integration_id,
        json.dumps(legacy),
    )
    for day in days:
        await execute(
            migrated,
            "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
            "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
            "impressions, position_sum, data_state) "
            "VALUES ($1, $2, 'web', '\\x01', 77, 'USA', 'DESKTOP', $3, $4, 1, 999, 5, 'final')",
            prop.integration_id,
            day,
            prop.workspace_id,
            prop.project_id,
        )

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    assert report.days_written == len(days)
    rows = await stored(migrated, prop.integration_id)
    assert {row[3] for row in rows} == {ALL_PAGES}
    assert 999 not in {row[7] for row in rows}
    assert len(rows) == len(days) * 5
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.recent_done
    assert state.days_stored == len(days)


async def test_a_day_that_becomes_final_later_is_fetched_by_the_next_pass(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=20)
    await _pull(worker_db, fake, prop)
    newer = [fake.final_through + timedelta(days=n) for n in (1, 2)]
    for day in newer:
        fake.set_day(SITE, day, crm_rows(4))
    fake.final_through = newer[-1]
    fake.requests.clear()

    report = await _pull(worker_db, fake, prop)

    assert report.days_written == 2
    assert fake.detail_days() == [day.isoformat() for day in newer]
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.window_end == newer[-1]
    assert {row[0] for row in await stored(migrated, prop.integration_id)} >= set(newer)


async def test_replacing_a_day_twice_leaves_one_copy_and_replacing_it_with_new_numbers_wins(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    day = today() - timedelta(days=5)

    def make(clicks: int) -> list[DayRow]:
        rows, _ = day_rows(
            [
                AnalyticsRow((day.isoformat(), "crm", "usa", "DESKTOP"), clicks, 10, 3.0),
                AnalyticsRow((day.isoformat(), "crm", "usa", "MOBILE"), 1, 4, 3.0),
            ],
            day,
        )
        return rows

    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        first = await replace_day(db, facts, day, make(2))
        second = await replace_day(db, facts, day, make(2))
        third = await replace_day(db, facts, day, make(9))

    assert (first.removed, first.written) == (0, 2)
    assert (second.removed, second.written) == (2, 2)
    assert (third.removed, third.written) == (2, 2)
    rows = await stored(migrated, prop.integration_id)
    assert len(rows) == 2
    assert sorted(row[6] for row in rows) == [1, 9]


async def test_rows_repeating_a_key_are_summed_and_a_country_or_device_without_a_place_is_skipped(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    day = today() - timedelta(days=5)
    rows, skipped = day_rows(
        [
            AnalyticsRow((day.isoformat(), "crm", "usa", "DESKTOP"), 2, 10, 3.0),
            # the same country written in capitals is the same key
            AnalyticsRow((day.isoformat(), "crm", "USA", "DESKTOP"), 3, 20, 5.0),
            AnalyticsRow((day.isoformat(), "crm", "us", "DESKTOP"), 9, 9, 1.0),
            AnalyticsRow((day.isoformat(), "crm", "usa", "WATCH"), 9, 9, 1.0),
        ],
        day,
    )
    assert skipped == 2

    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        replaced = await replace_day(db, facts, day, rows)

    assert (replaced.written, replaced.collapsed) == (1, 1)
    (row,) = await stored(migrated, prop.integration_id)
    assert (row[6], row[7], float(row[8])) == (5, 30, 10 * 3.0 + 20 * 5.0)


async def test_a_row_of_another_day_is_refused_and_nothing_is_written(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=3)
    other = fake.final_through - timedelta(days=1)
    # the day's rows claim to be of another day
    original = fake._analytics

    def wrong_day(request: httpx.Request) -> httpx.Response:
        body = original(request).json()
        for row in body.get("rows", []):
            if len(row["keys"]) > 1:
                row["keys"][0] = other.isoformat()
        return httpx.Response(200, json=body)

    fake._analytics = wrong_day  # type: ignore[method-assign]

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.FAILED
    assert report.error == "bad_response"
    assert await stored(migrated, prop.integration_id) == []


async def test_a_pass_cut_off_by_its_budget_goes_on_where_it_stopped(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    days = fill(fake, SITE, days=40)
    ticks = itertools.count()

    def monotonic() -> float:
        return float(next(ticks))

    # each check of the clock is a second and the budget is thirty of them: the 28 days of the
    # window and a few of the history
    first = await _pull(worker_db, fake, prop, monotonic=monotonic, budget=timedelta(seconds=32))

    assert first.outcome is Outcome.DONE
    assert first.more is True
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.recent_done
    assert not state.complete
    assert 28 < first.days_written < 40
    assert state.history_next is not None
    assert state.history_next > days[0]
    fetched_first = fake.detail_days()

    second = await _pull(worker_db, fake, prop)

    assert second.more is False
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.complete
    assert state.days_stored == 40
    # no day was asked for twice, and the second pass began at the cursor
    fetched = fake.detail_days()
    assert len(fetched) == len(set(fetched)) == 40
    assert (
        fetched[len(fetched_first)]
        == (days[0] + timedelta(days=(first.days_written - 28))).isoformat()
    )
    assert {row[0] for row in await stored(migrated, prop.integration_id)} == set(days)


async def test_a_pass_cut_off_inside_the_window_leaves_the_window_not_ready(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=40)
    ticks = itertools.count()

    first = await _pull(
        worker_db,
        fake,
        prop,
        monotonic=lambda: float(next(ticks)),
        budget=timedelta(seconds=10),
    )

    assert first.more is True
    state = _state(await integration_row(migrated, prop.integration_id))
    assert not state.recent_done
    assert state.window is None
    second = await _pull(worker_db, fake, prop)
    assert second.more is False
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.recent_done
    assert state.complete
    fetched = fake.detail_days()
    assert len(fetched) == len(set(fetched)) == 40


async def test_a_day_is_paged_by_start_row_until_a_page_is_empty(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=1)

    await _pull(worker_db, fake, prop, page_size=2)

    # five rows: pages of 2, 2, 1, and the empty one
    assert [body["startRow"] for body in fake.detail_requests()] == [0, 2, 4, 5]
    assert len(await stored(migrated, prop.integration_id)) == 5


async def test_a_property_with_no_data_has_a_window_of_zeros(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.DONE
    assert report.days_written == 0
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.recent_done
    assert state.complete
    assert state.window_end == today() - timedelta(days=3)


async def test_invalid_grant_marks_the_connection_and_every_property_on_it(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    first = await make_property(migrated, fake, sites=[SITE, "sc-domain:other.example"])
    # another workspace has its own connection
    second = await make_property(migrated, fake)
    sibling = await make_property(
        migrated,
        fake,
        site="sc-domain:other.example",
        account=first.account,
        connection_id=first.connection_id,
        workspace=Workspace(first.workspace_id, "Acme", "acme"),
    )
    fill(fake, SITE, days=3)
    fake.kill_refresh_token(first.account)

    report = await _pull(worker_db, fake, first)

    assert report.outcome is Outcome.REAUTH_REQUIRED
    assert report.error == "invalid_grant"
    connection = await fetchrow(
        migrated,
        "SELECT status, last_error_code FROM fp.connections WHERE id = $1",
        first.connection_id,
    )
    assert (connection["status"], connection["last_error_code"]) == (
        "reauth_required",
        "invalid_grant",
    )
    for marked in (first, sibling):
        row = await integration_row(migrated, marked.integration_id)
        assert (row["status"], row["last_error"]) == ("reauth_required", "invalid_grant")
    # the other connection is untouched, and a later pass of the stopped one does nothing
    assert (await integration_row(migrated, second.integration_id))["status"] == "active"
    again = await _pull(worker_db, fake, first)
    assert again.outcome is Outcome.SKIPPED
    assert await stored(migrated, first.integration_id) == []


async def test_a_property_the_account_lost_is_an_error_and_the_others_go_on(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    lost = await make_property(migrated, fake, site="sc-domain:lost.example")
    kept = await make_property(migrated, fake)
    fill(fake, SITE, days=3)
    fake.statuses["sc-domain:lost.example"] = 403

    report = await _pull(worker_db, fake, lost)
    other = await _pull(worker_db, fake, kept)

    assert report.outcome is Outcome.PERMISSION_REVOKED
    row = await integration_row(migrated, lost.integration_id)
    assert (row["status"], row["last_error"]) == ("error", "permission_revoked")
    connection = await fetchrow(
        migrated, "SELECT status FROM fp.connections WHERE id = $1", lost.connection_id
    )
    assert connection["status"] == "active"
    assert other.outcome is Outcome.DONE
    assert other.days_written == 3


async def test_a_quota_error_keeps_what_was_stored_and_waits_before_the_next_try(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=10)
    # the probe and four days get through
    fake.quota_after = 1 + 4 * 2
    limiter_calls: list[str] = []
    context = sync_context(worker_db, fake)
    original = context.limiter.quota_exceeded

    def noted(*, site: str) -> None:
        limiter_calls.append(site)
        original(site=site)

    context.limiter.quota_exceeded = noted  # type: ignore[method-assign]

    report = await sync_integration(context, prop.workspace_id, prop.integration_id)

    assert report.outcome is Outcome.FAILED
    assert report.error == "quota_exceeded"
    assert limiter_calls == [SITE]
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "quota_exceeded")
    state = _state(row)
    assert state.failures == 1
    assert state.retry_after is not None
    assert timedelta(minutes=14) < state.retry_after - datetime.now(UTC) <= timedelta(minutes=15)
    assert state.days_stored == 4
    assert len({r[0] for r in await stored(migrated, prop.integration_id)}) == 4
    # the next pass finishes the rest and clears the failure
    fake.quota_after = None
    done = await _pull(worker_db, fake, prop)
    assert done.days_written == 6
    row = await integration_row(migrated, prop.integration_id)
    state = _state(row)
    assert (state.failures, state.retry_after, row["last_error"]) == (0, None, None)


async def test_a_server_that_does_not_answer_is_recorded_and_the_property_stays_active(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=3)
    fake.statuses[SITE] = 503

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.FAILED
    assert report.error == "unavailable"
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "unavailable")
    assert _state(row).failures == 1


async def test_an_answer_that_is_not_what_the_api_documents_writes_nothing(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=3)
    fake.malformed = True

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.FAILED
    assert report.error == "bad_response"
    assert await stored(migrated, prop.integration_id) == []


async def test_a_failure_of_ours_is_recorded_before_it_is_raised(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=3)

    def broken() -> Any:
        raise RuntimeError("boom")

    context = sync_context(worker_db, fake, now=broken)
    with pytest.raises(RuntimeError, match="boom"):
        await sync_integration(context, prop.workspace_id, prop.integration_id)


async def test_a_disabled_or_missing_property_is_skipped(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=3)
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'disabled' WHERE id = $1",
        prop.integration_id,
    )

    assert (await _pull(worker_db, fake, prop)).outcome is Outcome.SKIPPED
    assert fake.requests == []
    other = await make_workspace(migrated)
    await execute(
        migrated, "UPDATE fp.integrations SET status = 'active' WHERE id = $1", prop.integration_id
    )
    # an integration of another workspace is not found under this workspace's name
    report = await sync_integration(sync_context(worker_db, fake), other.id, prop.integration_id)
    assert report.outcome is Outcome.SKIPPED
    assert fake.requests == []


async def test_a_secret_that_cannot_be_read_needs_a_new_sign_in(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=3)
    await execute(
        migrated,
        "UPDATE ops.secrets SET ciphertext = '\\x00' WHERE id = "
        "(SELECT credential_ref FROM fp.connections WHERE id = $1)",
        prop.connection_id,
    )

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.REAUTH_REQUIRED
    assert report.error == "secret_unreadable"
    assert fake.requests == []


async def test_one_workspaces_pull_never_writes_another_workspaces_rows(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    mine = await make_property(migrated, fake)
    theirs = await make_property(migrated, fake, site="sc-domain:theirs.example")
    fill(fake, SITE, days=4)
    fill(fake, "sc-domain:theirs.example", days=2)

    await _pull(worker_db, fake, mine)
    await _pull(worker_db, fake, theirs)

    rows = await fetch(
        migrated,
        "SELECT workspace_id, project_id, integration_id, count(*) AS n "
        "FROM fp.gsc_search_analytics WHERE integration_id = ANY($1) GROUP BY 1, 2, 3",
        [mine.integration_id, theirs.integration_id],
    )
    assert {(r["workspace_id"], r["project_id"], r["integration_id"]): r["n"] for r in rows} == {
        (mine.workspace_id, mine.project_id, mine.integration_id): 20,
        (theirs.workspace_id, theirs.project_id, theirs.integration_id): 10,
    }
    queries = await fetch(
        migrated,
        "SELECT workspace_id FROM fp.gsc_queries WHERE workspace_id = ANY($1) GROUP BY 1",
        [mine.workspace_id, theirs.workspace_id],
    )
    assert len(queries) == 2


def test_the_oldest_day_asked_for_is_inside_sixteen_months() -> None:
    assert history_start(date(2026, 11, 5)) == date(2025, 7, 7)
    assert history_start(date(2026, 3, 31)) == date(2024, 12, 2)
    assert history_start(date(2024, 2, 29)) == date(2022, 10, 31)


async def test_a_state_that_lost_its_sweep_ends_is_given_them_and_finishes(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    days = fill(fake, SITE, days=40)
    await execute(
        migrated,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        prop.integration_id,
        json.dumps(PullState(recent_done=True, window_end=days[-1]).write({})),
    )

    report = await _pull(worker_db, fake, prop)

    assert report.more is False
    state = _state(await integration_row(migrated, prop.integration_id))
    assert state.complete
    assert {row[0] for row in await stored(migrated, prop.integration_id)} == set(days[:40])


async def test_a_probe_that_names_something_other_than_a_day_is_refused(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    original = fake._analytics

    def not_a_day(request: httpx.Request) -> httpx.Response:
        body = original(request).json()
        return httpx.Response(
            200,
            json={
                "rows": [
                    {**row, "keys": ["soon"]}
                    for row in body.get("rows", [{"clicks": 1, "impressions": 1, "position": 1}])
                ]
            },
        )

    fake._analytics = not_a_day  # type: ignore[method-assign]
    fill(fake, SITE, days=2)

    report = await _pull(worker_db, fake, prop)

    assert report.outcome is Outcome.FAILED
    assert report.error == "bad_response"
