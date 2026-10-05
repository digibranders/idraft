"""Rank history, SERP snapshot and rank event routes (docs/19-api-specification.md section
3.6.4).

Reading needs `data:read`, and the raw answer `raw:read`. The membership dependency has already
refused a project outside the caller's scope: it reads the `project_id` of the path.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from sightline.api.pagination import Commas, Cursor, CursorPageInfo
from sightline.api.permissions import Permission
from sightline.api.ranks.service import RankService
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.ranks import (
    AioHistoryResponse,
    HistoryFormat,
    HistoryInclude,
    RankEventPage,
    RankHistoryResponse,
    SerpCurrentResponse,
    SerpFeatureHistoryResponse,
    SerpSnapshotDetailResponse,
    SerpSnapshotPage,
    SerpSnapshotPageInfo,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
keyword_router = APIRouter(
    prefix=f"{PROJECT}/tracked-keywords/{{tracked_keyword_id}}", tags=["ranks"]
)
snapshot_router = APIRouter(prefix=f"{PROJECT}/serp-snapshots", tags=["ranks"])
event_router = APIRouter(prefix=f"{PROJECT}/seo/rank-events", tags=["ranks"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
ReadRaw = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RAW_READ))]


def get_rank_service(resources: Annotated[Resources, Depends(get_resources)]) -> RankService:
    return resources.ranks


Ranks = Annotated[RankService, Depends(get_rank_service)]
From = Annotated[date | None, Query(alias="from", description="First local day, included.")]
To = Annotated[date | None, Query(alias="to", description="Last local day, included.")]


@keyword_router.get(
    "/rank-history",
    summary="A keyword's rank over time",
    description="One point per successful check on the project-local date it happened, for the "
    "project's primary own entity and the keyword's effective competitors (at most 11, or "
    "`entity_ids`). `from` and `to`, or `window` (`last_7d` to `last_365d`, default `last_90d`); "
    "at most 400 days. A rank is known within the depth checked: `beyond_depth` has no rank and "
    "is never drawn through; a check that failed for good is a `failed` point. `bands` shade the "
    "runs of beyond-depth checks. `format=columns` gives parallel arrays.",
)
async def rank_history(
    project_id: UUID,
    tracked_keyword_id: UUID,
    access: ReadData,
    ranks: Ranks,
    start: From = None,
    end: To = None,
    window: Annotated[str | None, Query(max_length=20)] = None,
    entity_ids: Annotated[list[UUID] | None, Commas, Query(max_length=11)] = None,
    include: Annotated[list[HistoryInclude] | None, Commas, Query()] = None,
    format: Annotated[HistoryFormat, Query()] = "points",
) -> RankHistoryResponse:
    history = await ranks.rank_history(
        access,
        project_id,
        tracked_keyword_id,
        start=start,
        end=end,
        window=window,
        entity_ids=entity_ids,
        include=frozenset(include or ()),
        form=format,
    )
    return RankHistoryResponse(data=history)


@keyword_router.get(
    "/serp-snapshots",
    summary="A keyword's SERP snapshots",
    description="Newest first. Each carries the own site's rank cell. A cursor is bound to its "
    "filters (`400 invalid_cursor` otherwise).",
)
async def serp_snapshots(
    project_id: UUID,
    tracked_keyword_id: UUID,
    access: ReadData,
    ranks: Ranks,
    page: Cursor,
    start: From = None,
    end: To = None,
    depth_requested: Annotated[
        int | None, Query(alias="filter[depth_requested]", ge=1, le=700)
    ] = None,
    has_ai_overview: Annotated[bool | None, Query(alias="filter[has_ai_overview]")] = None,
) -> SerpSnapshotPage:
    result = await ranks.snapshot_page(
        access,
        project_id,
        tracked_keyword_id,
        start=start,
        end=end,
        depth_requested=depth_requested,
        has_ai_overview=has_ai_overview,
        page=page,
    )
    return SerpSnapshotPage(
        data=result.rows,
        page=SerpSnapshotPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )


@keyword_router.get(
    "/serp-current",
    summary="A keyword's current top results",
    description="The top 20 of the last check, with the own or competitor entity each result "
    "belongs to. Empty before the first check.",
)
async def serp_current(
    project_id: UUID, tracked_keyword_id: UUID, access: ReadData, ranks: Ranks
) -> SerpCurrentResponse:
    return SerpCurrentResponse(
        data=await ranks.serp_current(access, project_id, tracked_keyword_id)
    )


@keyword_router.get(
    "/serp-features",
    summary="The SERP features of a keyword's recent checks",
    description="The last `limit_checks` checks in the window (default 30, newest first) with "
    "their features, and how often each feature was present and owned by the project.",
)
async def serp_features(
    project_id: UUID,
    tracked_keyword_id: UUID,
    access: ReadData,
    ranks: Ranks,
    start: From = None,
    end: To = None,
    feature_type_in: Annotated[
        list[str] | None, Commas, Query(alias="filter[feature_type_in]", max_length=20)
    ] = None,
    limit_checks: Annotated[int, Query(ge=1, le=200)] = 30,
) -> SerpFeatureHistoryResponse:
    return SerpFeatureHistoryResponse(
        data=await ranks.serp_features(
            access,
            project_id,
            tracked_keyword_id,
            start=start,
            end=end,
            feature_types=feature_type_in,
            limit_checks=limit_checks,
        )
    )


@keyword_router.get(
    "/aio-history",
    summary="AI Overview history of a keyword's checks",
    description="Per check: whether an AI Overview showed, whether the project and which "
    "competitors were cited, and how many sources it listed. At most 1,000 checks.",
)
async def aio_history(
    project_id: UUID,
    tracked_keyword_id: UUID,
    access: ReadData,
    ranks: Ranks,
    start: From = None,
    end: To = None,
) -> AioHistoryResponse:
    return AioHistoryResponse(
        data=await ranks.aio_history(access, project_id, tracked_keyword_id, start=start, end=end)
    )


@snapshot_router.get(
    "/{serp_snapshot_id}",
    summary="A SERP snapshot",
    description="The organic results with the entity each belongs to (as the rules stood when "
    "it was checked), the features and the provenance. `include=titles` adds titles and "
    "snippets where the tables keep them (the own and competitor entities' ranking pages, and "
    "the current top 20); `titles_source` says where they came from.",
)
async def serp_snapshot(
    project_id: UUID,
    serp_snapshot_id: int,
    access: ReadData,
    ranks: Ranks,
    observed_at: Annotated[datetime | None, Query(description="A hint to find the month.")] = None,
    include: Annotated[list[Literal["titles"]] | None, Commas, Query()] = None,
) -> SerpSnapshotDetailResponse:
    return SerpSnapshotDetailResponse(
        data=await ranks.snapshot_detail(
            access, project_id, serp_snapshot_id, observed_at, titles="titles" in (include or ())
        )
    )


@snapshot_router.get(
    "/{serp_snapshot_id}/raw",
    summary="The provider's answer for a SERP snapshot, as received",
    description="`raw:read`. `410 raw_expired` once the answer is past its retention; "
    "`503 raw_unavailable` when it could not be read now.",
    response_class=Response,
    responses={200: {"content": {"application/json": {}}}},
)
async def serp_snapshot_raw(
    project_id: UUID,
    serp_snapshot_id: int,
    access: ReadRaw,
    ranks: Ranks,
    observed_at: Annotated[datetime | None, Query(description="A hint to find the month.")] = None,
) -> Response:
    answer = await ranks.raw_answer(access, project_id, serp_snapshot_id, observed_at)
    return Response(
        content=answer.body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="serp-snapshot-{serp_snapshot_id}.json"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )


@event_router.get(
    "",
    summary="The project's rank events",
    description="Newest first. `from` and `to` take dates or timestamps. A cursor is bound to "
    "its filters (`400 invalid_cursor` otherwise).",
)
async def rank_events(
    project_id: UUID,
    access: ReadData,
    ranks: Ranks,
    page: Cursor,
    start: Annotated[datetime | None, Query(alias="from")] = None,
    end: Annotated[datetime | None, Query(alias="to")] = None,
    event_type_in: Annotated[
        list[str] | None, Commas, Query(alias="filter[event_type_in]", max_length=30)
    ] = None,
    tracked_keyword_id: Annotated[UUID | None, Query(alias="filter[tracked_keyword_id]")] = None,
    entity_id: Annotated[UUID | None, Query(alias="filter[entity_id]")] = None,
    group: Annotated[UUID | None, Query(alias="filter[group]")] = None,
    term: Annotated[UUID | None, Query(alias="filter[term]")] = None,
) -> RankEventPage:
    result = await ranks.event_page(
        access,
        project_id,
        start=start,
        end=end,
        event_types=event_type_in,
        tracked_keyword_id=tracked_keyword_id,
        entity_id=entity_id,
        group_id=group,
        term_id=term,
        page=page,
    )
    return RankEventPage(
        data=result.rows,
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )
