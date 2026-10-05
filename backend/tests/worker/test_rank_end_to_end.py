"""Rank collection end to end (plan Task 6): a new keyword or a due schedule becomes SERP tasks
sent to DataForSEO, found ready, fetched, kept in object storage and read into a snapshot, the
keyword's state and its current results, each task sent, fetched and paid for once.

DataForSEO is played by an httpx transport that answers as the documented API does; the raw
payloads go to a real S3 server. Recovery from a wiped Redis, a stopped worker and a lost
answer is proven for any workload in `test_end_to_end.py`; here the lost answer and a provider
that lists a task as ready again are run with the real workload and ingest. Intervals are
shortened so a test takes seconds.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from typing import Any

import httpx
import pytest
from redis.asyncio import Redis

from sightline.collectors.registry import Registry
from sightline.collectors.seo_rank import SeoRankWorkload, is_deep_day
from sightline.config.settings import Settings
from sightline.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.worker import assembly
from sightline.worker.app import WorkerContext, run_worker
from sightline.worker.limiter import RedisCallGate
from sightline.worker.ticks import Tick
from tests.api.auth.support import fetch
from tests.collectors.rank_support import OWN_HOST, World, make_world, track
from tests.collectors.support import empty_ledger, make_schedule
from tests.conftest import ObjectServer, PostgresServer
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    envelope,
    task_answer,
)
from tests.storage.support import object_keys
from tests.worker.conftest import eventually
from tests.worker.test_dataforseo_end_to_end import (
    BASE,
    INSTALLATION,
    FakeDataForSeo,
    bucket,
    quick,
    settings,
)

__all__ = ["bucket", "quick", "settings"]


@pytest.fixture(autouse=True)
def quick_ingest(quick: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assembly, "INGEST_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "INGEST_LOCK", timedelta(milliseconds=900))


class FakeSerp(FakeDataForSeo):
    """DataForSEO's organic SERP: the posted task is echoed in the answer, and the answer lists
    ten results with the project's site at rank three. `relist` keeps listing a task as ready
    after its result was fetched, as a provider sometimes does."""

    def __init__(self) -> None:
        super().__init__()
        self.relist = False
        self.gets: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.relist and request.url.path == f"{BASE}/tasks_ready":
            ready = [
                {"id": task_id, "tag": posted.task["tag"], "se": "google"}
                for task_id, posted in self.tasks.items()
            ]
            return httpx.Response(200, json=envelope([task_answer(result=ready)]))
        return super().__call__(request)

    def _get(self, task_id: str) -> httpx.Response:
        self.gets.append(task_id)
        posted = self.tasks[task_id]
        posted.fetched = True
        items = [
            {
                "type": "organic",
                "rank_group": rank,
                "rank_absolute": rank,
                "position": "left",
                "title": f"Result {rank}",
                "description": "A snippet.",
                "url": f"https://www.{OWN_HOST}/page"
                if rank == 3
                else f"https://elsewhere-{rank}.example/",
            }
            for rank in range(1, 11)
        ]
        result = [
            {
                "keyword": posted.task["keyword"],
                "type": "organic",
                "se_domain": "google.com",
                "datetime": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S +00:00"),
                "item_types": ["organic"],
                "se_results_count": 1000,
                "items": items,
            }
        ]
        answer = task_answer(task_id=task_id, result=result, data=posted.task, cost=0.0006)
        return httpx.Response(200, json=envelope([answer]))

    def depths(self) -> list[int]:
        return sorted(posted.task["depth"] for posted in self.tasks.values())


def _parts(context: WorkerContext, *, http: httpx.AsyncClient) -> Sequence[Tick]:
    """The production parts, with the adapter's HTTP going to the fake."""
    registry = Registry()
    registry.add_workload(SeoRankWorkload())
    gate = RedisCallGate(context.redis, "dataforseo", all_calls=ALL_CALLS, families=FAMILY_LIMITS)
    client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
    registry.add_provider(DataForSeo(client, installation=INSTALLATION))
    return assembly.assemble(context, registry)


async def _run_until(settings: Settings, api: FakeSerp, *, done: Any) -> None:
    stop = asyncio.Event()
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        worker = asyncio.create_task(run_worker(settings, partial(_parts, http=http), stop))
        try:
            await eventually(done, within=60)
            # A few more passes of everything: nothing is sent, fetched or ingested again.
            await asyncio.sleep(3)
        finally:
            stop.set()
            assert await asyncio.wait_for(worker, timeout=30) is True


async def _states(pg: PostgresServer, world: World) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT current_rank, current_depth_requested, last_snapshot_id "
        "FROM seo.tracked_keyword_state WHERE project_id = $1 ORDER BY tracked_keyword_id",
        world.project.id,
    )
    return [dict(row) for row in rows]


def _expected_deep_day() -> bool:
    return is_deep_day(datetime.now(UTC).date(), 1)


async def test_a_new_keyword_is_checked_without_anyone_asking(
    settings: Settings,
    redis: Redis,
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    await empty_ledger(migrated)
    world = await make_world(migrated)
    keyword = await track(migrated, world.project, "Best CRM")
    api = FakeSerp()

    async def ingested() -> bool:
        return len(await _states(migrated, world)) == 1

    await _run_until(settings, api, done=ingested)

    # Sent once, as entered, to the depth its profile gives today (the deep weekday replaces the
    # daily check), and fetched and paid for once.
    assert len(api.sent) == len(set(api.sent)) == 1
    (posted,) = api.tasks.values()
    assert posted.task["keyword"] == "Best CRM"
    assert posted.task["depth"] == (100 if _expected_deep_day() else 20)
    assert posted.task["priority"] == 1
    assert len(api.gets) == 1
    (state,) = await _states(migrated, world)
    assert state["current_rank"] == 3
    assert state["current_depth_requested"] == posted.task["depth"]
    (run,) = await fetch(
        migrated,
        "SELECT trigger, created_by_type, status, tasks_succeeded FROM ops.collection_runs "
        "WHERE project_id = $1",
        world.project.id,
    )
    assert (run["trigger"], run["created_by_type"], run["status"]) == (
        "manual",
        "system",
        "completed",
    )
    snapshots = await fetch(
        migrated,
        "SELECT collection_task_id, cost_usd FROM seo.serp_snapshots WHERE tracked_keyword_id = $1",
        keyword,
    )
    assert len(snapshots) == 1
    assert snapshots[0]["cost_usd"] == Decimal("0.000600")
    current = await fetch(
        migrated,
        "SELECT organic_rank FROM seo.serp_current_results WHERE tracked_keyword_id = $1",
        keyword,
    )
    assert len(current) == 10
    payloads = await fetch(migrated, "SELECT object_key FROM ops.raw_payloads")
    assert await object_keys(object_server, bucket) == [row["object_key"] for row in payloads]
    assert len(payloads) == 1


async def test_a_due_daily_schedule_checks_each_keyword_once_even_when_the_provider_relists_them(
    settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    await empty_ledger(migrated)
    world = await make_world(migrated)
    for text in ("crm one", "crm two", "crm three"):
        await track(migrated, world.project, text)
    began = (datetime.now(UTC) - timedelta(hours=2)).replace(second=0, microsecond=0)
    await make_schedule(
        migrated,
        world.project,
        next_run_at=began,
        window_start_local=began.strftime("%H:%M"),
        window_hours=1,
        selector={"all": True},
    )
    api = FakeSerp()
    api.relist = True

    async def all_ingested() -> bool:
        return len(await _states(migrated, world)) == 3

    await _run_until(settings, api, done=all_ingested)

    assert len(api.sent) == len(set(api.sent)) == 3
    assert sorted(api.gets) == sorted(api.tasks)
    snapshots = await fetch(
        migrated,
        "SELECT count(*) AS n, count(DISTINCT collection_task_id) AS tasks FROM seo.serp_snapshots "
        "WHERE project_id = $1",
        world.project.id,
    )
    assert (snapshots[0]["n"], snapshots[0]["tasks"]) == (3, 3)
    costs = await fetch(migrated, "SELECT cost_usd FROM ops.provider_cost_events")
    assert [row["cost_usd"] for row in costs] == [Decimal("0.000600")] * 3


async def test_a_submission_whose_answer_was_lost_is_found_and_ingested_once(
    settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    await empty_ledger(migrated)
    world = await make_world(migrated)
    for text in ("crm one", "crm two"):
        await track(migrated, world.project, text)
    api = FakeSerp()
    api.lose_next_answer = True

    async def all_ingested() -> bool:
        return len(await _states(migrated, world)) == 2

    await _run_until(settings, api, done=all_ingested)

    assert len(api.sent) == len(set(api.sent)) == 2
    snapshots = await fetch(
        migrated,
        "SELECT count(*) AS n FROM seo.serp_snapshots WHERE project_id = $1",
        world.project.id,
    )
    assert snapshots[0]["n"] == 2
    assert api.depths() == ([100, 100] if _expected_deep_day() else [20, 20])
