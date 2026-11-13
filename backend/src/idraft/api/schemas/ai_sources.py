"""What the Citations page, the prompt inspector's Citations tab and its fan-out view read
(docs/19 section 3.7.7, cut to slice 1 data; plan D2): sources by registrable domain and by
page, the citations behind them, and the queries ChatGPT issued while answering."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field

from idraft.api.pagination import CursorPageInfo, OffsetPageInfo
from idraft.api.schemas.ai import CitationOut, MetricCell
from idraft.api.schemas.metrics import MetricWindow
from idraft.domain.ai_engines import EngineCode

DomainRole = Literal["own", "competitor", "third_party"]
SourceSort = Literal["-citation_units", "-observations", "-prompts"]
SourceCompare = Literal["none", "previous_period"]
SourceDomainInclude = Literal["series", "cited_with", "by_role_by_engine"]
SourcePageInclude = Literal["series"]
SourceChangeKind = Literal["new", "lost"]
DiversityInclude = Literal["series", "ads"]
FanoutInclude = Literal["topics"]
_NOT_RETURNED = "Not returned yet: absent from every response until it is built."

TITLE_MAX = 300
RAW_URL_MAX = 1000
QUERY_MAX = 300
SERIES_MAX = 14  # weeks: the 92 day window at most, plus the week it starts in
ENGINES_MAX = 3  # one entry per engine
DOMAIN_MAX = 253
CATEGORY_MAX = 64
DETAIL_ROWS_MAX = 10  # a domain's rows: one per role and entity
DETAIL_PAGES_MAX = 10
DETAIL_PROMPTS_MAX = 20
CITED_WITH_MAX = 5
TOPICS_MAX = 10


def _bounded(limit: int) -> BeforeValidator:
    """Cut text a provider sent to `limit` characters, ending in `...`. Cutting, not rejecting:
    a response model that refused a long title would turn a stored answer into a 500."""

    def cut(value: object) -> object:
        if isinstance(value, str) and len(value) > limit:
            return value[: limit - 3] + "..."
        return value

    return BeforeValidator(cut)


_TITLE = (
    f"Provider text (untrusted: show it as text, never as markup); cut to {TITLE_MAX} characters "
    "with a trailing `...`."
)


_QUERY = (
    f"Provider text (untrusted: show it as text, never as markup); cut to {QUERY_MAX} "
    "characters with a trailing `...`."
)


def _absent(value: object) -> bool:
    """A block nobody asked for is left out of the answer, not sent as null."""
    return value is None


class PreviousUnits(BaseModel):
    citation_units: int
    observations: int = Field(description="Answers that cited it then.")


_PREVIOUS = (
    "With `compare=previous_period`: its citation units and citing answers over as many days "
    "just before the window, 0 when it was not cited there (docs/16 C5). Left out otherwise."
)

_UNITS = (
    "Citation units: distinct canonical URLs per answer (docs/16 C2); a URL an answer cites "
    "twice is one, and `occurrences` never counts."
)


class EngineUnits(BaseModel):
    engine_code: EngineCode
    citation_units: int


class SourceWeekUnits(BaseModel):
    week_start: date = Field(description="The Monday the week starts on, in the project's zone.")
    citation_units: int
    observations: int


class CitedWith(BaseModel):
    entity_id: UUID = Field(description="The tracked entity most named in answers citing it.")
    observations: int = Field(description="Answers citing it that name the entity.")


class SourceDomainRow(BaseModel):
    registrable_domain: str = Field(
        description="What sources are grouped by (docs/14 section 3, docs/16 C1): every host of "
        "one registrable domain, `www.` included."
    )
    domain_role: DomainRole
    role_entity_id: UUID | None = Field(
        description="The tracked entity whose domain rule the citations matched; null for a "
        "third party. A registrable domain whose citations matched different rules has a row "
        "per role and entity."
    )
    citation_units: int = Field(description=_UNITS)
    observations: int = Field(description="Answers that cite it.")
    prompts: int = Field(description="Prompts whose answers cite it.")
    engines: list[EngineUnits] = Field(
        description="Its citation units per engine of `meta.engine_codes`, in that order."
    )
    source_share: MetricCell = Field(
        description="Its citation units over every citation unit in scope (docs/16 C1); "
        "`n_observations` is the valid answers in scope."
    )
    first_seen_at: datetime = Field(description="Its first citation in the window.")
    last_seen_at: datetime = Field(description="Its last citation in the window.")
    previous: PreviousUnits | None = Field(default=None, exclude_if=_absent, description=_PREVIOUS)
    series: list[SourceWeekUnits] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=SERIES_MAX,
        description="With `include=series`: a point per week of the window, oldest first, at "
        "most 14, zero filled.",
    )
    cited_with: CitedWith | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=cited_with`: the tracked entity named in the most answers "
        "that cite this row (this role and entity), ties by entity id, with the answers citing "
        "it that name the entity. Absent when no counted answer citing it names one.",
    )
    category: str | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=CATEGORY_MAX,
        description="The domain's category. " + _NOT_RETURNED,
    )
    category_source: Literal["seed_list", "rule", "llm", "manual", "tenant_override"] | None = (
        Field(default=None, exclude_if=_absent, description=_NOT_RETURNED)
    )


class RoleUnits(BaseModel):
    domain_role: DomainRole
    citation_units: int
    observations: int = Field(description="Answers that cite a source of this role.")


class SourcesWeek(BaseModel):
    week_start: date
    answers: int
    citation_units: int
    distinct_domains: int


class RoleAnswers(BaseModel):
    citation_units: int
    answers_citing: int


class EngineRoleUnits(BaseModel):
    engine_code: EngineCode
    own: RoleAnswers
    competitor: RoleAnswers
    third_party: RoleAnswers


class SourcesMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode]
    answers: int = Field(description="Valid answers in scope, citing or not.")
    answers_citing: int = Field(description="Of those, the answers that cite a source.")
    citation_units: int = Field(
        description="Every citation unit in scope: the denominator of `source_share`. "
        "`filter[domain_role_in]` narrows the rows, not this."
    )
    by_role: list[RoleUnits] = Field(description="Own, competitor and third party, each once.")
    compare_window: MetricWindow | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare`: the window `previous` counts, as many days just before.",
    )
    previous_answers: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare`: the valid answers in scope in that window. 0 means it has no "
        "data, so a `previous` of 0 there says nothing about the source.",
    )
    series: list[SourcesWeek] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=SERIES_MAX,
        description="With `include=series`: a point per week of the window, oldest first, at "
        "most 14: the answers (citing or not), citation units and registrable domains cited "
        "in each week, the denominators of the rows' weekly points. The row filters "
        "(`filter[domain_role_in]`, and `filter[registrable_domain]` on pages) narrow the "
        "rows, not these.",
    )
    by_role_by_engine: list[EngineRoleUnits] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=ENGINES_MAX,
        description="With `include=by_role_by_engine` on domains: every engine of "
        "`engine_codes`, in that order, with the units and citing answers of each role over "
        "every citation in scope; `filter[domain_role_in]` does not narrow it. Per role the "
        "units over the engines add up to `by_role`.",
    )


class SourceDomainPage(BaseModel):
    data: list[SourceDomainRow]
    page: OffsetPageInfo
    meta: SourcesMeta


class SourcePageRow(BaseModel):
    url_id: int
    url: str = Field(description="The canonical URL: the link to follow.")
    host: str
    registrable_domain: str
    title: Annotated[str | None, _bounded(TITLE_MAX)] = Field(
        description="A title an answer gave the page; null if none did. " + _TITLE
    )
    domain_role: DomainRole
    role_entity_id: UUID | None
    citation_units: int = Field(description=_UNITS)
    observations: int = Field(description="Answers that cite it.")
    prompts: int = Field(description="Prompts whose answers cite it.")
    engines: list[EngineUnits]
    source_share: MetricCell
    first_seen_at: datetime
    last_seen_at: datetime
    previous: PreviousUnits | None = Field(default=None, exclude_if=_absent, description=_PREVIOUS)
    series: list[SourceWeekUnits] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=SERIES_MAX,
        description="With `include=series`: a point per week of the window, oldest first, at "
        "most 14, zero filled.",
    )


class SourcePagePage(BaseModel):
    data: list[SourcePageRow]
    page: OffsetPageInfo
    meta: SourcesMeta


class SourceChangeRow(BaseModel):
    registrable_domain: str = Field(max_length=DOMAIN_MAX)
    domain_role: DomainRole
    role_entity_id: UUID | None
    current_units: int = Field(description="Citation units in `meta.window` (0 for `lost`).")
    previous_units: int = Field(
        description="Citation units in `meta.compare_window` (0 for `new`)."
    )
    first_seen_at: datetime | None = Field(
        description="Its first citation in `meta.window`; null when it has none (`lost`)."
    )
    last_seen_at: datetime | None = Field(
        description="Its last citation in `meta.window`; null when it has none (`lost`)."
    )


class SourceChangesMeta(BaseModel):
    window: MetricWindow
    compare_window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode] = Field(max_length=ENGINES_MAX)
    kind: SourceChangeKind
    min_support: int


class SourceChangePage(BaseModel):
    data: list[SourceChangeRow]
    page: OffsetPageInfo
    meta: SourceChangesMeta


class AdPresence(BaseModel):
    answers_with_ads: MetricCell = Field(
        description="Answers that showed at least one ad, of the valid answers on the engine. "
        "Ads are kept out of answers and citations (docs/07 section 5.4); extras the 16 KB "
        "bound emptied count as no ad."
    )
    ads: int = Field(description="Ads stored with those answers.")


class DiversityWeek(BaseModel):
    week_start: date
    citation_units: int
    distinct_domains: int
    effective_sources: float | None = Field(description="Null when the week has no unit.")


class SourceDiversityEngine(BaseModel):
    engine_code: EngineCode
    answers: int
    answers_citing: int
    citation_units: int
    distinct_domains: int = Field(description="Registrable domains cited, roles merged (C3).")
    effective_sources: MetricCell = Field(
        description="Effective number of sources (docs/16 C3): 1 / sum of squared source "
        "shares, as (sum of units)^2 over the sum of squared units per domain."
    )
    series: list[DiversityWeek] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=SERIES_MAX,
        description="With `include=series`: a point per week of the window, oldest first, at "
        "most 14, zero filled.",
    )
    ads: AdPresence | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=ads`: the answers of the engine that showed an ad.",
    )


class SourceDiversityMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode] = Field(max_length=ENGINES_MAX)
    distinct_domains: int = Field(description="Over every engine in scope (a count).")
    effective_sources_engine_average: float | None = Field(
        description="The equal-weight mean of the engines' effective sources, engines with units "
        "only (docs/16 rule 2: never pooled)."
    )


class SourceDiversity(BaseModel):
    data: list[SourceDiversityEngine] = Field(max_length=ENGINES_MAX)
    meta: SourceDiversityMeta


class DomainEngineWeek(BaseModel):
    week_start: date
    citation_units: int
    observations: int
    all_citation_units: int = Field(
        description="Every unit of the engine that week: the share's denominator."
    )
    answers: int


class DomainEngineSeries(BaseModel):
    engine_code: EngineCode
    series: list[DomainEngineWeek] = Field(max_length=SERIES_MAX)


class DomainPrompt(BaseModel):
    prompt_id: UUID
    citation_units: int
    observations: int


class SourceDomainDetailData(BaseModel):
    registrable_domain: str = Field(max_length=DOMAIN_MAX)
    rows: list[SourceDomainRow] = Field(max_length=DETAIL_ROWS_MAX)
    engines: list[DomainEngineSeries] = Field(max_length=ENGINES_MAX)
    top_pages: list[SourcePageRow] = Field(max_length=DETAIL_PAGES_MAX)
    prompts: list[DomainPrompt] = Field(max_length=DETAIL_PROMPTS_MAX)
    cited_with: list[CitedWith] = Field(max_length=CITED_WITH_MAX)


class SourceDomainDetail(BaseModel):
    data: SourceDomainDetailData
    meta: SourcesMeta


class OwnPage(BaseModel):
    url_id: int
    url: str


class PromptOwnPagesRow(BaseModel):
    prompt_id: UUID
    engine_code: EngineCode
    answers: int = Field(description="Valid answers of the prompt on the engine in scope.")
    answers_citing_own: int
    own_citation_units: int
    own_pages: int = Field(description="Distinct own pages cited.")
    top_own_page: OwnPage | None = Field(
        description="The own page with the most units; null if none."
    )


class PromptOwnPagesMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode] = Field(max_length=ENGINES_MAX)


class PromptOwnPagesPage(BaseModel):
    data: list[PromptOwnPagesRow]
    page: CursorPageInfo
    meta: PromptOwnPagesMeta


class FanoutTopic(BaseModel):
    term_id: UUID
    observations: int = Field(description="Answers of the term's prompts that issued the query.")


class CitationRow(BaseModel):
    observation_id: str = Field(description="A 64-bit id, as a string.")
    observed_at: datetime
    prompt_id: UUID
    engine_code: EngineCode
    citation_index: int = Field(description="Its place in the answer's source list, from 1.")
    url_id: int
    url: str = Field(description="The canonical URL: the link to follow.")
    raw_url: Annotated[str, _bounded(RAW_URL_MAX)] = Field(
        description="As the provider gave it: evidence, not a link (untrusted: never follow or "
        f"render it as one); cut to {RAW_URL_MAX} characters with a trailing `...`."
    )
    host: str
    registrable_domain: str
    title: Annotated[str | None, _bounded(TITLE_MAX)] = Field(
        description="The title the answer gave this citation; null if none. " + _TITLE
    )
    citation_kind: str
    domain_role: DomainRole
    role_entity_id: UUID | None
    occurrences: int
    # The answer detail's text and cap (`CitationOut.quote`): written always, null when none.
    quote: str | None = Field(
        default=None, description=CitationOut.model_fields["quote"].description
    )


class CitationPage(BaseModel):
    data: list[CitationRow]
    page: CursorPageInfo


class FanoutCitedDomain(BaseModel):
    registrable_domain: str
    domain_role: DomainRole
    role_entity_id: UUID | None
    citation_units: int


class FanoutQueryRow(BaseModel):
    query_text: Annotated[str, _bounded(QUERY_MAX)] = Field(
        description="Its most common spelling in the answers. " + _QUERY
    )
    normalized_text: Annotated[str, _bounded(QUERY_MAX)] = Field(
        description="Lower case, trimmed, inner whitespace as one space: what queries are "
        "grouped by (docs/16 F4). " + _QUERY
    )
    engine_code: EngineCode
    observations: int = Field(
        description="Answers that issued it, each once (docs/16 F4); `meta.answers` is the "
        "denominator."
    )
    prompts: int
    prompt_ids: list[UUID] = Field(description="The prompts whose answers issued it.")
    first_seen_at: datetime
    last_seen_at: datetime
    cited_domains: list[FanoutCitedDomain] = Field(
        description="The 5 registrable domains with the most citation units in the answers that "
        "issued it: an association, not a link (which query found which source is not stored)."
    )
    topics: list[FanoutTopic] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=TOPICS_MAX,
        description="With `include=topics`: the topic terms tagged on the prompts whose answers "
        "issued it, the most answers first, then by term id, at most 10; an empty list when no "
        "such prompt is tagged with a topic. Absent unless `include=topics`.",
    )


class FanoutMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode]
    min_support: int
    answers: int = Field(
        description="Valid answers in scope on these engines: the denominator of `observations`."
    )
    answers_with_fanout: int = Field(
        description="Of those, the answers that issued a query (docs/16 F1)."
    )
    answers_truncated: int = Field(
        description="Of those, the answers whose stored list is shorter than the queries they "
        "issued (the 16 KB bound on the stored extras keeps the first ones): their other "
        "queries are in no row."
    )
    engines_without_fanout: list[EngineCode] = Field(
        description="Engines that do not show the queries they issue: not exposed, never zero."
    )


class FanoutQueryPage(BaseModel):
    data: list[FanoutQueryRow]
    page: OffsetPageInfo
    meta: FanoutMeta
