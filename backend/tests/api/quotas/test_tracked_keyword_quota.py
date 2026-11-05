"""The workspace's tracked keyword quota (docs/19 section 3.2.5)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from idraft.keywords.writer import DEFAULT_TRACKED_KEYWORD_LIMIT
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import keyword_project, tracked_id
from tests.conftest import PostgresServer


async def _quota(api: httpx.AsyncClient, workspace: Workspace, caller: Caller) -> httpx.Response:
    return await api.get(
        f"/api/v1/workspaces/{workspace.id}/tracked-keyword-quota", headers=caller.headers
    )


async def test_the_quota_is_the_limit_and_the_active_tracked_keywords(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 7)",
        workspace.id,
    )
    for text in ("crm", "erp", "hr"):
        await tracked_id(api, workspace, project, owner, text)
    archived = await tracked_id(api, workspace, project, owner, "archived")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1::uuid",
        archived,
    )

    for caller in (owner, viewer):
        response = await _quota(api, workspace, caller)
        assert response.status_code == 200, response.text
        assert response.json() == {"data": {"limit": 7, "used": 3}}


async def test_a_workspace_without_a_quota_row_has_the_default_limit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await _quota(api, workspace, owner)

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"limit": DEFAULT_TRACKED_KEYWORD_LIMIT, "used": 0}}


async def test_someone_outside_the_workspace_gets_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    stranger = await member(resources, migrated, other, "owner")

    assert problem(await _quota(api, workspace, stranger)) == (404, "not_found")
