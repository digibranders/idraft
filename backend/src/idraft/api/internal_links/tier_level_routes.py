"""Workspace tier settings (spec 5.1): every member reads them; owners and admins change them
(`workspace:update`, decision D15)."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.tier_levels import TierLevel, TierLevelService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import (
    PageTier,
    PageTierCreate,
    PageTierList,
    PageTierPatch,
    PageTierResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/page-tiers", tags=["internal-links"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
ManageTiers = Annotated[WorkspaceAccess, Depends(require_permission(Permission.WORKSPACE_UPDATE))]


def get_tier_levels(resources: Annotated[Resources, Depends(get_resources)]) -> TierLevelService:
    return resources.tier_levels


Levels = Annotated[TierLevelService, Depends(get_tier_levels)]


def tier_view(level: TierLevel) -> PageTier:
    return PageTier(
        tier_id=level.tier_id,
        position=level.position,
        code=level.code,
        name=level.name,
        description=level.description,
        label=level.label,
        page_count=level.page_count,
        rule_count=level.rule_count,
        updated_at=level.updated_at,
    )


@router.get("", summary="The workspace's page tiers, T1 first")
async def list_tiers(access: ReadData, levels: Levels) -> PageTierList:
    return PageTierList(data=[tier_view(level) for level in await levels.list(access)])


@router.post(
    "",
    status_code=201,
    summary="Add the next tier",
    description="Appends the next position (T5, then up to T8); `422 tier_limit` at 8.",
)
async def add_tier(
    body: PageTierCreate, access: ManageTiers, levels: Levels, info: Info
) -> PageTierResponse:
    return PageTierResponse(data=tier_view(await levels.add(access, body, info)))


@router.patch("/{tier_id}", summary="Rename a tier or change its description")
async def rename_tier(
    tier_id: UUID, body: PageTierPatch, access: ManageTiers, levels: Levels, info: Info
) -> PageTierResponse:
    return PageTierResponse(data=tier_view(await levels.rename(access, tier_id, body, info)))


@router.delete(
    "/{tier_id}",
    status_code=204,
    summary="Delete a tier, moving its pages and rules",
    description="`move_to` is another tier's id or `none` (Untiered). A tier that pages or "
    "rules use and no `move_to` is `422 tier_in_use` with `page_count` and `rule_count`. "
    "Positions close up: deleting T2 makes T3 the new T2.",
)
async def delete_tier(
    tier_id: UUID,
    access: ManageTiers,
    levels: Levels,
    info: Info,
    move_to: Annotated[UUID | Literal["none"] | None, Query()] = None,
) -> Response:
    await levels.delete(access, tier_id, move_to, info)
    return Response(status_code=204)
