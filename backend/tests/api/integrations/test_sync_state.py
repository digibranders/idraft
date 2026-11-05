"""What the Integrations screen's sync strip reads: `sync` on a linked property (docs/18 section
4.3), made from the pull's state and the property's schedule."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from idraft.domain.gsc_pull import PullState
from tests.api.auth.support import execute
from tests.api.integrations.support import Harness, connected, make_world, project_url
from tests.api.integrations.test_choose import SITES, _choose

END = date.today() - timedelta(days=3)


async def _property(google: Harness) -> tuple[Any, str]:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    response = await _choose(google, world, connection, "sc-domain:acme.example")
    assert response.status_code == 201, response.text
    return world, response.json()["data"]["integration_id"]


async def _sync(google: Harness, world: Any) -> dict[str, Any]:
    response = await google.api.get(
        project_url(world, "integrations"), headers=world.viewer.headers
    )
    assert response.status_code == 200, response.text
    (row,) = response.json()["data"]
    sync: dict[str, Any] = row["sync"]
    return sync


async def test_a_property_that_has_not_been_pulled_is_pending_with_nothing_stored(
    google: Harness,
) -> None:
    world, _ = await _property(google)

    sync = await _sync(google, world)

    assert sync == {
        "phase": "pending",
        "window_start": None,
        "window_end": None,
        "covered_from": None,
        "days_stored": 0,
        "rows_stored": 0,
        "consecutive_failures": 0,
        "retry_after": None,
        "next_sync_at": None,
    }


async def test_the_strip_follows_the_pull_from_backfilling_to_synced(google: Harness) -> None:
    world, integration = await _property(google)
    oldest = END - timedelta(days=90)
    state = PullState(
        recent_done=True,
        window_end=END,
        days_stored=40,
        rows_stored=1234,
        oldest_day=oldest,
        history_next=oldest,
        history_until=END - timedelta(days=27),
    )
    await execute(
        google.pg,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        UUID(integration),
        json.dumps(state.write({})),
    )

    sync = await _sync(google, world)

    assert sync["phase"] == "backfilling"
    assert (sync["window_start"], sync["window_end"]) == (
        (END - timedelta(days=27)).isoformat(),
        END.isoformat(),
    )
    assert (sync["covered_from"], sync["days_stored"], sync["rows_stored"]) == (
        oldest.isoformat(),
        40,
        1234,
    )

    await execute(
        google.pg,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        UUID(integration),
        json.dumps(replace(state, complete=True).write({})),
    )
    assert (await _sync(google, world))["phase"] == "synced"


async def test_a_failed_pass_shows_when_it_is_tried_again(google: Harness) -> None:
    world, integration = await _property(google)
    now = datetime.now(UTC)
    state = PullState().failed(now)
    await execute(
        google.pg,
        "UPDATE fp.integrations SET backfill_state = $2::jsonb WHERE id = $1",
        UUID(integration),
        json.dumps(state.write({})),
    )

    sync = await _sync(google, world)

    assert sync["consecutive_failures"] == 1
    assert state.retry_after is not None
    assert datetime.fromisoformat(sync["retry_after"]) == state.retry_after


async def test_the_next_daily_sync_comes_from_the_schedule_unless_it_is_paused(
    google: Harness,
) -> None:
    world, _ = await _property(google)
    next_run = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=7)
    await execute(
        google.pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at) VALUES ($1, $2, 'gsc_sync', 'Daily Search Console sync', 'daily', "
        "'America/Los_Angeles', $3)",
        world.workspace.id,
        world.project_id,
        next_run,
    )
    assert datetime.fromisoformat((await _sync(google, world))["next_sync_at"]) == next_run

    await execute(
        google.pg,
        "UPDATE ops.schedules SET is_active = false WHERE project_id = $1",
        world.project_id,
    )
    assert (await _sync(google, world))["next_sync_at"] is None
