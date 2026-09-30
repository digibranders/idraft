"""Helpers for workspace tests: probe routes behind the membership and permission checks."""

from __future__ import annotations

import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from sightline.api.access import public
from sightline.api.pagination import Offset
from sightline.api.permissions import Permission
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import MemberAccess, require_permission
from tests.api.auth.support import fetchrow
from tests.conftest import PostgresServer

workspace_probes = APIRouter(prefix="/api/v1/_probe")
_WORKSPACE = "/workspaces/{workspace_id}"


class _Value(BaseModel):
    value: int


def _describe(access: WorkspaceAccess) -> dict[str, object]:
    return {
        "workspace_id": str(access.workspace_id),
        "user_id": str(access.user_id),
        "role": access.role.value,
        "project_ids": None
        if access.project_ids is None
        else sorted(str(project_id) for project_id in access.project_ids),
    }


@workspace_probes.get(_WORKSPACE + "/member")
async def probe_member(access: MemberAccess) -> dict[str, object]:
    return _describe(access)


@workspace_probes.post(_WORKSPACE + "/manage")
async def probe_manage(
    body: _Value,
    access: Annotated[WorkspaceAccess, Depends(require_permission(Permission.MEMBERS_MANAGE))],
) -> dict[str, object]:
    return _describe(access)


@workspace_probes.post(_WORKSPACE + "/delete")
async def probe_delete(
    access: Annotated[
        WorkspaceAccess, Depends(require_permission(Permission.WORKSPACE_DELETE, fresh=True))
    ],
) -> dict[str, object]:
    return _describe(access)


@workspace_probes.get(_WORKSPACE + "/projects/{project_id}")
async def probe_project(project_id: uuid.UUID, access: MemberAccess) -> dict[str, object]:
    return _describe(access)


@workspace_probes.patch(_WORKSPACE + "/projects/{project_id}")
async def probe_project_write(
    project_id: uuid.UUID,
    access: Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))],
) -> dict[str, object]:
    return _describe(access)


@workspace_probes.get(_WORKSPACE + "/log")
async def probe_log(access: MemberAccess) -> dict[str, bool]:
    structlog.get_logger("probe").info("inside the handler")
    return {"ok": True}


@workspace_probes.get(_WORKSPACE + "/boom")
async def probe_workspace_boom(access: MemberAccess) -> None:
    raise RuntimeError("kaput")


@workspace_probes.get("/no-workspace")
async def probe_no_workspace(access: MemberAccess) -> dict[str, object]:
    return _describe(access)


@workspace_probes.get("/page", dependencies=[Depends(public)])
async def probe_page(page: Offset) -> dict[str, int]:
    return {"offset": page.offset, "limit": page.limit}


async def make_project(
    pg: PostgresServer, workspace_id: uuid.UUID, *, name: str = "Site", slug: str | None = None
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
        workspace_id,
        name,
        slug or f"p-{uuid.uuid4().hex[:12]}",
    )
    project_id: uuid.UUID = row["id"]
    return project_id
