"""What the Search Console sync is sent for, and when (docs/18 section 13)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_plan import (
    SCHEDULE_NAME,
    SCHEDULE_TIMEZONE,
    GscSyncTask,
    plan_syncs,
)
from idraft.domain.gsc_pull import PullState
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.collectors.gsc_support import (
    SITE,
    FakeSearchConsole,
    Property,
    empty_integrations,
    make_property,
)
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


class Sent:
    def __init__(self, *, accept: bool = True) -> None:
        self.tasks: list[GscSyncTask] = []
        self._accept = accept

    async def __call__(self, task: GscSyncTask) -> bool:
        self.tasks.append(task)
        return self._accept

    @property
    def integrations(self) -> set[uuid.UUID]:
        return {task.integration_id for task in self.tasks}


@pytest.fixture
def fake() -> FakeSearchConsole:
    return FakeSearchConsole()


@pytest.fixture(autouse=True)
async def _alone(migrated: PostgresServer) -> None:
    await empty_integrations(migrated)


async def _schedules(pg: PostgresServer, prop: Property) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.schedules WHERE project_id = $1 AND workload = 'gsc_sync'",
        prop.project_id,
    )
    return [dict(row) for row in rows]


async def _state(pg: PostgresServer, prop: Property, state: PullState) -> None:
    await execute(
        pg,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        prop.integration_id,
        json.dumps(state.write({})),
    )


async def test_a_property_gets_a_daily_schedule_in_pacific_time_once(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    now = datetime.now(UTC)

    first = await plan_syncs(worker_db, Sent(), now=now)
    second = await plan_syncs(worker_db, Sent(), now=now)

    assert first.schedules_made >= 1
    assert second.schedules_made == 0
    (schedule,) = await _schedules(migrated, prop)
    assert (schedule["name"], schedule["cadence"], schedule["timezone"]) == (
        SCHEDULE_NAME,
        "daily",
        SCHEDULE_TIMEZONE,
    )
    assert str(schedule["window_start_local"]) == "09:00:00"
    assert schedule["window_hours"] == 4
    assert now < schedule["next_run_at"] <= now + timedelta(days=1, minutes=1)
    assert schedule["workspace_id"] == prop.workspace_id


async def test_a_schedule_a_person_paused_or_deleted_is_not_made_again(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = false, deleted_at = now() WHERE project_id = $1 "
        "AND workload = 'gsc_sync'",
        prop.project_id,
    )

    await plan_syncs(worker_db, Sent(), now=now)

    assert len(await _schedules(migrated, prop)) == 1


async def test_a_disabled_property_gets_no_schedule(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'disabled' WHERE id = $1",
        prop.integration_id,
    )

    await plan_syncs(worker_db, Sent(), now=datetime.now(UTC))

    assert await _schedules(migrated, prop) == []


async def test_a_ga4_property_is_never_planned_and_does_not_get_a_schedule(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    """GA4 properties are only chosen and stored for now: there is no GA4 pull to plan."""
    ga4 = await make_property(migrated, fake)
    await execute(
        migrated,
        "UPDATE fp.integrations SET kind = 'ga4', external_property = 'properties/11' "
        "WHERE id = $1",
        ga4.integration_id,
    )
    gsc = await make_property(migrated, fake)
    # The same project can hold both kinds on one connection: it is planned for Search Console
    # only, once.
    await execute(
        migrated,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
        "connection_id, scopes) VALUES ($1, $2, 'ga4', 'properties/12', $3, '{openid}')",
        gsc.workspace_id,
        gsc.project_id,
        gsc.connection_id,
    )
    sent = Sent()

    report = await plan_syncs(worker_db, sent, now=datetime.now(UTC))

    assert sent.integrations == {gsc.integration_id}
    assert ga4.integration_id not in sent.integrations
    assert await _schedules(migrated, ga4) == []
    assert len(await _schedules(migrated, gsc)) == 1
    assert report.schedules_made == 1


async def test_a_property_whose_pull_is_not_finished_is_sent_at_once(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    new = await make_property(migrated, fake)
    half = await make_property(migrated, fake)
    done = await make_property(migrated, fake)
    await _state(migrated, half, PullState(recent_done=True, complete=False))
    await _state(migrated, done, PullState(recent_done=True, complete=True))
    sent = Sent()

    report = await plan_syncs(worker_db, sent, now=datetime.now(UTC))

    assert {new.integration_id, half.integration_id} <= sent.integrations
    assert done.integration_id not in sent.integrations
    assert report.continued >= 2
    tasks = {task.integration_id: task for task in sent.tasks}
    assert tasks[new.integration_id].workspace_id == new.workspace_id


async def test_a_pass_that_failed_is_not_sent_again_before_its_wait_is_over(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    waiting = await make_property(migrated, fake)
    ready = await make_property(migrated, fake)
    now = datetime.now(UTC)
    await _state(migrated, waiting, PullState().failed(now))
    await _state(migrated, ready, PullState().failed(now - timedelta(hours=1)))
    sent = Sent()

    await plan_syncs(worker_db, sent, now=now)

    assert waiting.integration_id not in sent.integrations
    assert ready.integration_id in sent.integrations


async def test_a_property_that_cannot_be_read_is_not_sent(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    reauth = await make_property(migrated, fake)
    revoked = await make_property(migrated, fake)
    errored = await make_property(migrated, fake)
    archived = await make_property(migrated, fake)
    suspended = await make_property(migrated, fake)
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

    assert sent.integrations.isdisjoint(
        {
            reauth.integration_id,
            revoked.integration_id,
            errored.integration_id,
            archived.integration_id,
            suspended.integration_id,
        }
    )


async def test_a_due_schedule_sends_its_property_and_moves_to_the_next_day(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await _state(migrated, prop, PullState(recent_done=True, complete=True))
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await execute(
        migrated,
        "UPDATE ops.schedules SET next_run_at = $2 WHERE project_id = $1 AND workload = 'gsc_sync'",
        prop.project_id,
        now - timedelta(minutes=5),
    )
    sent = Sent()

    report = await plan_syncs(worker_db, sent, now=now)

    assert prop.integration_id in sent.integrations
    assert report.scheduled >= 1
    (schedule,) = await _schedules(migrated, prop)
    assert now < schedule["next_run_at"] <= now + timedelta(days=1, minutes=1)
    # the window is over: it is not sent a second time
    again = Sent()
    await plan_syncs(worker_db, again, now=now)
    assert prop.integration_id not in again.integrations


async def test_missed_days_are_not_caught_up(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await _state(migrated, prop, PullState(recent_done=True, complete=True))
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await execute(
        migrated,
        "UPDATE ops.schedules SET next_run_at = $2 WHERE project_id = $1 AND workload = 'gsc_sync'",
        prop.project_id,
        now - timedelta(days=9),
    )
    sent = Sent()

    await plan_syncs(worker_db, sent, now=now)

    assert [task.integration_id for task in sent.tasks].count(prop.integration_id) == 1
    (schedule,) = await _schedules(migrated, prop)
    assert schedule["next_run_at"] > now


async def test_a_paused_schedule_sends_nothing_and_a_dedupe_hit_is_not_counted(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    await _state(migrated, prop, PullState(recent_done=True, complete=True))
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await execute(
        migrated,
        "UPDATE ops.schedules SET next_run_at = $2, is_active = false "
        "WHERE project_id = $1 AND workload = 'gsc_sync'",
        prop.project_id,
        now - timedelta(minutes=5),
    )
    paused = Sent()
    await plan_syncs(worker_db, paused, now=now)
    assert prop.integration_id not in paused.integrations

    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = true WHERE project_id = $1 AND workload = 'gsc_sync'",
        prop.project_id,
    )
    refused = Sent(accept=False)
    report = await plan_syncs(worker_db, refused, now=now)
    assert prop.integration_id in refused.integrations
    assert report.scheduled == 0


async def test_a_schedule_of_a_property_that_was_disabled_moves_on_without_sending(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    prop = await make_property(migrated, fake)
    now = datetime.now(UTC)
    await plan_syncs(worker_db, Sent(), now=now)
    await execute(
        migrated,
        "UPDATE ops.schedules SET next_run_at = $2 WHERE project_id = $1 AND workload = 'gsc_sync'",
        prop.project_id,
        now - timedelta(minutes=5),
    )
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'disabled' WHERE id = $1",
        prop.integration_id,
    )
    sent = Sent()

    await plan_syncs(worker_db, sent, now=now)

    assert prop.integration_id not in sent.integrations
    (schedule,) = await _schedules(migrated, prop)
    assert schedule["next_run_at"] > now


async def test_a_task_names_one_property_and_dedupes_on_it() -> None:
    task = GscSyncTask(workspace_id=uuid.uuid4(), integration_id=uuid.uuid4())

    assert task.dedupe_key == f"gsc_sync:{task.integration_id}"
    with pytest.raises(ValueError, match="integration_id"):
        GscSyncTask.model_validate({"workspace_id": str(uuid.uuid4())})


async def test_two_workspaces_each_get_their_own_schedule(
    worker_db: Sessions, migrated: PostgresServer, fake: FakeSearchConsole
) -> None:
    one = await make_property(migrated, fake, site=SITE)
    other = await make_property(migrated, fake, workspace=await make_workspace(migrated))

    await plan_syncs(worker_db, Sent(), now=datetime.now(UTC))

    for prop in (one, other):
        (schedule,) = await _schedules(migrated, prop)
        assert schedule["workspace_id"] == prop.workspace_id
    row = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.schedules "
        "WHERE workload = 'gsc_sync' AND project_id = ANY($1)",
        [one.project_id, other.project_id],
    )
    assert row["n"] == 2
