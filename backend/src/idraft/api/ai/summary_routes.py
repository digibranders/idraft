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
from idraft.api.schemas.ai import (
    OPPORTUNITY_PATTERN,
    Outcome,
    PromptsSummaryResponse,
    SummaryCompare,
    SummaryGroupBy,
    SummaryInclude,
    SummaryRows,
)
from idraft.api.stubs import refuse_unbuilt
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
    " `include=series` adds a point for each week the window touches (weeks start on Monday in "
    "the project's timezone), with Mentioned, Cited and Share of voice over the week's "
    "answers. The first and last points may be partial weeks (cut at the window bounds; the "
    "first `week_start` can precede `window.from`). On a prompt row the weeks' numerators, "
    "denominators and n_observations add up to the window cell. On a topic row the weekly "
    "Mentioned and Cited are prompt weighted per week, so their numerators and denominators "
    "(sums of per-week prompt rates and prompt counts) do not add up to the window cell, while "
    "`pooled`, Share of voice and n_observations do. `include=entities` adds, per engine, a "
    "Mentioned and a Share of voice cell for each tracked entity (the own ones first, at most "
    "20); across all the entities an answer names, its shares add up to 1. "
    "`compare=previous_period` (as many days just before the window), `compare=previous_year` "
    "(the same dates a year earlier; 29 February becomes the 28th) or `compare_from` with "
    "`compare_to` (both or neither, at most 92 days, any position; they win over `compare`) add "
    "`compare_window` and `previous_answers` (the valid answers in scope there), and `previous` "
    "beside each engine's cells, and beside each entity's with `include=entities`: null when "
    "none of the row's prompts has an answer of the engine in that window, cells with a "
    "denominator of 0 when it has answers and none valid. Blocks not asked for are left out. "
    "`include=total`, `include=co_mentions`, `rows`, `filter[outcome]`, `filter[opportunity]` "
    "and `group_by` are published and not built yet (`501`).",
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
        Query(
            description="Blocks to add: `series`, `entities`; `total` and `co_mentions` are not "
            "built yet (`501`)."
        ),
    ] = None,
    compare: Annotated[
        SummaryCompare,
        Query(
            description="`previous_period`: as many days just before the window; "
            "`previous_year`: the same dates a year earlier. Adds `compare_window`, "
            "`previous_answers` and `previous` cells."
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
    rows: Annotated[
        SummaryRows | None,
        Query(
            description="`topics` leaves the prompt rows out, `none` both row lists (with "
            "`include=total`). Left out: every row. Not built yet: `501`."
        ),
    ] = None,
    outcome: Annotated[
        Outcome | None,
        Query(alias="filter[outcome]", description="Prompt rows by outcome. Not built yet: `501`."),
    ] = None,
    opportunity: Annotated[
        str | None,
        Query(
            alias="filter[opportunity]",
            pattern=OPPORTUNITY_PATTERN,
            description="`named_not_cited`, `cited_not_named`, `nobody_named` or "
            "`lost_to:<entity_id>`. Not built yet: `501`.",
        ),
    ] = None,
    group_by: Annotated[
        SummaryGroupBy | None,
        Query(description="`country` adds `by_country`. Not built yet: `501`."),
    ] = None,
) -> PromptsSummaryResponse:
    asked = frozenset(include or ())
    refuse_unbuilt(
        {
            "include=total": "total" in asked,
            "include=co_mentions": "co_mentions" in asked,
            "rows": rows is not None,
            "filter[outcome]": outcome is not None,
            "filter[opportunity]": opportunity is not None,
            "group_by": group_by is not None,
        }
    )
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
                include=asked,
                compare=compare,
                compare_from=compare_from,
                compare_to=compare_to,
            ),
        )
    )
