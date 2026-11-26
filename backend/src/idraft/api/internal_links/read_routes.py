"""Reads of a project's crawls for the Pages, Links, Journey and Tier flow screens (spec 7 and
8). Every route needs `data:read`; `run` is `latest` or a crawl id, `scope` the link scope in
view (editorial by default). `404 no_crawl` before the first finished crawl."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response

from idraft.api.internal_links.reads import EdgeQuery, LinkReadService
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import (
    EdgeRowPage,
    EdgeWorklist,
    LinkGraphResponse,
    LinkScopeName,
    ListMeta,
    NeighborList,
    PageDetailResponse,
    PageFilter,
    PageFlag,
    PageRowPage,
    PageSort,
    PageWorklist,
    PlacementName,
    StatusClass,
    TierFlowResponse,
    UrlId,
    WorklistsResponse,
)
from idraft.api.schemas.internal_links_history import PageHistoryResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.crawl.scopes import LinkScope

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links",
    tags=["internal-links"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Run = Annotated[Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")]
Scope = Annotated[LinkScopeName, Query()]
Output = Annotated[Literal["json", "csv"], Query(alias="format")]
TierList = list[UUID | Literal["none"]] | None
TierIds = Annotated[TierList, Commas, Query(alias="filter[tier]", min_length=1, max_length=9)]
SourceTiers = Annotated[
    TierList, Commas, Query(alias="filter[source_tier]", min_length=1, max_length=9)
]
TargetTiers = Annotated[
    TierList, Commas, Query(alias="filter[target_tier]", min_length=1, max_length=9)
]
Tags = Annotated[list[UUID] | None, Commas, Query(alias="filter[tag]", max_length=50)]
Statuses = Annotated[list[StatusClass] | None, Commas, Query(alias="filter[status]", max_length=5)]
TargetStatuses = Annotated[
    list[StatusClass] | None, Commas, Query(alias="filter[target_status]", max_length=5)
]
Flags = Annotated[list[PageFlag] | None, Commas, Query(alias="filter[flags]", max_length=7)]
Placements = Annotated[
    list[PlacementName] | None, Commas, Query(alias="filter[placement]", max_length=7)
]
PathText = Annotated[str | None, Query(min_length=1, max_length=200)]
UrlIdQuery = Annotated[UrlId, Query()]
UrlIdPath = Annotated[UrlId, Path()]
_CSV: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/csv": {}}, "description": "With `format=csv`: the rows as CSV."}
}


def get_reads(resources: Annotated[Resources, Depends(get_resources)]) -> LinkReadService:
    return resources.link_reads


Reads = Annotated[LinkReadService, Depends(get_reads)]


def _run(run: Literal["latest"] | UUID) -> UUID | None:
    return run if isinstance(run, UUID) else None


def _tiers(given: list[UUID | Literal["none"]] | None) -> tuple[UUID | None, ...] | None:
    if given is None:
        return None
    return tuple(tier if isinstance(tier, UUID) else None for tier in given)


def _csv(text: str, name: str) -> Response:
    return Response(
        content=text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )


@router.get(
    "/pages",
    summary="Pages of a crawl, with link counts in the scope in view",
    response_model=PageRowPage,
    responses=_CSV,
)
async def list_pages(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    page: Cursor,
    run: Run = "latest",
    scope: Scope = "editorial",
    tiers: TierIds = None,
    tags: Tags = None,
    status: Statuses = None,
    indexable: Annotated[bool | None, Query(alias="filter[indexable]")] = None,
    flags: Flags = None,
    include_variants: Annotated[bool, Query(alias="filter[include_variants]")] = False,
    worklist: Annotated[PageWorklist | None, Query(alias="filter[worklist]")] = None,
    q: PathText = None,
    sort: Annotated[PageSort, Query()] = "-equity_share",
    include: Annotated[
        list[Literal["changes", "keywords", "citations", "anchors", "gsc"]] | None,
        Commas,
        Query(max_length=5, description="Parts to add to each row as `extras`."),
    ] = None,
    output: Output = "json",
) -> PageRowPage | Response:
    found = PageFilter(
        tier_ids=tiers,
        tag_ids=tags,
        status=status,
        indexable=indexable,
        flags=flags,
        include_variants=include_variants,
        worklist=worklist,
        q=q,
    )
    view = LinkScope(scope)
    if output == "csv":
        text = await reads.pages_csv(
            access, project_id, run=_run(run), view=view, found=found, sort=sort
        )
        return _csv(text, "pages")
    listed = await reads.pages(
        access,
        project_id,
        run=_run(run),
        view=view,
        found=found,
        sort=sort,
        cursor=page.cursor,
        limit=page.limit,
        include=include or (),
    )
    return PageRowPage(
        data=listed.rows,
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=listed.next_cursor,
            has_more=listed.next_cursor is not None,
        ),
        meta=ListMeta(
            run_id=listed.run_id,
            scope=scope,
            total=listed.total,
            links_available=not listed.links_dropped,
        ),
    )


@router.get("/pages/{url_id}", summary="One page: the inspector")
async def get_page(
    project_id: UUID,
    url_id: UrlIdPath,
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    scope: Scope = "editorial",
) -> PageDetailResponse:
    detail = await reads.page_detail(
        access, project_id, run=_run(run), url_id=url_id, view=LinkScope(scope)
    )
    return PageDetailResponse(data=detail)


@router.get(
    "/pages/{url_id}/history",
    summary="One page: when its content changed",
    description="Reads the latest crawl; `404` when the URL is not in it.",
)
async def get_page_history(
    project_id: UUID, url_id: UrlIdPath, access: ReadData, reads: Reads
) -> PageHistoryResponse:
    return PageHistoryResponse(data=await reads.page_history(access, project_id, url_id=url_id))


@router.get(
    "/edges",
    summary="Link edges of a crawl",
    description="Template links first, then auto-generated, then editorial, so template fixes "
    "come first; then by target path.",
    response_model=EdgeRowPage,
    responses=_CSV,
)
async def list_edges(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    page: Cursor,
    run: Run = "latest",
    scope: Scope = "editorial",
    source_tiers: SourceTiers = None,
    target_tiers: TargetTiers = None,
    tags: Tags = None,
    placements: Placements = None,
    target_status: TargetStatuses = None,
    source: Annotated[UrlId | None, Query(alias="filter[source]")] = None,
    target: Annotated[UrlId | None, Query(alias="filter[target]")] = None,
    worklist: Annotated[EdgeWorklist | None, Query(alias="filter[worklist]")] = None,
    q_source: PathText = None,
    q_target: PathText = None,
    output: Output = "json",
) -> EdgeRowPage | Response:
    query = EdgeQuery(
        view=LinkScope(scope),
        source_tiers=_tiers(source_tiers),
        target_tiers=_tiers(target_tiers),
        tag_ids=tuple(tags or ()),
        placements=tuple(placements or ()),
        target_status=tuple(target_status or ()),
        source=source,
        target=target,
        worklist=worklist,
        q_source=q_source,
        q_target=q_target,
    )
    if output == "csv":
        return _csv(await reads.edges_csv(access, project_id, run=_run(run), query=query), "links")
    listed = await reads.edges(
        access, project_id, run=_run(run), query=query, cursor=page.cursor, limit=page.limit
    )
    return EdgeRowPage(
        data=listed.rows,
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=listed.next_cursor,
            has_more=listed.next_cursor is not None,
        ),
        meta=ListMeta(
            run_id=listed.run_id,
            scope=scope,
            total=listed.total,
            links_available=not listed.links_dropped,
        ),
    )


@router.get(
    "/neighbors",
    summary="One journey step, links out or links in",
    description="The pages on one side of `url_id` in the scope in view, 8 at a time "
    "(`offset` for more), sorted by tier then link strength, with the link between, "
    "`has_children` and `reciprocal`; `meta.other_scopes` counts the pages of the other "
    "scopes for the group cards. A redirect's one child, links out, is its target. The canvas "
    "decides new pages, back links and pages seen elsewhere itself.",
)
async def neighbors(
    project_id: UUID,
    url_id: UrlIdQuery,
    direction: Annotated[Literal["in", "out"], Query()],
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    scope: Scope = "editorial",
    limit: Annotated[int, Query(ge=1, le=50)] = 8,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> NeighborList:
    found = await reads.neighbors(
        access,
        project_id,
        run=_run(run),
        url_id=url_id,
        direction=direction,
        view=LinkScope(scope),
        limit=limit,
        offset=offset,
    )
    return NeighborList(data=found.rows, meta=found.meta)


@router.get("/tier-flow", summary="Links from tier to tier, and each tier's share")
async def tier_flow(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    scope: Scope = "editorial",
) -> TierFlowResponse:
    flow = await reads.tier_flow(access, project_id, run=_run(run), view=LinkScope(scope))
    return TierFlowResponse(data=flow)


@router.get(
    "/graph",
    summary="The whole crawl as a graph, for the Link map",
    description="Every live page that counts as a node and one edge per page pair that links in "
    "the body (and by auto-generated blocks with `include_auto`). A link to a redirect is a link "
    "to the page it leads to. Menu and footer links are not edges: `sitewide_from` on a node says "
    "how many pages have one, when that is at least half. Over `max_pages` the pages with the "
    "most edges are kept and `truncated` is true.",
)
async def graph(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    include_auto: Annotated[bool, Query()] = False,
    max_pages: Annotated[int, Query(ge=100, le=5_000)] = 3_000,
) -> LinkGraphResponse:
    return LinkGraphResponse(
        data=await reads.graph(
            access, project_id, run=_run(run), include_auto=include_auto, max_pages=max_pages
        )
    )


@router.get("/worklists", summary="Counts of the saved worklists")
async def worklists(
    project_id: UUID, access: ReadData, reads: Reads, run: Run = "latest"
) -> WorklistsResponse:
    return WorklistsResponse(data=await reads.worklists(access, project_id, run=_run(run)))
