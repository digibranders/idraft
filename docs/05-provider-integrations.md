# 05. Provider Integrations and Adapter Contract

Status: Draft for architecture freeze
Last updated: 2026-09-30
Research basis: `research/01-dataforseo-seo.md`, `research/02-dataforseo-ai.md`, `research/03-alt-providers.md`, `research/04-official-llm-apis.md`, `research/05-first-party.md` (all accessed 2026-09-29)
Related: [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md), [07-dataforseo-ai-integration.md](07-dataforseo-ai-integration.md), [12-normalized-observation-schemas.md](12-normalized-observation-schemas.md), [21-scheduler-workers.md](21-scheduler-workers.md)

## 1. Provider strategy

| Role | Provider | Status in V1 | Why |
|---|---|---|---|
| SERP rank tracking (Google organic, features, AI Overview) | DataForSEO SERP API | **Primary, built** | Lowest verified cost at our volumes, task-based standard queue, full SERP feature parsing, AI Overview included, pay-as-you-go |
| Google AI Mode | DataForSEO SERP AI Mode | **Primary, built** | Same account and adapter family |
| ChatGPT consumer surface | DataForSEO LLM Scraper (ChatGPT) | **Primary, built** | Cited sources, retrieved results, fan-out queries, brand entities, $0.0012 per standard task |
| Gemini consumer surface | DataForSEO LLM Scraper (Gemini) | **Primary, built** | Same price; thinner schema (no fan-out) |
| Keyword metrics and research | DataForSEO Labs + Keywords Data | **Primary, built** | Volume, KD, intent, ideas, competitors in one account |
| AI demand estimates | DataForSEO AI Keyword Data | Built, Phase 11 | Only as a labeled estimate |
| Official API benchmarks | OpenAI, Anthropic, Perplexity Agent API, xAI (direct) or DataForSEO LLM Responses | Optional, Phase 14 | Fan-out analysis and validation only; not the main tracker |
| Gemini API grounding | Google | **Not used for bulk measurement** | Gemini API terms restrict caching, analyzing and programmatically collecting grounded results (see section 6 and [30-risks-open-questions.md](30-risks-open-questions.md)) |
| SEO fallback | Oxylabs (or Bright Data after a paid trial) | Adapter stub in V1, built when triggered | See section 5 |
| AI fallback | SearchAPI.io | Adapter stub in V1, built when triggered | Only fallback found with ChatGPT, Gemini, AI Mode, AIO, Perplexity and Copilot under one API |
| First-party | Google Search Console, Bing Webmaster Tools, GA4 Data API, Cloudflare | Phase 12 | See [18-first-party-integrations.md](18-first-party-integrations.md) |

Explicit exclusions: Cloro (by decision), SerpApi as SEO fallback (4x to 20x DataForSEO standard cost at top-100 depth per `research/03-alt-providers.md` section 6, plus active litigation), self-operated browser scraping of chat UIs (terms and account-ban risk; the open-source projects that do this carry the problems listed in `research/06-open-source.md`).

## 2. Is an adapter abstraction worth it? Yes.

The abstraction costs about a week of design and pays for itself the first time a provider changes schema or price. Concrete reasons from research:

1. **Depth models differ.** DataForSEO bills per 10-result page with one task for any depth; others need one request per page, or return top-100 in one call. The scheduler must ask for "top N for keyword K" and let the adapter decide.
2. **Rank semantics differ.** DataForSEO `rank_group` / `rank_absolute`; Oxylabs `pos` / `pos_overall`; others restart positions per page. We normalize to our own `organic_rank` and `absolute_rank` and recompute when needed.
3. **AI Overview retrieval differs.** Paid async flag (DataForSEO), deferred token with 1-minute expiry (SerpApi), render flag (Oxylabs).
4. **AI answer schemas differ.** `sources` vs `citations` vs `annotations`; fan-out present or absent.
5. **Google keeps changing SERPs** (the `num=100` removal in September 2025, `google.com/goto` redirects in August 2026). A second provider must be switchable by configuration.

What we do **not** build: a generic "any provider for anything" router with automatic cost-based routing. V1 routes by static configuration per workload and per project, with manual failover. Automatic failover on error budget is Phase 15 at the earliest.

## 3. Adapter contract

Adapters live in `backend/src/sightline/providers` ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). They never touch PostgreSQL or Redis; import-linter enforces that `providers` never imports `db`. They turn canonical requests into provider calls and provider responses into canonical objects. Network calls go through one shared `httpx.AsyncClient` per provider (connection pooling, explicit timeouts, HTTP/2 off); provider responses are parsed into Pydantic v2 response models before normalization. Everything stateful (task ledger, retries, cost events, raw storage) is in `sightline.collectors`.

### 3.1 Core types

```python
# backend/src/sightline/providers/contract.py
from decimal import Decimal
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict

Workload = Literal[
    "serp_organic",       # rank tracking + SERP features + AI Overview
    "serp_ai_mode",       # Google AI Mode
    "ai_consumer",        # ChatGPT / Gemini consumer surfaces
    "ai_official_api",    # benchmark calls to official model APIs
    "keyword_metrics",    # volume, CPC, KD, intent
    "keyword_discovery",  # ideas, suggestions, related, PAA, autocomplete, competitor keywords
    "ai_demand",          # AI keyword data (modeled)
]

SubmissionMode = Literal["task", "live"]


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Exposes(Contract):
    absolute_rank: bool
    ai_overview: bool
    ai_overview_async_flag: bool
    citations: bool
    retrieved_results: bool
    fanout: bool
    brand_entities: bool
    model_name: bool
    cost_in_response: bool


class ProviderCapabilities(Contract):
    provider: ProviderCode
    workload: Workload
    modes: list[SubmissionMode]                     # e.g. ["task", "live"]
    max_tasks_per_submit: int                       # DataForSEO: 100
    callbacks: list[Literal["pingback", "postback"]]  # what the provider offers; V1 uses none (polling only)
    max_depth: int | None = None                    # SERP: 700 task / 200 live on DataForSEO
    billing_unit: Literal["task", "page_10", "item", "token", "request"]
    exposes: Exposes
    supports_stop_on_match: bool
    location_granularity: Literal["coordinate", "city", "country"]
    result_retention_days: int                      # how long task results can be re-fetched


P = TypeVar("P", bound=Contract)
N = TypeVar("N", bound=Contract)


class CanonicalRequest(Contract, Generic[P]):
    task_id: str                   # our ops.collection_tasks id, echoed back via provider tag
    workload: Workload
    mode: SubmissionMode
    priority: Literal["standard", "high"]
    params: P                      # workload-specific, see below


class StopOnMatch(Contract):
    domains: list[str]
    mode: Literal["with_subdomains", "exact"]


class SerpOrganicParams(Contract):
    keyword: str
    location_id: int
    language_code: str
    device: Literal["desktop", "mobile"]
    os: str | None = None
    se_domain: str | None = None
    depth: int                                  # 10..100 in V1
    stop_on_match: StopOnMatch | None = None
    load_async_ai_overview: bool                # true by default for AI visibility
    paa_click_depth: Literal[0, 1, 2] | None = None


class AiConsumerParams(Contract):
    engine: Literal["chatgpt_web", "gemini_web"]
    prompt: str
    location_id: int
    language_code: str
    force_web_search: bool | None = None        # ChatGPT only


class AcceptedTask(Contract):
    task_id: str
    provider_task_id: str
    cost_usd: Decimal | None


class RejectedTask(Contract):
    task_id: str
    error: ProviderError


class SubmitResult(Contract):
    accepted: list[AcceptedTask]
    rejected: list[RejectedTask]
    request_cost_usd: Decimal | None
    raw: RawEnvelope                            # stored for audit (small)


class FetchResult(Contract):
    provider_task_id: str
    status: Literal["ready", "pending", "failed", "expired"]
    body: bytes | None = None                   # exact bytes as received (for R2)
    content_type: str | None = None
    cost_usd: Decimal | None = None
    error: ProviderError | None = None
```

### 3.2 Adapter interface

```python
# backend/src/sightline/providers/contract.py (continued)
from typing import Protocol

import httpx


class ProviderAdapter(Protocol[P, N]):
    code: ProviderCode
    adapter_version: int        # bump on any behavior change; stored on observations

    def capabilities(self, workload: Workload) -> ProviderCapabilities: ...

    def validate(self, req: CanonicalRequest[P]) -> ValidationResult:
        """Pure. Validates params against provider limits (keyword length, depth max, location support)."""

    def fingerprint(self, req: CanonicalRequest[P]) -> bytes:
        """Pure. Deterministic request fingerprint for the shared-fetch cache and idempotency."""

    def estimate_cost(self, req: CanonicalRequest[P], price_book: PriceBook) -> CostEstimate:
        """Pure. Estimated cost from the price book, used for pre-flight budget checks."""

    async def submit(self, batch: list[CanonicalRequest[P]], ctx: CallContext) -> SubmitResult:
        """Network (httpx). Submits up to capabilities.max_tasks_per_submit tasks in one provider call."""

    async def list_ready(self, workload: Workload, ctx: CallContext) -> list[str]:
        """Network (httpx). Lists provider task ids that are ready. The V1 readiness path (polling only)."""

    async def fetch(self, provider_task_id: str, workload: Workload, ctx: CallContext) -> FetchResult:
        """Network (httpx). Fetches the result body for one provider task."""

    async def live(self, req: CanonicalRequest[P], ctx: CallContext) -> FetchResult:
        """Network (httpx). Single synchronous call for live mode. Returns body like fetch()."""

    def normalize(self, body: bytes, req: CanonicalRequest[P], meta: FetchMeta) -> NormalizeResult[N]:
        """Pure. Validates raw bytes against the provider's Pydantic response model, then maps to the canonical shape."""

    def classify_error(self, exc: BaseException | httpx.Response) -> ProviderError:
        """Pure. Maps provider errors to our error taxonomy with a retry decision."""
```

`CallContext` carries the shared `httpx.AsyncClient`, the rate limiter handle and the task's deadline; adapters never build their own clients.

Notes on the design choices:

- `submit` takes a batch because DataForSEO charges nothing extra for 100 tasks per POST and has a per-minute call limit; batching is how we stay far below it.
- `normalize` is pure and takes bytes, so re-ingest from R2 after a parser fix is the same code path as first ingest.
- `fingerprint` excludes our task id and priority, so identical SERP requests on the same day across projects are recognized (shared fetch, [04-data-model.md](04-data-model.md) section 11.3).
- `classifyError` returns a retry decision rather than throwing provider-specific errors up the stack.

**As built (step 3 of the build order).** `backend/src/sightline/providers/contract.py` holds the part of this contract that submitting and fetching need; normalizing arrives with the first workload that ingests. A `Provider` has `code`, `batch_size(endpoint)`, `result_lifetime(endpoint)`, `payload_slug(endpoint)` (the endpoint's name in raw payload keys), `submit` (a batch; a request left out of both lists has an unknown outcome), `list_ready`, `fetch` (the exact response bytes), `lists_submissions` and `find_submitted` (the tasks posted in a period, with their tags, complete or refused). Instead of a `CallContext`, the DataForSEO adapter is built with the process's one `httpx.AsyncClient` and a `CallGate` (the shared limiter, doc 21 section 7). Every request carries its task id, run id and the attempt submission stamps on it; the tag echoes all three, and an answer is matched by tag, never by position. A call that fails as a whole raises `ProviderCallError`; the kinds are those of section 3.3, with `throttled` for a call our own limiter held back.

### 3.3 Error taxonomy

```python
ProviderErrorKind = Literal[
    "auth",                  # 401, bad credentials: do not retry, alert, pause provider
    "payment",               # 402, balance exhausted: do not retry, alert, pause provider
    "account_limit",         # own cost limit reached (DataForSEO 40203): pause workload, alert
    "rate_limited",          # DataForSEO 40202, HTTP 429: retry with backoff, reduce limiter
    "concurrency",           # DataForSEO 40209: retry after short delay
    "invalid_request",       # bad field, keyword too long, unsupported location: do not retry, mark task failed
    "not_found_expired",     # 40403 results expired: resubmit task if still within run window
    "upstream_unavailable",  # 50301, HTTP 503, a connection never opened: retry with backoff
    "provider_error",        # any other provider failure while reading: retry with backoff
    "timeout",               # the call may have reached the provider (timeout, dropped connection, a 5xx
                             # while posting tasks): outcome unknown when sending, else retry
    "schema_mismatch",       # Pydantic ValidationError in normalize(): do not retry fetch; raw is kept; alert parser owners
    "empty_result",          # valid response with no content (e.g. AI refused): not an error for the task
    "throttled",             # not sent: our own limiter gave no turn in time or could not be reached;
                             # not an attempt, retry shortly, the limiter is not slowed
]


class ProviderError(Contract):
    kind: ProviderErrorKind
    provider_code: str
    provider_status: str | int | None = None
    message: str
    retryable: bool
    retry_after_ms: int | None = None
```

Retry policy per kind is in [21-scheduler-workers.md](21-scheduler-workers.md) section 6.

### 3.4 Canonical normalized outputs

The canonical output shapes (`NormalizedSerp`, `NormalizedAiAnswer`, `NormalizedKeywordMetrics`) are defined in [12-normalized-observation-schemas.md](12-normalized-observation-schemas.md). Every adapter for a workload returns the same shape; every field that a provider cannot supply is `null` (never omitted, never guessed), and the `exposes` capability flags tell downstream code which nulls mean "not available from this provider" versus "absent in this response".

### 3.5 Contract tests

Every adapter must pass a shared contract test suite (pytest, parametrized over adapters and fixtures) in `backend/tests/providers/contract/`:

1. `normalize` on every recorded fixture for the workload produces a schema-valid canonical object (Pydantic `model_validate` on the canonical model, no `ValidationError`).
2. `normalize` is deterministic (same bytes, same output).
3. `fingerprint` is stable across runs and differs when any identity field changes.
4. `validate` rejects over-limit inputs listed in the provider's capability table.
5. `classifyError` maps every documented provider error code to a kind (table-driven from the provider's error list).
6. Golden cross-provider parity: for fixture pairs of the same keyword fetched from two providers within minutes, organic rank of tracked domains agrees within ±1 for at least 90% of pairs (used when a fallback adapter is built).

Fixtures are real responses captured in Phase 0 spikes and anonymized where needed; they are the parser regression suite.

## 4. Provider registry and configuration

```python
# Static routing in V1: workload -> provider, overridable per project.
DEFAULT_ROUTING: Final[Mapping[Workload, ProviderCode]] = {
    "serp_organic": "dataforseo", "serp_ai_mode": "dataforseo", "ai_consumer": "dataforseo",
    "ai_official_api": "dataforseo",   # via LLM Responses; direct vendor adapters optional
    "keyword_metrics": "dataforseo", "keyword_discovery": "dataforseo", "ai_demand": "dataforseo",
}
```

Per-project override is stored in `ai.project_engines.provider_code` (AI) and `core.projects.settings.providers` (SEO). Changing a provider for a series is a **measurement change**: it is recorded as a version boundary on charts ([17-statistical-methodology.md](17-statistical-methodology.md) section 9).

Credentials: platform accounts (our own DataForSEO account) in the platform secrets file `/etc/seo-platform/.env` (root-owned, mode 0600, written by the deploy workflow from GitHub Actions environment secrets; [ADR-022](adr/ADR-022-python-backend-simplified-platform.md), doc 24 section 5.1, doc 22 section 7) and read once at startup by `sightline.config`; bring-your-own-key per workspace (post-MVP) in `ops.secrets` with `workspace_id`, envelope-encrypted when first-party integrations arrive in Phase 12.

## 5. Fallback providers (evaluation summary)

Verified figures are from `research/03-alt-providers.md`; see that file for sources and the full matrix.

| Provider | SEO fallback fit | AI fallback fit | Notes |
|---|---|---|---|
| Oxylabs | **Good**: `pos` and `pos_overall`, rich features, push-pull batch with callbacks; about $0.80 per 1,000 pages on Advanced plan | ChatGPT (with search queries), Perplexity, Gemini, AI Mode | Co-defendant in a Reddit lawsuit (legal risk to monitor) |
| Bright Data | **Potentially best** if its top-100 dataset really costs one billable request per keyword at scale; needs a paid trial | ChatGPT, Perplexity, Gemini scrapers | Strongest legal track record in the group |
| SearchAPI.io | `google_rank_tracking` returns 100 organic results per call (organic only; features need a second call) | **Best AI fallback**: ChatGPT with fan-out, Gemini, AI Mode, AIO, Perplexity, Copilot in one credit pool; about $40 per 10,000 observations | Smaller vendor; verify SLA claims |
| SerpApi | Poor at top-100 depth (cost) | AI Overview via deferred page token | Active litigation; excluded |

**Decision:** build the adapter contract and DataForSEO adapters in V1. Build one fallback adapter (SearchAPI.io for AI, Oxylabs or Bright Data for SEO) only when a trigger fires:

- DataForSEO error rate for a workload above 5% for 24 hours, or
- DataForSEO standard-queue turnaround p95 above 6 hours for 3 consecutive days, or
- a DataForSEO price increase of more than 30% on a primary workload, or
- a required surface (for example Perplexity consumer UI) that DataForSEO does not offer.

A weekly cross-provider parity sample (200 keywords, 100 prompts) starts once a fallback exists, so a silent regression in either provider is caught before failover is needed.

## 6. Official LLM APIs (benchmark source)

Summary of `research/04-official-llm-apis.md` (verified 2026-09-29; model names change frequently and must be re-checked at implementation):

| Vendor | Search tool | Exposes generated queries (fan-out) | Citation format | Search fee | Representativeness of consumer app |
|---|---|---|---|---|---|
| OpenAI | Responses API `web_search` tool; `user_location` supported | `web_search_call.action.queries` ("usually but not always"); parse `action.query` too | `url_citation` annotations with char offsets; full consulted list via `include: ["web_search_call.action.sources"]` | $10 per 1,000 calls plus search content tokens | Low to medium: ChatGPT adds its own orchestration, memory, and model routing |
| Anthropic | `web_search` server tool (versions `web_search_20250305`, `_20260209`, `_20260318`); `user_location` | `server_tool_use.input.query` | `web_search_result_location` with `cited_text` | $10 per 1,000 searches | Low (Claude.ai has no documented parity) |
| Perplexity | Agent API `web_search` (Sonar Chat Completions is legacy since 2026-09-27) | `search_results` item with `queries[]` | `results[]` with url, title, snippet, date | $2.50 per 1,000 calls ($1.00 fast) | Closest of the group: Perplexity states the API uses the same search system with different configuration |
| xAI | Responses API `web_search`, `x_search` (old Live Search removed) | Via SDK tool-call arguments (not confirmed in docs for raw Responses output) | `citations`, `url_citation` annotations | $5 per 1,000 calls | Low |
| Google Gemini | Grounding with Google Search | `groundingMetadata.webSearchQueries` | `groundingChunks`, `groundingSupports` | $14 per 1,000 queries (Gemini 3.x, after free tier) | Low; **terms restrict caching and analysis of grounded results; not used** |

Two ways to call them:

1. **Through DataForSEO LLM Responses** (`/v3/ai_optimization/{chat_gpt|claude|gemini|perplexity}/llm_responses/...`): one account, one adapter, `fan_out_queries` and `annotations` normalized by DataForSEO; cost is $0.0006 (live) plus the vendor charge. Doc examples range from about $0.007 to $0.55 per call depending on model. Note that routing Gemini through DataForSEO does not remove the Gemini terms question; it moves it.
2. **Direct vendor adapters**: more control (tool versions, `include` flags, location), each needs its own key and adapter.

**Recommendation:** Phase 14 builds OpenAI and Perplexity direct adapters (the two with the most useful fan-out exposure and clear terms), plus Anthropic if a customer needs Claude. Benchmarks run on a small, fixed sample (default 100 core prompts, weekly) because they cost roughly 5x to 50x a consumer-surface observation with cheap search-capable models and several hundred times with flagship models (documented examples $0.007 to $0.55 per call versus $0.0012; spike S-16 measures our pinned models). Official API observations are stored with `observation_class = 'official_api'` and are never pooled with consumer observations.

## 7. First-party providers

Covered in [18-first-party-integrations.md](18-first-party-integrations.md). They use the same `ProviderAdapter` shape for `fetch` and `normalize`, but not `submit` (they are pull-only APIs with OAuth), and they write to the `fp` schema.

## 8. Price book maintenance

- `ops.provider_price_book` rows are seeded from the verified prices in the research files, with `source_url` and `verified_at`.
- A monthly maintenance task compares **actual** average cost per task (from `ops.provider_cost_events`, which uses provider-reported cost) against the price book. A deviation above 10% for any endpoint raises an alert: it means either the provider changed prices or our understanding of add-on billing is wrong (research found two conflicting published formulas for DataForSEO add-ons; see [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md) section 6).
- The price book is only used for estimates. Billing reports always use provider-reported cost.
