"""The worker with the real DataForSEO adapter, end to end: a schedule becomes tasks sent to
DataForSEO, found ready, fetched and kept in object storage, each sent and paid for once.

DataForSEO is played by an httpx transport that answers as the documented API does; the raw
payloads go to a real S3 server. Intervals are shortened so a test takes seconds.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.collectors import reconciler, resolver
from sightline.collectors.ledger import LedgerTask, TaskRef
from sightline.collectors.registry import Plan, Registry, ScheduleWindow
from sightline.config.settings import Settings
from sightline.providers.contract import CanonicalRequest
from sightline.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.providers.dataforseo.serp import SERP_ORGANIC, SerpOrganicParams
from sightline.storage.raw import s3_client
from sightline.worker import assembly
from sightline.worker.app import WorkerContext, run_worker
from sightline.worker.limiter import RedisCallGate
from sightline.worker.ticks import Tick
from tests.api.auth.support import fetch
from tests.collectors.support import FakeWorkload, SerpParams
from tests.conftest import ObjectServer, PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, envelope, task_answer
from tests.storage.support import object_keys
from tests.worker.conftest import eventually
from tests.worker.test_end_to_end import _due_schedule, _statuses

INSTALLATION = "test"
BASE = "/v3/serp/google/organic"


@pytest.fixture(autouse=True)
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    """Seconds where production has minutes."""
    monkeypatch.setattr(assembly, "PLANNER_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "PLANNER_LOCK", timedelta(milliseconds=900))
    monkeypatch.setattr(assembly, "DISPATCHER_EVERY", timedelta(milliseconds=500))
    monkeypatch.setattr(assembly, "DISPATCHER_LOCK", timedelta(milliseconds=400))
    monkeypatch.setattr(assembly, "POLL_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "POLL_LOCK", timedelta(milliseconds=900))
    monkeypatch.setattr(assembly, "RECONCILE_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(reconciler, "STALE_DISPATCH", timedelta(seconds=2))
    # Long enough that the fake's clock (this process's) and the database's may differ a little.
    monkeypatch.setattr(resolver, "UNKNOWN_GRACE", timedelta(seconds=5))


@dataclass
class Posted:
    task: dict[str, Any]
    posted_at: datetime
    fetched: bool = False


class FakeDataForSeo:
    """Answers `task_post`, `tasks_ready`, `task_get/advanced` and `id_list` as DataForSEO
    documents them, and keeps what it was sent."""

    def __init__(self) -> None:
        self.tasks: dict[str, Posted] = {}
        self.posts: list[list[str]] = []
        # The next post creates its tasks and then answers as a gateway that gave up waiting.
        self.lose_next_answer = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == f"{BASE}/task_post":
            return self._post(json.loads(request.content))
        if path == f"{BASE}/tasks_ready":
            ready = [
                {"id": task_id, "tag": posted.task["tag"], "se": "google"}
                for task_id, posted in self.tasks.items()
                if not posted.fetched
            ]
            return httpx.Response(200, json=envelope([task_answer(result=ready)]))
        if path.startswith(f"{BASE}/task_get/advanced/"):
            return self._get(path.rsplit("/", 1)[1])
        if path == "/v3/tasks/id_list":
            return self._list(json.loads(request.content)[0])
        return httpx.Response(404, json={"status_code": 40400, "status_message": "Not Found."})

    def _post(self, tasks: list[dict[str, Any]]) -> httpx.Response:
        self.posts.append([task["tag"] for task in tasks])
        answers = []
        for task in tasks:
            task_id = str(uuid.uuid4())
            self.tasks[task_id] = Posted(task=task, posted_at=datetime.now(UTC))
            answers.append(task_answer(status_code=20100, task_id=task_id, cost=0.0006, data=task))
        if self.lose_next_answer:
            self.lose_next_answer = False
            return httpx.Response(504, text="<html>Gateway Timeout</html>")
        return httpx.Response(200, json=envelope(answers))

    def _get(self, task_id: str) -> httpx.Response:
        posted = self.tasks[task_id]
        posted.fetched = True
        result = [{"keyword": posted.task["keyword"], "type": "organic", "items": []}]
        return httpx.Response(200, json=envelope([task_answer(task_id=task_id, result=result)]))

    def _list(self, asked: Mapping[str, Any]) -> httpx.Response:
        since = datetime.strptime(asked["datetime_from"], "%Y-%m-%d %H:%M:%S %z")
        until = datetime.strptime(asked["datetime_to"], "%Y-%m-%d %H:%M:%S %z")
        listed = [
            {
                "id": task_id,
                "url": f"https://api.dataforseo.com{BASE}/task_post",
                "datetime_posted": posted.posted_at.strftime("%Y-%m-%d %H:%M:%S +00:00"),
                "status": "Completed",
                "cost": 0.0006,
                "metadata": {"tag": posted.task["tag"]},
            }
            for task_id, posted in self.tasks.items()
            if since <= posted.posted_at.replace(microsecond=0) <= until
        ]
        return httpx.Response(200, json=envelope([task_answer(result=listed)]))

    @property
    def sent(self) -> list[str]:
        """Every tag posted, as often as it was posted."""
        return [tag for post in self.posts for tag in post]


class SerpWorkload(FakeWorkload):
    """The fake workload's tasks, sent to DataForSEO's organic SERP endpoint."""

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        planned = await super().plan(db, window)
        tasks = [
            replace(task, provider_code="dataforseo", provider_endpoint=SERP_ORGANIC)
            for task in planned.tasks
        ]
        return replace(planned, tasks=tasks)

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        built = await super().build_requests(db, tasks)
        requests = {}
        for ref, request in built.items():
            assert isinstance(request.params, SerpParams)
            params = SerpOrganicParams(
                keyword=request.params.keyword, location_code=2840, language_code="en", depth=10
            )
            requests[ref] = request.model_copy(update={"params": params})
        return requests


@pytest.fixture
async def bucket(object_server: ObjectServer) -> str:
    name = f"raw-{uuid.uuid4().hex[:12]}"
    async with s3_client(
        endpoint=object_server.endpoint,
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
    ) as client:
        await client.create_bucket(Bucket=name)
    return name


@pytest.fixture
def settings(worker_settings: Settings, object_server: ObjectServer, bucket: str) -> Settings:
    return worker_settings.model_copy(
        update={
            "dataforseo_login": SecretStr(LOGIN),
            "dataforseo_password": SecretStr(PASSWORD),
            "r2_raw_endpoint": object_server.endpoint,
            "r2_raw_bucket": bucket,
            "r2_raw_access_key_id": SecretStr(object_server.access_key_id),
            "r2_raw_secret_access_key": SecretStr(object_server.secret_access_key),
            "installation_id": INSTALLATION,
            "resolve_unknown_submissions": True,
        }
    )


def _parts(
    context: WorkerContext, *, api: FakeDataForSeo, http: httpx.AsyncClient, subjects: int
) -> Sequence[Tick]:
    """The production parts, with the adapter's HTTP going to the fake."""
    registry = Registry()
    registry.add_workload(SerpWorkload(subjects=subjects))
    gate = RedisCallGate(context.redis, "dataforseo", all_calls=ALL_CALLS, families=FAMILY_LIMITS)
    client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
    registry.add_provider(DataForSeo(client, installation=INSTALLATION))
    return assembly.assemble(context, registry)


async def _run_until(
    settings: Settings,
    api: FakeDataForSeo,
    *,
    subjects: int,
    done: Any,
) -> None:
    stop = asyncio.Event()
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        worker = asyncio.create_task(
            run_worker(settings, partial(_parts, api=api, http=http, subjects=subjects), stop)
        )
        try:
            await eventually(done, within=40)
            # A few more passes of everything: nothing is sent or fetched again.
            await asyncio.sleep(2)
        finally:
            stop.set()
            assert await asyncio.wait_for(worker, timeout=30) is True


async def _costs(pg: PostgresServer) -> list[Any]:
    return await fetch(pg, "SELECT task_id, cost_usd FROM ops.provider_cost_events")


async def test_a_schedule_becomes_fetched_tasks_with_their_payloads_kept(
    settings: Settings,
    redis: Redis,
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    schedule_id = await _due_schedule(migrated)
    api = FakeDataForSeo()

    async def all_fetched() -> bool:
        return await _statuses(migrated, schedule_id) == ["fetched"] * 4

    await _run_until(settings, api, subjects=4, done=all_fetched)

    # Each task sent once, in one call, and paid for once.
    assert len(api.posts) == 1
    assert len(api.sent) == len(set(api.sent)) == 4
    assert all(tag.startswith(f"i:{INSTALLATION}:t:") for tag in api.sent)
    assert len(await _costs(migrated)) == 4
    # Each result fetched once, and kept once.
    assert all(posted.fetched for posted in api.tasks.values())
    payloads = await fetch(
        migrated, "SELECT object_key, retention_class FROM ops.raw_payloads ORDER BY object_key"
    )
    assert len(payloads) == 4
    assert {row["retention_class"] for row in payloads} == {"serp_raw"}
    assert await object_keys(object_server, bucket) == [row["object_key"] for row in payloads]
    assert all(
        row["object_key"].startswith("raw/v1/serp_raw/dataforseo/serp_google_organic_advanced/")
        for row in payloads
    )


async def test_a_submission_whose_answer_was_lost_is_found_and_not_sent_again(
    settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    """The provider created the tasks and the answer never came: the resolver finds them by
    their tags, and they are fetched like any other."""
    schedule_id = await _due_schedule(migrated)
    api = FakeDataForSeo()
    api.lose_next_answer = True

    async def all_fetched() -> bool:
        return await _statuses(migrated, schedule_id) == ["fetched"] * 3

    await _run_until(settings, api, subjects=3, done=all_fetched)

    assert len(api.sent) == len(set(api.sent)) == 3
    # Paid for once, at the cost the provider's list reports.
    costs = await _costs(migrated)
    assert [row["cost_usd"] for row in costs] == [Decimal("0.000600")] * 3
