"""The GA4 pull (docs/18 sections 7.2 to 7.5): what one run stores, and what each way of failing
leaves behind."""

from __future__ import annotations

from collections.abc import MutableMapping
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from idraft.collectors import ga4_store, gsc_store
from idraft.collectors.ga4_sync import (
    DIMENSIONS,
    HOURLY_TOKENS,
    METRICS,
    SyncReport,
    session_rows,
    sync_integration,
)
from idraft.collectors.gsc_sync import Outcome
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_referrals import ReferralRow, SessionRow
from idraft.domain.ga4_pull import FIRST_PULL_DAYS, Ga4PullState
from idraft.providers.google.client import TOKEN_URL, Ga4Row
from idraft.providers.google.errors import GoogleResponseError
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.collectors.ga4_support import (
    ReportRow,
    ai_day,
    ga4_context,
    ga4_row,
    reports,
    serve,
    stored,
    yesterday,
)
from tests.collectors.gsc_support import GA4_PROPERTY, Property, integration_row, make_property
from tests.conftest import PostgresServer
from tests.providers.google.fake_google import FakeGoogle

type Sessions = async_sessionmaker[AsyncSession]
REDIRECT = "https://app.example.com/api/v1/oauth/google/callback"
CHANNEL = "ga4_ai_assistant_channel"
RULES = "own_rules"


@pytest.fixture
def fake() -> FakeGoogle:
    return FakeGoogle(REDIRECT)


async def _pull(
    sessions: Sessions, fake: FakeGoogle, workspace_id: Any, integration_id: Any, **changes: Any
) -> SyncReport:
    return await sync_integration(
        ga4_context(sessions, fake, **changes), workspace_id, integration_id
    )


def _state(row: dict[str, Any]) -> Ga4PullState:
    return Ga4PullState.read(row["backfill_state"])


def _expected(day: date, extra: int = 0) -> list[tuple[Any, ...]]:
    """What `ai_day` stores: both classifiers, in the order `stored` reads them."""
    return [
        (day, CHANNEL, 0, "chatgpt.com", 10 + extra, 7, Decimal(2), Decimal("19.99")),
        (day, CHANNEL, 0, "claude", 3, 2, Decimal(0), Decimal(0)),
        (day, RULES, 1, "chatgpt", 12 + extra, 8, Decimal(2), Decimal("19.99")),
        (day, RULES, 1, "perplexity", 4, 3, Decimal(1), Decimal(0)),
    ]


async def test_a_first_run_stores_ninety_days_for_both_classifiers_and_says_it_is_complete(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    # five days older than the first pull: asked for by nobody
    days = serve(fake, GA4_PROPERTY, FIRST_PULL_DAYS + 5)
    window = days[-FIRST_PULL_DAYS:]

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert report == SyncReport(Outcome.DONE, rows_written=4 * 90, calls=1)
    rows = await stored(migrated, prop.integration_id)
    assert rows == [row for day in window for row in _expected(day)]
    (body,) = reports(fake)
    assert body["dateRanges"] == [
        {"startDate": window[0].isoformat(), "endDate": yesterday().isoformat()}
    ]
    assert [d["name"] for d in body["dimensions"]] == list(DIMENSIONS)
    assert [m["name"] for m in body["metrics"]] == list(METRICS)
    assert (body["offset"], body["limit"], body["returnPropertyQuota"]) == ("0", "100000", True)
    row = await integration_row(migrated, prop.integration_id)
    # the first pulled day is kept, for the route to tell what part of a window was collected
    assert _state(row) == Ga4PullState(through=yesterday(), since=window[0], complete=True)
    assert row["last_success_at"] is not None
    assert (row["status"], row["last_error"]) == ("active", None)


async def test_only_ai_rows_are_stored_each_with_the_facts_of_its_integration(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 2)

    await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    # organic search and direct are in the report and not in the table
    assert {row[3] for row in await stored(migrated, prop.integration_id)} == {
        "chatgpt.com",
        "claude",
        "chatgpt",
        "perplexity",
    }
    facts = await fetch(
        migrated,
        "SELECT DISTINCT workspace_id, project_id, origin, unit, landing_url_id, is_current "
        "FROM fp.ai_referral_daily WHERE integration_id = $1",
        prop.integration_id,
    )
    assert [tuple(row) for row in facts] == [
        (prop.workspace_id, prop.project_id, "ga4", "sessions", 0, True)
    ]


async def test_a_later_run_reads_the_trailing_three_days_and_leaves_one_copy_of_each_key(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    days = serve(fake, GA4_PROPERTY, FIRST_PULL_DAYS)
    await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    first = await stored(migrated, prop.integration_id)

    def restated(day: date, back: int) -> list[ReportRow]:
        if back == 0:
            # GA4 restated the last day, and Perplexity is gone from it
            return [row for row in ai_day(day, 5) if row[0][1] != "perplexity.ai"]
        # a day the run does not read again is never taken from the answer
        return ai_day(day, 5 if back < 3 else 100)

    serve(fake, GA4_PROPERTY, FIRST_PULL_DAYS, rows=restated)

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert report.outcome is Outcome.DONE
    second = reports(fake)[-1]
    assert second["dateRanges"] == [
        {
            "startDate": (yesterday() - timedelta(days=2)).isoformat(),
            "endDate": yesterday().isoformat(),
        }
    ]
    rows = await stored(migrated, prop.integration_id)
    older = yesterday() - timedelta(days=3)
    assert [row for row in rows if row[0] <= older] == [row for row in first if row[0] <= older]
    assert [row for row in rows if row[0] == days[-2]] == _expected(days[-2], 5)
    assert [row for row in rows if row[0] == days[-1]] == [
        row for row in _expected(days[-1], 5) if row[3] != "perplexity"
    ]
    # one copy per key, not 90 days plus three
    assert len(rows) == 90 * 4 - 1
    # the first pulled day is recorded once: the run of three days did not move it
    assert _state(await integration_row(migrated, prop.integration_id)).since == days[0]
    assert (report.rows_written, report.calls) == (3 * 4 - 1, 1)


async def test_a_day_that_has_no_ai_row_any_more_loses_what_it_had(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 5)
    await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    serve(fake, GA4_PROPERTY, 5, rows=lambda day, back: [] if back == 0 else ai_day(day))

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.rows_written) == (Outcome.DONE, 2 * 4)
    assert yesterday() not in {row[0] for row in await stored(migrated, prop.integration_id)}


async def test_a_property_with_no_session_stores_nothing_and_is_complete(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert report == SyncReport(Outcome.DONE, rows_written=0, calls=1)
    assert await stored(migrated, prop.integration_id) == []
    assert _state(await integration_row(migrated, prop.integration_id)).complete


async def test_a_report_longer_than_a_page_is_read_page_by_page(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    days = serve(fake, GA4_PROPERTY, 5)

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id, page_size=7)

    # 30 report rows: pages of 7, 7, 7, 7 and 2 rows
    assert report.calls == 5
    assert [(body["offset"], body["limit"]) for body in reports(fake)] == [
        (str(offset), "7") for offset in (0, 7, 14, 21, 28)
    ]
    assert await stored(migrated, prop.integration_id) == [
        row for day in days for row in _expected(day)
    ]


async def test_the_other_workspaces_rows_of_the_same_property_are_never_touched(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    mine = await make_property(migrated, fake, kind="ga4")
    theirs = await make_property(migrated, fake, kind="ga4")
    days = serve(fake, GA4_PROPERTY, 6)
    # an integration of another workspace is not found under this workspace's name
    other = await make_workspace(migrated)
    skipped = await _pull(worker_db, fake, other.id, mine.integration_id)
    assert skipped.outcome is Outcome.SKIPPED
    assert reports(fake) == []
    await _pull(worker_db, fake, theirs.workspace_id, theirs.integration_id)
    theirs_before = await stored(migrated, theirs.integration_id)
    serve(fake, GA4_PROPERTY, 6, rows=lambda day, back: ai_day(day, 9))

    await _pull(worker_db, fake, mine.workspace_id, mine.integration_id)

    assert await stored(migrated, theirs.integration_id) == theirs_before
    assert theirs_before == [row for day in days for row in _expected(day)]
    owners = await fetch(
        migrated,
        "SELECT workspace_id, project_id, integration_id, count(*) AS n FROM fp.ai_referral_daily "
        "WHERE integration_id = ANY($1) GROUP BY 1, 2, 3",
        [mine.integration_id, theirs.integration_id],
    )
    assert {(r["workspace_id"], r["project_id"], r["integration_id"]): r["n"] for r in owners} == {
        (mine.workspace_id, mine.project_id, mine.integration_id): 6 * 4,
        (theirs.workspace_id, theirs.project_id, theirs.integration_id): 6 * 4,
    }


async def test_a_disabled_search_console_or_missing_property_is_skipped(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    search_console = await make_property(migrated, fake)
    serve(fake, GA4_PROPERTY, 3)
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'disabled' WHERE id = $1",
        prop.integration_id,
    )

    disabled = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    # a Search Console integration is not a GA4 one, even with a GA4 sync asked for it
    wrong_kind = await _pull(
        worker_db, fake, search_console.workspace_id, search_console.integration_id
    )

    assert (disabled.outcome, wrong_kind.outcome) == (Outcome.SKIPPED, Outcome.SKIPPED)
    assert reports(fake) == []
    assert await stored(migrated, prop.integration_id) == []


async def test_invalid_grant_marks_the_connection_and_stores_nothing(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    fake.kill_refresh_token(prop.account)

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error) == (Outcome.REAUTH_REQUIRED, "invalid_grant")
    connection = await fetchrow(
        migrated,
        "SELECT status, last_error_code FROM fp.connections WHERE id = $1",
        prop.connection_id,
    )
    assert (connection["status"], connection["last_error_code"]) == (
        "reauth_required",
        "invalid_grant",
    )
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("reauth_required", "invalid_grant")
    assert await stored(migrated, prop.integration_id) == []
    again = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    assert again.outcome is Outcome.SKIPPED


async def test_a_property_the_account_lost_is_an_error_and_the_connection_goes_on(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    fake.ga4_status = 403

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error) == (Outcome.PERMISSION_REVOKED, "permission_revoked")
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("error", "permission_revoked")
    connection = await fetchrow(
        migrated, "SELECT status FROM fp.connections WHERE id = $1", prop.connection_id
    )
    assert connection["status"] == "active"
    assert await stored(migrated, prop.integration_id) == []


async def test_a_quota_error_stores_nothing_and_waits_before_the_next_try(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    fake.ga4_status = 429

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error) == (Outcome.FAILED, "quota_exceeded")
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "quota_exceeded")
    state = _state(row)
    assert (state.failures, state.complete, state.through) == (1, False, None)
    assert state.retry_at is not None
    assert timedelta(minutes=14) < state.retry_at - datetime.now(UTC) <= timedelta(minutes=15)
    assert await stored(migrated, prop.integration_id) == []
    # the next run, with the quota back, stores the window and clears the failure
    fake.ga4_status = None
    done = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    assert done.outcome is Outcome.DONE
    row = await integration_row(migrated, prop.integration_id)
    assert (_state(row).failures, _state(row).retry_at, row["last_error"]) == (0, None, None)
    assert len(await stored(migrated, prop.integration_id)) == 3 * 4


async def test_a_failed_run_keeps_what_the_last_run_stored(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 6)
    await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    before = await stored(migrated, prop.integration_id)
    succeeded_at = (await integration_row(migrated, prop.integration_id))["last_success_at"]
    fake.ga4_status = 503

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error) == (Outcome.FAILED, "unavailable")
    assert await stored(migrated, prop.integration_id) == before
    row = await integration_row(migrated, prop.integration_id)
    assert row["last_success_at"] == succeeded_at
    assert _state(row).complete
    assert _state(row).through == yesterday()
    assert _state(row).failures == 1


async def test_a_property_with_little_quota_left_is_not_asked_for_another_page(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 10)
    # below 30 percent of the hourly budget, with 45 of the 60 report rows still to read
    fake.ga4_tokens_remaining = HOURLY_TOKENS * 3 // 10 - 1

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id, page_size=15)

    assert (report.outcome, report.error, report.calls) == (Outcome.FAILED, "quota_exceeded", 1)
    assert len(reports(fake)) == 1
    assert await stored(migrated, prop.integration_id) == []
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "quota_exceeded")
    state = _state(row)
    assert state.failures == 1
    assert state.retry_at is not None


async def test_thirty_percent_of_the_budget_is_enough_and_the_last_page_needs_no_more(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    on_the_line = await make_property(migrated, fake, kind="ga4", external_property="properties/1")
    last_page = await make_property(migrated, fake, kind="ga4", external_property="properties/2")
    serve(fake, "properties/1", 10)
    serve(fake, "properties/2", 2)
    fake.ga4_tokens_remaining = HOURLY_TOKENS * 3 // 10

    full = await _pull(
        worker_db, fake, on_the_line.workspace_id, on_the_line.integration_id, page_size=15
    )
    fake.ga4_tokens_remaining = 10
    # nothing is left to ask for after the only page, so the quota does not matter any more
    single = await _pull(worker_db, fake, last_page.workspace_id, last_page.integration_id)

    assert (full.outcome, full.calls) == (Outcome.DONE, 4)
    assert (single.outcome, single.calls) == (Outcome.DONE, 1)
    assert len(await stored(migrated, last_page.integration_id)) == 2 * 4


async def test_a_number_that_is_not_one_stores_nothing_and_saves_a_failed_state(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    fake.ga4_rows[GA4_PROPERTY].append(
        (
            ("20261120", "chatgpt.com", "referral", "(not set)", "AI Assistant"),
            ("abc", "1", "0", "0"),
        )
    )

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error) == (Outcome.FAILED, "bad_response")
    assert await stored(migrated, prop.integration_id) == []
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "bad_response")
    assert _state(row).failures == 1


async def _refused(
    worker_db: Sessions,
    migrated: PostgresServer,
    fake: FakeGoogle,
    extra: list[ReportRow],
) -> tuple[Property, list[MutableMapping[str, Any]]]:
    """Pull a property whose report holds `extra` rows after three good days. Returns the
    property and the log events of the run."""
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    fake.ga4_rows[GA4_PROPERTY].extend(extra)
    with capture_logs() as events:
        report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    assert (report.outcome, report.error) == (Outcome.FAILED, "bad_response")
    assert await stored(migrated, prop.integration_id) == []
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "bad_response")
    state = _state(row)
    assert (state.failures, state.complete) == (1, False)
    return prop, events


def _chatgpt(
    sessions: str = "1",
    engaged: str = "1",
    key_events: str = "0",
    revenue: str = "0",
    medium: str = "referral",
) -> ReportRow:
    day = yesterday().strftime("%Y%m%d")
    return (
        (day, "chatgpt.com", medium, "(not set)", "AI Assistant"),
        (sessions, engaged, key_events, revenue),
    )


@pytest.mark.parametrize(
    "metrics",
    [
        {"key_events": "1e99999999999999999999"},
        {"key_events": "1E+999999999"},
        {"revenue": "-1e99999999999999999999"},
        {"revenue": "1E+999999999"},
        {"revenue": "1000000000000"},
        # rounds up to a million millions at two decimals
        {"revenue": "999999999999.996"},
        {"sessions": "2147483648"},
        {"engaged": "99999999999999999999"},
        {"sessions": "9" * 5000},
    ],
    ids=lambda metrics: "-".join(f"{k}={v[:16]}" for k, v in metrics.items()),
)
async def test_a_number_the_tables_cannot_hold_stores_nothing_and_saves_a_failed_state(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle, metrics: dict[str, str]
) -> None:
    await _refused(worker_db, migrated, fake, [_chatgpt(**metrics)])


@pytest.mark.parametrize(
    ("first", "second"),
    [
        ({"sessions": "2000000000"}, {"sessions": "2000000000"}),
        ({"engaged": "2147483647"}, {"engaged": "1"}),
        ({"key_events": "600000000000"}, {"key_events": "600000000000"}),
        ({"revenue": "600000000000"}, {"revenue": "600000000000"}),
        ({"revenue": "-600000000000"}, {"revenue": "-600000000000"}),
    ],
    ids=["sessions", "engaged", "key_events", "revenue", "negative_revenue"],
)
async def test_a_total_the_tables_cannot_hold_stores_nothing_and_saves_a_failed_state(
    worker_db: Sessions,
    migrated: PostgresServer,
    fake: FakeGoogle,
    first: dict[str, str],
    second: dict[str, str],
) -> None:
    # each row fits; the two of one assistant and day are summed by the classifier
    await _refused(
        worker_db,
        migrated,
        fake,
        [_chatgpt(**first), _chatgpt(**second, medium="ai-assistant")],
    )


async def test_the_log_says_why_a_report_was_refused_and_not_what_it_held(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    secret = "secret-looking-value"
    bad_day = (
        # sorts between the days asked for, which is all the fake looks at
        ("2026110x", secret, "referral", "(not set)", "AI Assistant"),
        ("1", "1", "0", "0"),
    )
    _, by_day = await _refused(worker_db, migrated, fake, [bad_day])
    other = FakeGoogle(REDIRECT)
    _, by_number = await _refused(worker_db, migrated, other, [_chatgpt(revenue="1E+999999999")])

    (day_event,) = [e for e in by_day if e["event"] == "ga4 run failed"]
    (number_event,) = [e for e in by_number if e["event"] == "ga4 run failed"]
    assert day_event["reason"] == number_event["reason"] == "bad_response"
    assert day_event["detail"] == "a day of the report is not a date"
    assert number_event["detail"] == "a number of the report is out of range"
    assert secret not in str(by_day)


async def test_a_row_outside_the_window_is_refused_by_the_store_and_nothing_is_changed(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    days = serve(fake, GA4_PROPERTY, 3)
    await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    before = await stored(migrated, prop.integration_id)
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await gsc_store.load_integration(db, prop.workspace_id, prop.integration_id, "ga4")
    assert facts is not None
    outside = ReferralRow(
        day=days[0] - timedelta(days=1),
        classifier="own_rules",
        rules_version=1,
        assistant_code="chatgpt",
        sessions=1,
        engaged_sessions=1,
        key_events=Decimal(0),
        total_revenue=Decimal(0),
    )

    with pytest.raises(ValueError, match="outside the window"):
        async with workspace_transaction(worker_db, prop.workspace_id) as db:
            await ga4_store.replace_window(db, facts, days[0], days[-1], [outside])

    # the check comes before the delete, and nothing was written either
    assert await stored(migrated, prop.integration_id) == before


_DAY = date(2026, 11, 20)
_GOOD_DIMENSIONS = ("20261120", "chatgpt.com", "referral", "(not set)", "AI Assistant")
_GOOD_METRICS = ("12", "9", "3", "19.99")


def _report_row(
    dimensions: tuple[str, ...] = _GOOD_DIMENSIONS, metrics: tuple[str, ...] = _GOOD_METRICS
) -> Ga4Row:
    return Ga4Row(dimensions=dimensions, metrics=metrics)


def test_a_report_row_becomes_a_session_row_with_real_numbers() -> None:
    rows = session_rows([_report_row()], _DAY, _DAY)

    assert rows == [
        SessionRow(
            day=_DAY,
            source="chatgpt.com",
            medium="referral",
            manual_source="(not set)",
            channel_group="AI Assistant",
            sessions=12,
            engaged_sessions=9,
            key_events=Decimal(3),
            revenue=Decimal("19.99"),
        )
    ]


@pytest.mark.parametrize(
    ("dimensions", "metrics"),
    [
        (_GOOD_DIMENSIONS, ("abc", "9", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("", "9", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("-1", "9", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("12.5", "9", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("1_2", "9", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "nine", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "9", "three", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "9", "1e99", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "9", "1e99999999999999999999", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "9", "3", "1E+999999999")),
        (_GOOD_DIMENSIONS, ("12", "9", "3", "999999999999.996")),
        (_GOOD_DIMENSIONS, ("2147483648", "9", "3", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "9" * 5000, "3", "19.99")),
        (_GOOD_DIMENSIONS, ("12", "9", "3", "NaN")),
        (_GOOD_DIMENSIONS, ("12", "9", "3", "Infinity")),
        (_GOOD_DIMENSIONS, ("12", "9", "3", "")),
        (("2026-11-20", *_GOOD_DIMENSIONS[1:]), _GOOD_METRICS),
        (("20261320", *_GOOD_DIMENSIONS[1:]), _GOOD_METRICS),
        (("", *_GOOD_DIMENSIONS[1:]), _GOOD_METRICS),
        # a day outside the window that was asked for
        (("20261119", *_GOOD_DIMENSIONS[1:]), _GOOD_METRICS),
        (("20261121", *_GOOD_DIMENSIONS[1:]), _GOOD_METRICS),
    ],
)
def test_a_report_row_with_a_value_that_is_not_what_the_api_documents_is_refused(
    dimensions: tuple[str, ...], metrics: tuple[str, ...]
) -> None:
    with pytest.raises(GoogleResponseError):
        session_rows([_report_row(dimensions, metrics)], _DAY, _DAY)


def test_a_negative_revenue_is_a_refund_and_is_kept() -> None:
    (row,) = session_rows([_report_row(metrics=("12", "9", "3", "-4.50"))], _DAY, _DAY)

    assert row.revenue == Decimal("-4.50")


async def test_the_first_access_token_that_google_refuses_is_renewed_once(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    fake.ga4_status = 401

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error, report.calls) == (Outcome.FAILED, "unauthorized", 2)
    assert len(fake.called(TOKEN_URL)) == 2
    assert await stored(migrated, prop.integration_id) == []


async def test_a_run_that_is_out_of_time_stops_before_asking_and_stores_nothing(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)

    report = await _pull(
        worker_db, fake, prop.workspace_id, prop.integration_id, budget=timedelta(0)
    )

    assert (report.outcome, report.calls) == (Outcome.FAILED, 0)
    assert reports(fake) == []
    assert await stored(migrated, prop.integration_id) == []
    assert _state(await integration_row(migrated, prop.integration_id)).failures == 1


async def test_a_secret_that_cannot_be_read_needs_a_new_sign_in(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)
    await execute(
        migrated,
        "UPDATE ops.secrets SET ciphertext = '\\x00' WHERE id = "
        "(SELECT credential_ref FROM fp.connections WHERE id = $1)",
        prop.connection_id,
    )

    report = await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert (report.outcome, report.error) == (Outcome.REAUTH_REQUIRED, "secret_unreadable")
    assert reports(fake) == []


async def test_a_failure_of_ours_is_recorded_before_it_is_raised(
    worker_db: Sessions,
    migrated: PostgresServer,
    fake: FakeGoogle,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(fake, GA4_PROPERTY, 3)

    async def broken(*args: object, **kwargs: object) -> ga4_store.Replaced:
        raise RuntimeError("boom")

    monkeypatch.setattr(ga4_store, "replace_window", broken)

    with pytest.raises(RuntimeError, match="boom"):
        await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)

    assert await stored(migrated, prop.integration_id) == []
    row = await integration_row(migrated, prop.integration_id)
    assert (row["status"], row["last_error"]) == ("active", "internal_error")
    state = _state(row)
    assert (state.failures, state.complete) == (1, False)
    assert state.retry_at is not None


async def test_a_window_is_replaced_only_in_the_workspace_that_holds_it(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    other = await make_workspace(migrated)
    days = serve(fake, GA4_PROPERTY, 3)
    await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    before = await stored(migrated, prop.integration_id)
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await gsc_store.load_integration(db, prop.workspace_id, prop.integration_id, "ga4")
    assert facts is not None

    # the same integration under another workspace's name finds nothing to delete
    async with workspace_transaction(worker_db, other.id) as db:
        replaced = await ga4_store.replace_window(
            db, replace(facts, workspace_id=other.id), days[0], days[-1], []
        )

    assert replaced == ga4_store.Replaced(removed=0, written=0)
    assert await stored(migrated, prop.integration_id) == before


async def test_the_rules_of_the_newest_rule_set_are_the_ones_applied(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await make_property(migrated, fake, kind="ga4")
    serve(
        fake,
        GA4_PROPERTY,
        2,
        rows=lambda day, back: [
            ga4_row(day, "mychat.example", "referral", "(not set)", "Referral", 5, 4)
        ],
    )
    await execute(
        migrated,
        "INSERT INTO fp.ai_referrer_rules (rule_set_version, rule_id, match_field, match_type, "
        "pattern, assistant_code, operator, confidence) "
        "VALUES (2, 1, 'referrer_host', 'exact', 'mychat.example', 'mychat', 'Example', 'high')",
    )
    try:
        async with workspace_transaction(worker_db, prop.workspace_id) as db:
            rules = await ga4_store.load_rules(db)
        await _pull(worker_db, fake, prop.workspace_id, prop.integration_id)
    finally:
        await execute(migrated, "DELETE FROM fp.ai_referrer_rules WHERE rule_set_version = 2")

    assert {rule.rule_set_version for rule in rules} == {2}
    assert [
        (row[1], row[2], row[3], row[4]) for row in await stored(migrated, prop.integration_id)
    ] == [
        (RULES, 2, "mychat", 5),
        (RULES, 2, "mychat", 5),
    ]


async def test_the_seeded_rules_are_loaded_with_their_confidence(
    worker_db: Sessions, migrated: PostgresServer
) -> None:
    async with workspace_transaction(worker_db, (await make_workspace(migrated)).id) as db:
        rules = await ga4_store.load_rules(db)

    assert {rule.rule_set_version for rule in rules} == {1}
    assert len(rules) == 20
    assert {rule.confidence for rule in rules} == {"high", "ambiguous"}
    assert {rule.match_field for rule in rules} == {"referrer_host", "utm_source"}
