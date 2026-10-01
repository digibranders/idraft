"""Helpers for the keyword route tests."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.entities.support import Caller
from tests.conftest import PostgresServer

LOCATION = 2840
OTHER_LOCATION = 2826


async def ensure_locations(pg: PostgresServer) -> None:
    await execute(
        pg,
        "INSERT INTO core.locations (id, name, country_iso, location_type) VALUES "
        "($1, 'United States', 'US', 'Country'), ($2, 'United Kingdom', 'GB', 'Country') "
        "ON CONFLICT (id) DO UPDATE SET is_active = true",
        LOCATION,
        OTHER_LOCATION,
    )


async def keyword_project(pg: PostgresServer, workspace: Workspace) -> uuid.UUID:
    """A project whose defaults are the United States in English."""
    await ensure_locations(pg)
    row = await fetchrow(
        pg,
        "INSERT INTO core.projects (workspace_id, name, slug, default_location_id, "
        "default_language_code) VALUES ($1, 'Site', $2, $3, 'en') RETURNING id",
        workspace.id,
        f"p-{uuid.uuid4().hex[:12]}",
        LOCATION,
    )
    project_id: uuid.UUID = row["id"]
    return project_id


def project_url(workspace: Workspace, project_id: uuid.UUID, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/projects/{project_id}", *map(str, parts)])


def keywords_url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/keywords", *map(str, parts)])


async def track(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    keyword: str,
    **body: Any,
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project_id, "tracked-keywords"),
        json={"keyword": keyword, **body},
        headers=caller.headers,
    )


async def tracked_id(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    keyword: str,
    **body: Any,
) -> str:
    response = await track(api, workspace, project_id, caller, keyword, **body)
    assert response.status_code == 201, response.text
    found: str = response.json()["data"][0]["tracked_keyword_id"]
    return found


def errors(response: httpx.Response) -> list[tuple[str, str]]:
    return [(error["path"], error["code"]) for error in response.json()["errors"]]
