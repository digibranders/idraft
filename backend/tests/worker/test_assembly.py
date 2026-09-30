"""The parts the worker is assembled from (docs/21-scheduler-workers.md sections 3 and 4)."""

from datetime import UTC, datetime, time, timedelta

from redis.asyncio import Redis

from sightline.collectors.registry import Registry
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.domain.schedules import Cadence, ScheduleRule, next_occurrence
from sightline.worker.app import WorkerContext
from sightline.worker.assembly import assemble, production_registry
from sightline.worker.queues import Queues
from tests.api.auth.support import fetch
from tests.collectors.support import FakeWorkload, empty_ledger, make_schedule, make_tenant
from tests.conftest import PostgresServer


async def test_the_planner_tick_plans_what_is_due_now(
    worker_settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    await empty_ledger(migrated)
    engine = create_engine(worker_settings)
    context = WorkerContext(
        settings=worker_settings,
        engine=engine,
        sessions=create_session_factory(engine),
        redis=redis,
        queues=Queues(worker_settings.redis_url.get_secret_value(), redis),
    )
    registry = Registry()
    registry.add_workload(FakeWorkload(subjects=2))
    project = await make_tenant(migrated)
    daily = ScheduleRule(cadence=Cadence.DAILY, timezone="UTC", window_start_local=time(2, 0))
    due = next_occurrence(daily, datetime.now(UTC) - timedelta(days=1))
    schedule_id = await make_schedule(migrated, project, next_run_at=due)
    try:
        ticks = {tick.name: tick for tick in assemble(context, registry)}
        planner = ticks["planner"]
        await planner.action()
    finally:
        await engine.dispose()

    # Every minute, and one worker at a time.
    assert (planner.interval, planner.lock_ttl) == (timedelta(seconds=60), timedelta(seconds=55))
    (run,) = await fetch(
        migrated,
        "SELECT status, tasks_total FROM ops.collection_runs WHERE schedule_id = $1",
        schedule_id,
    )
    assert (run["status"], run["tasks_total"]) == ("running", 2)


def test_no_workload_is_registered_yet_so_the_deployed_worker_plans_nothing() -> None:
    assert production_registry().workloads == frozenset()
