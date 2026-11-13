"""Cited sources of the project's AI answers (docs/19 section 3.7.7, cut to slice 1; plan D2).
Reading needs `data:read`; the membership dependency has already refused a project outside the
caller's scope."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from pydantic import AfterValidator

from idraft.api.ai.sources import SourceQuery, SourceService
from idraft.api.pagination import Commas, Cursor, Offset
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_sources import (
    CitationPage,
    DiversityInclude,
    DomainRole,
    FanoutInclude,
    FanoutQueryPage,
    PromptOwnPagesPage,
    SourceChangeKind,
    SourceChangePage,
    SourceCompare,
    SourceDiversity,
    SourceDomainDetail,
    SourceDomainInclude,
    SourceDomainPage,
    SourcePageInclude,
    SourcePagePage,
    SourceSort,
)
from idraft.api.schemas.common import printable
from idraft.api.stubs import refuse_unbuilt
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

_NOT_BUILT = "Not built yet: `501 not_implemented`."

CountryFilter = Annotated[
    str | None,
    Query(
        alias="filter[country_iso]",
        pattern=r"^[A-Z]{2}$",
        description="The answers of the prompts of one market, ISO 3166-1 alpha-2 in capitals; "
        "prompts with no market are left out. Also narrows `meta` and every share.",
    ),
]
MinSupport = Annotated[
    int | None,
    Query(
        ge=1,
        le=1000,
        description="The fewest citation units in the window a row is listed for (docs/16 C5). "
        "Rows with fewer are left out of the rows and of `page.total`; `meta` and every share "
        "still count them.",
    ),
]

AnswerScope = Annotated[SourceQuery, Depends(answer_scope)]

_UNRESOLVED = (
    "Count the citations flagged `unresolved_redirect` (a redirect link that was not resolved to "
    "its target, such as Gemini's grounding links), which are left out by default (docs/14 "
    "section 9). " + _NOT_BUILT
)
_INTERNAL = (
    "Count the citations flagged `engine_internal` (links into the engine's own product), which "
    "are left out by default (docs/14 section 9). " + _NOT_BUILT
)


def flag_toggles(
    include_unresolved_redirects: Annotated[bool, Query(description=_UNRESOLVED)] = False,
    include_engine_internal: Annotated[bool, Query(description=_INTERNAL)] = False,
) -> tuple[str, ...]:
    """The citation flags a read leaves out (docs/14 section 9)."""
    return tuple(
        flag
        for flag, counted in (
            ("engine_internal", include_engine_internal),
            ("unresolved_redirect", include_unresolved_redirects),
        )
        if not counted
    )


Flags = Annotated[tuple[str, ...], Depends(flag_toggles)]


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
    flags: Flags,
    sort: SourceSort = "-citation_units",
    compare: SourceCompare = "none",
    include: Annotated[
        list[SourceDomainInclude] | None,
        Commas,
        Query(
            max_length=3,
            description="Blocks to add: `series` (a point per week of the window), "
            "`cited_with` (on each row, the tracked entity named in the most answers that cite "
            "it, ties by entity id; absent when none is named) and `by_role_by_engine` "
            "(`meta`: per engine the units and citing answers of each role, whatever "
            "`filter[domain_role_in]` says).",
        ),
    ] = None,
    min_support: MinSupport = None,
    country_iso: CountryFilter = None,
) -> SourceDomainPage:
    refuse_unbuilt(
        {
            "include_unresolved_redirects": "unresolved_redirect" not in flags,
            "include_engine_internal": "engine_internal" not in flags,
        }
    )
    return await sources.domains(
        access,
        project_id,
        replace(scope, country_iso=country_iso),
        sort=sort,
        compare=compare,
        include=include or (),
        min_support=min_support,
        page=page,
    )


# A control character (NUL included) would reach the database as text and answer 500.
DomainText = Annotated[str, AfterValidator(printable)]

RegistrableDomain = Annotated[
    DomainText | None,
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
    flags: Flags,
    registrable_domain: RegistrableDomain = None,
    sort: SourceSort = "-citation_units",
    compare: SourceCompare = "none",
    include: Annotated[
        list[SourcePageInclude] | None,
        Commas,
        Query(
            max_length=1,
            description="Blocks to add: `series` (a point per week of the window, and "
            "`meta.series`).",
        ),
    ] = None,
    min_support: MinSupport = None,
    country_iso: CountryFilter = None,
) -> SourcePagePage:
    refuse_unbuilt(
        {
            "include_unresolved_redirects": "unresolved_redirect" not in flags,
            "include_engine_internal": "engine_internal" not in flags,
        }
    )
    return await sources.pages(
        access,
        project_id,
        replace(scope, country_iso=country_iso),
        registrable_domain=registrable_domain,
        sort=sort,
        compare=compare,
        include=include or (),
        min_support=min_support,
        page=page,
    )


@router.get(
    "/sources/changes",
    summary="New and lost sources against the window before",
    description=SCOPE
    + "`kind=new` (default): domains with at least `min_support` citation units in the window "
    "and none in as many days before (docs/16 C5). `kind=lost` (docs/16 C6): domains with at "
    "least `min_support` units in a support window and none in each of the 2 windows after it. "
    "The windows are as long as the asked one: for `lost`, `meta.window` is the asked window "
    "and the one before it (the 2 empty windows) and `meta.compare_window` the support window "
    "before those, so a 92 day ask reads 276 days; for `new`, `meta.window` is the asked "
    "window and `meta.compare_window` the one before. `min_support` (default 2) counts "
    "citation units. `current_units` and `previous_units` are the units in `meta.window` and "
    "`meta.compare_window`; `first_seen_at` and `last_seen_at` are in `meta.window` (null for "
    "`lost`). One row per registrable domain and role (and entity), the most units first; "
    "offset pages.",
)
async def source_changes(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: Scope,
    page: Offset,
    flags: Flags,
    kind: SourceChangeKind = "new",
    min_support: Annotated[int, Query(ge=1, le=1000)] = 2,
    country_iso: CountryFilter = None,
) -> SourceChangePage:
    refuse_unbuilt(
        {
            "include_unresolved_redirects": "unresolved_redirect" not in flags,
            "include_engine_internal": "engine_internal" not in flags,
        }
    )
    return await sources.changes(
        access,
        project_id,
        replace(scope, country_iso=country_iso),
        kind=kind,
        min_support=min_support,
        page=page,
    )


@router.get(
    "/sources/diversity",
    summary="Source diversity per engine",
    description=SCOPE
    + "Per engine: the valid answers, the answers that cite a source, the citation units, the "
    "registrable domains cited (roles merged) and the effective number of sources (docs/16 C3: "
    "1 over the sum of squared source shares, with its numerator and denominator visible). "
    "Engines are never pooled: `meta.distinct_domains` is a count over every engine in scope "
    "and `meta.effective_sources_engine_average` the equal-weight mean of the engines with "
    "units. `include=series` adds a weekly point per engine and `include=ads` the answers that "
    "showed an ad.",
)
async def source_diversity(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: AnswerScope,
    flags: Flags,
    include: Annotated[
        list[DiversityInclude] | None,
        Commas,
        Query(
            max_length=2,
            description="Blocks to add to each engine: `series` (a weekly point) and `ads` (the "
            "answers that showed an ad). Default none.",
        ),
    ] = None,
    country_iso: CountryFilter = None,
) -> SourceDiversity:
    refuse_unbuilt(
        {
            "include_unresolved_redirects": "unresolved_redirect" not in flags,
            "include_engine_internal": "engine_internal" not in flags,
        }
    )
    return await sources.diversity(
        access, project_id, replace(scope, country_iso=country_iso), include=include or ()
    )


@router.get(
    "/sources/domains/{registrable_domain}",
    summary="One cited domain",
    description=SCOPE
    + "One registrable domain as the domain list names it: its rows (one per role and entity, "
    "at most 10), its units per engine and week, its 10 most cited pages, the 20 prompts "
    "whose answers cite it most and the 5 tracked entities named most in those answers. A "
    "domain that is not cited in scope answers `200` with empty lists; the name is read in "
    "lower case.",
)
async def source_domain(
    project_id: UUID,
    registrable_domain: Annotated[DomainText, Path(min_length=1, max_length=253)],
    access: ReadData,
    sources: Sources,
    scope: AnswerScope,
    flags: Flags,
    country_iso: CountryFilter = None,
) -> SourceDomainDetail:
    refuse_unbuilt(
        {
            "include_unresolved_redirects": "unresolved_redirect" not in flags,
            "include_engine_internal": "engine_internal" not in flags,
        }
    )
    return await sources.domain(
        access, project_id, replace(scope, country_iso=country_iso), registrable_domain
    )


@router.get(
    "/sources/prompts",
    summary="Each prompt's own pages, per engine",
    description=SCOPE
    + "One row per prompt and engine with a counted answer: the valid answers, the answers "
    "that cite an own page, the own citation units, the distinct own pages and the one with "
    "the most units. `filter[own_cited]=false` keeps the prompts whose answers cite no own page. "
    "Keyset pages `(prompt_id, engine_code)`; a cursor is bound to its filters (`400 "
    "invalid_cursor` otherwise). An engine with no counted answer of a prompt has no row.",
)
async def source_prompts(
    project_id: UUID,
    access: ReadData,
    sources: Sources,
    scope: AnswerScope,
    page: Cursor,
    flags: Flags,
    own_cited: Annotated[
        bool | None,
        Query(
            alias="filter[own_cited]",
            description="`false` keeps the prompt and engine pairs whose answers cite no own page; "
            "`true` those that cite one. Default: both.",
        ),
    ] = None,
    country_iso: CountryFilter = None,
) -> PromptOwnPagesPage:
    refuse_unbuilt(
        {
            "include_unresolved_redirects": "unresolved_redirect" not in flags,
            "include_engine_internal": "engine_internal" not in flags,
        }
    )
    return await sources.prompts(
        access, project_id, replace(scope, country_iso=country_iso), own_cited=own_cited, page=page
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
    country_iso: CountryFilter = None,
) -> CitationPage:
    return await sources.citations(
        access,
        project_id,
        replace(scope, country_iso=country_iso),
        registrable_domain=registrable_domain,
        url_id=url_id,
        page=page,
    )


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
    include: Annotated[
        list[FanoutInclude] | None,
        Commas,
        Query(max_length=1, description="Blocks to add: `topics`. " + _NOT_BUILT),
    ] = None,
    country_iso: CountryFilter = None,
) -> FanoutQueryPage:
    refuse_unbuilt({"include": bool(include)})
    return await sources.fanout(
        access,
        project_id,
        replace(scope, country_iso=country_iso),
        min_support=min_support,
        page=page,
    )
