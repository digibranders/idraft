"""Answers for the Citations page tests (WP-76): `sources_support.answer` plus what the page reads
that it leaves at its defaults: the collection run, the own mention and the competitor mentions."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from tests.api.ai.sources_support import Cite, World, answer
from tests.api.auth.support import execute, fetchrow
from tests.collectors.ai_support import Prompt
from tests.conftest import PostgresServer


async def make_run(pg: PostgresServer, world: World, *, days_ago: float) -> uuid.UUID:
    """An `ai_prompt` collection run whose window starts `days_ago` days before now."""
    row = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot) VALUES ($1, $2, 'ai_prompt', "
        "now() - make_interval(secs => $3), now() - make_interval(secs => $3) + interval '1 hour', "
        "'manual', 'completed', '{}'::jsonb) RETURNING id",
        world.project.workspace_id,
        world.project.id,
        days_ago * 86400.0,
    )
    run_id: uuid.UUID = row["id"]
    return run_id


async def run_answer(
    pg: PostgresServer,
    world: World,
    prompt: Prompt,
    *,
    run: uuid.UUID | None,
    days_ago: float,
    engine: str = "chatgpt_web",
    cites: Sequence[Cite] = (),
    own_mentioned: bool = False,
    mentions: Sequence[uuid.UUID] = (),
    **rest: Any,
) -> int:
    observation_id = await answer(
        pg, world, prompt, days_ago=days_ago, engine=engine, cites=cites, **rest
    )
    await execute(
        pg, "UPDATE ai.observations SET collection_run_id = $2 WHERE id = $1", observation_id, run
    )
    await execute(
        pg,
        "UPDATE ai.observation_facts SET own_mentioned = $2, competitor_mentions = $3::uuid[] "
        "WHERE observation_id = $1",
        observation_id,
        own_mentioned,
        list(mentions),
    )
    return observation_id
