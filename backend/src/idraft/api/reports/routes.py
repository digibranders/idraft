"""Client reports: guest links and scheduled emails, managed by people, and the public read.

Listing needs `data:read`; making, revoking and every schedule change need `projects:write`.
The guest link is one random token in the path of the public read: no sign-in, no cookie, and
an unknown, expired or revoked link all answer the same `404 not_found`.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Response

from idraft.api.access import public
from idraft.api.internal_links.shares import ShareService
from idraft.api.permissions import Permission
from idraft.api.problems import NotFoundError, ProblemError
from idraft.api.reports.guest import ClientReportService
from idraft.api.reports.schedules import ReportScheduleService
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_reports import (
    ClientReportResponse,
    CreatedReportShare,
    CreatedReportShareResponse,
    ReportScheduleCreate,
    ReportScheduleList,
    ReportScheduleResponse,
    ReportScheduleUpdate,
    ReportShareCreate,
    ReportShareList,
    ReportShareResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

GUEST_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
}
PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/reports"
router = APIRouter(prefix=PROJECT, tags=["reports"])
public_router = APIRouter(
    prefix="/api/v1/public/reports", tags=["public"], dependencies=[Depends(public)]
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_shares(resources: Annotated[Resources, Depends(get_resources)]) -> ShareService:
    return resources.report_shares


def get_schedules(resources: Annotated[Resources, Depends(get_resources)]) -> ReportScheduleService:
    return resources.report_schedules


def get_guest(resources: Annotated[Resources, Depends(get_resources)]) -> ClientReportService:
    return resources.client_report


Shares = Annotated[ShareService, Depends(get_shares)]
Schedules = Annotated[ReportScheduleService, Depends(get_schedules)]
Guest = Annotated[ClientReportService, Depends(get_guest)]


@router.post(
    "/shares",
    status_code=201,
    summary="Make a read-only link to the project's AI visibility report",
    description="The token in the answer is shown once and is not stored; only its hash is. "
    "The link stops working at `expires_at` (7, 30 or 90 days, default 30) or when revoked.",
    response_model=CreatedReportShareResponse,
)
async def create_share(
    project_id: UUID, body: ReportShareCreate, access: WriteProject, shares: Shares, info: Info
) -> CreatedReportShareResponse:
    made = await shares.create(access, project_id, expires_in_days=body.expires_in_days, info=info)
    return CreatedReportShareResponse(data=CreatedReportShare(**made.model_dump()))


@router.get(
    "/shares",
    summary="The report links of the project, newest first, without their tokens",
    response_model=ReportShareList,
)
async def list_shares(project_id: UUID, access: ReadData, shares: Shares) -> ReportShareList:
    return ReportShareList(data=await shares.list(access, project_id))


@router.delete(
    "/shares/{report_share_id}",
    summary="Revoke a report link",
    description="Revoking a link that is already revoked changes nothing.",
    response_model=ReportShareResponse,
)
async def revoke_share(
    project_id: UUID, report_share_id: UUID, access: WriteProject, shares: Shares, info: Info
) -> ReportShareResponse:
    return ReportShareResponse(data=await shares.revoke(access, project_id, report_share_id, info))


@router.get(
    "/schedules",
    summary="The scheduled report emails of the project",
    response_model=ReportScheduleList,
)
async def list_schedules(
    project_id: UUID, access: ReadData, schedules: Schedules
) -> ReportScheduleList:
    return ReportScheduleList(data=await schedules.list(access, project_id))


@router.post(
    "/schedules",
    status_code=201,
    summary="Email the report weekly or monthly",
    description="Weekly sends on Monday and monthly on the 1st, at 06:00 UTC. Each email holds a "
    "new report link that works for 30 days. At most 10 recipients and 10 schedules a project "
    "(`422 schedule_limit`).",
    response_model=ReportScheduleResponse,
)
async def create_schedule(
    project_id: UUID,
    body: ReportScheduleCreate,
    access: WriteProject,
    schedules: Schedules,
    info: Info,
) -> ReportScheduleResponse:
    return ReportScheduleResponse(data=await schedules.create(access, project_id, body, info))


@router.patch(
    "/schedules/{report_schedule_id}",
    summary="Change, pause or resume a scheduled report",
    response_model=ReportScheduleResponse,
)
async def update_schedule(
    project_id: UUID,
    report_schedule_id: UUID,
    body: ReportScheduleUpdate,
    access: WriteProject,
    schedules: Schedules,
    info: Info,
) -> ReportScheduleResponse:
    return ReportScheduleResponse(
        data=await schedules.update(access, project_id, report_schedule_id, body, info)
    )


@router.delete(
    "/schedules/{report_schedule_id}",
    status_code=204,
    summary="Delete a scheduled report",
    description="The links already emailed keep working until they expire or are revoked.",
)
async def delete_schedule(
    project_id: UUID,
    report_schedule_id: UUID,
    access: WriteProject,
    schedules: Schedules,
    info: Info,
) -> Response:
    await schedules.delete(access, project_id, report_schedule_id, info)
    return Response(status_code=204)


@public_router.get(
    "/{token}",
    summary="The AI visibility report of a guest link",
    description="Read only, no sign-in, the last 28 project-local days. 30 requests a minute per "
    "address and 120 an hour per link; past either, `429 rate_limited`. The answer is never "
    "cached and holds no costs, prompt texts or answer texts.",
    response_model=ClientReportResponse,
)
async def public_report(
    token: Annotated[str, Path(max_length=200)], guest: Guest, info: Info, response: Response
) -> ClientReportResponse:
    try:
        report = await guest.read(token, ip=info.throttle_ip)
    except ProblemError as error:
        # A refusal (429) is as private as the report: it is never cached and never leaks a referrer
        error.headers.update(GUEST_HEADERS)
        raise
    if report is None:
        raise NotFoundError(headers=GUEST_HEADERS)
    response.headers.update(GUEST_HEADERS)
    return ClientReportResponse(data=report)
