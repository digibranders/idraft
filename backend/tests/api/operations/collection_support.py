"""Rows for the AI collection reads (WP-30 T1): a project with its engines and an owner, and runs,
tasks, raw payloads and answers written straight into the tables, so every expected count can
be worked out by hand. Nothing here calls a provider."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from idraft.api.resources import Resources
from idraft.providers.dataforseo import ai
from tests.api.ai.support import ai_project, enable_engine
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import LOCATION, project_url
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")


@dataclass(frozen=True)
class Scene:
    """A project of its own workspace with a caller of one role."""

    workspace: Workspace
    project: Project
    caller: Caller

    def url(self, *parts: object) -> str:
        return project_url(self.workspace, self.project.id, *parts)


async def make_scene(
    resources: Resources,
    pg: PostgresServer,
    *,
    role: str = "viewer",
    timezone: str = "UTC",
    engines: Sequence[str] = ("chatgpt_web",),
) -> Scene:
    workspace = await make_workspace(pg)
    caller = await member(resources, pg, workspace, role)
    project_id = await ai_project(pg, workspace)
    await execute(pg, "UPDATE core.projects SET timezone = $2 WHERE id = $1", project_id, timezone)
    for engine in engines:
        await enable_engine(pg, workspace, project_id, engine)
    return Scene(workspace, Project(workspace.id, project_id), caller)


async def another_project(pg: PostgresServer, scene: Scene) -> Scene:
    """A second project of the same workspace, read by the same caller."""
    project_id = await ai_project(pg, scene.workspace)
    return Scene(scene.workspace, Project(scene.workspace.id, project_id), scene.caller)


async def new_prompt(pg: PostgresServer, scene: Scene, text: str) -> Prompt:
    return await add_prompt(pg, scene.project, text)


async def add_run(
    pg: PostgresServer,
    scene: Scene,
    *,
    workload: str = "ai_prompt",
    status: str = "completed",
    engine_codes: Sequence[str] | None = None,
    completed_at: datetime | None = None,
) -> uuid.UUID:
    """A run of the project; `engine_codes` is what its selector asked for (none: the selector
    names no engine). Run ids are time ordered, so runs added in turn sort oldest first."""
    selector: dict[str, Any] = {}
    if engine_codes is not None:
        selector["engine_codes"] = list(engine_codes)
    row = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot, completed_at) VALUES ($1, $2, $3, "
        "clock_timestamp(), clock_timestamp() + interval '1 hour', 'manual', $4, $5::jsonb, $6) "
        "RETURNING id",
        scene.workspace.id,
        scene.project.id,
        workload,
        status,
        json.dumps({"selector": selector}),
        completed_at,
    )
    run_id: uuid.UUID = row["id"]
    return run_id


async def add_task(
    pg: PostgresServer,
    scene: Scene,
    run_id: uuid.UUID,
    prompt: Prompt,
    *,
    engine: str = "chatgpt_web",
    status: str = "ingested",
    location_id: int | None = LOCATION,
    replicate: int = 1,
    scheduled_for: datetime | None = None,
    workload: str = "ai_prompt",
) -> int:
    """One task of the run for the prompt's current version on the engine."""
    row = await fetchrow(
        pg,
        "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, engine_code, location_id, replicate_index, idempotency_key, "
        "request_fingerprint, provider_code, provider_endpoint, scheduled_for, status) VALUES "
        "($1, $2, $3, $4, 'prompt_version', $5, $6, $7, $8, $9, $9, 'dataforseo', $10, "
        "COALESCE($11, now()), $12) RETURNING id",
        run_id,
        scene.workspace.id,
        scene.project.id,
        workload,
        str(prompt.version_id),
        engine,
        location_id,
        replicate,
        uuid.uuid4().bytes,
        ai.ENGINE_ENDPOINTS[engine],
        scheduled_for,
        status,
    )
    task_id: int = row["id"]
    return task_id


async def raw_payload(pg: PostgresServer, engine: str) -> int:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', $3, now(), 'ai_raw', now() + interval '400 days') "
        "RETURNING id",
        f"ai/test/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
        ai.ENGINE_ENDPOINTS[engine],
    )
    payload_id: int = row["id"]
    return payload_id


async def add_answer(
    pg: PostgresServer,
    scene: Scene,
    prompt: Prompt,
    *,
    run_id: uuid.UUID | None = None,
    task_id: int | None = None,
    engine: str = "chatgpt_web",
    status: str = "complete",
    observed_at: datetime | None = None,
    superseded: bool = False,
) -> int:
    """One stored answer to the prompt, `status` as given, `observed_at` now by default.
    Returns its id."""
    moment = observed_at or datetime.now(UTC)
    row = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "collection_run_id, collection_task_id, provider_code, provider_endpoint, status, "
        "has_citations, raw_payload_id, adapter_version, normalizer_version, "
        "canonicalizer_version) VALUES ($1, $2, $3, $4, $5::text, "
        "(SELECT observation_class FROM ai.engines WHERE code = $5::text), $6, $7, 'q', $8, $9, "
        "'dataforseo', $10, $11, false, $12, 1, 1, 1) RETURNING id",
        moment,
        moment.astimezone(UTC).date(),
        scene.workspace.id,
        scene.project.id,
        engine,
        prompt.id,
        prompt.version_id,
        run_id,
        task_id,
        ai.ENGINE_ENDPOINTS[engine],
        status,
        await raw_payload(pg, engine),
    )
    answer_id: int = row["id"]
    if superseded:
        await execute(pg, "UPDATE ai.observations SET superseded_by = id WHERE id = $1", answer_id)
    return answer_id


async def add_tasks_with_answers(
    pg: PostgresServer,
    scene: Scene,
    run_id: uuid.UUID,
    prompt: Prompt,
    count: int,
    *,
    engine: str = "chatgpt_web",
) -> None:
    """`count` tasks of the run, each with a complete answer."""
    for number in range(count):
        task_id = await add_task(pg, scene, run_id, prompt, engine=engine, replicate=1 + number)
        await add_answer(pg, scene, prompt, run_id=run_id, task_id=task_id, engine=engine)


def today(zone: str = "UTC") -> date:
    return datetime.now(ZoneInfo(zone)).date()


def at(day: date, hour: int, minute: int = 0) -> datetime:
    """A UTC instant on `day`."""
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def days_ago(count: int, zone: str = "UTC") -> date:
    return today(zone) - timedelta(days=count)
