"""AI referral sessions from the project's Google Analytics property (docs/18 section 7.3)."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.fp.service import AiReferralsQuery, FpService
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import SummaryCompare
from idraft.api.schemas.fp import AiReferralsResponse, ReferralClassifier, ReferralGroupBy
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/fp", tags=["first-party"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_fp_service(resources: Annotated[Resources, Depends(get_resources)]) -> FpService:
    return FpService(sessions=resources.sessions)


FirstParty = Annotated[FpService, Depends(get_fp_service)]


@router.get(
    "/ai-referrals",
    summary="Sessions from AI assistants in Google Analytics, under two classifiers",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`). Each assistant has the sessions, engaged "
    "sessions and key events GA4's own `AI Assistant` channel counts (`ga4_ai_assistant_channel`) "
    "and our referrer rules count (`own_rules`), side by side, and their `difference`; neither is "
    "labelled correct. The figures are a lower bound, and Google AI Mode and Google AI Overview "
    "are not counted (GA4 files them under organic search): `meta.notes` says so. "
    "`compare=previous_period` (as many days just before the window), `compare=previous_year` or "
    "`compare_from` with `compare_to` (both or neither, at most 92 days; they win over `compare`) "
    "add `compare_window` and `previous` beside each value; `previous` is null unless the "
    "compared window is collected and holds a row for the key. Answers `200` with `connected: "
    "false` and no rows when the project has no live GA4 integration, and no rows when nothing "
    "is collected for the window (`meta.collected_through`); a key without a row is absent, never "
    "0. `group_by=landing_page` is `422 not_available` until the landing page report is built.",
)
async def ai_referrals(
    project_id: UUID,
    access: ReadData,
    service: FirstParty,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    compare: Annotated[
        SummaryCompare,
        Query(
            description="`previous_period`: as many days just before the window; "
            "`previous_year`: the same dates a year earlier. Adds `compare_window` and "
            "`previous` values."
        ),
    ] = "none",
    compare_from: Annotated[
        date | None,
        Query(
            description="First day of a window to compare with, project-local; needs "
            "`compare_to`, and wins over `compare`."
        ),
    ] = None,
    compare_to: Annotated[
        date | None,
        Query(
            description="Last day of the window to compare with, included; at most 92 days from "
            "`compare_from`."
        ),
    ] = None,
    group_by: Annotated[
        ReferralGroupBy,
        Query(
            description="`assistant` (default) or `origin` (only `ga4` exists today). "
            "`landing_page` is `422 not_available`: the landing page report is not built yet."
        ),
    ] = "assistant",
    classifier: Annotated[
        ReferralClassifier,
        Query(description="Which classifier values are filled; the other is null."),
    ] = "both",
) -> AiReferralsResponse:
    return await service.ai_referrals(
        access,
        project_id,
        AiReferralsQuery(
            start=start,
            end=end,
            compare=compare,
            compare_from=compare_from,
            compare_to=compare_to,
            group_by=group_by,
            classifier=classifier,
        ),
    )
