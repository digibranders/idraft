"""Cannibalization and Switching: own pages competing for tracked keywords (docs/33). Reads
only, all need `data:read`. `days` is the period (14, 30 or 90 checks back from today)."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.cannibalization.service import ROWS_MAX, CannibalizationService
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.cannibalization import (
    ConflictListResponse,
    DeviceName,
    KeywordDetailResponse,
    PairListResponse,
    SwitchKind,
    SwitchListResponse,
    VerdictFilter,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/cannibalization",
    tags=["cannibalization"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Device = Annotated[DeviceName, Query(description="Desktop and mobile are never mixed.")]
Days = Annotated[Literal["14", "30", "90"], Query(description="The period in days.")]
Group = Annotated[UUID | None, Query(description="A keyword group, with the groups under it.")]
Limit = Annotated[int, Query(ge=1, le=ROWS_MAX)]


def get_service(resources: Annotated[Resources, Depends(get_resources)]) -> CannibalizationService:
    return resources.cannibalization


Service = Annotated[CannibalizationService, Depends(get_service)]


@router.get(
    "",
    summary="Tracked keywords where two or more of the site's own pages compete",
    description="One row per tracked keyword on the device with its verdict over the period, "
    "the pages involved, rank gap, confirmed switches and a one-cell-per-check history. The "
    "headline carries the figures of the period before when the history allows. A verdict "
    "needs `min_checks` ranked checks, else it is `insufficient`.",
)
async def conflicts(
    project_id: UUID,
    access: ReadData,
    service: Service,
    device: Device = "desktop",
    days: Days = "30",
    verdict: VerdictFilter = "conflicts",
    group_id: Group = None,
    limit: Limit = 500,
) -> ConflictListResponse:
    found = await service.conflicts(
        access,
        project_id,
        device=device,
        days=int(days),
        verdict=verdict,
        group_id=group_id,
        limit=limit,
    )
    return ConflictListResponse(data=found)


@router.get("/pairs", summary="Pairs of own pages that compete on several keywords")
async def pairs(
    project_id: UUID,
    access: ReadData,
    service: Service,
    device: Device = "desktop",
    days: Days = "30",
    group_id: Group = None,
) -> PairListResponse:
    found = await service.pairs(
        access, project_id, device=device, days=int(days), group_id=group_id
    )
    return PairListResponse(data=found)


@router.get(
    "/switches",
    summary="Confirmed changes of the ranking page, with the weekly count",
    description="A switch is confirmed when the new page also holds the best rank on the next "
    "ranked check; one-check changes are only counted. `kind` narrows the rows, not the "
    "headline or the weeks.",
)
async def switches(
    project_id: UUID,
    access: ReadData,
    service: Service,
    device: Device = "desktop",
    days: Days = "30",
    kind: SwitchKind = "all",
    group_id: Group = None,
    limit: Limit = 500,
) -> SwitchListResponse:
    found = await service.switches(
        access, project_id, device=device, days=int(days), kind=kind, group_id=group_id, limit=limit
    )
    return SwitchListResponse(data=found)


@router.get(
    "/keywords/{tracked_keyword_id}",
    summary="One tracked keyword: its row and the page that ranked on each check",
)
async def keyword(
    project_id: UUID,
    tracked_keyword_id: UUID,
    access: ReadData,
    service: Service,
    device: Device = "desktop",
    days: Days = "30",
) -> KeywordDetailResponse:
    found = await service.keyword(
        access, project_id, tracked_keyword_id, device=device, days=int(days)
    )
    return KeywordDetailResponse(data=found)
