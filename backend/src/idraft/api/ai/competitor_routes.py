"""Competitor visibility across the project's AI answers (contract C5, docs/ai-visibility/contracts/
c5-competitors.md). Reading needs `data:read`; the membership dependency has already refused a
project outside the caller's scope.

WP-32 (overview-aggregates) builds the bodies; api/main.py includes this router already (docs/
ai-visibility/MASTER-PLAN.md section 3.3). The scope and compare dependencies are the metric
routes' (metrics_routes.py).
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query

from idraft.api.ai.metrics_routes import COMPARE, SCOPE, Compared, EntityIds, ReadData
from idraft.api.pagination import Commas
from idraft.api.schemas.ai_metrics import AiCompetitorsResponse, OverviewCompetitorsResponse
from idraft.api.stubs import not_built, not_built_yet

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(tags=["ai"])

CompetitorInclude = Literal["lost_prompts", "top_sources"]


@router.get(
    f"{PROJECT}/ai/competitors",
    summary="Each tracked entity's mention rate, share of voice and citation share, per engine",
    description=SCOPE
    + "One row per tracked entity (the own entities, then the competitors by name, those tracked "
    "in AI answers, at most 20; `entity_ids` narrows them), each with one entry per engine shown: "
    "Mentioned and Share of voice from the prompts summary's entity cells, citation share (the "
    "entity's citation units over all those of the engine, as the Sources page counts them) and "
    "recommendation (suppressed: `not_classified`). `is_top_competitor` is true on exactly the "
    "competitor with the most share of voice on that engine, and false for every row when no "
    "competitor was named. `include=lost_prompts` adds, per competitor and engine, the prompts "
    "where it is named and the own brand is not (the `lost_to` opportunity of the summary), by "
    "importance, at most `lost_limit`, with `lost_prompts_total` (before the cap) and "
    "`lost_prompts_with_min_answers`; `include=top_sources` adds the domains cited most with the "
    "entity, at most `sources_limit`, over all engines. " + COMPARE,
)
@not_built
async def competitors(
    project_id: UUID,
    access: ReadData,
    query: Compared,
    entity_ids: EntityIds = None,
    include: Annotated[
        list[CompetitorInclude] | None,
        Commas,
        Query(description="Blocks to add: `lost_prompts`, `top_sources`. Left out otherwise."),
    ] = None,
    lost_limit: Annotated[
        int, Query(ge=1, le=10, description="Rows of `lost_prompts` per entity and engine.")
    ] = 5,
    sources_limit: Annotated[
        int, Query(ge=1, le=5, description="Rows of `top_sources` per entity.")
    ] = 3,
) -> AiCompetitorsResponse:
    raise not_built_yet()


@router.get(
    f"{PROJECT}/overview/competitors",
    summary="The AI half of the Overview competitor table",
    description=SCOPE
    + "One row per tracked entity, in the order of `ai/competitors`, each with its share of "
    "voice and its mention rate per engine shown (no citation share, lost prompts or sources). "
    "The SEO share of voice and visibility are declared and left out until they are built. "
    + COMPARE,
)
@not_built
async def overview_competitors(
    project_id: UUID, access: ReadData, query: Compared
) -> OverviewCompetitorsResponse:
    raise not_built_yet()
