"""Bodies and answers of the internal link tracker's routes (plan 02, API contract)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    PlainValidator,
    StringConstraints,
    field_validator,
    model_validator,
)

from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import Body, Patch, UserRef, printable, refuse_null
from idraft.api.schemas.metrics import Usd

TierName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=60),
    AfterValidator(printable),
]
TierDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(printable)
]


class TierRef(BaseModel):
    tier_id: UUID
    code: str
    name: str


class PageTier(BaseModel):
    tier_id: UUID
    position: int
    code: str = Field(description="T1 to T8, from the position.")
    name: str
    description: str
    label: str = Field(description='Code and name as filters show it: "T1 Money pages".')
    page_count: int = Field(description="Pages of the workspace's projects on this tier.")
    rule_count: int
    updated_at: datetime


class PageTierList(BaseModel):
    data: list[PageTier]


class PageTierResponse(BaseModel):
    data: PageTier


class PageTierCreate(Body):
    name: TierName
    description: TierDescription = ""


class PageTierPatch(Patch):
    name: TierName | None = None
    description: TierDescription | None = None

    _not_null = field_validator("name", "description")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> PageTierPatch:
        if not self.model_fields_set:
            raise ValueError("give a name or a description")
        return self


StatusClass = Literal["2xx", "3xx", "4xx", "5xx", "blocked"]
PageFlag = Literal[
    "orphan",
    "editorial_orphan",
    "deep_only_through_auto",
    "placement_unknown",
    "has_broken_outlinks",
    "generic_anchors",
]
PageWorklist = Literal[
    "under_linked_t1",
    "orphans",
    "editorial_orphans",
    "deep_only_through_auto",
    "lost_links_top",
    "weak_outlinks",
]
INT64_MAX: Final = 9_223_372_036_854_775_807


def parse_url_id(value: object) -> int:
    """A `core.urls` id from the API: a string of digits (a JSON number loses digits above 2**53
    in a browser), or a whole number from a caller that sends one. Positive and within int64."""
    if isinstance(value, bool):
        raise ValueError("an id is a positive whole number")
    if isinstance(value, str):
        if not (value.isascii() and value.isdigit() and not value.startswith("0")):
            raise ValueError("an id is a positive whole number, sent as a string")
        number = int(value)
    elif isinstance(value, int):
        number = value
    else:
        raise ValueError("an id is a positive whole number, sent as a string")
    if not 0 < number <= INT64_MAX:
        raise ValueError("an id is a positive whole number that fits 64 bits")
    return number


# Requests take the id as a string, like responses give it; the code works with the int.
UrlId = Annotated[int, PlainValidator(parse_url_id, json_schema_input_type=str)]
BULK_IDS_MAX: Final = 5_000
BULK_MATCH_MAX: Final = 20_000
TERMS_MAX: Final = 50
CSV_MAX: Final = 900_000
CSV_ROWS_MAX: Final = 20_000


class PageFilter(Body):
    """The Pages list's filters as a bulk body (`run` is always the latest crawl)."""

    tier_ids: Annotated[list[UUID | Literal["none"]], Field(max_length=9)] | None = None
    tag_ids: Annotated[list[UUID], Field(max_length=TERMS_MAX)] | None = None
    status: Annotated[list[StatusClass], Field(max_length=5)] | None = None
    indexable: bool | None = None
    flags: Annotated[list[PageFlag], Field(max_length=6)] | None = None
    worklist: PageWorklist | None = None
    q: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None


class PageSelection(Body):
    """Exactly one of `url_ids` and `filter`."""

    url_ids: Annotated[list[UrlId], Field(min_length=1, max_length=BULK_IDS_MAX)] | None = None
    filter: PageFilter | None = None

    @model_validator(mode="after")
    def _one_way(self) -> PageSelection:
        if (self.url_ids is None) == (self.filter is None):
            raise ValueError("give exactly one of `url_ids` and `filter`")
        return self


class PageTierSet(PageSelection):
    tier_id: UUID | None = Field(description="null sets the pages to Untiered by hand.")


class BulkResult(BaseModel):
    matched: int = Field(description="Pages of the latest crawl the selection named.")
    changed: int


class BulkResponse(BaseModel):
    data: BulkResult


class TierImportRequest(Body):
    csv: Annotated[str, StringConstraints(min_length=1, max_length=CSV_MAX)] = Field(
        description="Columns `url` and `tier` (a code such as T1, a name, or `none`)."
    )


class ImportPending(BaseModel):
    line: int
    url: str


class ImportProblem(BaseModel):
    line: int
    code: Literal["invalid_url", "other_site", "unknown_tier", "missing_column", "too_many_rows"]
    message: str


class TierImportResult(BaseModel):
    accepted: int
    pending: list[ImportPending] = Field(
        description="Valid rows whose URL the latest crawl did not find; they apply when a "
        "crawl finds it."
    )
    errors: list[ImportProblem]
    applied: bool = Field(description="False while `errors` is not empty: nothing was changed.")


class TierImportResponse(BaseModel):
    data: TierImportResult


MatchTypeName = Literal["exact", "prefix", "pattern"]
RuleValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
RulePosition = Annotated[int, Field(ge=1, le=500)]


class TierRuleView(BaseModel):
    rule_id: UUID
    position: int
    match_type: MatchTypeName
    value: str
    tier: TierRef
    created_at: datetime


class TierRuleList(BaseModel):
    data: list[TierRuleView]


class TierRuleResponse(BaseModel):
    data: TierRuleView


class TierRuleCreate(Body):
    match_type: MatchTypeName
    value: RuleValue
    tier_id: UUID
    position: RulePosition | None = Field(default=None, description="Left out, the rule goes last.")


class TierRulePatch(Patch):
    match_type: MatchTypeName | None = None
    value: RuleValue | None = None
    tier_id: UUID | None = None
    position: RulePosition | None = None

    _not_null = field_validator("match_type", "value", "tier_id", "position")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> TierRulePatch:
        if not self.model_fields_set:
            raise ValueError("give at least one member")
        return self


class TierRulePreviewRequest(Body):
    match_type: MatchTypeName
    value: RuleValue
    position: RulePosition | None = None
    rule_id: UUID | None = Field(default=None, description="The rule being edited, if any.")


class TierRulePreview(BaseModel):
    matching_pages: int = Field(description="Pages of the latest crawl whose path matches.")
    would_apply: int = Field(
        description="Of those, the pages with no manual tier that no earlier rule claims."
    )


class TierRulePreviewResponse(BaseModel):
    data: TierRulePreview


class PageTagChange(PageSelection):
    add: Annotated[list[UUID], Field(max_length=TERMS_MAX)]
    remove: Annotated[list[UUID], Field(max_length=TERMS_MAX)]


class TagChangeResult(BaseModel):
    matched: int
    added: int
    removed: int


class TagChangeResponse(BaseModel):
    data: TagChangeResult


LinkScopeName = Literal["editorial", "auto_generated", "template", "all"]
EdgeScopeName = Literal["editorial", "auto_generated", "template"]
PlacementName = Literal[
    "content", "auto_generated", "navigation", "header", "footer", "sidebar", "breadcrumb"
]
RowFlag = Literal[
    "orphan",
    "editorial_orphan",
    "deep_only_through_auto",
    "placement_unknown",
    "broken",
    "blocked",
    "redirect",
    "non_indexable",
    "generic_anchors",
]
PageSort = Literal[
    "path",
    "-path",
    "click_depth",
    "-click_depth",
    "linking_pages",
    "-linking_pages",
    "outlinks",
    "-outlinks",
    "equity_share",
    "-equity_share",
    "status_code",
    "-status_code",
    "change",
    "-change",
    "rank",
    "-rank",
    "citations",
    "-citations",
    "anchor",
    "-anchor",
    "tier",
    "-tier",
    "clicks",
    "-clicks",
    "title",
    "-title",
    "indexable",
    "-indexable",
    "in_sitemap",
    "-in_sitemap",
]
EdgeWorklist = Literal["broken_and_redirected", "links_to_non_indexable"]
UrlIdText = Annotated[str, Field(description="A `core.urls` id: a 64-bit integer as a string.")]


class PageTagRef(BaseModel):
    term_id: UUID
    name: str


class TierCount(BaseModel):
    tier: TierRef | None = Field(description="null is Untiered.")
    pages: int


class PageChange(BaseModel):
    is_new: bool
    editorial_in_delta: int | None
    equity_points: float | None = Field(
        description="Link strength change in points since the previous crawl."
    )
    depth_state: Literal["lost", "found"] | None
    depth_delta: int | None


class KeywordSummary(BaseModel):
    tracked: int
    ranking: int
    average_rank: float | None
    best_volume: int | None
    rank_as_of: date | None = Field(
        description="The day of the newest check behind these ranks (today's numbers, not the "
        "crawl's day); null when none was checked."
    )


class CitationCounts(BaseModel):
    chatgpt: int
    gemini: int
    ai_mode: int
    total: int
    citations_as_of: date | None = Field(
        description="The day of the project's newest AI answer behind these counts (today's "
        "numbers, not the crawl's day); null when there is none."
    )


class AnchorSummary(BaseModel):
    total: int
    # Null, with `matches_keyword` and `top`, when the crawl's links are gone (410 on the link
    # reads): only the stored counts of the enrichment remain.
    distinct: int | None
    generic: int
    generic_share: float
    matches_keyword: bool | None


class GscPage(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    clicks: int | None = Field(description="Google's clicks for the page, last 28 days.")
    impressions: int | None
    window_start: date | None
    window_end: date | None


class PageExtras(BaseModel):
    change: PageChange | None = None
    keywords: KeywordSummary | None = None
    citations: CitationCounts | None = None
    anchors: AnchorSummary | None = None
    gsc: GscPage | None = None


class KeywordRow(BaseModel):
    keyword: str
    rank: int | None
    change: int | None = Field(description="Places moved since the last check; positive is up.")
    volume: int | None
    rank_as_of: date | None = Field(
        description="The day of the check that gave `rank`; null when it was never checked."
    )


class AnchorText(BaseModel):
    text: str
    count: int
    generic: bool


class AnchorDetail(AnchorSummary):
    top: list[AnchorText] | None


class PageDetailExtras(BaseModel):
    change: PageChange | None
    keywords: list[KeywordRow]
    citations: CitationCounts
    anchors: AnchorDetail
    gsc: GscPage


class PageRow(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    title: str | None
    status_code: int | None
    resource_type: Literal["html", "redirect", "broken", "other"]
    redirect_url: str | None
    is_indexable: bool
    non_indexable_reason: str | None
    canonical_url: str | None
    in_sitemap: bool
    click_depth: int | None
    depth_without_auto: int | None
    equity_share: float | None = Field(
        description="Link strength: the page's share of the whole site's, 0 to 1. Show the "
        "change in points, never this share."
    )
    linking_pages: int = Field(description="Unique pages linking here, in the scope in view.")
    linking_pages_all: int
    outlinks: int = Field(description="Unique pages linked from here, in the scope in view.")
    outlinks_all: int
    linked_from_tiers: list[TierCount]
    outlinks_to_t1: int
    broken_outlinks: int
    redirect_outlinks: int
    non_indexable_outlinks: int
    top_anchor: str | None
    tier: TierRef | None
    tier_source: Literal["manual", "rule"] | None
    tier_rule_id: UUID | None
    tier_set_by: UserRef | None
    tier_set_at: datetime | None
    tags: list[PageTagRef]
    flags: list[RowFlag]
    extras: PageExtras | None = Field(
        default=None, description="Set when the list was asked for `include`."
    )


class ListMeta(BaseModel):
    run_id: UUID
    scope: LinkScopeName
    total: int
    links_available: bool = Field(
        default=True,
        description="False when the crawl's links were dropped: link counts are the stored ones.",
    )


class PageRowPage(BaseModel):
    data: list[PageRow]
    page: CursorPageInfo
    meta: ListMeta


class Neighbor(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    title: str | None
    status_code: int | None = Field(description="null when the page was not crawled.")
    redirect_url_id: UrlIdText | None
    tier: TierRef | None
    click_depth: int | None
    linking_pages: int
    linking_pages_all: int
    equity_share: float | None = Field(
        description="Link strength: the page's share of the whole site's, 0 to 1."
    )
    anchor: str | None
    placement: PlacementName | None
    scope: EdgeScopeName | None
    is_followed: bool
    rel: list[str]
    occurrences: int
    links: int = Field(description="Link rows between the two pages in the scope in view.")
    has_children: bool
    reciprocal: bool = Field(description="The two pages link both ways in the scope in view.")


class ScopeCount(BaseModel):
    scope: EdgeScopeName
    pages: int


class NeighborFocus(BaseModel):
    url_id: UrlIdText
    status_code: int | None
    redirect_url_id: UrlIdText | None


class NeighborMeta(BaseModel):
    run_id: UUID
    url_id: UrlIdText
    direction: Literal["in", "out"]
    scope: LinkScopeName
    total: int
    other_scopes: list[ScopeCount]
    focus: NeighborFocus


class NeighborList(BaseModel):
    data: list[Neighbor]
    meta: NeighborMeta


class PlacementCount(BaseModel):
    placement: PlacementName
    pages: int


class AnchorCount(BaseModel):
    anchor: str
    links: int


class PageDetail(BaseModel):
    page: PageRow
    linking_by_tier: list[TierCount]
    linking_by_placement: list[PlacementCount]
    top_anchors: list[AnchorCount]
    linking_pages: list[Neighbor]
    outlinks: list[Neighbor]
    linking_pages_total: int
    outlinks_total: int
    links_available: bool = Field(
        description="False when retention dropped the crawl's links: the link lists and "
        "counts are then empty, not zero."
    )
    extras: PageDetailExtras


class PageDetailResponse(BaseModel):
    data: PageDetail


class EdgePage(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    tier: TierRef | None
    status_code: int | None
    redirect_url: str | None
    is_indexable: bool | None


class EdgeRow(BaseModel):
    link_id: UrlIdText
    source: EdgePage
    target: EdgePage
    anchor: str
    kind: Literal["text", "image"]
    placement: PlacementName
    scope: EdgeScopeName
    rel: list[str]
    is_followed: bool
    occurrences: int


class EdgeRowPage(BaseModel):
    data: list[EdgeRow]
    page: CursorPageInfo
    meta: ListMeta


class TierFlowCell(BaseModel):
    from_tier: TierRef | None
    to_tier: TierRef | None
    links: int


class TierStat(BaseModel):
    tier: TierRef | None
    pages: int
    equity_share: float = Field(
        description="Link strength of the tier: its pages' share of the whole site's, 0 to 1."
    )
    average_depth: float | None


class TierFlow(BaseModel):
    run_id: UUID
    scope: LinkScopeName
    stale: bool = Field(description="A tier change is being applied; read again in a minute.")
    cells: list[TierFlowCell]
    tiers: list[TierStat]


class TierFlowResponse(BaseModel):
    data: TierFlow


class Worklists(BaseModel):
    run_id: UUID
    under_linked_t1: int
    orphans: int
    editorial_orphans: int
    deep_only_through_auto: int
    lost_links_top: int = Field(description="Pages that lost an editorial link and are important.")
    weak_outlinks: int = Field(description="T1 pages that mostly link to weak targets.")
    broken_and_redirected: int = Field(description="Links of every scope.")
    links_to_non_indexable: int = Field(description="Links of every scope.")
    may_be_incomplete: bool = Field(
        description="True when pages refused the crawler: the links of those pages were not read, "
        "so under_linked_t1, orphans, editorial_orphans, deep_only_through_auto and "
        "weak_outlinks may count pages that are linked from a page we could not see."
    )


class WorklistsResponse(BaseModel):
    data: Worklists


CrawlState = Literal[
    "queued", "crawling", "processing", "ready", "stopped_at_ceiling", "failed", "cancelled"
]
CrawlTrigger = Literal["website_added", "schedule", "manual", "ceiling_retry"]


class CrawlRun(BaseModel):
    run_id: UUID
    trigger: CrawlTrigger
    state: CrawlState
    ceiling: int = Field(description="The safety stop: the crawl ends at this many pages.")
    pages_found: int = Field(description="Crawled and still queued, while it runs.")
    pages_crawled: int
    sitemap_pages: int | None
    pages_blocked: int | None = Field(
        description="Pages that refused the crawler (401, 403, 429): unknown, not broken. "
        "null for a crawl that was not counted."
    )
    render_javascript: bool
    estimated_cost_usd: Usd | None
    cost_usd: Usd | None
    stop_reason: str | None
    error_code: str | None
    error_message: str | None
    hints: list[Literal["render_javascript"]]
    is_latest: bool = Field(description="The crawl `run=latest` reads.")
    links_available: bool = Field(
        description="False once the crawl's links were dropped (past the last four finished "
        "crawls): its pages stay, links, journeys and changes of links are gone."
    )
    previous_run_id: UUID | None = Field(description="The crawl its changes are measured against.")
    enrich_state: Literal["pending", "running", "done", "failed"] = Field(
        description="State of the second job: changes, anchors and mentions."
    )
    created_at: datetime
    submitted_at: datetime | None
    finished_at: datetime | None
    requested_by: UserRef | None


class CrawlRunPage(BaseModel):
    data: list[CrawlRun]
    page: CursorPageInfo


class CrawlRunResponse(BaseModel):
    data: CrawlRun


class CrawlCreate(Body):
    higher_limit: bool = Field(
        default=False,
        description="Crawl again with a higher limit after a crawl stopped at its ceiling.",
    )
