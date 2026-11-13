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
    "answers. The first and last weeks may be partial (cut at the window bounds; the first "
    "`week_start` can precede `window.from`). A point of a prompt row always holds the "
    "trailing four weeks to its week, and one of a topic, total or country row does when fewer "
    "than 10 of its prompts answered that week (`is_pooled`, `pool`, `prompts`): a pooled "
    "point never reaches outside the window, so the first points hold fewer weeks, and the "
    "points of a prompt row do not add up to its window cell. `include=entities` adds, per "
    "engine, a "
    "Mentioned and a Share of voice cell for each tracked entity (the own ones first, at most "
    "20); across all the entities an answer names, its shares add up to 1. With `include=series` "
    "too, each point also holds those cells over the very weeks the point holds (its own "
    "week, or the weeks it pools), as `entities`, without `previous`. "
    "`compare=previous_period` (as many days just before the window), `compare=previous_year` "
    "(the same dates a year earlier; 29 February becomes the 28th) or `compare_from` with "
    "`compare_to` (both or neither, at most 92 days, any position; they win over `compare`) add "
    "`compare_window` and `previous_answers` (the valid answers in scope there), and `previous` "
    "beside each engine's cells, and beside each entity's with `include=entities`: null when "
    "none of the row's prompts has an answer of the engine in that window, cells with a "
    "denominator of 0 when it has answers and none valid. `include=total` adds `total`: every "
    "prompt in scope as one row, aggregated as a topic row is, with the `previous`, `series` and "
    "`entities` blocks when asked. `rows=topics` leaves the prompt rows out and `rows=none` both "
    "row lists; `total` does not depend on `rows`. `include=co_mentions` adds `co_mentions`: "
    "per engine shown, the valid answers in scope and, for each pair of the tracked entities "
    "(the own ones first, at most 20) named in the same valid answer, how many answers name "
    "both; it does not depend on `rows`. Blocks not asked for are left out. "
    "`filter[outcome]=O` keeps a prompt row when at least one of its valid answers in the window, "
    "on the engines shown, had outcome O; `filter[opportunity]` keeps it by the same rule: "
    "`named_not_cited` is outcome `mentioned_only`, `cited_not_named` is `cited_only`, "
    "`nobody_named` is no tracked entity named, `lost_to:<entity_id>` is that competitor named "
    "and the own brand not (an id that is not a competitor of the project keeps no row and is "
    "not an error). With both, a row must pass each. They narrow `prompts` only: cells, topic "
    "rows, `total`, `co_mentions` and `prompt_count` still count every prompt in scope. "
    "`group_by=country` adds `by_country`: one entry per market of the prompts in scope (the "
    "prompt's own, sorted by code), with the engines built as a topic row of those prompts and "
    "the blocks the rows carry when asked; a prompt without a market is in no entry, and the "
    "block does not depend on `rows`, the outcome or opportunity filters.",
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
        Query(description="Blocks to add: `series`, `entities`, `total`, `co_mentions`."),
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
            "`include=total`). Left out: every row. `total`, `co_mentions` and `by_country` do "
            "not depend on it."
        ),
    ] = None,
    outcome: Annotated[
        Outcome | None,
        Query(
            alias="filter[outcome]",
            description="Prompt rows with at least one valid answer of this outcome, on the "
            "engines shown. Narrows `prompts` only.",
        ),
    ] = None,
    opportunity: Annotated[
        str | None,
        Query(
            alias="filter[opportunity]",
            pattern=OPPORTUNITY_PATTERN,
            description="Prompt rows with at least one valid answer that is `named_not_cited`, "
            "`cited_not_named`, `nobody_named` or `lost_to:<entity_id>` (a competitor named, the "
            "own brand not), on the engines shown. Narrows `prompts` only.",
        ),
    ] = None,
    group_by: Annotated[
        SummaryGroupBy | None,
        Query(
            description="`country` adds `by_country`. `language` is not built (the language half "
            "of BE-METRICS-22 is not in contract C2): `422`, as any other value."
        ),
    ] = None,
) -> PromptsSummaryResponse:
    asked = frozenset(include or ())
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
                rows=rows,
                outcome=outcome,
                opportunity=opportunity,
                group_by=group_by,
            ),
        )
    )
