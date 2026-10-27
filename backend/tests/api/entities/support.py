"""Helpers for the entity route tests."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import (
    Workspace,
    add_member,
    cookie,
    execute,
    fetchrow,
    make_user,
    open_session,
)
from tests.conftest import PostgresServer


def entities_url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/entities", *map(str, parts)])


def problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


@dataclass(frozen=True)
class Caller:
    user_id: uuid.UUID
    headers: dict[str, str]


async def member(
    resources: Resources,
    pg: PostgresServer,
    workspace: Workspace,
    role: str,
    *,
    project_ids: list[uuid.UUID] | None = None,
) -> Caller:
    user = await make_user(pg)
    await add_member(pg, workspace, user, role, project_ids)
    token, _ = await open_session(resources, user)
    return Caller(user.id, cookie(token))


async def attach(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    entity_id: str | uuid.UUID,
    role: str = "competitor",
    *,
    removed: bool = False,
) -> None:
    """A project role, written directly: its routes arrive with Task 5."""
    await execute(
        pg,
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
        "removed_at) VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)",
        project_id,
        uuid.UUID(str(entity_id)),
        workspace.id,
        role,
        removed,
    )


async def config_version(pg: PostgresServer, project_id: uuid.UUID) -> int:
    row = await fetchrow(
        pg, "SELECT entity_config_version FROM core.projects WHERE id = $1", project_id
    )
    version: int = row["entity_config_version"]
    return version
