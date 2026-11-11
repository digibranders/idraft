"""A world for the AI collection tests: a project that owns Eventus Security and competes with
CyberNX (the brands of the captured Gemini answer), prompts with their first version, engines
turned on, fetched AI tasks holding a stored answer, and an observation written directly."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from idraft.collectors import ledger
from idraft.collectors.fetching import RETENTION_CLASS
from idraft.collectors.ledger import NewTask
from idraft.collectors.raw_payloads import RawPayload, store_raw_payload
from idraft.domain.workloads import TaskWorkload
from idraft.providers.dataforseo import ai
from tests.api.auth.support import execute, fetchrow
from tests.api.keywords.support import LOCATION, ensure_locations
from tests.collectors.rank_support import Ledger, _entity
from tests.collectors.support import NOW, Project, make_tenant
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt

OWN_NAME = "Eventus Security"
OWN_HOST = "eventussecurity.com"
RIVAL_NAME = "CyberNX"
RIVAL_HOST = "cybernx.com"


@dataclass(frozen=True)
class AiWorld:
    project: Project
    own: uuid.UUID
    rival: uuid.UUID


@dataclass(frozen=True)
class Prompt:
    id: uuid.UUID
    version_id: uuid.UUID


async def make_ai_world(pg: PostgresServer) -> AiWorld:
    """A project of its own workspace that owns `OWN_HOST` and competes with `RIVAL_HOST`."""
    project = await make_tenant(pg)
    await ensure_locations(pg)
    own = await _entity(pg, project, OWN_NAME, OWN_HOST, "own", primary=True)
    rival = await _entity(pg, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    return AiWorld(project, own, rival)


async def add_prompt(
    pg: PostgresServer,
    project: Project,
    text: str,
    *,
    country: str = "US",
    language: str = "en",
    branded: bool = False,
    active: bool = True,
) -> Prompt:
    """A prompt with its first version, written as the prompt routes write one (plan A's
    `insert_prompt`). `active=False` is an archived prompt (plan A decision A7)."""
    async with connection(pg) as db:
        prompt_id, version_id = await insert_prompt(
            db,
            project.workspace_id,
            project.id,
            text,
            language_code=language,
            country_iso=country,
            is_active=active,
        )
        if branded:
            await db.execute("UPDATE ai.prompts SET is_branded = true WHERE id = $1", prompt_id)
    return Prompt(id=prompt_id, version_id=version_id)


async def enable_engine(
    pg: PostgresServer,
    project: Project,
    engine_code: str,
    *,
    location_ids: Sequence[int] = (LOCATION,),
    enabled: bool = True,
) -> None:
    """The engine turned on (or off) for the project at these locations (1 to 50 countries)."""
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code, is_enabled) VALUES ($1, $2, $3, $4, 'dataforseo', $5) "
        "ON CONFLICT (project_id, engine_code) DO UPDATE SET is_enabled = excluded.is_enabled, "
        "location_ids = excluded.location_ids",
        project.id,
        engine_code,
        project.workspace_id,
        list(location_ids),
        enabled,
    )


def chatgpt_answer(text: str, urls: Sequence[str] = (), *, when: datetime | None = None) -> bytes:
    """A ChatGPT scraper answer: one block of `text` citing `urls`, which the source list names
    too. A text under 40 characters reads as a refusal."""
    sources = [
        {"type": "chat_gpt_source", "url": url, "title": f"Page {number}", "source_name": None}
        for number, url in enumerate(urls, 1)
    ]
    result = {
        "model": "gpt-6",
        "datetime": (when or NOW).strftime("%Y-%m-%d %H:%M:%S +00:00"),
        "markdown": text,
        "sources": sources,
        "items": [{"type": "chat_gpt_text", "rank_group": 1, "markdown": text, "sources": sources}],
    }
    task = {
        "status_code": 20000,
        "data": {"device": "desktop", "language_code": "en"},
        "result": [result],
    }
    return json.dumps({"status_code": 20000, "tasks": [task]}).encode()


def at_now(path: Path, when: datetime | None = None) -> bytes:
    """A recorded answer with its time moved to `when` (NOW by default): the observation tables
    have partitions for the months around today only, and lists default to the last 28 days."""
    document = json.loads(path.read_text())
    for task in document["tasks"]:
        for result in task.get("result") or []:
            result["datetime"] = (when or NOW).strftime("%Y-%m-%d %H:%M:%S +00:00")
    return json.dumps(document).encode()


async def fetched_ai_task(
    sessions: Ledger,
    pg: PostgresServer,
    project: Project,
    prompt: Prompt,
    body: bytes,
    store: MemoryStore,
    *,
    engine_code: str = "chatgpt_web",
    fetched_at: datetime | None = None,
    cost: str = "0.0012",
) -> int:
    """A manual run of one task for the prompt on the engine, fetched, with `body` as its stored
    answer. Returns the task id."""
    endpoint = ai.ENGINE_ENDPOINTS[engine_code]
    run = ledger.NewRun(
        workspace_id=project.workspace_id,
        project_id=project.id,
        schedule_id=None,
        workload=TaskWorkload.AI_PROMPT,
        window_start=NOW,
        window_end=NOW + timedelta(hours=1),
        trigger="manual",
        config_snapshot={"selector": {"prompt_ids": [str(prompt.id)]}},
    )
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                NewTask(
                    subject_type="prompt_version",
                    subject_id=str(prompt.version_id),
                    engine_code=engine_code,
                    location_id=LOCATION,
                    replicate_index=1,
                    depth=None,
                    request_fingerprint=hashlib.sha256(uuid.uuid4().bytes).digest(),
                    provider_code="dataforseo",
                    provider_endpoint=endpoint,
                    scheduled_for=NOW,
                )
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=1, estimated_cost_usd=Decimal(0))
    payload_id = await store_raw_payload(
        sessions,
        store,
        RawPayload(
            body=body,
            content_type="application/json",
            provider_code="dataforseo",
            provider_endpoint=endpoint,
            endpoint_slug=ai.ENDPOINTS[endpoint].payload_slug,
            retention_class=RETENTION_CLASS[TaskWorkload.AI_PROMPT],
        ),
    )
    row = await fetchrow(
        pg,
        "UPDATE ops.collection_tasks SET status = 'fetched', raw_payload_id = $2, "
        "ready_source = 'poll', ready_at = $3, provider_task_id = 'p-' || id::text, "
        "cost_usd = $4 WHERE run_id = $1 RETURNING id",
        run_id,
        payload_id,
        fetched_at or NOW,
        Decimal(cost),
    )
    task_id: int = row["id"]
    return task_id


async def seed_observation(
    pg: PostgresServer,
    project: Project,
    prompt: Prompt,
    *,
    object_key: str,
    sha256: bytes,
    engine_code: str = "chatgpt_web",
) -> int:
    """An observation of the prompt written directly, with no task, no facts and a raw payload
    registered at `object_key`. Returns its id."""
    endpoint = ai.ENGINE_ENDPOINTS[engine_code]
    raw = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', $3, now(), 'ai_raw', now() + interval '400 days') "
        "RETURNING id",
        object_key,
        sha256,
        endpoint,
    )
    text = "Eventus Security runs a managed SOC in Mumbai and Pune."
    row = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, answer_text, answer_markdown, "
        "answer_char_count, has_citations, raw_payload_id, adapter_version, normalizer_version, "
        "canonicalizer_version) SELECT now(), current_date, $1, $2, $3, "
        "(SELECT observation_class FROM ai.engines WHERE code = $3), $4, v.id, v.text, "
        "'dataforseo', $5, 'complete', $6, $6, $7, false, $8, 1, 1, 1 "
        "FROM ai.prompt_versions v WHERE v.id = $9 RETURNING id",
        project.workspace_id,
        project.id,
        engine_code,
        prompt.id,
        endpoint,
        text,
        len(text),
        raw["id"],
        prompt.version_id,
    )
    observation_id: int = row["id"]
    return observation_id
