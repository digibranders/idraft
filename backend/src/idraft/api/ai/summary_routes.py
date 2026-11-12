"""The prompts summary (spec section 4.5): what the Topics & Prompts page reads."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.ai.summary import SummaryQuery, SummaryService
from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import PromptsSummaryResponse, SummaryInclude
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_summary_service(resources: Annotated[Resources, Depends(get_resources)]) -> SummaryService:
    return resources.ai_summary


Summaries = Annotated[SummaryService, Depends(get_summary_service)]


@router.get(
    "/prompts-summary",
    summary="Mentioned, Cited, outcomes and Share of voice per prompt, engine and topic",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`). Each cell counts valid, current "
    "answers: `numerator` of `denominator`, with `n_observations` every answer of the cell and "
    "`value` null when the denominator is 0. Share of voice is doc 16 section 5 per "
    "observation: the own brand's share of the tracked entities each answer names, over the "
    "answers that name one; the response lists the entity set once. Branded prompts are left "
    "out unless `include_branded` is true; `branded_only` keeps them alone. A prompt of two "
    "topics counts in both; prompts without a topic share a row with `term_id` null. "
    "`filter[country_iso]` keeps the prompts of one market and `filter[term]` the prompts "
    "given the term or one under it; the topic rows then hold only those prompts, and under "
    "`filter[term]` they are the term and the topics below it, with no row for prompts without "
    "a topic. Each row says when its last counted answer and its last valid one came."
    " `include=entities` adds, per engine, a Mentioned and a Share of voice cell for each "
    "tracked entity (the own ones first, at most 20); across all the entities an answer names, "
    "its shares add up to 1.",
)
async def prompts_summary(
    project_id: UUID,
    access: ReadData,
    summaries: Summaries,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[str] | None, Commas, Query(alias="filter[engine_code_in]", max_length=10)
    ] = None,
    include_branded: bool = False,
    branded_only: Annotated[
        bool, Query(description="Only the branded prompts; wins over `include_branded`.")
    ] = False,
    country_iso: Annotated[
        str | None,
        Query(
            alias="filter[country_iso]",
            pattern=r"^[A-Z]{2}$",
            description="The prompts of one market, ISO 3166-1 alpha-2.",
        ),
    ] = None,
    term_id: Annotated[
        UUID | None,
        Query(alias="filter[term]", description="The prompts given the term or one under it."),
    ] = None,
    include: Annotated[
        list[SummaryInclude] | None,
        Commas,
        Query(description="Blocks to add: `entities`."),
    ] = None,
) -> PromptsSummaryResponse:
    return PromptsSummaryResponse(
        data=await summaries.summary(
            access,
            project_id,
            SummaryQuery(
                start=start,
                end=end,
                engine_codes=engine_codes,
                include_branded=include_branded,
                branded_only=branded_only,
                country_iso=country_iso,
                term_id=term_id,
                include=frozenset(include or ()),
            ),
        )
    )
