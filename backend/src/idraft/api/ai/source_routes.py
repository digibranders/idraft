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
from idraft.api.pagination import Commas, Cursor, Offset
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_sources import (
    CitationPage,
    DomainRole,
    FanoutQueryPage,
    SourceCompare,
    SourceDomainPage,
    SourcePagePage,
    SourceSort,
)
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

COMPARE = (
    " `compare=previous_period` (default `none`) adds `previous` to each row, its units and "
    "citing answers over as many days just before the window (0 when not cited there: docs/16 "
    "C5), with `meta.compare_window` and `meta.previous_answers`."
)


@router.get(
    "/sources/domains",
    summary="Cited sources by registrable domain, with their share of every citation",
    description=SCOPE
    + "One row per registrable domain and role (and the entity whose domain rule matched): "
    "citation units, answers, prompts, units per engine and `source_share` (its units over every "
    "unit in scope; `filter[domain_role_in]` narrows the rows, not the denominator). `meta` "
    "states the answers, the units and the units of each role. Offset pages; `sort` is "
    "`-citation_units` (default), `-observations` or `-prompts`." + COMPARE,
)
async def source_domains(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: Scope,
    page: Offset,
    sort: SourceSort = "-citation_units",
    compare: SourceCompare = "none",
) -> SourceDomainPage:
    return await sources.domains(access, project_id, scope, sort=sort, compare=compare, page=page)


RegistrableDomain = Annotated[
    str | None,
    Query(
        alias="filter[registrable_domain]",
        min_length=1,
        max_length=253,
        description="The sources of one registrable domain, as a domain row names it.",
    ),
]


@router.get(
    "/sources/pages",
    summary="Cited pages, with their share of every citation",
    description=SCOPE
    + "One row per canonical page and role: as the domain rows, plus the URL, host, registrable "
    "domain and a title an answer gave it. `filter[registrable_domain]` keeps one domain's "
    "pages, whose units add up to its row's. Offset pages; the same sorts as the domains."
    + COMPARE,
)
async def source_pages(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: Scope,
    page: Offset,
    registrable_domain: RegistrableDomain = None,
    sort: SourceSort = "-citation_units",
    compare: SourceCompare = "none",
) -> SourcePagePage:
    return await sources.pages(
        access,
        project_id,
        scope,
        registrable_domain=registrable_domain,
        sort=sort,
        compare=compare,
        page=page,
    )


@router.get(
    "/citations",
    summary="The citations behind the source counts, newest answer first",
    description=SCOPE
    + "One row per citation of a counted answer, in the answer's order (a URL listed twice is "
    "two rows and one unit). `filter[registrable_domain]` and `filter[url_id]` give the "
    "citations behind a domain or page row. Keyset pages `(observed_at DESC, observation_id "
    "DESC, citation_index)`; a cursor is bound to its filters (`400 invalid_cursor` otherwise).",
)
async def citation_list(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: Scope,
    page: Cursor,
    registrable_domain: RegistrableDomain = None,
    url_id: Annotated[int | None, Query(alias="filter[url_id]", ge=1, le=2**63 - 1)] = None,
) -> CitationPage:
    return await sources.citations(
        access,
        project_id,
        scope,
        registrable_domain=registrable_domain,
        url_id=url_id,
        page=page,
    )


AnswerScope = Annotated[SourceQuery, Depends(answer_scope)]


@router.get(
    "/fanout-queries",
    summary="The queries ChatGPT issued while answering, by how many answers issued them",
    description=SCOPE
    + "Read from the lists ingest stored with each answer (engines that show them: ChatGPT; "
    "`filter[engine_code_in]` naming another is `422 engine_has_no_fanout`, and "
    "`meta.engines_without_fanout` lists them so they read as not exposed, never zero). One row "
    "per normalized text (lower case, trimmed, inner whitespace as one space) and engine, the "
    "most issued first: the most common spelling, the answers and prompts that issued it, when "
    "it was first and last seen, and the 5 registrable domains with the most citation units in "
    "those answers (an association: which query found which source is not stored). A query "
    "issued by fewer than `min_support` answers (default 2) is left out. `meta.answers` is the "
    "denominator; `meta.answers_truncated` counts the answers whose stored list is shorter than "
    "the queries they issued (the 16 KB bound keeps the first ones). Offset pages.",
)
async def fanout_queries(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: AnswerScope,
    page: Offset,
    min_support: Annotated[
        int, Query(ge=1, le=1000, description="The fewest answers a query is listed for.")
    ] = 2,
) -> FanoutQueryPage:
    return await sources.fanout(access, project_id, scope, min_support=min_support, page=page)
