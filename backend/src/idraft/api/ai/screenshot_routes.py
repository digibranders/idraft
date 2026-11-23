"""The screenshot of an AI answer: the page the engine showed.

POST captures it (one provider call, $0.004, once: a second POST returns the stored one) and
needs `runs:trigger`, because it spends. GET serves the stored image to anyone who can read the
project's data. The answer's own details stay under `observation_routes.py`.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from idraft.api.ai.observation_routes import Hint, ObservationId, ReadData
from idraft.api.ai.screenshots import ScreenshotService, screenshot_path
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai/observations", tags=["ai"])

RunTrigger = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]


def get_screenshot_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> ScreenshotService:
    return resources.ai_screenshots


Screenshots = Annotated[ScreenshotService, Depends(get_screenshot_service)]


class ScreenshotData(BaseModel):
    created: bool
    truncated: bool
    width: int | None
    height: int | None
    url: str


class ScreenshotResponse(BaseModel):
    data: ScreenshotData


@router.post(
    "/{observation_id}/screenshot",
    response_model=ScreenshotResponse,
    summary="Capture the screenshot of an AI answer",
    description="`runs:trigger`. One DataForSEO call ($0.004) the first time; later calls return "
    "the stored image and cost nothing (`200` instead of `201`). `410 screenshot_expired` once "
    "the answer is past the provider's 7 days, `409 screenshot_unsupported` for an engine with "
    "no platform page, `502 screenshot_failed` when the provider or the image could not be "
    "used, `503 screenshots_unavailable` when this installation has no DataForSEO account or "
    "no object storage.",
    status_code=status.HTTP_201_CREATED,
)
async def capture(
    workspace_id: UUID,
    project_id: UUID,
    observation_id: ObservationId,
    access: RunTrigger,
    screenshots: Screenshots,
    response: Response,
    observed_at: Hint = None,
) -> ScreenshotResponse:
    outcome = await screenshots.capture(access, project_id, observation_id, observed_at)
    if not outcome.created:
        response.status_code = status.HTTP_200_OK
    return ScreenshotResponse(
        data=ScreenshotData(
            created=outcome.created,
            truncated=outcome.truncated,
            width=outcome.width,
            height=outcome.height,
            url=screenshot_path(workspace_id, project_id, observation_id),
        )
    )


@router.get(
    "/{observation_id}/screenshot",
    summary="The stored screenshot of an AI answer",
    description="`data:read`. The PNG, or `404 no_screenshot` when none was captured.",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def screenshot(
    project_id: UUID,
    observation_id: ObservationId,
    access: ReadData,
    screenshots: Screenshots,
    observed_at: Hint = None,
) -> Response:
    body = await screenshots.image(access, project_id, observation_id, observed_at)
    return Response(
        content=body,
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )
