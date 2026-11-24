"""Scheduled report emails, as people manage them, and the digest that sends them."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.reports.schedules import next_slot
from idraft.providers.email import EmailMessage, EmailSendError
from idraft.worker.report_digest import send_due_reports
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer
from tests.db.support import connection

type Sessions = async_sessionmaker[AsyncSession]
PUBLIC = "/api/v1/public/reports"


class Recorder:
    def __init__(self, *, fail_for: str | None = None) -> None:
        self.sent: list[EmailMessage] = []
        self._fail_for = fail_for

    async def send(self, message: EmailMessage) -> None:
        if message.to == self._fail_for:
            raise EmailSendError("the email provider answered 500")
        self.sent.append(message)


async def _base(migrated: PostgresServer) -> tuple[str, Any, Any]:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    return project_url(workspace, project, "reports", "schedules"), workspace, project


def test_a_weekly_schedule_runs_next_monday_at_6_and_a_monthly_one_on_the_first() -> None:
    wednesday = datetime(2026, 11, 25, 9, 30, tzinfo=UTC)
    assert next_slot("weekly", wednesday) == datetime(2026, 11, 30, 6, 0, tzinfo=UTC)
    assert next_slot("monthly", wednesday) == datetime(2026, 12, 1, 6, 0, tzinfo=UTC)
    # Exactly at a slot, the next one: a slot is never sent twice.
    monday = datetime(2026, 11, 30, 6, 0, tzinfo=UTC)
    assert next_slot("weekly", monday) == datetime(2026, 12, 7, 6, 0, tzinfo=UTC)
    # Before the slot of the same day, that slot; at the turn of the year, January.
    assert next_slot("weekly", datetime(2026, 11, 30, 5, 59, tzinfo=UTC)) == monday
    assert next_slot("monthly", datetime(2026, 12, 31, 23, 0, tzinfo=UTC)) == datetime(
        2027, 1, 1, 6, 0, tzinfo=UTC
    )
    assert next_slot("monthly", datetime(2026, 12, 1, 5, 0, tzinfo=UTC)) == datetime(
        2026, 12, 1, 6, 0, tzinfo=UTC
    )


async def test_a_schedule_is_made_with_clean_recipients_and_audited_without_addresses(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")

    made = await api.post(
        base,
        json={"frequency": "weekly", "recipients": [" Client@Example.com", "client@example.com"]},
        headers=editor.headers,
    )

    assert made.status_code == 201, made.text
    data = made.json()["data"]
    assert data["recipients"] == ["client@example.com"]
    assert (data["paused"], data["last_sent_at"], data["last_error"]) == (False, None, None)
    entry = await fetchrow(
        migrated,
        "SELECT after::text AS after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'ai_report_schedule.created'",
        workspace.id,
    )
    assert "client@example.com" not in entry["after"]
    listed = await api.get(base, headers=editor.headers)
    assert [row["id"] for row in listed.json()["data"]] == [data["id"]]


@pytest.mark.parametrize(
    "body",
    [
        {"frequency": "daily", "recipients": ["a@example.com"]},
        {"frequency": "weekly", "recipients": []},
        {"frequency": "weekly", "recipients": ["not an address"]},
        {"frequency": "weekly", "recipients": [f"u{n}@example.com" for n in range(11)]},
        {"frequency": "weekly", "recipients": ["a@example.com\r\nbcc: b@example.com"]},
    ],
)
async def test_a_schedule_needs_a_rhythm_and_one_to_ten_real_addresses(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer, body: dict[str, Any]
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")

    assert (await api.post(base, json=body, headers=editor.headers)).status_code == 422


async def test_a_project_holds_ten_schedules_and_a_viewer_cannot_change_them(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    viewer = await member(resources, migrated, workspace, "viewer")
    body = {"frequency": "monthly", "recipients": ["a@example.com"]}
    for _ in range(10):
        assert (await api.post(base, json=body, headers=editor.headers)).status_code == 201

    eleventh = await api.post(base, json=body, headers=editor.headers)

    assert problem(eleventh) == (422, "schedule_limit")
    assert (await api.post(base, json=body, headers=viewer.headers)).status_code == 403
    assert (await api.get(base, headers=viewer.headers)).status_code == 200


async def test_pausing_resuming_and_deleting_and_nothing_crosses_workspaces(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    other, other_workspace, _ = await _base(migrated)
    outsider = await member(resources, migrated, other_workspace, "owner")
    made = await api.post(
        base, json={"frequency": "weekly", "recipients": ["a@example.com"]}, headers=editor.headers
    )
    schedule = made.json()["data"]
    url = f"{base}/{schedule['id']}"
    await execute(
        migrated,
        "UPDATE core.ai_report_schedules SET next_run_at = now() - interval '9 days' "
        "WHERE id = $1::uuid",
        schedule["id"],
    )

    paused = await api.patch(url, json={"paused": True}, headers=editor.headers)
    resumed = await api.patch(url, json={"paused": False}, headers=editor.headers)
    monthly = await api.patch(url, json={"frequency": "monthly"}, headers=editor.headers)
    empty = await api.patch(url, json={}, headers=editor.headers)

    assert paused.json()["data"]["paused"] is True
    # Resumed, it waits for its next slot instead of sending for the slot it missed.
    assert resumed.json()["data"]["next_run_at"] > datetime.now(UTC).isoformat()
    assert monthly.json()["data"]["frequency"] == "monthly"
    assert empty.status_code == 200
    refused = await api.patch(
        f"{other}/{schedule['id']}", json={"paused": True}, headers=outsider.headers
    )
    assert problem(refused) == (404, "not_found")
    assert (
        await api.delete(f"{other}/{schedule['id']}", headers=outsider.headers)
    ).status_code == 404
    assert (await api.delete(url, headers=editor.headers)).status_code == 204
    assert problem(await api.delete(url, headers=editor.headers)) == (404, "not_found")


async def test_the_digest_sends_a_due_schedule_once_with_a_working_link(
    api: httpx.AsyncClient,
    resources: Any,
    migrated: PostgresServer,
    worker_db: Sessions,
) -> None:
    base, workspace, project = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    made = await api.post(
        base,
        json={"frequency": "weekly", "recipients": ["a@example.com", "b@example.com"]},
        headers=editor.headers,
    )
    schedule_id = made.json()["data"]["id"]
    await execute(
        migrated,
        "UPDATE core.ai_report_schedules SET next_run_at = now() - interval '1 hour' "
        "WHERE id = $1::uuid",
        schedule_id,
    )
    sender = Recorder()
    now = datetime.now(UTC)

    first = await send_due_reports(worker_db, sender, origin="https://app.example", now=now)
    second = await send_due_reports(worker_db, sender, origin="https://app.example", now=now)

    assert (first.claimed, first.sent, first.failed) == (1, 1, 0)
    assert second.claimed == 0
    assert [message.to for message in sender.sent] == ["a@example.com", "b@example.com"]
    link = sender.sent[0].text.split("https://app.example/public/reports/")[1].split()[0]
    assert sender.sent[1].text.count(link) == 1
    assert (await api.get(f"{PUBLIC}/{link}")).status_code == 200
    row = await fetchrow(
        migrated,
        "SELECT last_sent_at, last_error, next_run_at FROM core.ai_report_schedules "
        "WHERE id = $1::uuid",
        schedule_id,
    )
    assert row["last_sent_at"] is not None
    assert row["last_error"] is None
    assert row["next_run_at"] == next_slot("weekly", now)
    shares = await fetch(
        migrated,
        "SELECT expires_at - created_at AS span FROM core.ai_report_shares WHERE project_id = $1",
        project,
    )
    assert [share["span"].days for share in shares] == [30]


async def test_a_failed_send_is_recorded_not_retried_and_a_paused_schedule_is_left_alone(
    api: httpx.AsyncClient,
    resources: Any,
    migrated: PostgresServer,
    worker_db: Sessions,
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    ids = []
    for paused in (False, True):
        made = await api.post(
            base,
            json={"frequency": "weekly", "recipients": ["a@example.com", "bad@example.com"]},
            headers=editor.headers,
        )
        ids.append(made.json()["data"]["id"])
        await execute(
            migrated,
            "UPDATE core.ai_report_schedules SET next_run_at = now() - interval '1 hour', "
            "paused = $2 WHERE id = $1::uuid",
            ids[-1],
            paused,
        )
    now = datetime.now(UTC)

    report = await send_due_reports(
        worker_db, Recorder(fail_for="bad@example.com"), origin="https://app.example", now=now
    )
    again = await send_due_reports(worker_db, Recorder(), origin="https://app.example", now=now)

    assert (report.claimed, report.sent, report.failed) == (1, 0, 1)
    assert again.claimed == 0
    live = await fetchrow(
        migrated,
        "SELECT last_sent_at, last_error FROM core.ai_report_schedules WHERE id = $1::uuid",
        ids[0],
    )
    # One of the two got it: it was sent, and the failure is still said
    assert live["last_sent_at"] is not None
    assert live["last_error"] == "1 of 2 emails were not sent"
    idle = await fetchrow(
        migrated,
        "SELECT last_error, next_run_at < now() AS still_due FROM core.ai_report_schedules "
        "WHERE id = $1::uuid",
        ids[1],
    )
    assert (idle["last_error"], idle["still_due"]) == (None, True)


async def _due_schedule(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer, who: str
) -> tuple[Any, str]:
    base, workspace, _ = await _base(migrated)
    caller = await member(resources, migrated, workspace, who)
    made = await api.post(
        base, json={"frequency": "weekly", "recipients": ["a@example.com"]}, headers=caller.headers
    )
    schedule_id = made.json()["data"]["id"]
    await execute(
        migrated,
        "UPDATE core.ai_report_schedules SET next_run_at = now() - interval '1 hour' "
        "WHERE id = $1::uuid",
        schedule_id,
    )
    return (workspace, caller), schedule_id


async def test_one_schedule_that_breaks_never_costs_the_others_their_email(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, broken = await _due_schedule(api, resources, migrated, "editor")
    _, fine = await _due_schedule(api, resources, migrated, "editor")

    class Exploding(Recorder):
        async def send(self, message: EmailMessage) -> None:
            if not self.sent:
                self.sent.append(message)  # the first schedule's only mail goes through...
                raise RuntimeError("provider client blew up")  # ...after an unexpected error
            await super().send(message)

    report = await send_due_reports(
        worker_db, Exploding(), origin="https://app.example", now=datetime.now(UTC)
    )

    assert (report.claimed, report.failed) == (2, 1)
    assert report.sent == 1
    rows = await fetch(
        migrated,
        "SELECT id::text, last_error FROM core.ai_report_schedules WHERE id = ANY($1::uuid[])",
        [broken, fine],
    )
    errors = {row["id"]: row["last_error"] for row in rows}
    assert sorted(value is None for value in errors.values()) == [False, True]
    assert "blew up" not in str(errors)


async def test_a_schedule_stops_when_the_person_who_made_it_leaves_the_workspace(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer, worker_db: Sessions
) -> None:
    (workspace, caller), schedule_id = await _due_schedule(api, resources, migrated, "editor")
    await execute(
        migrated,
        "DELETE FROM auth.memberships WHERE workspace_id = $1 AND user_id = $2",
        workspace.id,
        caller.user_id,
    )
    sender = Recorder()

    report = await send_due_reports(
        worker_db, sender, origin="https://app.example", now=datetime.now(UTC)
    )

    assert (report.claimed, report.sent, report.failed) == (1, 0, 1)
    assert sender.sent == []
    row = await fetchrow(
        migrated,
        "SELECT last_error FROM core.ai_report_schedules WHERE id = $1::uuid",
        schedule_id,
    )
    assert row["last_error"] == "the person who made it can no longer send it"


async def test_editing_the_recipients_does_not_move_the_next_email(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    made = await api.post(
        base, json={"frequency": "weekly", "recipients": ["a@example.com"]}, headers=editor.headers
    )
    schedule = made.json()["data"]
    await execute(
        migrated,
        "UPDATE core.ai_report_schedules SET next_run_at = now() - interval '1 minute' "
        "WHERE id = $1::uuid",
        schedule["id"],
    )

    edited = await api.patch(
        f"{base}/{schedule['id']}",
        json={"frequency": "weekly", "recipients": ["b@example.com"]},
        headers=editor.headers,
    )

    # Still due: the edit changed who gets it, not when
    assert datetime.fromisoformat(edited.json()["data"]["next_run_at"]) < datetime.now(UTC)
    # Not left due for the digest tests that share this database
    await api.delete(f"{base}/{schedule['id']}", headers=editor.headers)


_SLOT_CASES = [
    ("weekly", datetime(2026, 11, 30, 5, 59, tzinfo=UTC)),
    ("weekly", datetime(2026, 11, 30, 6, 0, tzinfo=UTC)),
    ("weekly", datetime(2026, 11, 25, 9, 30, tzinfo=UTC)),
    ("weekly", datetime(2026, 12, 31, 23, 0, tzinfo=UTC)),
    ("monthly", datetime(2026, 12, 1, 5, 59, tzinfo=UTC)),
    ("monthly", datetime(2026, 12, 1, 6, 0, tzinfo=UTC)),
    ("monthly", datetime(2026, 11, 25, 9, 30, tzinfo=UTC)),
    ("monthly", datetime(2026, 12, 31, 23, 0, tzinfo=UTC)),
]


@pytest.mark.parametrize(("frequency", "now"), _SLOT_CASES)
async def test_the_claim_moves_a_schedule_to_the_same_slot_the_api_would_give(
    api: httpx.AsyncClient,
    resources: Any,
    migrated: PostgresServer,
    frequency: str,
    now: datetime,
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    made = await api.post(
        base, json={"frequency": frequency, "recipients": ["a@example.com"]}, headers=editor.headers
    )
    schedule_id = made.json()["data"]["id"]
    await execute(
        migrated,
        "UPDATE core.ai_report_schedules SET next_run_at = '2000-01-01' WHERE id = $1::uuid",
        schedule_id,
    )

    # Whatever the time zone of the session, the slot is in UTC
    async with connection(migrated) as db:
        await db.execute("SET TIME ZONE 'Asia/Kolkata'")
        rows = await db.fetch(
            "SELECT id, next_run_at FROM core.ai_report_schedules_claim_due($1, 1000)", now
        )

    claimed = {str(row["id"]): row["next_run_at"] for row in rows}
    assert claimed[schedule_id] == next_slot(frequency, now)  # type: ignore[arg-type]


async def test_a_resume_of_a_schedule_that_is_not_paused_keeps_its_next_email(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    made = await api.post(
        base, json={"frequency": "weekly", "recipients": ["a@example.com"]}, headers=editor.headers
    )
    schedule_id = made.json()["data"]["id"]
    due = datetime(2020, 1, 1, tzinfo=UTC)
    await execute(
        migrated,
        "UPDATE core.ai_report_schedules SET next_run_at = $2 WHERE id = $1::uuid",
        schedule_id,
        due,
    )

    resumed = await api.patch(
        f"{base}/{schedule_id}", json={"paused": False}, headers=editor.headers
    )

    assert datetime.fromisoformat(resumed.json()["data"]["next_run_at"]) == due
    await api.delete(f"{base}/{schedule_id}", headers=editor.headers)


async def test_a_schedule_stops_with_a_workspace_that_is_not_active(
    api: httpx.AsyncClient, resources: Any, migrated: PostgresServer, worker_db: Sessions
) -> None:
    (workspace, _), schedule_id = await _due_schedule(api, resources, migrated, "editor")
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1", workspace.id
    )
    sender = Recorder()

    report = await send_due_reports(
        worker_db, sender, origin="https://app.example", now=datetime.now(UTC)
    )

    assert (report.claimed, report.sent, report.failed) == (1, 0, 1)
    assert sender.sent == []
    row = await fetchrow(
        migrated,
        "SELECT last_error FROM core.ai_report_schedules WHERE id = $1::uuid",
        schedule_id,
    )
    assert row["last_error"] == "the workspace is not active"
