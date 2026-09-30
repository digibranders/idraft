# 12. Normalized Observation Schemas

Status: Draft for architecture freeze
Last updated: 2026-09-30
Related: [05-provider-integrations.md](05-provider-integrations.md) (adapter contract), [04-data-model.md](04-data-model.md) (tables), [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md), [07-dataforseo-ai-integration.md](07-dataforseo-ai-integration.md)

Adapters turn provider bytes into the canonical objects defined here. Persistence code turns canonical objects into rows. Nothing downstream of the adapter reads provider-specific fields; if a feature needs a provider field, the field is added to the canonical schema (with `null` for providers that lack it) and the schema version increments.

The source of truth for these schemas is Pydantic v2 models in `backend/src/sightline/domain/observations/` ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). Python attributes are snake_case; the serialized form (JSON, the invariants below, the example in section 9) uses the camelCase aliases produced by `alias_generator=to_camel`. JSON Schema files are generated from the models (`model_json_schema()`) for documentation and fixture validation, and the API exposes these shapes through the FastAPI-generated OpenAPI document.

## 1. Observation classes

| Class | Examples | Canonical object | Tables |
|---|---|---|---|
| `serp` | Google organic SERP from DataForSEO, later Oxylabs | `NormalizedSerp` | `seo.serp_snapshots`, `seo.serp_features`, `seo.domain_rank_observations` |
| `serp_ai` | AI Overview (from a SERP), Google AI Mode | `NormalizedAiAnswer` (with `serpContext`) | `ai.observations`, `ai.citations`, ... |
| `consumer_ui` | ChatGPT web, Gemini web (via DataForSEO LLM Scraper), later SearchAPI.io | `NormalizedAiAnswer` | same |
| `official_api` | OpenAI Responses with web search, Anthropic web search, Perplexity Agent API | `NormalizedAiAnswer` (with `usage`) | same |
| `first_party` | GSC, Bing Webmaster, GA4, Cloudflare, logs, imported exports | `FirstPartyMetricRow` | `fp.*` |
| (not an observation) | Keyword metrics, modeled AI demand, third-party mention datasets | `NormalizedKeywordMetrics`, `NormalizedAiDemand` | `seo.keyword_metric_snapshots`, `seo.ai_demand_snapshots` |

The class is a required field on every canonical object and on every observation row. Metric functions require it as a parameter.

## 2. Provenance envelope (shared by all canonical objects)

```python
# backend/src/sightline/domain/observations/provenance.py
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from pydantic.alias_generators import to_camel

Sha256 = Annotated[str, Field(min_length=64, max_length=64)]
PosInt = Annotated[int, Field(gt=0)]
NonNegInt = Annotated[int, Field(ge=0)]


class Canonical(BaseModel):
    """Base for every canonical object: immutable, strict, camelCase on the wire."""
    model_config = ConfigDict(frozen=True, extra="forbid", alias_generator=to_camel, populate_by_name=True)


class ProvenanceWarning(Canonical):
    code: str                                  # e.g. 'rank_recomputed', 'unresolved_redirect'
    detail: str


class Provenance(Canonical):
    provider_code: str                         # 'dataforseo'
    provider_endpoint: str                     # 'serp/google/organic/task_get/advanced'
    provider_task_id: str | None
    provider_schema_hint: str | None           # provider API version if any
    adapter_version: int                       # bumps on adapter behavior change
    normalizer_version: int                    # bumps on parsing/mapping change
    canonicalizer_version: int                 # URL canonicalization rules version
    raw_payload_sha256: Sha256                 # links to ops.raw_payloads
    fetched_at: datetime
    observed_at: datetime                      # provider's crawl time when available, else fetched_at
    cost_usd: Decimal | None
    latency_ms: int | None
    request_fingerprint: Sha256
    warnings: list[ProvenanceWarning]
```

## 3. NormalizedSerp

```python
# backend/src/sightline/domain/observations/serp.py
class NormalizedUrl(Canonical):
    raw_url: str
    canonical_url: HttpUrl
    url_hash: Sha256
    host: str
    registrable_domain: str
    path: str
    referral_tag: str | None                   # stripped tracking param value worth keeping (e.g. utm_source)
    flags: list[Literal["unresolved_redirect", "text_fragment_removed", "redirect_unwrapped"]]


class Rating(Canonical):
    value: float
    votes: int | None
    max: float


class OrganicResult(Canonical):
    organic_rank: PosInt                       # canonical
    absolute_rank: PosInt | None
    page: PosInt | None
    url: NormalizedUrl
    title: str | None
    snippet: str | None
    breadcrumb: str | None
    grouped_urls: list[NormalizedUrl]          # provider "related_result" children, same rank
    has_sitelinks: bool
    checks: list[str]                          # provider flags normalized: 'is_image','is_video','amp','highly_cited'
    rating: Rating | None


class SerpFeature(Canonical):
    feature_type: str                          # registry code or 'other:<provider type>'
    ordinal: PosInt
    absolute_rank: PosInt | None
    source_urls: list[NormalizedUrl]           # display order
    payload: dict[str, Any] | None             # <= 4 KB after serialization, feature-specific schema


class SerpQuery(Canonical):
    keyword: str
    engine: Literal["google", "bing"]
    se_domain: str | None
    location_id: int
    language_code: str
    device: Literal["desktop", "mobile"]
    os: str | None
    depth_requested: int


class Spell(Canonical):
    type: str
    keyword: str


class AiOverviewSlot(Canonical):
    state: Literal["absent", "present", "present_async_loaded", "present_not_loaded"]
    answer: "NormalizedAiAnswerCore | None"    # same shape as AI answers (section 4); forward reference


class NormalizedSerp(Canonical):
    schema_: Literal["serp.v1"] = Field(alias="schema")
    observation_class: Literal["serp"]
    provenance: Provenance
    query: SerpQuery
    check_url: HttpUrl | None
    se_results_count: int | None
    spell: Spell | None
    item_types: list[str]
    organic: list[OrganicResult]               # organic rank order, deduped
    features: list[SerpFeature]
    ai_overview: AiOverviewSlot
```

Invariants (checked by the normalizer and by contract tests):

1. `organic[i].organicRank == i + 1` after normalization (the parser recomputes and warns when the provider's ranks do not satisfy this).
2. No two organic results share a `urlHash`.
3. `aiOverview.state = 'absent'` implies `answer = null`; `present*` states imply `answer != null` except `present_not_loaded`.
4. `features` contains an `ai_overview` entry iff `aiOverview.state` is a present state.
5. `depthRequested >= organic.length` is **not** required (Google sometimes returns more than requested); `depth_returned` is stored as-is.

## 4. NormalizedAiAnswer

```python
# backend/src/sightline/domain/observations/ai_answer.py
class Citation(Canonical):
    index: PosInt                              # first-appearance order, 1-based
    url: NormalizedUrl
    title: str | None
    source_name: str | None
    snippet: str | None
    published_at: str | None
    kind: Literal["inline", "source_list", "search_result", "reference_card", "product_card", "footnote"]
    first_char_offset: NonNegInt | None        # offset in answer_text
    answer_block_index: NonNegInt | None
    occurrences: PosInt


class RetrievedResult(Canonical):
    index: PosInt
    fanout_seq: PosInt | None
    url: NormalizedUrl
    title: str | None
    was_cited: bool


class FanoutQuery(Canonical):
    seq: PosInt
    text: str
    normalized_text: str
    source_field: str                          # provider field name, for provenance


class AnswerBlock(Canonical):
    index: NonNegInt
    type: Literal["heading", "paragraph", "list_item", "table_row", "blockquote", "code",
                  "images", "local_businesses", "products", "ad", "navigation"]
    list_id: int | None
    list_ordered: bool | None
    list_item_number: int | None
    start_offset: int | None                   # into answer_text; None for non-text blocks
    end_offset: int | None
    is_sponsored: bool
    data: dict[str, Any] | None                # products, businesses, ads summary


class ProviderEntity(Canonical):
    title: str
    category: str | None
    urls: list[NormalizedUrl]


class NormalizedAiAnswerCore(Canonical):
    status: Literal["complete", "partial", "empty", "refused", "error"]
    answer_text: str | None                    # plain text, ads excluded
    answer_markdown: str | None
    answer_hash: Sha256 | None
    blocks: list[AnswerBlock]
    citations: list[Citation]
    retrieved_results: list[RetrievedResult] | None   # None = engine does not expose; [] = none returned
    fanout_queries: list[FanoutQuery] | None          # None = engine does not expose
    provider_entities: list[ProviderEntity] | None
    model_reported: str | None


class PromptVersionSubject(Canonical):
    type: Literal["prompt_version"]
    prompt_version_id: UUID
    text: str


class SerpKeywordSubject(Canonical):
    type: Literal["serp_keyword"]
    tracked_keyword_id: UUID
    serp_snapshot_ref: str | None
    text: str


class AnswerContext(Canonical):
    location_id: int | None
    language_code: str | None
    device: str | None


class Sampling(Canonical):
    run_id: UUID | None
    replicate_index: PosInt


class Usage(Canonical):                        # official_api only
    input_tokens: int | None
    output_tokens: int | None
    reasoning_tokens: int | None
    search_calls: int | None
    model_requested: str | None
    tool_version: str | None


class AdItem(Canonical):
    advertiser_domain: str | None
    url: NormalizedUrl | None
    is_rendered: bool | None


class NormalizedAiAnswer(NormalizedAiAnswerCore):
    schema_: Literal["ai_answer.v1"] = Field(alias="schema")
    observation_class: Literal["consumer_ui", "official_api", "serp_ai"]
    engine_code: str          # a code of the ai.engines registry (doc 04 section 8.1), listed below the schema
    provenance: Provenance
    subject: Annotated[PromptVersionSubject | SerpKeywordSubject, Field(discriminator="type")]
    context: AnswerContext
    sampling: Sampling
    usage: Usage | None
    ads: list[AdItem]
```

`engineCode` takes one of the `ai.engines` codes (doc 04 section 8.1; identical in docs 07 and 19): `chatgpt_web`, `chatgpt_web_forced_search`, `gemini_web`, `perplexity_web`, `copilot_web`, `claude_web` (consumer UI); `google_ai_overview`, `google_ai_mode` (SERP AI); `openai_api_search`, `gemini_api_grounded`, `anthropic_api_search`, `perplexity_api`, `xai_api_search` (official API).

Invariants:

1. `citations[].index` is 1..N without gaps; `citations` has no duplicate `urlHash`.
2. Every `citations[].firstCharOffset`, when not null, is `< answerText.length`.
3. Sponsored blocks (`isSponsored`) have no text inside `answerText`, and ad URLs never appear in `citations`.
4. `retrievedResults[].wasCited` is true iff its `urlHash` is in `citations`.
5. `null` vs `[]` semantics: `null` means the engine or provider cannot expose the field; `[]` means it can but returned none this time. Metrics like fan-out presence rate use only engines with non-null fields.

## 5. NormalizedKeywordMetrics and NormalizedAiDemand

```python
# backend/src/sightline/domain/observations/keyword_metrics.py
class MonthlySearches(Canonical):
    year: int
    month: int
    search_volume: int | None


class NormalizedKeywordMetrics(Canonical):
    schema_: Literal["keyword_metrics.v1"] = Field(alias="schema")
    provenance: Provenance
    keyword: str
    location_id: int
    language_code: str
    source: Literal["dataforseo_labs", "dataforseo_google_ads", "dataforseo_clickstream"]
    data_month: str | None                     # YYYY-MM of latest month covered
    search_volume: int | None
    monthly_searches: list[MonthlySearches]
    cpc_usd: Decimal | None
    competition: Annotated[float, Field(ge=0, le=1)] | None   # Labs float; Google Ads competition_index / 100
    competition_level: Literal["LOW", "MEDIUM", "HIGH"] | None
    keyword_difficulty: Annotated[int, Field(ge=0, le=100)] | None
    intent_main: str | None
    intent_detail: dict[str, float] | None
    serp_item_types: list[str] | None


class MonthlyValue(Canonical):
    year: int
    month: int
    value: int | None


class NormalizedAiDemand(Canonical):
    schema_: Literal["ai_demand.v1"] = Field(alias="schema")
    provenance: Provenance
    keyword: str
    location_id: int
    language_code: str
    ai_demand_estimate: int | None
    monthly: list[MonthlyValue]
    method_note: str
    is_estimate: Literal[True]
```

## 6. FirstPartyMetricRow

```python
# backend/src/sightline/domain/observations/first_party.py
class FirstPartyProvenance(Provenance):
    file_import_id: UUID | None


class FirstPartyMetricRow(Canonical):
    schema_: Literal["first_party.v1"] = Field(alias="schema")
    observation_class: Literal["first_party"]
    source: Literal[
        "gsc_search_analytics", "gsc_property", "gsc_generative_ai_import", "bing_ai_performance_import", "server_log",
        # fp.metric_observations sources (doc 04 section 10, doc 18 amendment A5):
        "bing_traffic", "bing_query_stats", "bing_page_stats", "bing_page_query_stats",
        "cloudflare_ai_crawl", "cloudflare_ai_referral", "ga4_source_daily", "ga4_ai_landing_daily",
    ]
    integration_id: UUID
    metric_date: str                           # YYYY-MM-DD in the source's reporting timezone
    data_state: Literal["final", "provisional", "all"]   # 'all' only for GSC Search Analytics (doc 04 fp.gsc_search_analytics)
    dimensions: dict[str, str]                 # canonical keys: query, page, country, device, bot, channel, ...
    metrics: dict[str, float]                  # clicks, impressions, position_sum, citations, sessions, ...
    provenance: FirstPartyProvenance
```

Detailed first-party mappings are in [18-first-party-integrations.md](18-first-party-integrations.md).

## 7. Mutation rules for observation rows

| Operation | Allowed? | Mechanism |
|---|---|---|
| Insert | yes | ingest only |
| Update observed facts (ranks, URLs, answer text, citations list) | **no** | Re-ingest from raw creates a **new** observation row; the old row is marked superseded in `ops.derivation_log` and excluded by a `superseded_by` column (added to `ai.observations` and `seo.serp_snapshots` in Phase 4 and 7 migrations) |
| Update tenant interpretation columns (`owned_by_project`, `competitor_entity_ids`, `domain_role`, `role_entity_id`, `cited_in_ai_overview`, domain rank rows for newly added competitors) | yes, by backfill job only | Logged in `ops.derivation_log`; the observed fact the interpretation is computed from is unchanged |
| Update extraction outputs | no | New `derivation_id` rows, `is_current` flip |
| Delete | only tenant purge and retention | batch jobs; partition drops |
| First-party restatements | replace all rows of an (integration, metric date) when the source restates that date | the source revises its own data; `data_state` records provisional vs final |

## 8. Schema evolution

- Canonical schemas carry a literal `schema` version (`serp.v1`, `ai_answer.v1`). Additive, nullable fields do not change the version. Renames, removals, semantic changes create `v2`, with both versions accepted by persistence during migration.
- `normalizerVersion` changes when mapping logic changes even if the schema does not (for example, a better redirect unwrapper). Re-ingest of historical raw payloads with a new normalizer is a backfill job that creates superseding observations.
- Provider schema drift: the schema hash check in the normal test suite compares each recorded fixture's field set against its stored hash and fails on new or missing fields; there is no nightly drift canary ([26-testing-quality.md](26-testing-quality.md), ADR-022). New provider fields are ignored until mapped; missing required fields fail normalization with `schema_mismatch`, keeping raw bytes for re-ingest.

## 9. Example: normalized AI Overview (trimmed)

```json
{
  "schema": "ai_answer.v1",
  "observationClass": "serp_ai",
  "engineCode": "google_ai_overview",
  "subject": { "type": "serp_keyword", "trackedKeywordId": "0192...", "serpSnapshotRef": "serp:88123", "text": "best crm for startups" },
  "status": "complete",
  "answerText": "For startups, popular CRM options include HubSpot, Pipedrive and Zoho CRM...",
  "citations": [
    { "index": 1, "url": { "canonicalUrl": "https://www.example-reviews.com/best-startup-crm", "registrableDomain": "example-reviews.com", "referralTag": null, "flags": ["text_fragment_removed"] },
      "kind": "reference_card", "title": "Best CRM for Startups 2026", "firstCharOffset": 62, "answerBlockIndex": 0, "occurrences": 1 }
  ],
  "retrievedResults": null,
  "fanoutQueries": null,
  "providerEntities": null,
  "modelReported": null,
  "ads": [],
  "provenance": { "providerCode": "dataforseo", "providerEndpoint": "serp/google/organic/task_get/advanced", "adapterVersion": 1, "normalizerVersion": 1, "canonicalizerVersion": 1, "warnings": [] }
}
```
