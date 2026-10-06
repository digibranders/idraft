"""Failed rank checks and stale keywords reach the keyword's state (docs/21 section 9). As
`app_worker`."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from sightline.collectors.seo_rank_health import HealthReport, refresh_health
from tests.api.auth.support import execute, fetch
from tests.collectors.rank_support import Ledger, World, answer, fetched_task, make_world, track
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

CLOCK = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> World:
    return await make_world(migrated)


async def _failed_task(
    sessions: Ledger,
    pg: PostgresServer,
    world: World,
    keyword: uuid.UUID,
    *,
    ended: datetime,
    status: str = "failed",
) -> None:
    task_id = await fetched_task(sessions, pg, world, keyword, answer([]), MemoryStore())
    await execute(
        pg,
        "UPDATE ops.collection_tasks SET status = $2, completed_at = $3 WHERE id = $1",
        task_id,
        status,
        ended,
    )


async def _checked(
    pg: PostgresServer, world: World, keyword: uuid.UUID, at: datetime, *, stale: bool = False
) -> None:
    """A keyword whose last successful check was at `at`."""
    await execute(
        pg,
        "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
        "last_observed_at, is_stale) VALUES ($1, $2, $3, $4, $5)",
        keyword,
        world.project.workspace_id,
        world.project.id,
        at,
        stale,
    )


async def _state(pg: PostgresServer, keyword: uuid.UUID) -> dict[str, Any] | None:
    rows = await fetch(
        pg,
        "SELECT consecutive_failures, is_stale FROM seo.tracked_keyword_state "
        "WHERE tracked_keyword_id = $1",
        keyword,
    )
    return dict(rows[0]) if rows else None


async def test_a_keyword_whose_checks_all_failed_gets_a_state_that_says_so(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project, "crm failing")
    other = await track(migrated, world.project, "crm fine")
    for status in ("failed", "dead", "failed"):
        await _failed_task(
            worker_db, migrated, world, keyword, ended=CLOCK - timedelta(hours=3), status=status
        )

    report = await refresh_health(worker_db, now=CLOCK)

    state = await _state(migrated, keyword)
    assert state is not None
    assert state["consecutive_failures"] == 3
    # A keyword nothing failed for has no state to write.
    assert await _state(migrated, other) is None
    assert report.failures_changed == 1


async def test_only_failures_after_the_last_successful_check_count(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project, "crm recovering")
    await _checked(migrated, world, keyword, CLOCK - timedelta(hours=10))
    await _failed_task(worker_db, migrated, world, keyword, ended=CLOCK - timedelta(hours=20))
    await _failed_task(worker_db, migrated, world, keyword, ended=CLOCK - timedelta(hours=5))
    await _failed_task(worker_db, migrated, world, keyword, ended=CLOCK - timedelta(hours=1))

    await refresh_health(worker_db, now=CLOCK)

    state = await _state(migrated, keyword)
    assert state is not None
    assert state["consecutive_failures"] == 2


async def test_failures_of_an_archived_or_other_keyword_are_left_alone(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    archived = await track(migrated, world.project, "crm archived")
    await execute(
        migrated, "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1", archived
    )
    await _failed_task(worker_db, migrated, world, archived, ended=CLOCK - timedelta(hours=1))

    await refresh_health(worker_db, now=CLOCK)

    assert await _state(migrated, archived) is None


async def test_a_keyword_is_stale_after_36_hours_or_9_days_by_its_profile(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    daily_old = await track(migrated, world.project, "daily old")
    daily_new = await track(migrated, world.project, "daily new")
    weekly_mid = await track(migrated, world.project, "weekly mid")
    weekly_old = await track(migrated, world.project, "weekly old")
    for keyword, profile in ((weekly_mid, "weekly"), (weekly_old, "weekly_light")):
        await execute(
            migrated,
            "UPDATE seo.tracked_keywords SET depth_profile = $2 WHERE id = $1",
            keyword,
            profile,
        )
    await _checked(migrated, world, daily_old, CLOCK - timedelta(hours=37))
    await _checked(migrated, world, daily_new, CLOCK - timedelta(hours=35))
    await _checked(migrated, world, weekly_mid, CLOCK - timedelta(days=8))
    await _checked(migrated, world, weekly_old, CLOCK - timedelta(days=10))

    await refresh_health(worker_db, now=CLOCK)

    flags = {
        name: (await _state(migrated, keyword) or {})["is_stale"]
        for name, keyword in (
            ("daily_old", daily_old),
            ("daily_new", daily_new),
            ("weekly_mid", weekly_mid),
            ("weekly_old", weekly_old),
        )
    }
    assert flags == {
        "daily_old": True,
        "daily_new": False,
        "weekly_mid": False,
        "weekly_old": True,
    }


async def test_a_flag_clears_when_the_keyword_is_archived_or_checked_again(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    archived = await track(migrated, world.project, "was stale")
    fresh = await track(migrated, world.project, "checked again")
    await _checked(migrated, world, archived, CLOCK - timedelta(days=3), stale=True)
    await _checked(migrated, world, fresh, CLOCK - timedelta(hours=1), stale=True)
    await execute(
        migrated, "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1", archived
    )

    await refresh_health(worker_db, now=CLOCK)

    assert (await _state(migrated, archived) or {})["is_stale"] is False
    assert (await _state(migrated, fresh) or {})["is_stale"] is False


async def test_a_keyword_never_checked_is_stale_from_the_day_it_was_tracked(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project, "never checked")
    await _failed_task(worker_db, migrated, world, keyword, ended=NOW - timedelta(hours=1))
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET created_at = $2 WHERE id = $1",
        keyword,
        NOW - timedelta(hours=40),
    )

    await refresh_health(worker_db, now=NOW)

    state = await _state(migrated, keyword)
    assert state is not None
    assert (state["consecutive_failures"], state["is_stale"]) == (1, True)


async def test_running_it_twice_changes_nothing(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project, "crm twice")
    await _failed_task(worker_db, migrated, world, keyword, ended=CLOCK - timedelta(hours=2))
    await _checked(
        migrated, world, await track(migrated, world.project, "old"), CLOCK - timedelta(days=2)
    )

    first = await refresh_health(worker_db, now=CLOCK)
    again = await refresh_health(worker_db, now=CLOCK)

    assert not first.quiet
    assert again == HealthReport(failures_changed=0, staleness_changed=0)


async def test_a_naive_clock_is_refused(worker_db: Ledger) -> None:
    with pytest.raises(ValueError, match="aware"):
        await refresh_health(worker_db, now=datetime(2026, 10, 6, 12, 0))
