"""Answers written straight into `ai.observations` for the quality checks (WP-62 T3), so every
expected count is worked out by hand. Nothing here calls a provider."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

import asyncpg

from idraft.ai.quality import QualityResult
from tests.api.operations.collection_support import raw_payload
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.support import Project, make_tenant
from tests.collectors.support import another_project as sibling_project
from tests.conftest import PostgresServer

# Two days back, so the baseline (the 7 days before) and the day after are all in the past and in
# partitions that exist.
DAY = datetime.now(UTC).date() - timedelta(days=2)
NOON = datetime.combine(DAY, time(12), tzinfo=UTC)
BASELINE = NOON - timedelta(days=3)

Hashes = Literal["none", "same", "distinct"]

_INSERT = """
INSERT INTO ai.observations (
    observed_at, observed_date, workspace_id, project_id, engine_code, observation_class,
    prompt_id, prompt_version_id, query_text, collection_run_id, provider_code, provider_endpoint,
    model_reported, status, answer_hash, has_citations, fanout_count, raw_payload_id,
    adapter_version, normalizer_version, canonicalizer_version)
SELECT $1::timestamptz + make_interval(secs => g), ($1::timestamptz AT TIME ZONE 'UTC')::date,
    $2::uuid, $3::uuid, $4::text, (SELECT observation_class FROM ai.engines WHERE code = $4::text),
    $5::uuid, $6::uuid, 'q', $7::uuid, 'dataforseo', 'x', $8::text, $9::text,
    CASE $10::text WHEN 'same' THEN decode('01', 'hex')
                   WHEN 'distinct' THEN sha256(convert_to(g::text, 'UTF8')) END,
    $11::boolean, $12::smallint, $13::bigint, 1, 1, 1
FROM generate_series(0, $14::int - 1) AS g
"""


@dataclass(frozen=True)
class World:
    """A project of its own workspace with a prompt and a stored payload to point answers at."""

    project: Project
    prompt: Prompt
    payload_id: int


async def make_world(pg: PostgresServer) -> World:
    project = await make_tenant(pg)
    prompt = await add_prompt(pg, project, "Which SOC provider is best?")
    return World(project, prompt, await raw_payload(pg, "chatgpt_web"))


async def another_project(pg: PostgresServer, world: World) -> World:
    """A second project of the same workspace."""
    return World(await sibling_project(pg, world.project), world.prompt, world.payload_id)


async def put(
    db: asyncpg.Connection[asyncpg.Record],
    world: World,
    *,
    n: int,
    at: datetime = NOON,
    engine: str = "chatgpt_web",
    status: str = "complete",
    cited: bool = False,
    fanout: int = 0,
    model: str | None = "model-1",
    run: uuid.UUID | None = None,
    hashes: Hashes = "none",
) -> None:
    """`n` answers a second apart from `at`, with the given status, citation, fan-out, model and
    hash (`same`: one hash for all, `distinct`: one each, `none`: no hash)."""
    await db.execute(
        _INSERT,
        at,
        world.project.workspace_id,
        world.project.id,
        engine,
        world.prompt.id,
        world.prompt.version_id,
        run,
        model,
        status,
        hashes,
        cited,
        fanout,
        world.payload_id,
        n,
    )


async def failing_day(db: asyncpg.Connection[asyncpg.Record], world: World) -> None:
    """The day's 100 answers of one engine, 50 of them errors: `ai_status_mix` is flagged."""
    await put(db, world, n=50, status="error")
    await put(db, world, n=50)


def day_of(offset: int) -> date:
    return DAY + timedelta(days=offset)


def find(results: list[QualityResult], check: str, engine: str = "chatgpt_web") -> QualityResult:
    """The one result of `check` for `engine`."""
    (found,) = [r for r in results if r.check == check and r.engine_code == engine]
    return found
