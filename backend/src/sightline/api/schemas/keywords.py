"""Bodies of the keyword routes (docs/19-api-specification.md sections 3.6.1 and 3.6.2).

Rank fields of a tracked keyword row (`state`, `sparkline`, competitor ranks, `aio`) arrive with
rank collection; until then a row carries its configuration and, when asked, its metrics,
groups, terms and competitor overrides.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError

from sightline.api.pagination import CursorPageInfo
from sightline.api.schemas.common import (
    Body,
    LanguageCode,
    LocationRef,
    Patch,
    QueryText,
    UserRef,
    printable,
    refuse_null,
)
from sightline.api.schemas.entities import EntityRef
from sightline.api.schemas.metrics import MetricValue, Usd
from sightline.ranks.depth import UNAVAILABLE

DepthProfile = Literal[
    "light", "standard", "deep", "full", "weekly", "weekly_light", "until_own_match_100"
]


def _offered(profile: DepthProfile) -> DepthProfile:
    """`until_own_match_100` needs `stop_crawl_on_match`, which the adapter does not send yet
    (docs/06 section 2.3): no rank check would be planned for it, so it is refused when set."""
    if profile in UNAVAILABLE:
        raise PydanticCustomError(
            "depth_profile_not_available",
            "The depth profile `{profile}` is not offered yet.",
            {"profile": profile},
        )
    return profile


# The profiles a request may set; what is stored and returned may be any.
OfferedDepthProfile = Annotated[DepthProfile, AfterValidator(_offered)]
Intent = Literal["informational", "navigational", "commercial", "transactional", "local", "unknown"]
FunnelStage = Literal["tofu", "mofu", "bofu", "retention", "unknown"]
Os = Literal["windows", "macos", "android", "ios"]
Frequency = Literal["daily", "weekly", "custom"]
DeviceChoice = Literal["desktop", "mobile", "both"]
Device = Literal["desktop", "mobile"]
KeywordSource = Literal["manual", "csv_import", "api", "gsc_import", "discovery", "bulk_paste"]

BULK_CREATE_MAX = 1000
BULK_IDS_MAX = 5000
LINKS_MAX = 100
TARGET_URL_MAX = 2048
CHANGE_REASON_MAX = 500
GROUP_NAME_MAX = 100
IDENTITY_FIELDS = ("keyword", "search_engine", "location_id", "language_code", "device", "os")

# The keyword rules (`sightline.keywords.text`) judge the text and give the specific codes
# (`keyword_invalid`, `keyword_missing`, `keyword_too_long`, `search_operator_not_allowed`);
# this only bounds the body.
KeywordText = Annotated[str, StringConstraints(min_length=1, max_length=2000)]
TargetUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=TARGET_URL_MAX),
    AfterValidator(printable),
]
BusinessValue = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Priority = Annotated[int, Field(ge=1, le=5)]
Links = Annotated[list[UUID], Field(max_length=LINKS_MAX)]
# A filter's list of values: one at least, so an empty list never reads as "no filter".
type FilterList[T] = Annotated[list[T], Field(min_length=1, max_length=LINKS_MAX)]


def _no_slash(name: str) -> str:
    """A group's path joins names with `/`, so a name holds none."""
    if "/" in name:
        raise PydanticCustomError("slash_not_allowed", "A group name cannot hold `/`.")
    return name


GroupName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=GROUP_NAME_MAX),
    AfterValidator(printable),
    AfterValidator(_no_slash),
]


class CompetitorOverrides(Body):
    """Entities with a project role added to, or taken from, the project's competitor set for
    one keyword."""

    include: Links = Field(default_factory=list)
    exclude: Links = Field(default_factory=list)

    @model_validator(mode="after")
    def _apart(self) -> CompetitorOverrides:
        if set(self.include) & set(self.exclude):
            raise ValueError("an entity is either included or excluded, not both")
        return self


class TrackedKeywordCreate(Body):
    """Defaults come from the project: its location and language, and its settings
    (`seo.default_device`, `default_depth_profile`, `default_frequency`)."""

    keyword: KeywordText
    location_id: int | None = None
    language_code: LanguageCode | None = None
    device: DeviceChoice | None = Field(default=None, description="`both` makes two rows.")
    search_engine: Literal["google"] = Field(
        default="google", description="Bing arrives with its collection."
    )
    os: Os | None = None
    depth_profile: OfferedDepthProfile | None = None
    target_url: TargetUrl | None = None
    intent: Intent | None = Field(default=None, description="Given: `intent_source` is `manual`.")
    funnel_stage: FunnelStage = "unknown"
    priority: Priority = 3
    business_value: BusinessValue | None = None
    frequency: Frequency | None = None
    schedule_id: UUID | None = None
    group_ids: Links = Field(default_factory=list)
    term_ids: Links = Field(default_factory=list)
    competitor_overrides: CompetitorOverrides | None = None


class TrackedKeywordBulkCreate(Body):
    items: Annotated[list[TrackedKeywordCreate], Field(min_length=1, max_length=BULK_CREATE_MAX)]
    on_duplicate: Literal["skip", "merge_terms"] = Field(
        default="skip",
        description="`merge_terms` adds the item's groups and terms to the tracked keyword it "
        "duplicates.",
    )


class TrackedKeywordPatch(Patch):
    """At least one member. `depth_profile` or `target_url` makes a new configuration version
    (`config_version`) with a history row; identity fields cannot change."""

    depth_profile: OfferedDepthProfile | None = None
    target_url: TargetUrl | None = None
    intent: Intent | None = None
    funnel_stage: FunnelStage | None = None
    priority: Priority | None = None
    business_value: BusinessValue | None = None
    frequency: Frequency | None = None
    schedule_id: UUID | None = None
    is_active: bool | None = None
    change_reason: Annotated[str, StringConstraints(max_length=CHANGE_REASON_MAX)] | None = None

    # The identity of a tracked keyword: accepted only to be refused by name, so a client that
    # sends one learns which field it was. Not in the API document.
    keyword: SkipJsonSchema[object] = None
    search_engine: SkipJsonSchema[object] = None
    location_id: SkipJsonSchema[object] = None
    language_code: SkipJsonSchema[object] = None
    device: SkipJsonSchema[object] = None
    os: SkipJsonSchema[object] = None

    nullable = frozenset({"target_url", "business_value", "schedule_id"})
    _not_null = field_validator(
        "depth_profile", "intent", "funnel_stage", "priority", "frequency", "is_active"
    )(refuse_null)

    @field_validator(*IDENTITY_FIELDS, mode="before")
    @classmethod
    def _identity(cls, value: object) -> object:
        raise PydanticCustomError(
            "immutable_field", "Part of the keyword's identity: track a new keyword instead."
        )

    @model_validator(mode="after")
    def _says_something(self) -> TrackedKeywordPatch:
        if not self.model_fields_set - {"change_reason"}:
            raise ValueError("give at least one field to change")
        return self


class Keyword(BaseModel):
    keyword_id: UUID
    text: str = Field(description="As first entered: what the provider receives.")
    normalized_text: str
    language_code: str
    created_at: datetime


class UrlRef(BaseModel):
    url_id: str
    canonical_url: str
    host: str
    registrable_domain: str
    path: str


TrackedInclude = Literal["metrics", "groups", "terms", "competitors"]
MetricsSource = Literal["dataforseo_labs", "dataforseo_google_ads", "dataforseo_clickstream"]
CompetitionLevel = Literal["LOW", "MEDIUM", "HIGH"]


class KeywordMetrics(BaseModel):
    source: MetricsSource
    location_id: int
    language_code: str
    fetched_at: datetime
    data_month: date | None
    search_volume: MetricValue
    cpc_usd: Usd | None
    competition: float | None
    competition_level: CompetitionLevel | None
    keyword_difficulty: int | None
    intent_main: str | None
    trend_pct_per_month: float | None
    is_seasonal: bool | None


class GroupRef(BaseModel):
    group_id: UUID
    name: str
    path: str


class TermRef(BaseModel):
    term_id: UUID
    vocabulary_id: UUID
    vocabulary_kind: str
    name: str
    path: str


class CompetitorOverride(BaseModel):
    entity: EntityRef
    mode: Literal["include", "exclude"]


class TrackedKeyword(BaseModel):
    tracked_keyword_id: UUID
    project_id: UUID
    keyword: Keyword
    search_engine: Literal["google", "bing"]
    location_id: int
    location: LocationRef
    language_code: str
    device: Device
    os: Os | None
    config_version: int
    depth_profile: DepthProfile
    target_url: UrlRef | None
    intent: Intent
    intent_source: Literal["provider", "manual", "rule"] | None
    funnel_stage: FunnelStage
    priority: int
    business_value: Usd | None
    frequency: Frequency
    schedule_id: UUID | None
    source: KeywordSource
    is_active: bool
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class TrackedKeywordRow(TrackedKeyword):
    """A list row. The blocks named in `include` are filled; the others are null."""

    metrics: KeywordMetrics | None = Field(default=None, description="`include=metrics`.")
    groups: list[GroupRef] | None = Field(default=None, description="`include=groups`.")
    terms: list[TermRef] | None = Field(default=None, description="`include=terms`.")
    competitors: list[CompetitorOverride] | None = Field(
        default=None, description="`include=competitors`: the keyword's overrides."
    )


class TrackedKeywordResponse(BaseModel):
    data: TrackedKeyword


class TrackedKeywordList(BaseModel):
    data: list[TrackedKeyword]


class TrackedKeywordPageInfo(CursorPageInfo):
    total: int


class TrackedKeywordPage(BaseModel):
    data: list[TrackedKeywordRow]
    page: TrackedKeywordPageInfo


class ScheduleRef(BaseModel):
    schedule_id: UUID
    name: str
    next_run_at: datetime


class TrackedKeywordDetail(TrackedKeyword):
    metrics: KeywordMetrics | None
    groups: list[GroupRef]
    terms: list[TermRef]
    competitor_overrides: list[CompetitorOverride]
    config_history_count: int
    schedule: ScheduleRef | None


class TrackedKeywordDetailResponse(BaseModel):
    data: TrackedKeywordDetail


class BulkSkipped(BaseModel):
    index: int
    existing_id: UUID


class BulkRejected(BaseModel):
    index: int
    code: str
    message: str


class BulkCreateResult(BaseModel):
    created: list[UUID]
    restored: list[UUID] = Field(
        description="The ids of `created` that were deleted and came back with their settings."
    )
    skipped: list[BulkSkipped]
    rejected: list[BulkRejected]


class BulkCreateResponse(BaseModel):
    data: BulkCreateResult


class TrackedKeywordFilter(Body):
    """The list's filters, as a body: what bulk changes and term assignments select by.
    The same names as the list's `filter[...]` parameters, without the brackets. A list holds
    at least one value. `is_active` left out takes archived and active keywords alike (the
    list itself defaults it to true)."""

    q: QueryText | None = None
    group: UUID | None = None
    term: FilterList[UUID] | None = Field(
        default=None,
        description="Each term or one under it; terms of one vocabulary: either, of two: both.",
    )
    term_in: FilterList[UUID] | None = Field(
        default=None, description="Any of these terms or one under them."
    )
    device: Device | None = None
    location_id: int | None = None
    language_code: LanguageCode | None = None
    search_engine: Literal["google", "bing"] | None = None
    intent_in: FilterList[Intent] | None = None
    funnel_stage_in: FilterList[FunnelStage] | None = None
    priority_lte: Priority | None = None
    is_active: bool | None = None
    source_in: FilterList[KeywordSource] | None = None
    depth_profile_in: FilterList[DepthProfile] | None = None
    search_volume_gte: Annotated[int, Field(ge=0)] | None = None
    keyword_difficulty_lte: Annotated[int, Field(ge=0, le=100)] | None = None


class Selection(Body):
    """Exactly one of `ids` and `filter`."""

    ids: Annotated[list[UUID], Field(min_length=1, max_length=BULK_IDS_MAX)] | None = None
    filter: TrackedKeywordFilter | None = None

    @model_validator(mode="after")
    def _one_way(self) -> Selection:
        if (self.ids is None) == (self.filter is None):
            raise ValueError("give exactly one of `ids` and `filter`")
        return self


class TrackedKeywordBulkUpdate(Selection):
    """At least one of `set` and the group and term lists. `add_term_ids` with a term of a
    single-valued vocabulary replaces the keyword's other term of that vocabulary."""

    set: TrackedKeywordPatch | None = None
    add_group_ids: Links = Field(default_factory=list)
    remove_group_ids: Links = Field(default_factory=list)
    add_term_ids: Links = Field(default_factory=list)
    remove_term_ids: Links = Field(default_factory=list)

    @model_validator(mode="after")
    def _says_something(self) -> TrackedKeywordBulkUpdate:
        lists = (self.add_group_ids, self.remove_group_ids, self.add_term_ids, self.remove_term_ids)
        if self.set is None and not any(lists):
            raise PydanticCustomError(
                "nothing_to_change", "Give `set`, or groups or terms to add or remove."
            )
        if set(self.add_group_ids) & set(self.remove_group_ids) or set(self.add_term_ids) & set(
            self.remove_term_ids
        ):
            raise PydanticCustomError(
                "added_and_removed", "A group or term is either added or removed, not both."
            )
        return self


class BulkUpdateResult(BaseModel):
    matched: int
    updated: int
    config_versions_created: int


class BulkUpdateResponse(BaseModel):
    data: BulkUpdateResult


class TrackedKeywordBulkArchive(Selection):
    archive: bool = Field(description="false unarchives, within the quota.")


class BulkArchiveResult(BaseModel):
    matched: int
    updated: int


class BulkArchiveResponse(BaseModel):
    data: BulkArchiveResult


class TrackedKeywordBulkDelete(Selection):
    """The chosen rows are deleted as one by one: their history stays, and tracking the same
    keyword again brings the row back (plan decision D3)."""


class BulkDeleteResult(BaseModel):
    matched: int
    deleted: int


class BulkDeleteResponse(BaseModel):
    data: BulkDeleteResult


class ConfigVersion(BaseModel):
    config_version: int
    depth_profile: DepthProfile
    target_url: UrlRef | None
    valid_from: datetime
    valid_to: datetime | None
    changed_by: UserRef | None
    change_reason: str | None


class ConfigHistory(BaseModel):
    data: list[ConfigVersion]


class CompetitorSet(BaseModel):
    effective_competitors: list[EntityRef]
    overrides: list[CompetitorOverride]


class CompetitorSetResponse(BaseModel):
    data: CompetitorSet


class KeywordPage(BaseModel):
    data: list[Keyword]
    page: CursorPageInfo


class TrackedVariant(BaseModel):
    tracked_keyword_id: UUID
    project_id: UUID
    location_id: int
    language_code: str
    device: Device
    is_active: bool


class KeywordDetail(Keyword):
    metrics: list[KeywordMetrics] = Field(description="Current metrics per location and source.")
    tracked: list[TrackedVariant] = Field(description="Tracked variants the caller can see.")


class KeywordDetailResponse(BaseModel):
    data: KeywordDetail


class MonthlySearches(BaseModel):
    year: int
    month: int
    search_volume: int | None


class MetricsSnapshot(BaseModel):
    snapshot_id: str
    fetched_at: datetime
    data_month: date | None
    search_volume: int | None
    monthly_searches: list[MonthlySearches]
    cpc_usd: Usd | None
    keyword_difficulty: int | None
    is_material_change: bool


class MonthIndex(BaseModel):
    month: int
    index: float


class Seasonality(BaseModel):
    index_by_month: list[MonthIndex] = Field(description="Empty without twelve months of volume.")
    is_seasonal: bool | None = Field(description="Null without twelve months of volume.")
    method: str


class KeywordMetricsHistory(BaseModel):
    snapshots: list[MetricsSnapshot]
    trend: MetricValue
    seasonality: Seasonality


class KeywordMetricsHistoryResponse(BaseModel):
    data: KeywordMetricsHistory


# Groups (docs/19 section 3.6.2).


class KeywordGroupCreate(Body):
    name: GroupName
    parent_id: UUID | None = None


class KeywordGroupUpdate(Patch):
    """At least one member. `parent_id: null` moves the group to the root."""

    name: GroupName | None = None
    parent_id: UUID | None = None

    nullable = frozenset({"parent_id"})
    _not_null = field_validator("name")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> KeywordGroupUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class KeywordGroup(BaseModel):
    group_id: UUID
    parent_id: UUID | None
    name: str
    path: str = Field(description="Names from the root down, joined by `/`.")
    keyword_count: int = Field(
        description="Active tracked keywords in the group or under it, each keyword once."
    )
    created_at: datetime


class KeywordGroupNode(KeywordGroup):
    children: list[KeywordGroupNode] = Field(description="Empty in the flat format.")


class KeywordGroupResponse(BaseModel):
    data: KeywordGroup


class KeywordGroupTree(BaseModel):
    data: list[KeywordGroupNode]


class GroupMembers(Body):
    tracked_keyword_ids: Annotated[list[UUID], Field(min_length=1, max_length=BULK_IDS_MAX)]


class MembersAdded(BaseModel):
    added: int


class MembersAddedResponse(BaseModel):
    data: MembersAdded


class MembersRemoved(BaseModel):
    removed: int


class MembersRemovedResponse(BaseModel):
    data: MembersRemoved


# Term assignments (docs/19 section 3.5).


class TermAssignment(Body):
    """`replace` takes the subjects' terms away within the vocabularies of `term_ids`, then
    adds `term_ids`; other vocabularies are not touched. Exactly one of `subject_ids` and
    `subject_filter`."""

    op: Literal["add", "remove", "replace"]
    subject_type: Literal["tracked_keyword", "prompt"] = Field(
        description="`prompt` arrives with prompts."
    )
    subject_ids: Annotated[list[UUID], Field(min_length=1, max_length=BULK_IDS_MAX)] | None = None
    subject_filter: TrackedKeywordFilter | None = None
    term_ids: Annotated[list[UUID], Field(min_length=1, max_length=LINKS_MAX)]

    @model_validator(mode="after")
    def _one_way(self) -> TermAssignment:
        if (self.subject_ids is None) == (self.subject_filter is None):
            raise ValueError("give exactly one of `subject_ids` and `subject_filter`")
        return self


class TermAssignmentResult(BaseModel):
    subjects_matched: int
    assignments_added: int
    assignments_removed: int


class TermAssignmentResponse(BaseModel):
    data: TermAssignmentResult


# The manual metrics refresh (docs/19 section 3.6.1).


class MetricsRefresh(Body):
    """Keywords to refresh: the given ones (tracked by the project), else the project's tracked
    keywords whose metrics are older than `stale_days` (default 25)."""

    keyword_ids: Annotated[list[UUID], Field(min_length=1, max_length=1000)] | None = None
    stale_days: Annotated[int, Field(ge=0, le=365)] | None = None
