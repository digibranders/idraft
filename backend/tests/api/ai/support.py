"""Helpers for the AI prompt and engine route tests."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

import httpx

from tests.api.auth.support import Workspace, execute
from tests.api.entities.support import Caller
from tests.api.keywords.support import LOCATION, keyword_project, project_url
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt


async def ai_project(pg: PostgresServer, workspace: Workspace) -> uuid.UUID:
    """A project in the United States in English, with no engine on."""
    return await keyword_project(pg, workspace)


def prompt_body(text: str, **changes: Any) -> dict[str, Any]:
    return {"text": text, "language_code": "en", "country_iso": "US", **changes}


async def add_prompt(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    text: str,
    **changes: Any,
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project_id, "prompts"),
        json=prompt_body(text, **changes),
        headers=caller.headers,
    )


async def added(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    text: str,
    **changes: Any,
) -> str:
    response = await add_prompt(api, workspace, project_id, caller, text, **changes)
    assert response.status_code == 201, response.text
    prompt_id: str = response.json()["data"]["prompt_id"]
    return prompt_id


async def enable_engine(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    engine_code: str = "chatgpt_web",
    location_ids: Sequence[int] = (LOCATION,),
) -> None:
    """An engine turned on, written directly: no schedule is made."""
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code) VALUES ($1, $2, $3, $4, 'dataforseo') ON CONFLICT (project_id, "
        "engine_code) DO UPDATE SET location_ids = excluded.location_ids, is_enabled = true",
        project_id,
        engine_code,
        workspace.id,
        list(location_ids),
    )


async def seed_prompts(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    count: int,
    *,
    text_length: int | None = None,
) -> list[uuid.UUID]:
    """`count` active prompts written directly: `prompt 1` and on, or `00000xxx...` of
    `text_length` characters each."""
    ids: list[uuid.UUID] = []
    async with connection(pg) as db:
        for index in range(count):
            text = (
                f"prompt {index + 1}"
                if text_length is None
                else f"{index:05d}".ljust(text_length, "x")
            )
            prompt_id, _ = await insert_prompt(db, workspace.id, project_id, text)
            ids.append(prompt_id)
    return ids


async def set_prompt_quota(pg: PostgresServer, workspace: Workspace, limit: int) -> None:
    await execute(
        pg,
        "INSERT INTO core.workspace_quotas (workspace_id, max_active_prompts) VALUES ($1, $2) "
        "ON CONFLICT (workspace_id) DO UPDATE SET max_active_prompts = excluded.max_active_prompts",
        workspace.id,
        limit,
    )
