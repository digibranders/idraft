"""What the GA4 sync is sent for, and when (docs/18 section 13)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.ga4_plan import (
    SCHEDULE_NAME,
    SCHEDULE_TIMEZONE,
    Ga4SyncTask,
    plan_syncs,
)
from idraft.domain.ga4_pull import Ga4PullState
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.collectors.gsc_support import (
    Property,
    empty_integrations,
    make_property,
)
from tests.conftest import PostgresServer
from tests.providers.google.fake_google import FakeGoogle

type Sessions = async_sessionmaker[AsyncSession]
REDIRECT = "https://app.example.com/api/v1/oauth/google/callback"
DONE = Ga4PullState().succeeded(date(2026, 11, 25))


class Sent:
    def __init__(self, *, accept: bool = True) -> None:
        self.tasks: list[Ga4SyncTask] = []
        self._accept = accept

    async def __call__(self, task: Ga4SyncTask) -> bool:
        self.tasks.append(task)
        return self._accept

    @property
    def integrations(self) -> set[uuid.UUID]:
        return {task.integration_id for task in self.tasks}


@pytest.fixture
def fake() -> FakeGoogle:
    return FakeGoogle(REDIRECT)


@pytest.fixture(autouse=True)
async def _alone(migrated: PostgresServer) -> None:
    await empty_integrations(migrated)


async def _property(pg: PostgresServer, fake: FakeGoogle, **changes: Any) -> Property:
    return await make_property(pg, fake, kind="ga4", **changes)


async def _schedules(pg: PostgresServer, prop: Property) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.schedules WHERE project_id = $1 AND workload = 'ga4_sync'",
        prop.project_id,
    )
    return [dict(row) for row in rows]


async def _state(pg: PostgresServer, prop: Property, state: Ga4PullState) -> None:
    await execute(
        pg,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        prop.integration_id,
        json.dumps(state.write({})),
    )


async def _due(pg: PostgresServer, prop: Property, when: datetime, **set_also: str) -> None:
    extra = "".join(f", {column} = {value}" for column, value in set_also.items())
    await execute(
        pg,
        f"UPDATE ops.schedules SET next_run_at = $2{extra} "
        "WHERE project_id = $1 AND workload = 'ga4_sync'",
        prop.project_id,
        when,
    )


async def test_a_property_gets_a_daily_schedule_at_six_in_pacific_time_once(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await _property(migrated, fake)
    now = datetime.now(UTC)

    first = await plan_syncs(worker_db, Sent(), now=now)
    second = await plan_syncs(worker_db, Sent(), now=now)

    assert first.schedules_made == 1
    assert second.schedules_made == 0
    (schedule,) = await _schedules(migrated, prop)
    assert (schedule["name"], schedule["cadence"], schedule["timezone"]) == (
        SCHEDULE_NAME,
        "daily",
        SCHEDULE_TIMEZONE,
    )
    assert SCHEDULE_NAME == "Daily GA4 sync"
    assert str(schedule["window_start_local"]) == "06:00:00"
    assert schedule["window_hours"] == 6
    assert now < schedule["next_run_at"] <= now + timedelta(days=1, minutes=1)
    assert schedule["workspace_id"] == prop.workspace_id


async def test_a_schedule_a_person_paused_or_deleted_is_not_made_again(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await _property(migrated, fake)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = false, deleted_at = now() WHERE project_id = $1 "
        "AND workload = 'ga4_sync'",
        prop.project_id,
    )

    await plan_syncs(worker_db, Sent(), now=now)

    assert len(await _schedules(migrated, prop)) == 1


async def test_a_disabled_or_unattached_property_or_a_revoked_connection_gets_no_schedule(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    disabled = await _property(migrated, fake)
    unattached = await _property(migrated, fake)
    revoked = await _property(migrated, fake)
    reauth = await _property(migrated, fake)
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'disabled' WHERE id = $1",
        disabled.integration_id,
    )
    await execute(
        migrated,
        "UPDATE fp.integrations SET project_id = NULL WHERE id = $1",
        unattached.integration_id,
    )
    await execute(
        migrated,
        "UPDATE fp.connections SET status = 'revoked', credential_ref = NULL WHERE id = $1",
        revoked.connection_id,
    )
    await execute(
        migrated,
        "UPDATE fp.connections SET status = 'reauth_required' WHERE id = $1",
        reauth.connection_id,
    )

    report = await plan_syncs(worker_db, Sent(), now=datetime.now(UTC))

    assert report.schedules_made == 0
    for prop in (disabled, unattached, revoked, reauth):
        assert await _schedules(migrated, prop) == []


async def test_a_search_console_property_is_never_planned_and_a_project_has_one_schedule_of_each(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    ga4 = await _property(migrated, fake)
    search_console = await make_property(migrated, fake)
    both = await make_property(migrated, fake, kind="ga4", external_property="properties/12")
    await execute(
        migrated,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
        "connection_id, scopes) VALUES ($1, $2, 'gsc', 'sc-domain:both.example', $3, '{openid}')",
        both.workspace_id,
        both.project_id,
        both.connection_id,
    )
    sent = Sent()

    report = await plan_syncs(worker_db, sent, now=datetime.now(UTC))

    assert sent.integrations == {ga4.integration_id, both.integration_id}
    assert search_console.integration_id not in sent.integrations
    assert await _schedules(migrated, search_console) == []
    assert report.schedules_made == 2
    for prop in (ga4, both):
        assert len(await _schedules(migrated, prop)) == 1
    only_both = await fetch(
        migrated,
        "SELECT workload FROM ops.schedules WHERE project_id = $1 ORDER BY 1",
        both.project_id,
    )
    assert [row["workload"] for row in only_both] == ["ga4_sync"]


async def test_a_property_whose_first_run_is_not_done_is_sent_at_once(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    new = await _property(migrated, fake)
    half = await _property(migrated, fake)
    done = await _property(migrated, fake)
    await _state(migrated, half, Ga4PullState(through=date(2026, 11, 25), complete=False))
    await _state(migrated, done, DONE)
    sent = Sent()

    report = await plan_syncs(worker_db, sent, now=datetime.now(UTC))

    assert sent.integrations == {new.integration_id, half.integration_id}
    assert report.continued == 2
    tasks = {task.integration_id: task for task in sent.tasks}
    assert tasks[new.integration_id].workspace_id == new.workspace_id


async def test_a_property_whose_state_is_of_another_version_is_sent_at_once(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    old = await _property(migrated, fake)
    await execute(
        migrated,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        old.integration_id,
        json.dumps({"ga4": {"version": 0, "through": "2026-11-25", "complete": True}}),
    )
    sent = Sent()

    await plan_syncs(worker_db, sent, now=datetime.now(UTC))

    assert old.integration_id in sent.integrations


async def test_a_run_that_failed_is_sent_again_only_when_its_wait_is_over(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    waiting = await _property(migrated, fake)
    ready = await _property(migrated, fake)
    done_and_waiting = await _property(migrated, fake)
    done_and_ready = await _property(migrated, fake)
    now = datetime.now(UTC)
    await _state(migrated, waiting, Ga4PullState().failed(now))
    await _state(migrated, ready, Ga4PullState().failed(now - timedelta(hours=1)))
    # a property that was complete and failed today is tried again as soon as its wait is over,
    # not tomorrow
    await _state(migrated, done_and_waiting, DONE.failed(now))
    await _state(migrated, done_and_ready, DONE.failed(now - timedelta(hours=1)))
    sent = Sent()

    await plan_syncs(worker_db, sent, now=now)

    assert sent.integrations == {ready.integration_id, done_and_ready.integration_id}


async def test_a_property_that_cannot_be_read_is_not_sent(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    reauth = await _property(migrated, fake)
    revoked = await _property(migrated, fake)
    errored = await _property(migrated, fake)
    archived = await _property(migrated, fake)
    suspended = await _property(migrated, fake)
    await execute(
        migrated,
        "UPDATE fp.connections SET status = 'reauth_required' WHERE id = $1",
        reauth.connection_id,
    )
    await execute(
        migrated,
        "UPDATE fp.connections SET status = 'revoked', credential_ref = NULL WHERE id = $1",
        revoked.connection_id,
    )
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'error' WHERE id = $1",
        errored.integration_id,
    )
    await execute(
        migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", archived.project_id
    )
    await execute(
        migrated,
        "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1",
        suspended.workspace_id,
    )
    sent = Sent()

    await plan_syncs(worker_db, sent, now=datetime.now(UTC))

    assert sent.integrations == set()


async def test_a_due_schedule_sends_its_property_and_moves_to_the_next_day(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await _property(migrated, fake)
    await _state(migrated, prop, DONE)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await _due(migrated, prop, now - timedelta(minutes=5))
    sent = Sent()

    report = await plan_syncs(worker_db, sent, now=now)

    assert sent.integrations == {prop.integration_id}
    assert report.scheduled == 1
    (schedule,) = await _schedules(migrated, prop)
    assert now < schedule["next_run_at"] <= now + timedelta(days=1, minutes=1)
    # the window is over: it is not sent a second time
    again = Sent()
    await plan_syncs(worker_db, again, now=now)
    assert again.tasks == []


async def test_missed_days_are_not_caught_up(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await _property(migrated, fake)
    await _state(migrated, prop, DONE)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await _due(migrated, prop, now - timedelta(days=9))
    sent = Sent()

    await plan_syncs(worker_db, sent, now=now)

    assert [task.integration_id for task in sent.tasks] == [prop.integration_id]
    (schedule,) = await _schedules(migrated, prop)
    assert schedule["next_run_at"] > now


async def test_a_paused_schedule_sends_nothing_and_a_dedupe_hit_is_not_counted(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await _property(migrated, fake)
    await _state(migrated, prop, DONE)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await _due(migrated, prop, now - timedelta(minutes=5), is_active="false")
    paused = Sent()
    await plan_syncs(worker_db, paused, now=now)
    assert paused.tasks == []

    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = true WHERE project_id = $1 AND workload = 'ga4_sync'",
        prop.project_id,
    )
    refused = Sent(accept=False)
    report = await plan_syncs(worker_db, refused, now=now)
    assert prop.integration_id in refused.integrations
    assert report.scheduled == 0


async def test_a_schedule_of_a_property_that_was_disabled_moves_on_without_sending(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    prop = await _property(migrated, fake)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await _due(migrated, prop, now - timedelta(minutes=5))
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'disabled' WHERE id = $1",
        prop.integration_id,
    )
    sent = Sent()

    await plan_syncs(worker_db, sent, now=now)

    assert sent.tasks == []
    (schedule,) = await _schedules(migrated, prop)
    assert schedule["next_run_at"] > now


async def test_a_task_names_one_property_and_dedupes_on_it() -> None:
    task = Ga4SyncTask(workspace_id=uuid.uuid4(), integration_id=uuid.uuid4())

    assert task.dedupe_key == f"ga4_sync:{task.integration_id}"
    with pytest.raises(ValueError, match="integration_id"):
        Ga4SyncTask.model_validate({"workspace_id": str(uuid.uuid4())})


async def test_two_workspaces_each_get_their_own_schedule(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeGoogle
) -> None:
    one = await _property(migrated, fake)
    other = await _property(migrated, fake, workspace=await make_workspace(migrated))

    await plan_syncs(worker_db, Sent(), now=datetime.now(UTC))

    for prop in (one, other):
        (schedule,) = await _schedules(migrated, prop)
        assert schedule["workspace_id"] == prop.workspace_id
    row = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.schedules "
        "WHERE workload = 'ga4_sync' AND project_id = ANY($1)",
        [one.project_id, other.project_id],
    )
    assert row["n"] == 2
