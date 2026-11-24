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
    assert row["next_run_at"] > now
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
    assert live["last_sent_at"] is None
    assert live["last_error"] == "1 of 2 emails were not sent"
    idle = await fetchrow(
        migrated,
        "SELECT last_error, next_run_at < now() AS still_due FROM core.ai_report_schedules "
        "WHERE id = $1::uuid",
        ids[1],
    )
    assert (idle["last_error"], idle["still_due"]) == (None, True)
