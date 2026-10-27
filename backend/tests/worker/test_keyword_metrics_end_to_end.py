"""Keyword metrics end to end (plan decisions D6 to D9): a newly tracked keyword gets a run of
its own, sent to DataForSEO Labs live, its answer kept in object storage and read into a
snapshot and the keyword's current metrics.

DataForSEO is played by an httpx transport that answers as the documented API does; the raw
payloads go to a real S3 server. Intervals are shortened so a test takes seconds.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from functools import partial
from typing import Any

import httpx
import pytest
from redis.asyncio import Redis

from idraft.collectors.keyword_metrics import KeywordMetricsWorkload
from idraft.collectors.registry import Registry
from idraft.config.settings import Settings
from idraft.providers.dataforseo import labs
from idraft.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from idraft.providers.dataforseo.provider import DataForSeo
from idraft.worker import assembly
from idraft.worker.app import WorkerContext, run_worker
from idraft.worker.limiter import RedisCallGate
from idraft.worker.ticks import Tick
from tests.api.auth.support import fetch
from tests.collectors.support import empty_ledger, make_tenant
from tests.collectors.test_keyword_metrics import _track
from tests.conftest import ObjectServer, PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, fixture_bytes
from tests.storage.support import object_keys
from tests.worker.conftest import eventually
from tests.worker.test_dataforseo_end_to_end import INSTALLATION, bucket, quick, settings

__all__ = ["bucket", "quick", "settings"]


@pytest.fixture(autouse=True)
def quick_ingest(quick: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assembly, "INGEST_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "INGEST_LOCK", timedelta(milliseconds=900))


class FakeLabs:
    """Answers Labs' keyword overview live call with the recorded answer, and keeps what it
    was asked."""

    def __init__(self) -> None:
        self.asked: list[list[dict[str, Any]]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path != labs.PATH:
            return httpx.Response(404, json={"status_code": 40400, "status_message": "Not Found."})
        self.asked.append(json.loads(request.content))
        return httpx.Response(
            200,
            content=fixture_bytes("keyword_overview_live"),
            headers={"content-type": "application/json"},
        )


def _parts(context: WorkerContext, *, http: httpx.AsyncClient) -> Sequence[Tick]:
    """The production parts, with the adapter's HTTP going to the fake."""
    registry = Registry()
    registry.add_workload(KeywordMetricsWorkload())
    gate = RedisCallGate(context.redis, "dataforseo", all_calls=ALL_CALLS, families=FAMILY_LIMITS)
    client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
    registry.add_provider(DataForSeo(client, installation=INSTALLATION))
    return assembly.assemble(context, registry)


async def test_a_new_keyword_gets_its_metrics_without_anyone_asking(
    settings: Settings,
    redis: Redis,
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    await empty_ledger(migrated)
    project = await make_tenant(migrated)
    best = await _track(migrated, project, "Best CRM")
    await _track(migrated, project, "CRM Software")
    api = FakeLabs()

    async def run_completed() -> bool:
        rows = await fetch(
            migrated, "SELECT status FROM ops.collection_runs WHERE project_id = $1", project.id
        )
        return [row["status"] for row in rows] == ["completed"]

    stop = asyncio.Event()
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        worker = asyncio.create_task(run_worker(settings, partial(_parts, http=http), stop))
        try:
            await eventually(run_completed, within=40)
            # A few more passes of everything: nothing is asked again.
            await asyncio.sleep(2)
        finally:
            stop.set()
            assert await asyncio.wait_for(worker, timeout=30) is True

    # Both keywords in one call, as entered.
    assert len(api.asked) == 1
    (asked,) = api.asked[0]
    assert sorted(asked["keywords"]) == ["Best CRM", "CRM Software"]
    (run,) = await fetch(
        migrated,
        "SELECT trigger, created_by_type, tasks_succeeded, actual_cost_usd "
        "FROM ops.collection_runs WHERE project_id = $1",
        project.id,
    )
    assert (run["trigger"], run["created_by_type"], run["tasks_succeeded"]) == (
        "manual",
        "system",
        2,
    )
    # The call's cost, shared by its keywords.
    assert run["actual_cost_usd"] > Decimal(0)
    (current,) = await fetch(
        migrated,
        "SELECT search_volume, keyword_difficulty FROM seo.keyword_metrics_current "
        "WHERE keyword_id = $1",
        best,
    )
    assert (current["search_volume"], current["keyword_difficulty"]) == (1900, 58)
    # The answer kept once.
    payloads = await fetch(migrated, "SELECT object_key FROM ops.raw_payloads")
    assert len(payloads) == 1
    assert await object_keys(object_server, bucket) == [payloads[0]["object_key"]]
