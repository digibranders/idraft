"""The Phase 3 acceptance (docs/29 section 3, plan Task 11): 5,000 keywords from a CSV reach a
correct preview, are confirmed and written, get their metrics without anyone asking, and the
cost of getting them shows in the cost report.

The API and the worker run as they do in production: separate application and worker
processes' worth of code, one database, one bucket for sources and raw answers. DataForSEO is
played by an httpx transport that answers as the documented API does. Intervals are shortened
so the test takes a minute or so.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import time
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from typing import Any

import httpx
import pytest
from redis.asyncio import Redis

from sightline.api.resources import Resources
from sightline.collectors.costs import roll_up_costs
from sightline.collectors.keyword_metrics import KeywordMetricsWorkload
from sightline.collectors.registry import Registry
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.providers.dataforseo import labs
from sightline.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.worker import assembly
from sightline.worker.app import WorkerContext, run_worker
from sightline.worker.limiter import RedisCallGate
from sightline.worker.ticks import Tick
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.conftest import AppFactory, auth_app, client_for, import_store, mailbox, resources
from tests.api.entities.support import member
from tests.api.imports.support import imports_url
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.support import empty_ledger
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, fixture_bytes
from tests.worker.conftest import eventually
from tests.worker.test_dataforseo_end_to_end import INSTALLATION, bucket, quick, settings

__all__ = [
    "auth_app",
    "bucket",
    "client_for",
    "import_store",
    "mailbox",
    "quick",
    "resources",
    "settings",
]

KEYWORDS = 5000


@pytest.fixture(autouse=True)
async def clean(migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    monkeypatch.setattr(assembly, "INGEST_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "INGEST_LOCK", timedelta(milliseconds=900))
    monkeypatch.setattr(assembly, "IMPORTS_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "IMPORTS_LOCK", timedelta(milliseconds=900))
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    await empty_ledger(migrated)
    yield
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    await execute(migrated, "DELETE FROM seo.tracked_keywords")


class FakeLabs:
    """Answers Labs' keyword overview live call for whatever keywords it is asked: the recorded
    answer's item for each, with a volume of its own."""

    def __init__(self) -> None:
        self.calls = 0
        self.keywords = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path != labs.PATH:
            return httpx.Response(404, json={"status_code": 40400, "status_message": "Not Found."})
        asked: list[str] = json.loads(request.content)[0]["keywords"]
        self.calls += 1
        self.keywords += len(asked)
        body: dict[str, Any] = json.loads(fixture_bytes("keyword_overview_live"))
        result = body["tasks"][0]["result"][0]
        template = result["items"][0]
        result["items"] = [
            {
                **template,
                "keyword": text,
                "keyword_info": {**template["keyword_info"], "search_volume": 100 + n},
            }
            for n, text in enumerate(asked)
        ]
        result["items_count"] = result["total_count"] = len(asked)
        body["tasks"][0]["data"]["keywords"] = asked
        return httpx.Response(
            200, content=json.dumps(body).encode(), headers={"content-type": "application/json"}
        )


def _parts(context: WorkerContext, *, http: httpx.AsyncClient) -> Sequence[Tick]:
    """The production parts, with the adapter's HTTP going to the fake."""
    registry = Registry()
    registry.add_workload(KeywordMetricsWorkload())
    gate = RedisCallGate(context.redis, "dataforseo", all_calls=ALL_CALLS, families=FAMILY_LIMITS)
    client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
    registry.add_provider(DataForSeo(client, installation=INSTALLATION))
    return assembly.assemble(context, registry)


def _file() -> bytes:
    out = io.StringIO()
    rows = csv.writer(out, lineterminator="\n")
    rows.writerow(["keyword", "group"])
    for n in range(KEYWORDS):
        rows.writerow([f"acceptance keyword {n}", f"Cluster/Group {n % 10}"])
    return out.getvalue().encode()


async def test_five_thousand_keywords_from_a_csv_get_their_metrics_and_a_cost(
    settings: Settings,
    redis: Redis,
    migrated: PostgresServer,
    resources: Resources,
    client_for: AppFactory,
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    labs_api = FakeLabs()
    stop = asyncio.Event()

    async with (
        client_for(
            r2_raw_endpoint=settings.r2_raw_endpoint,
            r2_raw_bucket=settings.r2_raw_bucket,
            r2_raw_access_key_id=settings.r2_raw_access_key_id,
            r2_raw_secret_access_key=settings.r2_raw_secret_access_key,
        ) as api,
        httpx.AsyncClient(transport=httpx.MockTransport(labs_api)) as http,
    ):
        # Signed in after the application started: it clears the session cache on start.
        owner = await member(resources, migrated, workspace, "owner")
        worker = asyncio.create_task(run_worker(settings, partial(_parts, http=http), stop))
        try:
            uploaded = await api.post(
                imports_url(workspace, project, "upload"),
                files={"file": ("keywords.csv", _file(), "text/csv")},
                headers=owner.headers,
            )
            assert uploaded.status_code == 202, uploaded.text
            import_id = uploaded.json()["data"]["import_id"]
            url = imports_url(workspace, project, import_id)

            async def status() -> str:
                shown = await api.get(url, headers=owner.headers)
                return str(shown.json()["data"]["status"])

            # The preview: well under two minutes.
            began = time.monotonic()

            async def previewed() -> bool:
                return await status() == "preview_ready"

            await eventually(previewed, within=110, every=0.5)
            assert time.monotonic() - began < 110
            preview = (await api.get(url, headers=owner.headers)).json()["data"]
            assert preview["counts"]["rows_total"] == KEYWORDS
            assert preview["counts"]["new"] == KEYWORDS
            assert preview["quota"]["would_use"] == KEYWORDS

            confirmed = await api.post(
                url + "/confirm", json={"duplicate_action": "skip"}, headers=owner.headers
            )
            assert confirmed.status_code == 202, confirmed.text

            async def written() -> bool:
                return await status() == "completed"

            await eventually(written, within=110, every=0.5)

            # Metrics for every one of them, without anyone asking.
            async def with_metrics() -> bool:
                (row,) = await fetch(
                    migrated,
                    "SELECT count(*) AS n FROM seo.keyword_metrics_current WHERE workspace_id = $1",
                    workspace.id,
                )
                return bool(row["n"] == KEYWORDS)

            await eventually(with_metrics, within=170, every=1)
            # A few more passes of everything: nothing is asked again.
            await asyncio.sleep(3)
        finally:
            stop.set()
            assert await asyncio.wait_for(worker, timeout=60) is True

        done = (await api.get(url, headers=owner.headers)).json()["data"]
        assert (done["counts"]["created"], done["counts"]["skipped"]) == (KEYWORDS, 0)
        listed = await api.get(
            project_url(workspace, project, "tracked-keywords"),
            params={"limit": 5, "include": "groups,metrics"},
            headers=owner.headers,
        )
        assert listed.json()["page"]["total"] == KEYWORDS
        assert all(row["groups"] for row in listed.json()["data"])

        # Every keyword was asked for once, in as few calls as the adapter allows.
        assert labs_api.keywords == KEYWORDS
        runs = await fetch(
            migrated,
            "SELECT status, created_by_type, tasks_succeeded FROM ops.collection_runs "
            "WHERE project_id = $1",
            project,
        )
        # The tick that finds new keywords runs while the import is still being written, so
        # there is a run for each stretch of it; every keyword is in exactly one.
        assert {(r["status"], r["created_by_type"]) for r in runs} == {("completed", "system")}
        assert sum(r["tasks_succeeded"] for r in runs) == KEYWORDS

        # The cost events are in the report once the rollup has run.
        engine = create_engine(settings)
        try:
            await roll_up_costs(create_session_factory(engine), now=datetime.now(UTC), days=2)
        finally:
            await engine.dispose()
        today = datetime.now(UTC).date()
        costs = await api.get(
            f"/api/v1/workspaces/{workspace.id}/costs",
            params={
                "from": (today - timedelta(days=1)).isoformat(),
                "to": today.isoformat(),
                "group_by": "project,workload",
            },
            headers=owner.headers,
        )
        assert costs.status_code == 200, costs.text
        (row,) = costs.json()["data"]
        assert row["keys"] == {"project": str(project), "workload": "keyword_metrics"}
        assert Decimal(row["cost_usd"]) > Decimal(0)
        # A cost event for each keyword's task, each with its share of its call's cost.
        assert row["request_count"] == KEYWORDS
        assert row["subjects"] == KEYWORDS
        assert labs_api.calls < KEYWORDS
