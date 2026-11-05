"""Quota routes (docs/19-api-specification.md section 3.2.5), open to every member."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from idraft.api.quotas.service import QuotaService
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.quotas import TrackedKeywordQuota, TrackedKeywordQuotaResponse
from idraft.api.workspaces.dependencies import MemberAccess

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["workspaces"])


def get_quota_service(resources: Annotated[Resources, Depends(get_resources)]) -> QuotaService:
    return resources.quotas


Quotas = Annotated[QuotaService, Depends(get_quota_service)]


@router.get(
    "/tracked-keyword-quota",
    summary="The workspace's tracked keyword limit and use",
    description="`used` counts the active tracked keywords of every live project of the "
    "workspace, the figure `quota_exceeded` carries. The full quota report stays deferred.",
)
async def get_tracked_keyword_quota(
    access: MemberAccess, quotas: Quotas
) -> TrackedKeywordQuotaResponse:
    usage = await quotas.tracked_keywords(access)
    return TrackedKeywordQuotaResponse(data=TrackedKeywordQuota(limit=usage.limit, used=usage.used))
