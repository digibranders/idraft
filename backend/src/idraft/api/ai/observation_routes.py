"""AI answers (docs/19 section 3.7.6): the project's observations, one with its citations and
mentions, and the provider's raw answer."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import AwareDatetime

from idraft.api.ai.observation_repository import ObservationFilter
from idraft.api.ai.observations import ObservationService
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import AnswerStatus, ObservationPage, ObservationResponse, Outcome
from idraft.api.schemas.ai_evidence import AnswerCompareResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai/observations", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
ReadRaw = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RAW_READ))]
# An observation id is a 64-bit integer, and PostgreSQL refuses anything larger.
ObservationId = Annotated[int, Path(ge=1, le=2**63 - 1)]
Hint = Annotated[datetime | None, Query(description="A hint to find the month.")]


def get_observation_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> ObservationService:
    return resources.ai_observations


Observations = Annotated[ObservationService, Depends(get_observation_service)]


@router.get(
    "",
    summary="The project's AI answers",
    description="Newest first. `from` and `to` take timestamps or project-local dates (`to` "
    "included); without them the last 28 days. A request covers at most 92 days "
    "(`422 window_too_large`). `facts` is the current derivation's, null before extraction. "
    "A cursor is bound to its filters (`400 invalid_cursor` otherwise).",
)
async def list_observations(
    project_id: UUID,
    access: ReadData,
    observations: Observations,
    page: Cursor,
    start: Annotated[AwareDatetime | date | None, Query(alias="from")] = None,
    end: Annotated[AwareDatetime | date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[str] | None, Commas, Query(alias="filter[engine_code_in]", max_length=10)
    ] = None,
    prompt_id: Annotated[UUID | None, Query(alias="filter[prompt_id]")] = None,
    statuses: Annotated[
        list[AnswerStatus] | None, Commas, Query(alias="filter[status_in]", max_length=5)
    ] = None,
    is_valid: Annotated[bool | None, Query(alias="filter[is_valid]")] = None,
    outcomes: Annotated[
        list[Outcome] | None, Commas, Query(alias="filter[outcome_in]", max_length=4)
    ] = None,
) -> ObservationPage:
    result = await observations.page(
        access,
        project_id,
        ObservationFilter(
            engine_codes=engine_codes,
            prompt_id=prompt_id,
            statuses=statuses,
            is_valid=is_valid,
            outcomes=outcomes,
        ),
        start=start,
        end=end,
        page=page,
    )
    return ObservationPage(
        data=result.rows,
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )


@router.get(
    "/{observation_id}",
    summary="One AI answer with its citations and mentions",
    description="The answer text, the cited sources with their role (own, competitor, third "
    "party) and the tracked entities it names, with evidence spans. Offsets are UTF-16 code "
    "units into `answer_text`, as a JavaScript string indexes it.",
)
async def get_observation(
    project_id: UUID,
    observation_id: ObservationId,
    access: ReadData,
    observations: Observations,
    observed_at: Hint = None,
) -> ObservationResponse:
    return ObservationResponse(
        data=await observations.detail(access, project_id, observation_id, observed_at)
    )


@router.get(
    "/{observation_id}/compare",
    summary="What an AI answer gained, lost and kept against the earlier answer",
    description="The tracked entities and the cited domains of this answer against the newest "
    "earlier valid answer of the same prompt and engine in which the own brand was mentioned "
    "(same project, not superseded, strictly earlier). Entities are the accepted mentions of "
    "the current derivation in any tracked role, matched by entity; sources are matched by "
    "registrable domain, and citations flagged `unresolved_redirect` or `engine_internal` are "
    "left out. Problems: `404 not_found` (no such answer in the project), `404 no_baseline` "
    "(no earlier answer to compare with, or this answer has no current facts), `403` (no "
    "`data:read`), `422` (an id that is not a 64-bit integer).",
)
async def compare_observation(
    project_id: UUID, observation_id: ObservationId, access: ReadData, observations: Observations
) -> AnswerCompareResponse:
    return AnswerCompareResponse(
        data=await observations.compare(access, project_id, observation_id)
    )


@router.get(
    "/{observation_id}/raw",
    summary="The provider's answer for an AI observation, as received",
    description="`raw:read`. `410 raw_expired` once the answer is past its retention; "
    "`503 raw_unavailable` when it could not be read now.",
    response_class=Response,
    responses={200: {"content": {"application/json": {}}}},
)
async def observation_raw(
    project_id: UUID,
    observation_id: ObservationId,
    access: ReadRaw,
    observations: Observations,
    observed_at: Hint = None,
) -> Response:
    body = await observations.raw_answer(access, project_id, observation_id, observed_at)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="ai-observation-{observation_id}.json"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )
