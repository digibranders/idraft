"""Chart annotations: model, entity set, extractor and prompt set changes (contract N9; WP-38
builds the body). Reading needs `data:read`."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.schemas.ai_notes import AnnotationList
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/annotations",
    summary="The changes every AI time chart marks",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`), oldest first: a new `model_reported` "
    "per engine, entity set, extractor and prompt set changes. Not built yet: `501 "
    "not_implemented`.",
)
@not_built
async def list_annotations(
    project_id: UUID,
    access: ReadData,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
) -> AnnotationList:
    raise not_built_yet()
