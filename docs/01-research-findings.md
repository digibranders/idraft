# 01. Research Findings

Status: Draft for architecture freeze (Phase 0)
Last updated: 2026-09-30
Research date: 2026-09-29 (every primary page cited in research/*.md was accessed on this date)
Owner: Platform architecture
Inputs: research/01 to research/08
Related: [03-system-architecture.md](03-system-architecture.md), [04-data-model.md](04-data-model.md), [05-provider-integrations.md](05-provider-integrations.md), [17-statistical-methodology.md](17-statistical-methodology.md), [24-security.md](24-security.md)
Stack change (2026-09-30): [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) locked a Python backend (FastAPI, Taskiq on Redis), our own auth module, polling-only readiness and a self-hosted Next.js app; the findings below about BullMQ, Better Auth, pingback and the Node RAM budget are kept as research history and no longer describe the build.

## How to read this

| Label | Meaning | Where it appears |
|---|---|---|
| **Verified fact** | Read on a primary page (vendor docs, pricing page, terms, standards body, source code) on 2026-09-29. The source is given as `[Rnn §x]`: the research file and section that holds the exact URL. | Default for every row in a "Verified facts" table unless the row is tagged otherwise |
| **Inference** | Our own derivation from verified facts: arithmetic, reconciling two pages, reading code we did not run. | Tagged *(Inference)* |
| **Assumption** | Treated as true for design until an experiment or the vendor confirms it. Anything the research marks UNVERIFIED keeps that label verbatim. | Tagged *(Assumption)* or *(UNVERIFIED)* |
| **Recommendation** | What the design does as a result. | Every "Design impact" bullet is a recommendation unless tagged |
| **Open question** | Needs an experiment (S-nn, section 12) or a written vendor answer. | "Open questions" lists |

Shorthand: R01 = research/01-dataforseo-seo.md, R02 = 02-dataforseo-ai.md, R03 = 03-alt-providers.md, R04 = 04-official-llm-apis.md, R05 = 05-first-party.md, R06 = 06-open-source.md, R07 = 07-commercial-competitors.md, R08 = 08-infra-methodology.md.

Prices are USD list prices on 2026-09-29. They change. Current values belong in `ops.provider_price_book`; actual spend always comes from the provider-reported `cost` field recorded in `ops.provider_cost_events`.

---

## 1. Summary

1. **DataForSEO covers every surface we need at V1 except Perplexity and Copilot consumer UIs.** ChatGPT and Gemini consumer scrapes, Google AI Mode and AI Overview all cost $0.0006 to $0.0012 per observation on the Standard queue [R02 §0].
2. **Depth is now the main SEO cost driver.** Top-100 costs 10 times top-10 on the current pricing FAQ [R01 §1.3]. Default tracking depth is a product decision, not a detail.
3. **AI Overview presence is undercounted unless `load_async_ai_overview: true` is set**, and the surcharge formula is documented two incompatible ways [R01 §1.4, §2.7].
4. **First-party AI data from Google and Microsoft has no API.** GSC generative AI reports and Bing AI Performance are UI plus export only [R05 §1.7, §2.3]. We need an upload path.
5. **Official LLM APIs are benchmarks, not the product.** Gemini grounding terms forbid analysing grounded results, and Perplexity Sonar went legacy two days before this research [R04 §2.5, §4.1].
6. **The infrastructure stack moved under us.** BullMQ 6 (2026-07-30) removed repeatable jobs and added a Postgres backend; WAL-G hangs against R2; the postgres 18 image changed its data path [R08 §0].
7. **Statistics decide the sampling plan.** With intra-prompt correlation near 0.5, more prompts beat more replicates once replicates reach about 3 [R08 §8.3].

---

## 2. DataForSEO: SERP, Keywords Data, Labs (R01)

### 2.1 Verified facts: endpoints, modes, prices

| Item | Value | Source |
|---|---|---|
| Standard flow | `POST /v3/serp/google/organic/task_post` (max 100 tasks per call), then pingback or `tasks_ready`, then `GET .../task_get/advanced/$id` (free) | R01 §1.1, §1.5 |
| Standard, normal priority | $0.0006 per page of 10 results; "5 minutes on average", target 45 minutes, "extended processing may occur" | R01 §1.2 |
| Standard, high priority | $0.0012 per page; "up to 1 minute on average" | R01 §1.2 |
| Live | $0.002 per page; one task per call; "up to 6 seconds"; top-100 Live takes 3 to 4 times longer than page 1 | R01 §1.2 |
| Depth rule | Billed per page of 10; `depth` rounds up to the next 10; default 10; max 700 (task_post), 200 (Live); unreturned results refunded | R01 §1.3 |
| Extra pages | Linear since the FAQ updated 2026-07-02: top-100 Standard = 10 x $0.0006 = $0.006. The 25% page-2+ discount ($0.00465) was still shown on 2026-04-11 | R01 §1.3 |
| `stop_crawl_on_match` | Up to 10 targets; billed for every page crawled until match | R01 §1.3 |
| Search operators | Task cost x 5 | R01 §1.4 |
| `calculate_rectangles`, `load_async_ai_overview` | "+ one base price" (pricing page, help center, task_post docs) versus "C = 2" multiplier (overview docs) | R01 §1.4 |
| `people_also_ask_click_depth` | 1 to 4; +$0.00015 per click, refunded for clicks not performed | R01 §1.4 |
| AI Mode SERP | $0.0012 / $0.0024 / $0.004 (2x Organic); `calculate_rectangles` doubles the charge | R01 §5.3 |
| Google Ads search volume | $0.06 per task Standard (up to 1,000 keywords, 1 to 3 hours); $0.09 Live, 12 requests per minute | R01 §4.1 |
| Labs | $0.012 per task + $0.00012 per item; Live only; 30 simultaneous requests; prices include the +20% of 2026-07-01 | R01 §4.3 |
| Monthly refresh, 10,000 keywords | Google Ads $0.60; Labs `keyword_overview` $1.38 (adds KD and intent) | R01 §9.5 |
| Account | Pay-as-you-go, $50 minimum top-up, no expiry; $1 trial credit; free sandbox with dummy data and callbacks | R01 §6 |

### 2.2 Verified facts: limits and operations

| Item | Value | Source |
|---|---|---|
| Rate limit | 2,000 calls per minute (POST + GET), raisable; error 40202 | R01 §1.5 |
| Concurrency | 30 simultaneous applies to Labs, AI Optimization and others. SERP API is not on that list. Error 40209 | R01 §1.5 |
| `tasks_ready` | 20 calls per minute, 1,000 ids per call, 3-day window; above 1,000 tasks per minute use callbacks | R01 §1.5 |
| Callbacks | `pingback_url` (GET) or `postback_url` (gzip POST, needs `postback_data`); `$id` and `$tag` placeholders; 10 s timeout, then the task goes to `tasks_ready` | R01 §1.5 |
| Callback source IPs | 144.76.154.130, 144.76.153.113, 144.76.153.106, 94.130.155.89, 178.63.193.217, 94.130.93.29 | R01 §1.5 |
| `webhook_resend` | Up to 100 ids per call, no double charge | R01 §1.5 |
| Retention | Regular and Advanced results 30 days; HTML 7 days; 40403 after that | R01 §1.5 |
| `tag` | Up to 255 characters, echoed in `data` | R01 §1.5 |
| `cost` | Top-level and per-task `tasks[].cost` in every response | R01 §6 |
| `user_data` | 6 calls per minute; price table excludes paid add-ons | R01 §6 |
| HTTP status | Always 200 except 401, 402, 404, 500. Errors live in `status_code` | R01 §6 |
| Rate limit headers | None documented; none seen on an unauthenticated call *(UNVERIFIED for authenticated calls)* | R01 §6 |
| Cost controls | Daily cost limits (40203), duplicate-task limits per hour and day (40205, 40206), IP allow list (40207) | R01 §6 |
| ToS (12 June 2026) | No clause against resale, storage or display; clause 7.1 bars use that competes with search engines; 7.2 makes the customer indemnify | R01 §7 |

### 2.3 Verified facts: field semantics

| Field | Meaning | Source |
|---|---|---|
| `rank_group` | Position among items of the same `type`. Organic #1 stays 1 even below ads and an AIO | R01 §2.3 |
| `rank_absolute` | Position among all SERP items; right-column items restart at 1 | R01 §2.3 |
| `position` | Alignment `left` or `right`. **Not a rank** | R01 §2.3 |
| `start=N` offset | `rank_absolute` and `rank_group` restart at 1 on the first crawled page | R01 §1.3 |
| `ai_overview.asynchronous_ai_overview` | true = loaded async, false = cached | R01 §2.7 |
| `ai_overview.references[]` | `source`, `domain`, `url`, `title`, `text` | R01 §2.7 |
| AIO placement | Also inside Knowledge Graph, PAA and Product Considerations | R01 §2.7 |
| Google Ads `competition` | String `HIGH`/`MEDIUM`/`LOW` | R01 §4.1 |
| Labs `keyword_info.competition` | Float 0 to 1; `competition_level` is the string | R01 §4.4 |
| `keyword_difficulty` | Integer 0 to 100, logarithmic, from top-10 link profiles | R01 §4.4 |
| Labs freshness | Keywords DB monthly; SERP DB 30 to 90 days per query; `ranked_keywords` weekly | R01 §4.5 |
| ETV | New algorithm default for all accounts from 2026-11-01 | R01 §4.5 |

### 2.4 Design impact

- **Depth defaults.** Track top-20 daily and top-100 weekly on the Standard queue, and use `stop_crawl_on_match` for "find my domain" checks *(Recommendation from R01 §9.3)*. At 10,000 keywords, desktop, daily: top-10 $180, top-20 $360, top-100 $1,800 per month [R01 §9.2, §9.3]. Depth lives in `seo.tracked_keyword_config_history`; `seo.serp_snapshots.depth_requested` and `depth_returned` record what was asked and returned.
- **Cost truth.** Write `tasks[].cost` to `ops.provider_cost_events` with `cost_source = 'provider_reported'`. The price book (`conditions` such as `{"priority":"standard","depth_pages":10}`) is for pre-flight only. Alert when reported cost per task deviates from the price book by more than 10%, because the 2026 depth change was not announced in the update feed.
- **Ranks.** Store organic order from `rank_group` of `type: organic` in `organic_url_ids` and whole-SERP position from `rank_absolute` in `organic_abs_positions`. Never read `position`.
- **Callbacks.** The pingback handler in `api` enqueues `fetch_task` on `provider.dataforseo` and returns well inside 10 s. `poll_ready` every 2 minutes while tasks are outstanding stays as the fallback (06 §4.2, 21 §5.2). `tag` carries the `ops.collection_tasks` id.
- **Rate limiting.** The shared limiter on `provider.dataforseo` at 1,000 calls per minute, 50% of 2,000 (06 §3.2, 21 §7), is correct for SERP. Labs and AI endpoints also need a 30-concurrency semaphore.
- **Keyword metrics.** Screen Google Ads batches for policy-restricted terms, since one such keyword returns no data for the whole 1,000-keyword batch [R01 §4.1]. Map `competition` by source into `seo.keyword_metric_snapshots`, and store the ETV algorithm flag.
- **Labs is for discovery, not tracking.** Daily rank comes from the SERP API only *(Inference, R01 §4.5)*.

### 2.5 Open questions

- Additive or multiplicative billing for `load_async_ai_overview` and `calculate_rectangles` at depth above 10 (S-01).
- Linear or 0.75x billing for extra pages on our account (S-01).
- Rate limit headers on authenticated responses (S-01).
- Are callbacks signed? The research records source IPs but no signature scheme; 24-security.md already assumes unsigned (S-01).
- Written confirmation from DataForSEO sales that multi-tenant resale and our retention period fit clause 7.1 (vendor question).

---

## 3. DataForSEO: AI endpoints (R02)

### 3.1 Verified facts: surfaces and prices

| Surface | Endpoint | Std / Priority / Live | Fan-out field | Citation fields | Source |
|---|---|---|---|---|---|
| ChatGPT consumer UI | `/v3/ai_optimization/chat_gpt/llm_scraper/` | $0.0012 / $0.0024 / $0.004 | `fan_out_queries` (needs `force_web_search`, still not guaranteed) | `sources` (cited), `search_results` (retrieved) | R02 §1.3, §1.4 |
| Gemini consumer UI | `/v3/ai_optimization/gemini/llm_scraper/` | same | none | `sources` | R02 §1.3 |
| Google AI Mode | `/v3/serp/google/ai_mode/` | same | none | `references` | R02 §4.1 |
| Google AI Overview | `ai_overview` item in Organic SERP | $0.0006 base, + async surcharge when fetched | none | `references` | R02 §4.2 |
| Official APIs (ChatGPT, Gemini, Claude, Perplexity) | `/v3/ai_optimization/{platform}/llm_responses/` | Live $0.0006 + vendor charge; Standard $0.0002 + $0.01 prepay | `fan_out_queries` | `annotations` | R02 §1.2 |
| Mentions database | `/v3/ai_optimization/llm_mentions/` | $0.1 per request + $0.001 per row | ChatGPT only | `sources` aggregates | R02 §6 |
| AI search volume | `/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live` | $0.01 per task + $0.0001 per keyword | n/a | n/a | R02 §5 |

### 3.2 Verified facts: fields, limits, caveats

| Item | Value | Source |
|---|---|---|
| ChatGPT scraper items | `chat_gpt_text`, `_table`, `_navigation_list`, `_images`, `_local_businesses`, `_products`, `_ad`; `brand_entities[]` since 2025-12-04 | R02 §1.3, §2 |
| ChatGPT ads | `chat_gpt_ad.is_rendered` (since 2026-08-13): ads can be served but not shown | R02 §9.8 |
| Gemini scraper schema | No `fan_out_queries`, `brand_entities`, `search_results` or `check_url`; items limited to text, table, images | R02 §1.3 |
| `model` field | `gpt-4o` in the 2025-08 ChatGPT example; `"Fast"` for Gemini | R02 §9.5 |
| Scraper location | ChatGPT: 215 country-level locations; Gemini: over 210 locations plus GPS `location_coordinate` | R02 §1.3 |
| Scraper login state | Not documented. Anonymous desktop session *(Inference)* | R02 §2, §9.3 |
| Scraper turnaround | Pricing cards: Standard up to 45 min, Priority up to 5 min, Live up to 90 s. Same page intro: 5 min and 1 min. Docs: Live up to 120 s | R02 §1.3 |
| AI Mode depth | Overview says depth above default is billed per 20 results; Task POST and Live pages list no `depth` parameter | R02 §4.1 |
| AI Mode paid | `ai_overview_paid` since 2026-07-30; its `url` is the advertiser homepage | R02 §4.1, §9.8 |
| Async AIO | `load_async_ai_overview: false` returns `ai_overview: null` for async AIOs; true adds a surcharge refunded when no async AIO is fetched | R02 §4.2 |
| LLM Responses | "reflects what the underlying model produces, not what appears in the platform's interface" | R02 §1.2, §9.1 |
| LLM Responses Live concurrency | 30 per account per platform; Live timeout 120 s; Standard completes within 72 h | R02 §8 |
| Gemini LLM Responses annotations | Built from `groundingSupports` since 2026-07-28, can repeat URLs; `url` is a Vertex redirect, `direct_url` added 2026-09-17 | R02 §1.2, §9.6 |
| Mentions DB | 387,022,490 prompts on 2026-09-29 (27.6M ChatGPT, 359.4M Google AIO); ChatGPT is US English only; 60-day full refresh | R02 §6 |
| `ai_search_volume` | AI Keyword Data: derived from Google PAA questions. In LLM Mentions: Google volume for `google`, PAA question counts for `chat_gpt`; not comparable | R02 §5, §6 |
| Retention | Task GET results free for 30 days | R02 §8 |

### 3.3 Design impact

- **Engine set for V1.** ChatGPT scraper (natural or forced web search per the S-04 rule in 07 §4.2; pingback plus polling per ADR-018), Gemini scraper, AI Mode, and AIO piggybacked on the rank SERP with `load_async_ai_overview: true` [R02 §12]. Consumer scrapes land in `ai.observations` with `observation_class = 'consumer_ui'`; AIO and AI Mode with `'serp_ai'`.
- **Cited versus retrieved.** `ai.citations` comes from `sources` and `references` only. `search_results` go to `ai.retrieval_results` with `was_cited`. Citation share is computed from `ai.citations` only [R02 §9.7].
- **"Not exposed" is not "zero".** `ai.observations.fanout_count` defaults to 0, which conflates "engine exposes no fan-out" with "no fan-out happened". The per-engine capability `ai.engines.exposes_fanout` (04 §8.1) excludes non-exposing engines from fan-out denominators. Same for `brand_entities` and retrieval results.
- **Model drift.** Record `model_reported` on every row and mark a version boundary in charts when it changes (03 §9 rule 5).
- **Ads and duplicates.** Keep only `is_rendered: true` ChatGPT ads. Deduplicate Gemini LLM Responses annotations per answer and prefer `direct_url`.
- **Panel data is labelled.** LLM Mentions and AI Keyword Data carry `is_estimate: true` and a method string (03 §9 rule 6). They are discovery inputs, never our tracked visibility.
- **Cost envelope.** 1,000 prompts per week, 4 engines, Standard: $20.78 per month at R = 1, $62.35 at R = 3, $41.57 when only ChatGPT and Gemini are replicated 3 times [R02 §11]. Swapping the two scrapers for official-API LLM Responses raises the R = 1 case to about $295.52 *(Inference, R02 §11.5)*.
- **Scheduling windows.** Size `ops.schedules.window_hours` for the 45-minute Standard figure, not the 5-minute one, until S-04 measures it.

### 3.4 Open questions

- Scraper login state, account tier, location mechanism, and whether `model` reflects the UI picker (vendor question; S-04 records observed values).
- Real Standard and Priority turnaround distribution (S-04).
- Citation and fan-out presence rates with `force_web_search` (S-04).
- AI Mode depth billing (S-06).
- Whether replicates sent close together are independent draws (S-05).
- Current ChatGPT scraper language list (the CSV is dated 2023-05-02) and Gemini fan-out roadmap (vendor question).

---

## 4. Alternative providers (R03)

### 4.1 Verified facts

| Provider | Top-100 method and billable units | Position fields | AI surfaces | Fan-out text | Price anchor | Risk |
|---|---|---|---|---|---|---|
| DataForSEO | One task, 10 pages billed | `rank_group`, `rank_absolute` | ChatGPT, Gemini, AI Mode, AIO | ChatGPT | $0.60 per 1K pages Std | Baseline |
| Oxylabs | `pages=10`, 10 results billed *(Inference)* | `pos`, `pos_overall` | ChatGPT, Perplexity, Gemini, AI Mode, AIO | ChatGPT `search_queries` | $0.80 per 1K Google results (Advanced) | Co-defendant, Reddit v. SerpApi et al. |
| Bright Data | SERP API 10 requests; top-100 dataset "one billable request, regardless of page depth" (to validate) | `rank`, `global_rank` | ChatGPT, Perplexity, Gemini, Copilot, AI Mode | None (boolean `web_search_triggered`) | $1.50 per 1K PAYG, 5,000 free per month | Prevailed against Meta and X (2024) |
| SearchAPI.io | `google_rank_tracking` returns 100 organic per call (1 credit *Inference*) | `position` | ChatGPT, Perplexity, Gemini, AI Mode, AIO, Copilot | ChatGPT `search_queries` | $4.00 to $1.00 per 1K credits; 99.9% SLA | Smaller vendor |
| SerpApi | 10 searches | `position` | AIO, AI Mode, Copilot; no ChatGPT, Perplexity, Gemini | None | $25 to $3.75 per 1K | Defendant, Google v. SerpApi and Reddit v. SerpApi |
| ValueSERP | 10 credits | `position`, `position_overall` | AIO only | None | $1.60 to $1.00 per 1K | Acquired by ScraperAPI 2026-04-30 |

Google stopped honouring `num=100` on 2025-09-11 to 14, and has required JavaScript since 2025-01-15 [R03 §2]. SerpApi AIO `page_token` expires "within 1 minute" on one page and "within 4 minutes" on another [R03 §4.1].

### 4.2 Design impact

- **Adapter contract.** `packages/providers` exposes `SerpProvider.fetchTopN` and `AiAnswerProvider.ask` with declared capabilities (`supportsSingleCallTop100`, `supportsFanout`, `supportsStopOnMatch`, `asyncOnly`, `aioMode`) [R03 §7.1]. Adapters never touch the database (03 §4).
- **Normalisation.** Recompute organic rank ourselves from the concatenated, deduplicated list when a vendor restarts positions per page. `absolute_rank` is nullable.
- **Registry.** `ops.providers` seeds `searchapi` (the AI fallback in 05-provider-integrations.md) alongside `serpapi`, `brightdata` and `oxylabs` (04 §11.1).
- **Parity check.** A weekly 200-keyword cross-provider sample compares organic rank agreement and AIO presence, so a silent regression shows before failover [R03 §7.1].
- **Fallback order.** SEO: Oxylabs, with Bright Data promoted if its dataset billing holds. AI: SearchAPI.io, then Oxylabs. Do not rely on SerpApi alone.

### 4.3 Open questions

- Bright Data top-100 dataset billing and success rate; SearchAPI.io credits per 100-result call (S-12).
- Oxylabs LLM sources billed at the JS rate; Business and Corporate prices *(UNVERIFIED, third party only)*.

---

## 5. Official LLM APIs (R04)

### 5.1 Verified facts

| Provider | Cheapest search model used | Search fee | Fan-out field | Location | Terms constraint | Est. per 1,000 grounded prompts *(Inference)* |
|---|---|---|---|---|---|---|
| OpenAI | `gpt-6-luna` | $10 per 1K calls + content tokens | `web_search_call.action.queries` ("usually, but not always"; examples also show `action.query`) | `user_location` | Citations visible and clickable when shown | $10.43 to $11.23 |
| Google Gemini | `gemini-3.1-flash-lite` | $14 per 1K queries after 5,000 free per month (3.x); billed per query executed | `groundingMetadata.webSearchQueries` | `latLng` only; effect on Search *UNVERIFIED* | No cache, analyse, learn from, or programmatic link collection; show Search Suggestions | $15.28 |
| Anthropic | `claude-haiku-4-5` | $10 per 1K searches + result tokens | `server_tool_use.input.query` | `user_location` | Citations required when shown | $14.30 to $20.30 |
| Perplexity | Agent API `perplexity/sonar` | `web_search` $2.50 per 1K ($1.00 fast) | `search_results.queries[]` | `user_location` | None found *(UNVERIFIED)* | $4.58 to $4.83 |
| xAI | `grok-4.3` | $5 per 1K calls | SDK tool call arguments; Responses API field *UNVERIFIED* | None | None found *(UNVERIFIED)* | $7.38 to $13.63 |

Other verified points: `chat-latest` is "Latest Instant model used in ChatGPT" [R04 §1.1]. `gpt-4o-search-preview` shut down 2026-07-23 [R04 §1.1]. Gemini 2.5 access is limited to existing users [R04 §2.1]. Perplexity says the API uses "the same search system as the UI with differences in configuration" [R04 §4.7]. xAI Live Search was replaced by Agent Tools *(UNVERIFIED date)* [R04 §5.2].

### 5.2 Design impact

- **Separate class.** Official API rows use `observation_class = 'official_api'`, run on `provider.llm`, and are never pooled with consumer rows (05-provider-integrations.md: default 100 core prompts, weekly).
- **Gemini grounding stays off** in automated collection until counsel clears the terms. Gemini consumer data comes from the DataForSEO scraper instead.
- **Perplexity adapter targets the Agent API**, not Sonar Chat Completions.
- **Record `model_requested` and tool version** on every call; aliases such as `chat-latest` and `grok-4.7` move.
- **Answer viewer** renders citations as visible, clickable links, which satisfies the OpenAI and Anthropic display rules.
- **Fan-out parsers** accept both `action.query` and `action.queries` for OpenAI.

### 5.3 Open questions

- Does `gpt-5-search-api` also pay the $10 per 1K call fee *(UNVERIFIED)*?
- Are Gemini `groundingChunks[].web.uri` values Vertex redirects in practice *(UNVERIFIED)*?
- Does DataForSEO's Perplexity LLM Responses endpoint change behaviour now that Sonar sync requests are reformulated as Agent API requests *(Inference; S-13)*?

---

## 6. First-party data (R05)

### 6.1 Verified facts

| Source | AI-specific data | API for the AI data | Limits and retention | Source |
|---|---|---|---|---|
| GSC Search Analytics | AIO and AI Mode clicks and impressions are inside `type=web`; no AI `searchAppearance` value | n/a | 1,200 QPM per site and per user; 40,000 QPM and 30M QPD per project; 25,000 rows per call; about 50K rows per day per type; 16 months; 2 to 3 day lag; hourly for 10 days | R05 §1.1, §1.2, §1.4 |
| GSC generative AI reports | Impressions only, by page, country, device, date; no queries, no clicks; worldwide since 2026-08-31 | **No**; UI export only (1,000-row table) | Two results from one site in one AI feature count once | R05 §1.7 |
| GSC bulk export (BigQuery) | Anonymised rows present with `is_anonymized_query = true`; no AI field | n/a | Owner setup; no backfill | R05 §1.6 |
| Bing Webmaster API | JSON only since SOAP and POX retired 2026-08-31; OAuth or one API key per user; `GetQueryStats` refreshed weekly | n/a | Rate limits not published | R05 §2.1, §2.2 |
| Bing AI Performance | Citations, cited pages, grounding queries (sampled, not user prompts), Intents, Topics, Citation Share | **No**; CSV and Excel export only | "A citation ... does not represent traffic, clicks, or user engagement" | R05 §2.3 |
| Cloudflare AI Crawl Control | Per-zone AI crawler requests, status codes, paths; referrals on paid plans | Yes, GraphQL `httpRequestsAdaptiveGroups` | 300 queries per 5 min per user; Free 7 days retention and 24 h window | R05 §3.1, §3.2 |
| Cloudflare Radar | Global AI bot traffic, crawl-to-refer ratio | Yes | CC BY-NC 4.0 | R05 §3.3 |
| GA4 | "AI Assistant" channel, medium `ai-assistant`, since 2026-05-13; excludes AI Overviews and AI Mode (those stay Organic Search) | Standard dimensions | 200,000 tokens per day, 40,000 per hour, 14,000 per project per property per hour, 10 concurrent | R05 §4.1, §4.3 |
| Server logs | Crawler and user-fetcher UAs with IP JSON lists | n/a | Google-Extended and Applebot-Extended never appear in logs | R05 §5 |

### 6.2 Design impact

- **Upload path.** Accept GSC generative AI exports into `fp.gsc_generative_ai_daily` (report kinds `gsc_genai_search`, `gsc_genai_discover`) and Bing AI Performance exports into `fp.bing_ai_performance` (doc 18 sections 5, 6.2 and 12.1). Store the export filter in `dimensions` and never sum across differently filtered exports [R05 §6.2].
- **No measured AIO clicks.** Any AIO or AI Mode click figure is modelled and carries `is_estimate: true`.
- **GSC ingest.** One-day windows per `type`. Page totals from `[date,page]` with `byPage` go to `fp.gsc_page_daily`. Property totals from `[date,country,device]` with `byProperty` go to `fp.gsc_property_daily` (doc 18 section 4.2). Detail rows are paged by 25,000; `data_state` switches `all` to `final` and rows are replaced per (integration, date), as 04-data-model.md §10 already specifies. Expose "hidden query share" = total minus sum of query rows *(Inference)*.
- **Rate limiter keys.** `provider.firstparty` limits by OAuth user, by site and by our GCP project. An agency login owning 200 properties shares one 1,200 QPM budget *(Inference)*. GA4 budgets against the 14,000 per project per property per hour cap.
- **Cloudflare.** Poll at least daily and keep our own history; read the `settings` node per zone for plan limits.
- **Radar** is internal benchmark only until Cloudflare grants commercial use.
- **AI referral labels.** Store Google's `ai-assistant` label and our own referrer classifier side by side in `fp.ai_referral_daily` (doc 18 section 7.3).

### 6.3 Open questions

- Bing API history depth and rate limits (measure on first connect).
- How GA4 resolves `utm_source=chatgpt.com` without `utm_medium` against the `ai-assistant` rule *(UNVERIFIED; S-14)*.
- OAuth verification tier of `webmasters.readonly` *(UNVERIFIED)*; service account as GSC property user *(UNVERIFIED)*.
- Does `httpRequestsAdaptiveGroups` share the retention of `httpRequestsAdaptive` *(Inference; S-14)*?

---

## 7. Open-source projects (R06)

### 7.1 Verified facts

| Project | License | Idea worth reusing | Problem seen |
|---|---|---|---|
| Limelit Open | Apache-2.0 | Branded-prompt exclusion, `no_answer_surface` status, `n` on every metric, `list_rank`, source-type taxonomy, match offsets | Dashboard auth not found; binds all interfaces *(Inference)* |
| Lettertrace | MIT | Longest-first alias regex with link-surface blanking; no domain-derived mention terms; Wilson intervals and a thin-sample verdict; list-style prompts named about 3.7 companies per answer versus about 0.1 for "best X for Y" | 96 KB single provider module |
| Cloro geo-tracker | MIT | Raw response stored once; derived rows rebuilt by `EXTRACTION_REVISION`; HMAC-derived webhook token | One secret for everything |
| OpenSEO | MIT | Config, keywords, runs, snapshots; partial unique index for one active run; `match_case`; admission budget per cron tick sized to 2,000 calls per minute | Hosted version adds 28% markup |
| Elmo | MIT | pg-boss singleton key per prompt; queue retries set to zero after paid calls | Denormalised arrays early on |
| Ansvisor | MIT | Position term shrunk by `mentions / (mentions + 20)` | Counts domains as mentions; unsigned webhooks by default |
| Serposcope | MIT (archived) | Full SERP stored; rescan backfills competitors added later | Captcha solving, raw Google scraping |
| OneGlanse, Habibi, AEO Radar, OpenCited | MIT, custom, MIT, none | Evidence screenshots; N samples per prompt | Logged-in UI automation; LLM judge for core numbers; DB downloadable (AEO Radar) |

### 7.2 Design impact

- **Denominators.** Headline metrics exclude branded prompts and observations where no answer surface rendered (`ai.observations.status = 'empty'`, `seo.serp_snapshots.ai_overview_state = 'absent'`).
- **Extraction** is deterministic alias matching in `packages/extraction`; LLMs only for sentiment and recommendation on already-detected entities. Our `derivation_id` (which pins `extractor_version` in `ai.derivations`) plus `is_current` on `ai.entity_mentions` implements the Cloro revision pattern.
- **Paid calls are not retried by the queue.** BullMQ `attempts` covers only failures before the provider accepts a task; after acceptance, recovery goes through `ops.collection_tasks.status` and `webhook_resend` or `task_get`.
- **Run guard.** `ops.collection_runs` has `UNIQUE (schedule_id, window_start)`, which matches the OpenSEO guard for scheduled runs. Runs without a schedule are not guarded by their window (migration 0006).
- **Licensing.** Copy MIT and Apache-2.0 code only with notices; read AGPL, GPL, custom and unlicensed repos for ideas only [R06 Part D].

---

## 8. Commercial products (R07)

### 8.1 Verified facts

| Topic | Finding | Source |
|---|---|---|
| Visibility denominators | Peec: brand responses / all responses. Profound overview: / responses naming at least one brand (its glossary reportedly uses all). On one 96-answer sample with 54% naming no vendor, 20.8% versus 45.5% | R07 §4.3 |
| Position meaning | Brand order (Peec, Otterly), citation order (Semrush), text quartile (Scrunch) | R07 §4.3 |
| Sampling | Evertune: 100 samples per prompt; one run of one prompt ±44 points. Scrunch shows n in tooltips. Sielinski (arXiv 2603.08924): single-run rankings are unstable | R07 §4.4 |
| AIO in rank trackers | Semrush Position Tracking records an AIO citation as position 1 (toggle) | R07 §2.1 |
| Collection | Ahrefs, Profound, Semrush, SE Visible state UI capture; Peec labels UI and API channels | R07 §4.6 |
| CTR, position 1 | AWR July 2026 desktop US: 20.02% all SERPs, 9.69% with AIO. First Page Sage: 3.6% with AI answer, 22.6% without. Ahrefs GSC aggregate informational desktop with AIO: 1.6% | R07 §5 |
| AIO effect | Position 1 CTR falls 34.5% to 84% across studies; Seer shows an 85% rebound from Dec 2025 to Feb 2026 | R07 §6 |
| Prompt volume | Panels (Profound, Evertune), Google volume proxy (Ahrefs: "a modeling choice, not a measured relationship"), 1 to 5 score (Peec) | R07 §4.5 |
| Price per AI response | $0.0066 (ProRankTracker) to $0.082 (AthenaHQ) *(Inference)* | R07 §8 |
| Unit anchor | ProRankTracker bills 1 AI prompt check as 2 keyword checks | R07 §2.7 |

### 8.2 Design impact

- **Metric contract.** Every metric returns value, numerator, denominator and n (03 §9 rule 2). Default denominator is all valid responses; "responses naming no tracked brand" is its own metric.
- **"Position" is split** into `mention_order`, `structured_rank` and `prominence` on `ai.entity_mentions`, each named in the UI.
- **AIO citation stays separate from organic rank** on the keyword row.
- **CTR models** are time-varying, layout-aware, labelled with the estimator, and flagged `is_estimate`.
- **Unit economics.** Our Standard-queue cost of $0.0012 per consumer observation sits well below the $0.0066 to $0.082 market range per response *(Inference)*.

---

## 9. Infrastructure (R08)

### 9.1 Verified facts

| Item | Value | Source |
|---|---|---|
| Droplet | Basic `s-2vcpu-4gb`: 2 vCPU, 4 GiB, 80 GiB, 4,000 GiB transfer, $24 per month; next step `s-4vcpu-8gb` $48 | R08 §1.1 |
| Cloud Firewall | Free, network-based | R08 §1.2 |
| R2 pricing | $0.015 per GB-month Standard; 10 GB, 1M Class A and 10M Class B free per month; egress free | R08 §2.1 |
| R2 S3 gaps | No object versioning, no S3 Object Lock, no tagging | R08 §2.4 |
| R2 bucket locks | Age, date or indefinite; prefix-scoped; override lifecycle deletes | R08 §2.3 |
| PostgreSQL | 18.6 current; 19 Beta 4 on 2026-09-24; PG 19 defaults TOAST to `lz4` | R08 §3.1, §3.3 |
| Official postgres image, 18+ | `PGDATA=/var/lib/postgresql/18/docker`; mount `/var/lib/postgresql`; `/dev/shm` default 64 MB | R08 §3.9 |
| pg_dump | zstd and lz4 since PG 16; `-j` only with directory format | R08 §4.1 |
| WAL-G | v3.0.9: `wal-push` hangs against R2 (issue #2550, open) | R08 §4.2 |
| pgBackRest | 2.59.2 works with R2; slow restore with many small bundled files | R08 §4.2 |
| Redis licence | 8.x is RSALv2, SSPLv1 or AGPLv3; Valkey 9.1.2 is BSD-3 | R08 §5.1 |
| BullMQ | v6.0.0 on 2026-07-30; latest 6.3.10. Removed `repeat`, `debounce`, `Job#discard()`; ioredis is an optional peer dependency; `upsertJobScheduler` for recurring jobs; Groups are Pro only | R08 §5.3 |
| BullMQ Postgres backend | Parity for queues, flows, schedulers, rate limit, dedup; 1.5x to 2x lower throughput than Redis; uses `LISTEN` | R08 §5.4 |
| BullMQ Redis config | `maxmemory-policy noeviction`, AOF `everysec`, `maxRetriesPerRequest: null` on workers | R08 §5.2 |
| Docker and UFW | Published ports bypass UFW; default bind `0.0.0.0` | R08 §7.2 |
| Docker logs | `json-file` `max-size` defaults to unlimited | R08 §6.3 |
| Cloudflare proxy | Read timeout 125 s; Tunnel available on all plans with no inbound ports | R08 §7.5 |
| Free monitoring | Healthchecks 20 checks; Sentry 5,000 errors; Better Stack 10 monitors; Netdata 250 to 350 MB typical (too heavy for 4 GB) | R08 §6.1 |

### 9.2 Design impact

- **Compose.** Mount the postgres volume at `/var/lib/postgresql`, set `shm_size: 256mb`, set `default_toast_compression = lz4` on 18, cap container logs in `daemon.json`, and set `"ip": "127.0.0.1"` so a stray `ports:` stays local.
- **RAM budget** on 4 GB: `shared_buffers` 768 MB, Redis `maxmemory` 256 MB with `noeviction`, API 384 MB heap, worker 512 MB heap, 2 GB swap *(Inference, R08 §3.8)*. The two worker containers in 03 §5 must fit the worker allowance; S-08 measures this.
- **Queue code.** Use `upsertJobScheduler` for maintenance ticks and `deduplication` for debounced rollups; install ioredis explicitly. Tenant fairness without Pro Groups: interleave `addBulk` by project and use priorities (03 §6 already does).
- **Backups.** Launch with nightly `pg_dump -Fc -Z zstd` piped through `age` (two recipients, private key off-host) and `rclone rcat` to R2. Bucket lock on `logical/`. No WAL-G. pgBackRest later for PITR, on a prefix without a lock.
- **Network.** Publish only 80 and 443 (or none with Tunnel), plus a DO Cloud Firewall. Any request that waits on an LLM stays asynchronous because of the 125 s proxy timeout.
- **Callback source check.** If the API sits behind Cloudflare proxy or Tunnel, the DataForSEO IP allow list must read the forwarded client IP, not the socket address *(Inference)*.

---

## 10. Statistics and methodology (R08 §8, §9)

### 10.1 Verified facts and computed values

| Method | Use | Key numbers | Source |
|---|---|---|---|
| Wilson score interval | Per-prompt and per-engine rates | Half-width at p = 0.5: K = 3 ±0.375, K = 10 ±0.26, K = 20 ±0.20 *(Inference)*. Brown, Cai, DasGupta 2001 recommend Wilson or Jeffreys for small n | R08 §8.1, §8.2 |
| Kish design effect | Aggregate visibility with prompt as cluster | DEFF = 1 + (m - 1)ρ. 50 prompts x 5 runs at ρ 0.5: n_eff 83; x 10 runs: 91; 200 prompts x 3 at ρ 0.4: n_eff 333, MOE ±0.054 *(Inference)* | R08 §8.3 |
| Cluster bootstrap | Share of voice | B = 2,000, resample prompts not runs | R08 §8.4 |
| Paired differences | Same prompts across periods | Mean per-prompt difference with t interval (Miller 2024, arXiv 2411.00640) | R08 §8.5 |
| Newcombe hybrid score | Independent periods | 12/20 versus 6/20: CI -0.006 to 0.538, not significant *(Inference)* | R08 §8.5 |
| Benjamini-Hochberg | Alert flood control | q = 0.10 plus a minimum effect size | R08 §8.6 |
| Jaccard, RBO | Citation volatility | RBO p = 0.8 puts 86.1% of weight on the top 5 *(Inference)* | R08 §8.7 |
| URL canonicalisation | Citation grouping | RFC 3986 §6 safe rules; strip `utm_*`, `gclid`, `srsltid` and similar as lossy rules | R08 §9.2 |
| Registrable domain | `core.domains` | Public Suffix List via tldts 7.4.16; `allowPrivateDomains: true` for citations | R08 §9.3 |

### 10.2 Design impact

- `packages/domain` implements Wilson, cluster SE, prompt-level bootstrap, paired differences and BH as pure functions with gold tests.
- Sampling plan: R = 1 for every core prompt on every engine; R = 3 on ChatGPT and Gemini for a priority subset of up to 100 prompts (17 §7.3, ADR-010); grow the prompt panel before raising R (17-statistical-methodology.md).
- Volatility is reported as drift relative to within-period instability, from `ai.citations` domain sets.
- `canonicalizer_version` and the tldts version are recorded at ingest, so PSL updates arrive through code review.

---

## 11. Findings that changed our assumptions

| # | Finding | Evidence | What changed |
|---|---|---|---|
| 1 | **Top-100 now costs 10x top-10.** Billing per page of 10 began 2025-09-19; the 25% page-2+ discount was removed between 2026-04-11 and 2026-07-02 without an update post | R01 §1.3, §10 | Top-20 daily and top-100 weekly by default; price book alerting on reported cost |
| 2 | **AIO is undercounted without `load_async_ai_overview: true`.** Async AIOs come back as `ai_overview: null` | R01 §2.7, R02 §4.2, §9.9 | Flag on by default for tracked keywords; `ai_overview_state` distinguishes `present_async_loaded` |
| 3 | **Async AIO surcharge formula is ambiguous.** "+ one base price" versus "C = 2": $0.0066 versus $0.012 per depth-100 Standard task | R01 §1.4 | S-01 settles it before any budget is quoted |
| 4 | **Gemini API terms bar caching, analysing or programmatically collecting links from grounded results** | R04 §2.5 | Gemini grounding excluded from automated benchmarks |
| 5 | **Perplexity Sonar Chat Completions ended 2026-09-27**; async Sonar no longer supported | R04 §4.1 | Perplexity adapter targets the Agent API |
| 6 | **GSC generative AI report is UI and export only**; no AI `searchAppearance`, no BigQuery field | R05 §1.7 | Upload path into dedicated `fp` import tables (doc 18) |
| 7 | **Bing AI Performance is export only**, sampled, and not clicks; Bing API is JSON only since 2026-08-31 | R05 §2.1, §2.3 | Same upload path; "sampled" badge |
| 8 | **GA4 "AI Assistant" channel excludes AI Overviews and AI Mode** | R05 §4.1 | Google AI surfaces cannot be separated in GA4; label accordingly |
| 9 | **Cloudflare Radar data is CC BY-NC 4.0** | R05 §3.3 | Not shown in the paid product without permission |
| 10 | **BullMQ 6 has breaking changes and a Postgres backend** | R08 §5.3, §5.4 | Job code uses schedulers and dedup; dropping Redis becomes a later option |
| 11 | **WAL-G `wal-push` hangs against R2** | R08 §4.2 | pg_dump now, pgBackRest later |
| 12 | **R2 has no versioning or S3 Object Lock, but has bucket locks** | R08 §2.3, §2.4 | Bucket lock on `logical/`; token scoped to one bucket |
| 13 | **DataForSEO publishes callback source IPs** | R01 §1.5 | IP allow list on the pingback route; signature question stays open |
| 14 | **LLM Scraper login state is undocumented**; anonymous desktop sessions inferred | R02 §2, §9.3 | UI copy says "logged-out session" as an assumption; vendor question |
| 15 | **Gemini scraper has no fan-out, brand entities or retrieved results** | R02 §1.3 | Per-engine capability flags; fan-out metrics are ChatGPT-only at V1 |
| 16 | **Google wraps links in `google.com/goto` since Aug 2026**; unresolved in 52.26% of SERPs with AIO on 2026-08-27 before the fix | R01 §2.4 | Canonicaliser detects and flags goto URLs |
| 17 | **`position` in DataForSEO is left or right**, not a rank | R01 §2.3 | Parser reads `rank_group` and `rank_absolute` only |
| 18 | **Scraper Standard turnaround is quoted as 45 min and 5 min on the same page** | R02 §1.3 | Wider schedule windows until S-04 |
| 19 | **AI Mode depth billing is described but no depth parameter exists** | R02 §4.1 | Budget one page per task; S-06 |
| 20 | **Vendor visibility scores differ 2.2x on the same data** because of denominators | R07 §4.3 | Numerator, denominator and n on every metric |
| 21 | **Replicates buy little after about 3** at ρ near 0.5 | R08 §8.3 | Budget goes to prompts first |

---

## 12. Experiments required in Phase 0

Costs are provider spend at list price *(Inference)*, excluding engineering time. All DataForSEO runs use one tagged project so spend is attributable by `tag`.

Changed by [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) (2026-09-30): S-07 and S-08 are dropped because Better Auth and BullMQ are no longer in the stack; S-10 becomes Phase 1 work as the monthly restore drill (`restore-verify.sh`, no bucket lock). Phase 0 runs S-01 to S-06, S-09 and S-11. Readiness is polling only, so the pingback parts of S-01 are optional and the `tasks_ready` recovery path is the one that must pass.

| Id | Question | Method | Success criterion | Cost estimate |
|---|---|---|---|---|
| S-01 | How does the DataForSEO SERP task flow behave end to end, and how is it billed? | 400 Standard tasks: depth 10 and 100, each with and without `load_async_ai_overview`, 100 keywords. `pingback_url` with `$id` and `$tag`; record callback source IPs and headers; compare `tasks[].cost` with both formulas and with linear versus 0.75x depth pricing; call `webhook_resend` once; inspect authenticated response headers | Pingback received or recovered via `tasks_ready` for 100% of tasks; `tag` echoed on every task; add-on formula (additive or multiplicative) and depth rule (linear or 0.75x) determined from `cost` on at least 20 tasks per variant; price book rows updated; callback IPs match the published list; signature presence answered | Under $5 |
| S-02 | How large are raw advanced SERP payloads, and how well do they compress? | 100 keywords at depth 10, 20 and 100 (desktop and mobile); store raw JSON; compress with zstd level 3, 6 and 19 | Median and p95 raw and compressed bytes per depth; DM-2 estimate (30 to 60 KB at depth 100 after zstd 6) confirmed or the storage projection in 28-data-growth-scaling.md revised | Under $2 |
| S-03 | How much AIO do we miss without async loading? | 500 keywords, desktop, depth 10, run twice the same hour: flag off and flag on | AIO presence rate for both runs with 95% Wilson intervals; share with `asynchronous_ai_overview: true`; refund rate from `cost`; whether an async AIO is detectable when the flag is off (needed for `present_not_loaded`); default setting decided | Under $1 |
| S-04 | What do the ChatGPT and Gemini LLM Scraper payloads contain in practice? | 200 prompts x 2 engines Standard; ChatGPT also without `force_web_search`; 50 prompts on Priority; 20 Live | Presence rate per field (`sources`, `search_results`, `fan_out_queries`, `brand_entities`, ads); citation and fan-out presence with and without `force_web_search`; payload size p50/p95 (DM-3); turnaround p50/p95/p99 for Standard and Priority; observed `model` values | $1 to $2 |
| S-05 | Are replicates independent draws? | 30 prompts x 20 replicates on ChatGPT and Gemini scrapers (AI Mode optional), submitted in one batch; account duplicate-task limits (40205, 40206) checked first | Exact-duplicate answer rate (`answer_hash`) per engine; within-run cited-domain Jaccard distribution; ICC estimate. Replicates count as independent if at most 20% of pairs are byte-identical (17-statistical-methodology.md A1); otherwise spacing rule set | $1.44 to $2.16 |
| S-06 | What do AI Mode payloads look like, and is depth billed? | 200 keywords Standard; 20 with a `depth` value to see if it is accepted or rejected; 20 with `calculate_rectangles` | Field presence (`references`, `ai_overview_paid`, shopping); sizes; `cost` per variant; depth behaviour documented | Under $1 |
| S-07 (dropped by ADR-022) | Does Better Auth work with our schema rules? | Better Auth with Kysely adapter, `auth` schema, uuid ids, organization plugin, API key plugin, 2FA; generate types with `kysely-codegen` | Sign-up, sign-in, org create, invite, role change, API key auth all pass; every auth table in `auth` with uuid PKs; no writes to `public`; RLS helper coexists (DM-1) | $0 (1 to 2 engineer-days) |
| S-08 (dropped by ADR-022) | Does BullMQ 6 on Redis 8 hold our target load on the 4 GB droplet? | Target droplet with the full Compose stack; queues from 03 §6 at V1 concurrency; `upsertJobScheduler`, deduplication, rate limiter at 1,000 calls per minute against a mock provider; kill and restart workers | Rate limit never exceeded; zero lost jobs across restarts; schedulers fire once per tick after restart; dedup collapses repeated rollups; Redis under 256 MB with `noeviction`; no swap above 256 MB sustained | Under $2 of droplet time |
| S-09 | Do our key queries meet targets on 12 months of data? | Generate a synthetic 12-month dataset (for example 10,000 keywords daily and 1,000 prompts x 4 engines x 3 replicates daily) on the target droplet; run dashboard queries with `EXPLAIN (ANALYZE, BUFFERS)` | DM-4 SOV over 12 weeks under 200 ms; overview under 300 ms, lists and rank history under 500 ms, matrix under 800 ms p95 (NFR-02); partition pruning visible; disk and TOAST sizes recorded | Under $5 of droplet time |
| S-10 (moved to Phase 1 by ADR-022) | Can we restore from backup, and how long does it take? | Nightly script: `pg_dump -Fc -Z zstd` \| `age` \| `rclone rcat` to R2 with bucket lock on `logical/`; restore on a separate host into `postgres:18`; sanity queries; attempt delete with the backup token | Restore completes and row counts match; RTO and dump time measured; a failed `pg_dump` fails the pipeline and pings Healthchecks with non-zero status; locked object cannot be deleted | Under $1 (R2 free tier) |
| S-11 | How clean are stored URLs after canonicalisation? | Run the canonicaliser over URLs from S-02 to S-06 payloads | Count of `google.com/goto` URLs, tracking parameters and redirect hosts (Vertex, `utm_source=chatgpt.com`); 100% of goto URLs detected and flagged | $0 (reuses payloads) |
| S-12 | Are the fallback providers' top-100 billing claims true? | Bright Data top-100 dataset and SearchAPI.io `google_rank_tracking` on 100 keywords each; compare ranks with DataForSEO | Billable units per keyword known; organic rank agreement with DataForSEO measured; fallback order in 05-provider-integrations.md confirmed or changed | $0 to $40 (free tiers first) |
| S-13 (optional in Phase 0; required before Phase 14) | How do official API fan-out queries compare with the ChatGPT scraper? | 100 core prompts through OpenAI Responses (`chat-latest` with `web_search`) and Perplexity Agent API; same prompts via ChatGPT scraper; no Gemini grounding | Fan-out presence and overlap with scraper `fan_out_queries`; cited-domain Jaccard between API and UI; cost per prompt measured | Under $10 |
| S-14 (optional in Phase 0; required before Phase 12) | What do first-party connectors return on a real property? | Connect one GSC property (16-month backfill), one GA4 property, one Cloudflare zone | GSC quota errors and load time recorded; GA4 classification of `utm_source=chatgpt.com` sessions observed; Cloudflare `settings` retention recorded per plan | $0 |
| S-15 | What is the DataForSEO standard-queue turnaround distribution by hour of day (UTC)? | As defined in 06 §11 (defined there, listed here so S-01 to S-16 have one index) | p50 and p95 known; window sizing in doc 21 confirmed | not estimated; see 06 §11 |
| S-16 | LLM Responses: what does a call cost for the pinned benchmark models with web search, and are `fan_out_queries` present? | As defined in 07 §12 | Benchmark budget set | not estimated; see 07 §12 |

---

## 13. Conflicts between sources

| Topic | Conflict | Resolution for now |
|---|---|---|
| Top-100 billing | R01 dates the linear rule to the 2026-07-02 FAQ and shows the 0.75x rule on the 2026-04-11 copy. R02 §4.2 still describes extra pages at 0.75x. R03 §3.1 reads the 2025-09-13 notice and the FAQ as 10x and prices a range | Budget at linear ($0.006); S-01 decides |
| Async AIO surcharge | R02 §11 treats it as additive; R01 §1.4 documents the multiplicative reading | Budget at the higher figure until S-01 |
| Scraper turnaround | 45 min versus 5 min Standard on one pricing page; 90 s versus 120 s Live | Plan for 45 min; S-04 |
| DataForSEO Perplexity LLM Responses | R02 describes it as the official Sonar API; R04 shows Sonar went legacy on 2026-09-27 | Treat its behaviour as unknown; S-13 |
| AIO prevalence | AWR 43% of desktop SERPs (July 2026) versus First Page Sage 81.6% of US queries (Sep 2026) | Measure our own rate from `seo.serp_snapshots` |
| Bing history depth | Help page says 6 months; Bing blog says 16 months; 24 months *UNVERIFIED* | Measure on connect |

---

## 14. Sources

All URLs accessed 2026-09-29. This is a selection of the primary sources behind the findings above. The full, per-claim source lists are in research/01 to research/08.

**DataForSEO SEO (R01)**
- https://docs.dataforseo.com/v3/serp/google/organic/task_post/
- https://docs.dataforseo.com/v3/serp/google/organic/task_get/advanced/
- https://dataforseo.com/pricing/google-serp/google-organic-serp-api
- https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq
- https://dataforseo.com/help-center/serp-api-cost-explained
- https://web.archive.org/web/20260411140435/https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq
- https://dataforseo.com/help-center/how-to-scrape-google-ai-overviews-with-serp-api
- https://dataforseo.com/help-center/pingbacks-postbacks-with-dataforseo-api
- https://dataforseo.com/help-center/rate-limits-and-request-limits
- https://dataforseo.com/help-center/rank-absolute-vs-rank-group
- https://docs.dataforseo.com/v3/appendix/errors/
- https://docs.dataforseo.com/v3/appendix/user_data/
- https://dataforseo.com/update/googles-goto-rollout-we-already-resolve-99-99-of-urls
- https://dataforseo.com/update/pricing-update-in-dataforseo-apis
- https://dataforseo.com/pricing/keywords-data/google-ads
- https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api
- https://dataforseo.com/terms-of-service

**DataForSEO AI (R02)**
- https://docs.dataforseo.com/v3/ai_optimization/overview/
- https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_post/
- https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/
- https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/task_get/advanced/
- https://docs.dataforseo.com/v3/serp/google/ai_mode/overview/
- https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/
- https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live/
- https://dataforseo.com/pricing/ai-optimization/llm-scraper
- https://dataforseo.com/pricing/ai-optimization/llm-responses
- https://dataforseo.com/pricing/google-serp/google-ai-mode-serp-api
- https://dataforseo.com/pricing/ai-optimization/llm-mentions
- https://dataforseo.com/help-center/what-is-llm-scraper-api-and-what-data-does-it-provide
- https://dataforseo.com/help-center/how-to-access-search-queries-data-from-chatgpt
- https://dataforseo.com/help-center/what-is-ai-search-volume-in-dataforseo

**Alternative providers (R03)**
- https://serpapi.com/pricing
- https://docs.brightdata.com/scraping-automation/serp-api/get-top-100-google-results
- https://brightdata.com/pricing/web-scraper
- https://oxylabs.io/products/scraper-api/web/pricing
- https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt.md
- https://www.searchapi.io/pricing
- https://www.searchapi.io/docs/google-rank-tracking-api
- https://www.searchapi.io/docs/chatgpt-api
- https://www.courtlistener.com/docket/71720563/reddit-inc-v-serpapi-llc/
- https://serpapi.com/blog/google-tried-again-were-moving-to-dismiss-their-claims-a-second-time/

**Official LLM APIs (R04)**
- https://developers.openai.com/api/docs/guides/tools-web-search.md
- https://developers.openai.com/api/docs/pricing.md
- https://ai.google.dev/gemini-api/docs/google-search
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/terms
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md
- https://platform.claude.com/docs/en/about-claude/pricing.md
- https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md
- https://docs.perplexity.ai/docs/getting-started/pricing.md
- https://docs.perplexity.ai/docs/resources/faq.md
- https://docs.x.ai/developers/tools/web-search.md
- https://docs.x.ai/developers/pricing.md

**First-party data (R05)**
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/limits
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
- https://support.google.com/webmasters/answer/16984139?hl=en
- https://developers.google.com/search/docs/appearance/ai-features
- https://learn.microsoft.com/en-us/bingwebmaster/getting-access
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi?view=bing-webmaster-dotnet
- https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview
- https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c
- https://developers.cloudflare.com/ai-crawl-control/reference/graphql-api/
- https://developers.cloudflare.com/analytics/graphql-api/limits/
- https://developers.cloudflare.com/radar/
- https://support.google.com/analytics/answer/9756891?hl=en
- https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- https://developers.openai.com/api/docs/bots
- https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests

**Open-source projects (R06)**
- https://github.com/limelit-co/open
- https://github.com/letterstory/lettertrace
- https://github.com/cloro-dev/geo-tracker
- https://github.com/every-app/open-seo
- https://github.com/elmohq/elmo
- https://github.com/ansvisor/ansvisor
- https://github.com/serphacker/serposcope

**Commercial products (R07)**
- https://docs.peec.ai/metrics/brand-metrics/visibility
- https://help.tryprofound.com/articles/3443229936-answer-engine-insights-overview
- https://www.evertune.ai/platform/methodology
- https://helpcenter.scrunchai.com/en/articles/13566677-scrunch-metrics-guide
- https://ahrefs.com/blog/brand-radar-methodology/
- https://www.semrush.com/kb/1435-ai-overview
- https://www.advancedwebranking.com/seo/organic-ctr
- https://firstpagesage.com/reports/google-click-through-rates-ctrs-by-ranking-position/
- https://arxiv.org/abs/2603.08924
- https://authoritytech.io/blog/brand-free-response-rate-ai-visibility-denominator-2026

**Infrastructure (R08)**
- https://www.digitalocean.com/pricing/droplets
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/buckets/bucket-locks/
- https://developers.cloudflare.com/r2/api/s3/api/
- https://www.postgresql.org/support/versioning/
- https://github.com/docker-library/docs/blob/master/postgres/content.md
- https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/changelog.md
- https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/postgresql.md
- https://docs.bullmq.io/guide/job-schedulers
- https://docs.bullmq.io/guide/going-to-production
- https://github.com/wal-g/wal-g/issues/2550
- https://pgbackrest.org/configuration.html
- https://rclone.org/s3/
- https://github.com/FiloSottile/age
- https://redis.io/legal/licenses/
- https://docs.docker.com/engine/network/packet-filtering-firewalls/
- https://developers.cloudflare.com/fundamentals/reference/connection-limits/
- https://developers.cloudflare.com/tunnel/

**Statistics and methodology (R08)**
- https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
- https://arxiv.org/abs/2411.00640
- https://www.rfc-editor.org/rfc/rfc3986#section-6
- https://publicsuffix.org/list/
- https://github.com/remusao/tldts
- https://www.semrush.com/kb/652-sensor
