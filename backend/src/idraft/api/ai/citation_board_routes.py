"""The Citations page (WP-76; the design preview's #/citations). Reading needs `data:read`."""

from __future__ import annotations

from dataclasses import replace
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from pydantic import AfterValidator

from idraft.api.ai.citation_board import BoardQuery, CitationBoardService
from idraft.api.ai.source_routes import PROJECT, Flags, ReadData
from idraft.api.pagination import Commas, Offset
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_citation_board import (
    CitationGapDetail,
    CitationGapList,
    CitationOverview,
    CitedPageDetail,
    CitedPagePage,
    CitedPageSort,
)
from idraft.api.schemas.ai_sources import DomainRole
from idraft.api.schemas.common import printable
from idraft.domain.ai_engines import EngineCode

router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])


def get_board(resources: Annotated[Resources, Depends(get_resources)]) -> CitationBoardService:
    return resources.ai_citation_board


Board = Annotated[CitationBoardService, Depends(get_board)]


def _run_choice(value: int) -> int:
    if value not in (1, 2, 4):
        raise ValueError("runs is 1, 2 or 4")
    return value


def board_query(
    flags: Flags,
    runs: Annotated[
        int,
        AfterValidator(_run_choice),
        Query(description="Each prompt and engine's last 1, 2 or 4 runs."),
    ] = 4,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
    term_id: Annotated[
        UUID | None,
        Query(alias="filter[term]", description="The prompts given the term or one under it."),
    ] = None,
    include_branded: bool = False,
) -> BoardQuery:
    return BoardQuery(
        runs=runs,
        engine_codes=engine_codes,
        term_id=term_id,
        include_branded=include_branded,
        excluded_flags=flags,
    )


Scope = Annotated[BoardQuery, Depends(board_query)]
Competitors = Annotated[
    list[UUID],
    Commas,
    Query(
        alias="filter[competitor_id_in]",
        min_length=1,
        max_length=5,
        description="Up to five tracked competitors, the columns of the gap analysis.",
    ),
]

WINDOW = (
    "Counts each prompt and engine's last `runs` collection runs with a counted answer (slots 1 "
    "to `runs`) against the `runs` before them, over at most 183 days. A citation unit is a "
    "distinct canonical URL per answer (docs/16 C2); flagged citations are left out unless asked "
    "for. The answers are those of the sources routes: valid, current, not superseded, of the "
    "active non-branded prompts unless `include_branded`. "
)


def with_competitors(query: BoardQuery, competitors: list[UUID]) -> BoardQuery:
    """The query with its selected competitors; a repeated id is one column, the order is kept."""
    return replace(query, competitor_ids=tuple(dict.fromkeys(competitors)))


@router.get(
    "/citation-overview",
    summary="The six citation measures of the Citations page",
    description=WINDOW,
)
async def citation_overview(
    project_id: UUID, access: ReadData, board: Board, query: Scope
) -> CitationOverview:
    return await board.overview(access, project_id, query)


@router.get(
    "/cited-pages",
    summary="Pages cited in AI answers, with the prompts behind each",
    description=WINDOW
    + "Offset pages. `meta.owners` counts the pages of each role whatever the filter and `q`.",
)
async def cited_pages(
    project_id: UUID,
    access: ReadData,
    board: Board,
    query: Scope,
    page: Offset,
    role: Annotated[DomainRole | None, Query(alias="filter[domain_role_in]")] = None,
    q: Annotated[Annotated[str, AfterValidator(printable)] | None, Query(max_length=200)] = None,
    sort: CitedPageSort = "-citations",
) -> CitedPagePage:
    return await board.pages(access, project_id, query, role=role, q=q, sort=sort, page=page)


@router.get(
    "/cited-pages/{url_id}",
    summary="One cited page: its prompts, platforms and the domains cited beside it",
    description=WINDOW,
)
async def cited_page(
    project_id: UUID,
    access: ReadData,
    board: Board,
    query: Scope,
    url_id: Annotated[int, Path(ge=1)],
) -> CitedPageDetail:
    return await board.page_detail(access, project_id, query, url_id)


@router.get(
    "/citation-gaps",
    summary="Citation gap analysis: you and up to five competitors per prompt",
    description=WINDOW
    + "A prompt is lost on an engine where a selected competitor is cited and you are not.",
)
async def citation_gaps(
    project_id: UUID, access: ReadData, board: Board, query: Scope, competitors: Competitors
) -> CitationGapList:
    return await board.gaps(access, project_id, with_competitors(query, competitors))


@router.get(
    "/citation-gaps/{prompt_id}",
    summary="One prompt of the gap analysis",
    description=WINDOW,
)
async def citation_gap(
    project_id: UUID,
    access: ReadData,
    board: Board,
    query: Scope,
    competitors: Competitors,
    prompt_id: UUID,
) -> CitationGapDetail:
    return await board.gap_detail(
        access, project_id, with_competitors(query, competitors), prompt_id
    )
