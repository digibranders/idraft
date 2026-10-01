# 07. DataForSEO AI Integration

Status: Draft for architecture freeze
Last updated: 2026-09-30
Research basis: `research/02-dataforseo-ai.md` (DataForSEO facts verified 2026-09-29 unless marked)
Related: [05-provider-integrations.md](05-provider-integrations.md), [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md), [11-ai-prompt-system.md](11-ai-prompt-system.md), [12-normalized-observation-schemas.md](12-normalized-observation-schemas.md), [13-ai-extraction-engine.md](13-ai-extraction-engine.md)

## 1. Surfaces, endpoints and observation classes

| Engine code | Surface | DataForSEO endpoint family | Observation class | Phase |
|---|---|---|---|---|
| `chatgpt_web` | ChatGPT consumer web UI (search mode) | `/v3/ai_optimization/chat_gpt/llm_scraper/...` | `consumer_ui` | 7 |
| `chatgpt_web_forced_search` | Same, with `force_web_search: true` | same | `consumer_ui` | 7 (if S-04 shows value) |
| `gemini_web` | Gemini consumer web UI | `/v3/ai_optimization/gemini/llm_scraper/...` | `consumer_ui` | 7 |
| `google_ai_mode` | Google AI Mode | `/v3/serp/google/ai_mode/...` | `serp_ai` | 7 |
| `google_ai_overview` | AI Overview inside Google organic SERP | organic SERP (see doc 06) | `serp_ai` | 4 (collected with rank tracking) |
| `openai_api_search`, `anthropic_api_search`, `perplexity_api`, `gemini_api_grounded` | Official model APIs with web search | `/v3/ai_optimization/{chat_gpt,claude,perplexity,gemini}/llm_responses/...` or direct vendor adapters | `official_api` | 14 (optional) |
| `xai_api_search` | xAI API with search | direct vendor adapter only | `official_api` | 14 (optional) |
| `perplexity_web`, `copilot_web`, `claude_web` | Consumer UIs not offered by DataForSEO | none in V1 (registered with `is_active = false`) | `consumer_ui` | later, through a fallback adapter |
| n/a | AI demand estimates | `/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live` | not an observation (modeled estimate) | 11 |
| n/a | DataForSEO's own mentions database | `/v3/ai_optimization/llm_mentions/...` | not our observation (third-party dataset) | 13 (optional) |

Two rules:

1. `chatgpt_web` and `chatgpt_web_forced_search` are **different engines** in our registry. Forcing web search changes the answer distribution; mixing the two would corrupt trends. A project picks one as its ChatGPT series (default decided by spike S-04; see section 4.1).
2. LLM Mentions and AI Keyword Data are **not observations of our prompts**. They are stored in their own tables, labeled as third-party or modeled data, and never feed Mention Rate, Citation Rate, or Share of Voice.

Not available through DataForSEO (verified): Perplexity consumer UI, Claude consumer UI, Grok. Microsoft Copilot's summary appears as `ai_overview` in DataForSEO's Bing SERP API (a possible Phase 15 engine; its code must first be added to `ai.engines` in doc 04 section 8.1). A consumer Perplexity surface would need the SearchAPI.io fallback adapter ([05-provider-integrations.md](05-provider-integrations.md) section 5).

## 2. What each surface returns (verified schema summary)

| Capability | ChatGPT scraper | Gemini scraper | AI Mode | AI Overview (organic SERP) | LLM Responses |
|---|---|---|---|---|---|
| Answer markdown | `markdown` | `markdown` | `ai_overview.markdown` | `ai_overview.markdown` | `items[].sections[].text` |
| Cited sources | `sources[]` (url, domain, title, snippet, source_name, publication_date) | `sources[]` | `references[]` (source, domain, url, title, text) | `references[]` | `annotations[]` (title, url, start_index, end_index) |
| Per-block sources | `items[].sources[]` on `chat_gpt_text` | `items[].sources[]` on `gemini_text` | element `references[]`, `links[]` | element `references[]`, `links[]` | annotation offsets |
| Retrieved but not cited | `search_results[]` | no | no | no | no |
| Fan-out queries | `fan_out_queries[]` (not guaranteed) | **no** | **no** | **no** | `fan_out_queries[]` |
| Brand entities (provider NER) | `brand_entities[]` (title, category, urls) | no | no | no | no |
| Model | `model` (e.g. `gpt-4o` in a 2025 example) | `model` (e.g. `Fast`) | n/a | n/a | `model_name` |
| Structured blocks | text, table, navigation list, images, local businesses, products, ads (`chat_gpt_ad`, `is_rendered`) | text, table, images | element, video, table, expanded, shopping, paid (ads since 2026-07-30) | element, video, table, expanded | reasoning, message |
| Reproduction link | `check_url` | no | `check_url` | `check_url` | n/a |
| Location granularity | country (215 locations) | 210+ locations, plus `location_coordinate` | Google locations incl. coordinates (`lat,lng,zoom`) | Google locations | country code, city (ChatGPT/Claude) |
| Tokens and vendor cost | n/a | n/a | n/a | n/a | `input_tokens`, `output_tokens`, `reasoning_tokens`, `money_spent` |

Implications:

- **Query fan-out analysis in V1 is ChatGPT-only** (consumer). Gemini, AI Mode and AI Overview expose no fan-out through DataForSEO. The product must say "fan-out not available for this engine" rather than show empty charts.
- **Retrieved-vs-cited analysis is ChatGPT-only.** `search_results[]` versus `sources[]` tells us which pages ChatGPT looked at but did not cite, which is the most actionable source-gap signal we have.
- Ads now appear on ChatGPT and AI Mode surfaces. Ad content must never count as an organic mention or citation (section 5.4).

## 3. Request construction

### 3.1 ChatGPT scraper (task_post, up to 100 tasks per POST)

```json
{
  "keyword": "What is the best CRM for a 20-person SaaS startup?",
  "location_code": 2840,
  "language_code": "en",
  "priority": 1,
  "force_web_search": false,
  "tag": "i:prod:t:9f2c1b:a:1:r:0192f0a13c447e108a512b7d9c0e4f11"
}
```

| Field | Rule |
|---|---|
| `keyword` | `prompt_versions.text`, prefixed by `context_preamble` if the version has one (joined with a blank line). Max 2,000 characters; validated at prompt creation |
| `location_code` | Country-level only (215 locations). Prompt-level `country_iso` must map to a supported code; city-level locations are rejected for this engine |
| `language_code` | From prompt `language_code`. Note: DataForSEO's ChatGPT language list CSV is dated 2023 (verified); S-04 confirms that non-English prompts work as expected |
| `force_web_search` | Engine variant: false for `chatgpt_web`, true for `chatgpt_web_forced_search` |
| `priority` | 1 by default; 2 for high-priority schedules |
| `pingback_url`, `postback_url` | Omitted. Readiness is polling only (doc 06 section 4.2, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)) |

### 3.2 Gemini scraper

Same shape; no `force_web_search`; optional `location_coordinate` (`lat,lng,radius`) for city targeting in Phase 15.

### 3.3 Google AI Mode

```json
{
  "keyword": "best crm for startups",
  "location_code": 2840,
  "language_code": "en",
  "device": "desktop",
  "os": "windows",
  "priority": 1,
  "tag": "..."
}
```

- `keyword` max 700 characters (shorter limit than the ChatGPT scraper; prompts longer than 700 characters are skipped for AI Mode with a recorded reason).
- `calculate_rectangles` is never set (doubles the price).
- AI Mode has two subject types: **prompts** (`ai_prompt` workload, engine run over the prompt panel) and **tracked keywords** (`ai_mode_keyword` workload, optional per keyword group, so the SEO/AI matrix can show AI Mode presence for a keyword). The observation row distinguishes them (`prompt_version_id` vs `tracked_keyword_id`).
- The overview docs mention extra depth charges for AI Mode but the task pages have no `depth` parameter (documentation inconsistency, verified). We budget one base price per task and S-06 verifies.

### 3.4 LLM Responses (official API benchmarks, optional)

```json
{
  "user_prompt": "What is the best CRM for a 20-person SaaS startup?",
  "model_name": "<exact pinned model version>",
  "web_search": true,
  "web_search_country_iso_code": "US",
  "max_output_tokens": 2048,
  "temperature": null
}
```

- `user_prompt` max 500 characters (shorter than the scraper limit).
- **Always pin an exact model version.** A base model name auto-resolves to the latest version (verified), which would silently change the measured system. The pinned version is stored in `ai.project_engines.provider_params` and changes create a version boundary.
- Temperature and top_p left at provider defaults unless a benchmark design requires otherwise; whatever is sent is recorded.
- Standard mode charges $0.0002 plus a $0.01 prepayment that is refunded or topped up after the vendor call (verified). Live mode charges $0.0006 plus the vendor cost reported in `money_spent`. Our cost event uses `money_spent + DataForSEO fee`.

## 4. Scheduling, replicates and turnaround

### 4.1 Replicates

- Each replicate is its own provider task with its own `ops.collection_tasks` row (`replicate_index` 1..R).
- Replicates of the same prompt-engine are spread through the run window: replicate r is scheduled at `window_start` plus the stagger offset of doc 21 section 3.3 `+ (r - 1) * 20 minutes`. This reduces the chance that the provider serves identical cached answers and reduces correlation with short-lived backend states.
- Whether same-day replicates are independent enough to be worth paying for is spike S-05 ([17-statistical-methodology.md](17-statistical-methodology.md) section 2.2).

### 4.2 Default engine set and sampling (V1)

| Engine | Default | Replicates (priority subset / rest) | Cadence |
|---|---|---|---|
| `chatgpt_web` | on | 3 / 1 | weekly |
| `gemini_web` | on | 3 / 1 | weekly |
| `google_ai_mode` | on | 1 / 1 | weekly |
| `google_ai_overview` | on, keyword-level only (collected with rank tracking at no extra task cost; prompts are not sent through SERPs by default) | 1 | with rank checks |

The choice between `chatgpt_web` and `chatgpt_web_forced_search` as the default ChatGPT series is made after S-04 measures, on 200 prompts (doc 01 section 12), the citation presence rate and fan-out presence rate for both variants. Decision rule: if the natural variant returns citations on at least 60% of commercial-intent prompts, the natural variant is the default because it better represents what users see; otherwise the forced variant is the default and the UI labels the series "ChatGPT (web search forced)".

### 4.3 Turnaround

Published turnaround is inconsistent across DataForSEO pages (standard up to 45 minutes on the pricing cards, up to 5 minutes in the intro text; live up to 90 or 120 seconds). The planner assumes the worst published value and the run window for AI workloads is 8 hours, which leaves room for retries. S-04 measures the real distribution.

## 5. Normalization (normalizer version 1)

All engines produce the canonical `NormalizedAiAnswer` ([12-normalized-observation-schemas.md](12-normalized-observation-schemas.md) section 4).

### 5.1 ChatGPT scraper

| Canonical field | Source |
|---|---|
| `answerMarkdown` | `result[0].markdown` |
| `answerText` | markdown rendered to plain text by our markdown pipeline (same code as extraction Stage 3), so offsets are consistent |
| `modelReported` | `result[0].model` |
| `citations[]` | union of `result[0].sources[]` (kind `source_list`) and `items[].sources[]` on `chat_gpt_text` items (kind `inline`, with `answer_block_index` = item's `rank_group` order), deduplicated by canonical URL; `citation_index` = first-appearance order; per-URL `occurrences` counted |
| `retrievedResults[]` | `result[0].search_results[]`; `was_cited` = canonical URL is among citations |
| `fanoutQueries[]` | `result[0].fan_out_queries[]` in order; `seq` = array index + 1; `source_field = 'fan_out_queries'` |
| `providerEntities[]` | `result[0].brand_entities[]` (title, category, urls) into `ai.observations.provider_extras` |
| `blocks[]` | `items[]` mapped: text, table (markdown table), navigation list, images (alt text only), local businesses (title, url, rating), products (title, merchants, price), ads |
| `status` | `complete` if markdown length > 0; `empty` if no markdown and no items; `refused` if the answer matches refusal patterns (section 5.5) |

`utm_source=chatgpt.com` on cited URLs is stripped from the canonical URL and kept as `referral_tag` on the citation ([13-ai-extraction-engine.md](13-ai-extraction-engine.md) stage 1).

### 5.2 Gemini scraper

Same mapping, with `sources[]` at top level and in `gemini_text` items. No retrieved results, no fan-out, no provider entities (fields set to `null`, not `[]`, so downstream code distinguishes "not supported" from "none"). Duplicate URLs in sources are merged (Gemini annotations have contained duplicates since 2026-07-28, verified for LLM Responses; we dedupe everywhere by canonical URL).

### 5.3 AI Mode and AI Overview

Same parser as the organic SERP AI Overview ([06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md) section 5.5): `references[]` become `reference_card` citations, element `links[]` become `inline` citations when not already references; `ai_overview_shopping` elements go to blocks (products); `ai_overview_paid` elements go to blocks as ads.

### 5.4 Ads and sponsored content

- Blocks of type ad (`chat_gpt_ad`, `ai_overview_paid`) are **excluded** from `answerText` used for mention extraction, and their URLs are **not** citations.
- They are stored in `provider_extras.ads[]` with advertiser domain and `is_rendered` (ChatGPT), and counted in an "ads present" metric per engine (Phase 13 feature: "competitor is advertising on this prompt").
- S-04 verifies whether the scraper's top-level `markdown` includes ad text. If it does, the normalizer rebuilds `answerText` from non-ad items instead of using `markdown`.

### 5.5 Refusals, empties, partials

| Condition | Status | Counted in rates? |
|---|---|---|
| No markdown and no items | `empty` | No (collection health metric) |
| Answer under 40 characters or matches refusal patterns ("I can't help with", localized) | `refused` | No |
| Provider task error after retries | `error` | No |
| Markdown present but provider flags truncation, or blocks missing that markdown references | `partial` | Yes, flagged; excluded if the project enables strict mode |

## 6. Raw storage

Raw bytes of every AI result go to R2 at `raw/v1/ai_raw/dataforseo/<endpoint_slug>/YYYY/MM/DD/<sha256>.json.zst` (for example `raw/v1/ai_raw/dataforseo/chatgpt_llm_scraper/2026/09/29/<sha256>.json.zst`; key scheme in [23-backup-disaster-recovery.md](23-backup-disaster-recovery.md) section 9.1) with retention class `ai_raw` (kept indefinitely, with a weekly replica; doc 23 sections 9.2 and 9.5). AI raw payloads are small relative to SERPs (spike S-04 measures) and are the only evidence of a probabilistic answer that cannot be re-observed.

HTML endpoints (`task_get/html`) are not used in V1. They cost the same, and we do not render provider HTML in our UI ([24-security.md](24-security.md) section 7.1).

## 7. Costs

### 7.1 Unit prices (verified)

| Endpoint | Standard | Priority | Live |
|---|---|---|---|
| ChatGPT scraper, Gemini scraper (per task) | $0.0012 | $0.0024 | $0.004 |
| AI Mode (per task) | $0.0012 | $0.0024 | $0.004 |
| AI Overview via organic SERP | included in the rank check; async surcharge per doc 06 | | |
| LLM Responses | $0.0002 + vendor cost (with $0.01 prepay) | | $0.0006 + vendor cost |
| AI Keyword Data | $0.01 per task + $0.0001 per keyword (up to 1,000 keywords per task) | | |
| LLM Mentions | $0.1 per request + $0.001 per returned row | | |

### 7.2 Formulas

```
observations_per_month(engine) = prompts_per_week * 4.33 * replicates(engine)
cost(engine) = observations_per_month(engine) * unit_price(engine, mode)
```

V1 default design (1,000 prompts per week, priority subset of 100 prompts at 3 replicates on ChatGPT and Gemini, all others 1 replicate, AI Mode 1 replicate, AI Overview from rank tracking):

```
ChatGPT: (900 * 1 + 100 * 3) * 4.33 = 5,196 tasks * $0.0012 = $6.24
Gemini:  5,196 tasks * $0.0012                             = $6.24
AI Mode: 1,000 * 4.33 = 4,330 tasks * $0.0012              = $5.20
Total AI prompt collection (standard queue)                ≈ $17.68 per month
```

Scenario tables for 100 to 10,000 prompts per week and for 100,000 and 1,000,000 observations per month are in [27-cost-model.md](27-cost-model.md) section 4.

Official API benchmarks through LLM Responses cost roughly 5x to 50x more per observation with cheap search-capable models and several hundred times with flagship models (documented examples range from about $0.007 to $0.55 per call; verified doc examples; S-16 measures our pinned models). This is why they are a small, optional benchmark sample.

## 8. AI demand estimates (AI Keyword Data)

- Endpoint returns `ai_search_volume` and `ai_monthly_searches[]` (12 months) per keyword, up to 1,000 keywords per task.
- DataForSEO describes the values as calculated from statistical data on questions in Google's People Also Ask, via a proprietary algorithm that considers multiple signals (verified; paraphrased). Word forms are merged and multi-word phrases count questions containing every word.
- **What it is:** a modeled proxy derived from Google data. **What it is not:** a count of prompts sent to ChatGPT or any AI assistant. No AI vendor publishes prompt volumes.
- Product labeling: the column is titled **"Modeled AI demand (DataForSEO estimate)"** with an info tooltip quoting the method in plain words. It is used only to prioritize discovery candidates and sort prompt suggestions, never in visibility metrics and never summed into a "traffic" figure.
- Storage: a separate table, `seo.ai_demand_snapshots` ([04-data-model.md](04-data-model.md) section 7.2), so modeled AI demand can never be mixed up with Google search volume in `seo.keyword_metric_snapshots`.

## 9. LLM Mentions (third-party dataset, optional)

- What it is (verified): DataForSEO's own database of AI answers: Google AI Overview answers across supported locations and ChatGPT answers for the US in English only, over 300 million prompts, refreshed on a 60-day cycle, history from 2025-08-01. Aggregates by domain, page, brand, category; per-item `question`, `answer`, `sources`, `fan_out_queries` (ChatGPT only), `ai_search_volume`.
- Pricing: $0.1 per request + $0.001 per row (the earlier $100 monthly minimum was removed in July 2026).
- Use in our product (Phase 13, optional): **market landscape and discovery**, for example "questions in DataForSEO's dataset where competitor X is mentioned and we are not" as prompt candidates, and "domains most cited for topic T" as publisher opportunity context.
- Never used for: our Mention Rate, Citation Rate, SOV or trends. The prompts are not ours, the sample design is not ours, and the refresh cycle is 60 days.
- Storage: `ai.external_mention_snapshots` (Phase 13; shape: request params, fetched_at, rows as JSONB, cost), labeled `source = 'dataforseo_llm_mentions'`.

## 10. How close is this to what users see?

| Factor | Status | Consequence and UI wording |
|---|---|---|
| Logged-in vs logged-out | Undocumented for both scrapers. Evidence (no account parameter, fixed desktop/Windows echo, `check_url` pattern, model values) suggests anonymous sessions (inferred) | Observations represent a **logged-out, non-personalized** session. UI: "Samples of what a signed-out user sees" |
| Personalization, memory | None (no account, no history) | Real users with history may see different brands |
| Location | Country code; mechanism (proxy or otherwise) undocumented | Country-level representativeness only |
| Model | Reported per result; can change without notice | `model_reported` stored; changes shown as version boundaries |
| Web search triggering | ChatGPT decides unless forced; citations not guaranteed even when forced (verified) | Citation rate denominators are all valid observations, with "answers with any citation" shown alongside |
| Ads | Present on ChatGPT and AI Mode | Excluded from organic metrics (section 5.4) |

These caveats are shown on the Prompt Explorer and in every export header. They are the honest limits of consumer-surface tracking through any provider.

## 11. Limits

| Limit (verified) | Setting |
|---|---|
| 2,000 API calls per minute account-wide (shared with SERP) | Shared DataForSEO limiter (doc 06) |
| 100 tasks per task_post | Batches of 100 |
| LLM Responses: 30 concurrent live calls per platform | Taskiq `collect` queue; at most 4 LLM Responses calls in flight per platform (Redis limiter) |
| LLM Mentions, AI Keyword Data: 30 simultaneous | Discovery tasks: at most 2 in flight (Redis limiter) |
| Result retention 30 days; standard LLM Responses tasks can take up to 72 hours | Id sweeper and dead-lettering as in doc 06 section 4.2 |
| Callback: 10 s timeout then task appears in `tasks_ready` | No callback URL sent; `poll_ready` reads `tasks_ready` every 60 s, 30 s while a collection window is open (doc 06 section 4.2) |

## 12. Spikes

| Id | Question | Pass criterion |
|---|---|---|
| S-04 | ChatGPT and Gemini scraper on 200 prompts (method in doc 01 section 12) (natural and forced search for ChatGPT): field presence rates (sources, search_results, fan-out, brand_entities), payload sizes, does `markdown` include ad text, turnaround distribution standard vs priority, non-English behavior | Default ChatGPT variant chosen by the rule in 4.2; normalizer fixtures captured |
| S-05 | Replicate independence: 30 prompts x 20 replicates per engine | Duplicate-answer rate and within-run citation Jaccard measured; replicate policy confirmed or changed |
| S-06 | AI Mode: payload fields, cost per task at default settings (depth billing question), coverage in non-US locations | Unit price confirmed |
| S-16 | LLM Responses: cost per call for the pinned benchmark models with web search; `fan_out_queries` presence | Benchmark budget set |
