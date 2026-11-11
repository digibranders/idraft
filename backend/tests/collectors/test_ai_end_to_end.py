"""The whole AI prompt path, once: a person turns the engines on and asks three prompts with Run
now, the planner, dispatcher, submission, ready poll, fetch and ingest run over the real DataForSEO
adapter, and the prompts summary shows the answers. Nothing leaves the machine: the adapter's HTTP
client is an httpx mock transport that serves the three answers captured from the provider
(`tests/fixtures/dataforseo/captured`), and a request to any other host or path fails the test.

Two more scenarios pin the brakes of the first-run guide (docs/ops/ai-first-run.md): a budget of
0 blocks a run before anything is sent, and engines that are on with their schedules paused
plan nothing."""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

import httpx

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt import AiPromptWorkload
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.collectors.dispatcher import dispatch
from idraft.collectors.fetching import fetch_task, poll_ready
from idraft.collectors.planner import plan_due, plan_manual_runs
from idraft.collectors.registry import Registry
from idraft.collectors.submission import submit_batch
from idraft.providers.dataforseo import ai
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.provider import DataForSeo
from tests.api.auth.support import Workspace, fetch, make_workspace
from tests.api.conftest import api, auth_app, import_store, mailbox, resources
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import LOCATION, ensure_locations, project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    RIVAL_HOST,
    RIVAL_NAME,
    Prompt,
    add_prompt,
)
from tests.collectors.rank_support import Ledger, _entity
from tests.collectors.support import Pauses, Project, make_budget
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_rank_acceptance import Outbox
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import (
    FIXTURES,
    LOGIN,
    ORIGIN,
    PASSWORD,
    FakeGate,
    envelope,
    task_answer,
)

__all__ = ["api", "auth_app", "import_store", "mailbox", "resources"]

QUESTIONS = (
    "Which managed SOC providers work with mid-size banks?",
    "Best SOC as a service vendors in the US?",
    "Who offers 24x7 threat monitoring for fintechs?",
)
ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")
# The provider's path of each endpoint, and the captured answer it serves.
CAPTURED = {
    ai.CHATGPT_SCRAPER: "chatgpt_scraper_answer",
    ai.GEMINI_SCRAPER: "gemini_scraper_answer",
    ai.AI_MODE: "ai_mode_answer",
}
TASK_PRICE = Decimal("0.0012")


class Gateway:
    """DataForSEO as the HTTP client meets it: what each `task_post` carried, the tasks it made
    ready, and every request that was not for one of its three endpoints."""

    def __init__(self) -> None:
        self.posts: dict[str, list[list[dict[str, Any]]]] = {endpoint: [] for endpoint in CAPTURED}
        self.requests: list[str] = []
        self.strangers: list[str] = []
        self._ready: dict[str, list[tuple[str, str]]] = {endpoint: [] for endpoint in CAPTURED}
        self._made = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(f"{request.method} {request.url}")
        if request.url.host != urlsplit(ORIGIN).hostname:
            self.strangers.append(str(request.url))
            return httpx.Response(502)
        path = request.url.path
        for endpoint, name in CAPTURED.items():
            base = f"/v3/{endpoint}"
            if path == f"{base}/task_post":
                return self._post(endpoint, json.loads(request.content))
            if path == f"{base}/tasks_ready":
                ready = [{"id": pid, "tag": tag} for pid, tag in self._ready[endpoint]]
                return httpx.Response(200, json=envelope([task_answer(result=ready)]))
            if path.startswith(f"{base}/task_get/advanced/"):
                return self._answer(endpoint, name, path.rsplit("/", 1)[1])
        self.strangers.append(str(request.url))
        return httpx.Response(404, json={"status_code": 40400, "status_message": "Not Found."})

    def _post(self, endpoint: str, tasks: list[dict[str, Any]]) -> httpx.Response:
        self.posts[endpoint].append(tasks)
        made = []
        for task in tasks:
            self._made += 1
            provider_task_id = f"11110640-2666-0626-0000-{self._made:012d}"
            self._ready[endpoint].append((provider_task_id, task["tag"]))
            made.append(
                task_answer(
                    status_code=20100,
                    message="Task Created.",
                    task_id=provider_task_id,
                    cost=float(TASK_PRICE),
                    data=task,
                )
            )
        return httpx.Response(200, json=envelope(made))

    def _answer(self, endpoint: str, name: str, provider_task_id: str) -> httpx.Response:
        self._ready[endpoint] = [x for x in self._ready[endpoint] if x[0] != provider_task_id]
        document = json.loads((FIXTURES / "captured" / f"{name}.json").read_text())
        document["tasks"][0]["id"] = provider_task_id
        when = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S +00:00")
        for result in document["tasks"][0]["result"] or []:
            result["datetime"] = when
        return httpx.Response(200, content=json.dumps(document).encode())

    @property
    def tasks_posted(self) -> int:
        return sum(len(call) for calls in self.posts.values() for call in calls)


@dataclass
class Pipeline:
    """The worker's AI steps on a gateway and an in-memory object store."""

    worker_db: Ledger
    registry: Registry
    gateway: Gateway
    store: MemoryStore = field(default_factory=MemoryStore)

    async def tick(self, at: datetime) -> None:
        """One pass of every step, as of `at`: no waiting, the clock is the argument."""
        outbox, pauses = Outbox(), Pauses()
        await plan_manual_runs(self.worker_db, self.registry, now=at)
        await plan_due(self.worker_db, self.registry, now=at)
        await dispatch(self.worker_db, self.registry, outbox, pauses, now=at)
        for batch in outbox.batches:
            await submit_batch(
                self.worker_db, self.registry, pauses, batch, store=self.store, jitter=lambda: 0.0
            )
        await poll_ready(self.worker_db, self.registry, outbox, now=at)
        for order in outbox.fetches:
            await fetch_task(self.worker_db, self.registry, self.store, order, jitter=lambda: 0.0)
        await ingest(self.worker_db, self.store)

    async def run(self, start: datetime, *, minutes: int = 4) -> None:
        for minute in range(minutes):
            await self.tick(start + timedelta(minutes=minute))


@asynccontextmanager
async def pipeline(worker_db: Ledger) -> AsyncIterator[Pipeline]:
    """The real DataForSEO adapter over the mock transport. The test ends in failure when a
    request went anywhere else."""
    gateway = Gateway()
    async with httpx.AsyncClient(transport=httpx.MockTransport(gateway)) as http:
        client = DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD, origin=ORIGIN)
        registry = Registry()
        registry.add_workload(AiPromptWorkload())
        registry.add_provider(DataForSeo(client, installation="test"))
        yield Pipeline(worker_db, registry, gateway)
    assert gateway.strangers == []


@dataclass(frozen=True)
class Scene:
    workspace: Workspace
    owner: Caller
    project: Project
    prompts: list[Prompt]

    def url(self, *parts: object) -> str:
        return project_url(self.workspace, self.project.id, *parts)


async def make_scene(
    resources: Resources, pg: PostgresServer, *, prompts: int = len(QUESTIONS)
) -> Scene:
    """A project that owns Eventus Security and competes with CyberNX, with its prompts. No
    engine is on yet."""
    await ensure_locations(pg)
    workspace = await make_workspace(pg)
    project = Project(workspace.id, await make_project(pg, workspace.id))
    owner = await member(resources, pg, workspace, "owner")
    await _entity(pg, project, OWN_NAME, OWN_HOST, "own", primary=True)
    await _entity(pg, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    return Scene(
        workspace,
        owner,
        project,
        [await add_prompt(pg, project, text) for text in QUESTIONS[:prompts]],
    )


async def turn_engines_on(api: httpx.AsyncClient, scene: Scene) -> None:
    """Each engine on at the United States, through the route that also makes the schedules."""
    for code in ENGINES:
        response = await api.put(
            scene.url("engines", code),
            json={"location_ids": [LOCATION], "is_enabled": True},
            headers=scene.owner.headers,
        )
        assert response.status_code == 200, response.text


async def run_now(api: httpx.AsyncClient, scene: Scene, prompt: Prompt) -> None:
    response = await api.post(
        scene.url("prompts", prompt.id, "run-now"),
        json={"engine_codes": list(ENGINES)},
        headers=scene.owner.headers,
    )
    assert response.status_code == 202, response.text


async def schedules_of(pg: PostgresServer, scene: Scene) -> list[Any]:
    return await fetch(
        pg,
        "SELECT id, next_run_at, is_active FROM ops.schedules WHERE project_id = $1 "
        "AND workload = 'ai_prompt' ORDER BY next_run_at",
        scene.project.id,
    )


async def test_run_now_to_the_prompts_summary(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Ledger
) -> None:
    scene = await make_scene(resources, migrated)
    await turn_engines_on(api, scene)
    # Two weekly schedules, none due yet: only Run now makes work.
    schedules = await schedules_of(migrated, scene)
    assert len(schedules) == 2
    assert all(row["is_active"] and row["next_run_at"] > datetime.now(UTC) for row in schedules)
    for prompt in scene.prompts:
        await run_now(api, scene, prompt)

    async with pipeline(worker_db) as worker:
        await worker.run(datetime.now(UTC))
        gateway, store = worker.gateway, worker.store

    # Nine tasks, three per endpoint, every one of them through to its observation.
    tasks = await fetch(
        migrated,
        "SELECT engine_code, provider_endpoint, status, subject_id, raw_payload_id "
        "FROM ops.collection_tasks WHERE project_id = $1",
        scene.project.id,
    )
    assert len(tasks) == 9
    assert {task["status"] for task in tasks} == {"ingested"}
    assert Counter((task["engine_code"], task["provider_endpoint"]) for task in tasks) == {
        ("chatgpt_web", ai.CHATGPT_SCRAPER): 3,
        ("gemini_web", ai.GEMINI_SCRAPER): 3,
        ("google_ai_mode", ai.AI_MODE): 3,
    }
    assert {task["subject_id"] for task in tasks} == {str(p.version_id) for p in scene.prompts}

    # One task_post per endpoint carried its three tasks, asked in the project's country and
    # language on the standard queue; AI Mode is asked as a desktop Windows browser.
    assert {
        endpoint: [len(call) for call in calls] for endpoint, calls in gateway.posts.items()
    } == {
        ai.CHATGPT_SCRAPER: [3],
        ai.GEMINI_SCRAPER: [3],
        ai.AI_MODE: [3],
    }
    for endpoint, calls in gateway.posts.items():
        (call,) = calls
        assert {task["location_code"] for task in call} == {LOCATION}
        assert {task["language_code"] for task in call} == {"en"}
        assert {task["priority"] for task in call} == {1}
        assert {task["keyword"] for task in call} == set(QUESTIONS)
        if endpoint == ai.AI_MODE:
            assert {(task["device"], task["os"]) for task in call} == {("desktop", "windows")}
        else:
            assert all("device" not in task for task in call)

    # Each run was estimated at three tasks of 0.0012 on the standard queue.
    runs = await fetch(
        migrated,
        "SELECT status, estimated_cost_usd, config_snapshot->>'queue' AS queue "
        "FROM ops.collection_runs WHERE project_id = $1",
        scene.project.id,
    )
    assert [(run["estimated_cost_usd"], run["queue"]) for run in runs] == [
        (Decimal("0.0036"), "standard")
    ] * 3

    # The raw answers are kept, in the class that is never deleted.
    payloads = await fetch(
        migrated,
        "SELECT id, retention_class, object_key FROM ops.raw_payloads WHERE id = ANY($1)",
        [task["raw_payload_id"] for task in tasks],
    )
    assert {payload["retention_class"] for payload in payloads} == {"ai_raw"}
    assert {payload["object_key"] for payload in payloads} == set(store.objects)
    assert len(payloads) == 9

    written = await rows_written(migrated, scene)
    assert (written["observations"], written["observation_facts"]) == (9, 9)
    # A second ingest finds nothing to read and writes nothing.
    assert (await ingest(worker_db, store)).quiet
    assert await rows_written(migrated, scene) == written

    # Per prompt and engine, one answer: Gemini names and cites the project, the other two do
    # not (the captured answers).
    summary = await api.get(scene.url("ai", "prompts-summary"), headers=scene.owner.headers)
    assert summary.status_code == 200, summary.text
    rows = summary.json()["data"]["prompts"]
    assert {row["prompt_id"] for row in rows} == {str(prompt.id) for prompt in scene.prompts}
    for row in rows:
        assert {
            engine["engine_code"]: (
                engine["mentioned"]["numerator"],
                engine["mentioned"]["denominator"],
                engine["cited"]["numerator"],
                engine["cited"]["denominator"],
            )
            for engine in row["engines"]
        } == {
            "chatgpt_web": (0, 1, 0, 1),
            "gemini_web": (1, 1, 1, 1),
            "google_ai_mode": (0, 1, 0, 1),
        }


async def rows_written(pg: PostgresServer, scene: Scene) -> dict[str, int]:
    """How many rows the project has in each table that ingest writes."""
    counts: dict[str, int] = {}
    for table in (
        "observations",
        "observation_facts",
        "derivations",
        "citations",
        "entity_mentions",
    ):
        (row,) = await fetch(
            pg, f"SELECT count(*) AS n FROM ai.{table} WHERE project_id = $1", scene.project.id
        )
        counts[table] = row["n"]
    return counts


async def run_rows(pg: PostgresServer, scene: Scene) -> list[Any]:
    return await fetch(
        pg,
        "SELECT id, status, status_reason, tasks_total, blocked_by_budget_id "
        "FROM ops.collection_runs WHERE project_id = $1",
        scene.project.id,
    )


async def task_count(pg: PostgresServer, scene: Scene) -> int:
    (row,) = await fetch(
        pg, "SELECT count(*) AS n FROM ops.collection_tasks WHERE project_id = $1", scene.project.id
    )
    count: int = row["n"]
    return count


async def test_a_project_with_no_ai_budget_is_sent(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Ledger
) -> None:
    """The first-run guide sets the budget first because without one nothing stops a run."""
    scene = await make_scene(resources, migrated, prompts=1)
    await turn_engines_on(api, scene)
    await run_now(api, scene, scene.prompts[0])

    async with pipeline(worker_db) as worker:
        await worker.run(datetime.now(UTC))
        assert worker.gateway.tasks_posted == 3

    (run,) = await run_rows(migrated, scene)
    assert run["status"] != "budget_blocked"
    assert run["blocked_by_budget_id"] is None
    assert await task_count(migrated, scene) == 3


async def test_a_budget_of_zero_blocks_the_run_and_nothing_is_sent(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Ledger
) -> None:
    """The emergency brake of the first-run guide: a limit of 0 on the `ai_prompt` budget."""
    scene = await make_scene(resources, migrated, prompts=1)
    await turn_engines_on(api, scene)
    budget_id = await make_budget(
        migrated, scene.project, "0", workload="ai_prompt", for_project=True
    )
    await run_now(api, scene, scene.prompts[0])

    async with pipeline(worker_db) as worker:
        await worker.run(datetime.now(UTC))
        assert worker.gateway.requests == []

    (run,) = await run_rows(migrated, scene)
    assert (run["status"], run["status_reason"], run["blocked_by_budget_id"]) == (
        "budget_blocked",
        "budget_exceeded",
        budget_id,
    )
    assert run["tasks_total"] == 0
    assert await task_count(migrated, scene) == 0


async def test_engines_that_are_on_with_paused_schedules_plan_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Ledger
) -> None:
    """Step B of the first-run guide: the engines are on, both schedules are paused, and when
    their windows come nothing is planned and nothing is sent."""
    scene = await make_scene(resources, migrated, prompts=1)
    await turn_engines_on(api, scene)
    before = await schedules_of(migrated, scene)
    assert len(before) == 2
    for schedule in before:
        paused = await api.post(
            scene.url("schedules", schedule["id"], "pause"),
            json={"reason": "first run, paused until step 3"},
            headers=scene.owner.headers,
        )
        assert paused.status_code == 200, paused.text
    after = await schedules_of(migrated, scene)
    assert [row["is_active"] for row in after] == [False, False]

    async with pipeline(worker_db) as worker:
        # Each window comes: a minute after its schedule was due.
        for schedule in after:
            await worker.run(schedule["next_run_at"] + timedelta(minutes=1), minutes=1)
        assert worker.gateway.requests == []

    assert await run_rows(migrated, scene) == []
    assert await task_count(migrated, scene) == 0
