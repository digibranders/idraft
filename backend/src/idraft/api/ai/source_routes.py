"""Cited sources of the project's AI answers (docs/19 section 3.7.7, cut to slice 1; plan D2).
Reading needs `data:read`; the membership dependency has already refused a project outside the
caller's scope."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.ai.sources import SourceQuery, SourceService
from idraft.api.pagination import Commas, Offset
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_sources import DomainRole, SourceDomainPage, SourceSort
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_source_service(resources: Annotated[Resources, Depends(get_resources)]) -> SourceService:
    return resources.ai_sources


Sources = Annotated[SourceService, Depends(get_source_service)]


def answer_scope(
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
    prompt_id: Annotated[
        UUID | None,
        Query(
            alias="filter[prompt_id]",
            description="One prompt's answers, whether it is active, archived or branded.",
        ),
    ] = None,
    term_id: Annotated[
        UUID | None,
        Query(alias="filter[term]", description="The prompts given the term or one under it."),
    ] = None,
    include_branded: bool = False,
) -> SourceQuery:
    """Which answers a read counts: the scope every route here shares."""
    return SourceQuery(
        start=start,
        end=end,
        engine_codes=engine_codes,
        include_branded=include_branded,
        prompt_id=prompt_id,
        term_id=term_id,
    )


def source_query(
    scope: Annotated[SourceQuery, Depends(answer_scope)],
    roles: Annotated[
        list[DomainRole] | None, Commas, Query(alias="filter[domain_role_in]", max_length=3)
    ] = None,
) -> SourceQuery:
    return replace(scope, roles=roles)


Scope = Annotated[SourceQuery, Depends(source_query)]

SCOPE = (
    "Over `from` to `to`, project-local days both included (default the 28 days ending today; "
    "at most 92, `422 window_too_large`). The answers the prompts summary counts: valid, "
    "current and not superseded, of the active prompts, branded ones only with "
    "`include_branded`; `filter[prompt_id]` reads one prompt's answers whatever its state, and "
    "`filter[term]` the prompts given the term or one under it. A citation unit is a distinct "
    "canonical URL per answer (docs/16 C2). Aggregated by query over `ai.citations` (no rollup "
    "table: a 28 day window of a full project is about 3,600 answers). "
)


@router.get(
    "/sources/domains",
    summary="Cited sources by registrable domain, with their share of every citation",
    description=SCOPE
    + "One row per registrable domain and role (and the entity whose domain rule matched): "
    "citation units, answers, prompts, units per engine and `source_share` (its units over every "
    "unit in scope; `filter[domain_role_in]` narrows the rows, not the denominator). `meta` "
    "states the answers, the units and the units of each role. Offset pages; `sort` is "
    "`-citation_units` (default), `-observations` or `-prompts`.",
)
async def source_domains(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: Scope,
    page: Offset,
    sort: SourceSort = "-citation_units",
) -> SourceDomainPage:
    return await sources.domains(access, project_id, scope, sort=sort, page=page)
