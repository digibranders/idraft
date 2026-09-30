# 03. Alternative SERP and AI-answer providers (fallback evaluation)

Research date: 2026-09-29. All URLs below were accessed on 2026-09-29 unless marked otherwise.
Primary provider: DataForSEO. Candidates evaluated as fallbacks: SerpApi, Bright Data, Oxylabs, SearchAPI.io, Scrapingdog, Traject Data (ValueSERP), Zenserp, Apify, Serper (brief).

## Legend

| Tag | Meaning |
|---|---|
| VERIFIED | Read on the vendor's own docs, pricing page, API or official blog during this session. URL given. |
| VERIFIED (3rd party) | Read on a credible third-party source (court coverage, trade press). Not a vendor page. |
| INFERRED | Derived by us from verified facts (for example, arithmetic, or reading a billing rule onto a new case). |
| UNVERIFIED | Claim found only in secondary sources, or we could not load the primary page. Treat as a lead, not a fact. |

Method note: vendor pages were fetched with WebFetch and, where the summarizer was unreliable, re-downloaded raw with curl and grepped. Two summarizer errors were caught this way (an invented Oxylabs "billing per page" note, and an invented Bright Data `web_search_query` field). Neither appears below.

---

## 1. TL;DR

1. **Build the adapter.** Every vendor has a different depth model, position semantics, AI Overview retrieval flow and async model. Google changed the ground rules twice in 2025 (JavaScript required in January; `num=100` removed in September) and is litigating against one vendor. A thin `SerpProvider` and `AiAnswerProvider` interface with per-vendor adapters and a normalized result schema is cheap insurance.
2. **SEO fallback: Oxylabs** (lowest verified per-page Google rate among the large enterprise vendors, $0.80/1K on Advanced and about $0.50 to $0.60/1K on larger plans; costs 1.1x to 1.8x DataForSEO Standard at our volumes; 1 page = 1 result; `pos` and `pos_overall` fields; strong SERP feature parsing; pooled plan covers AI targets too). **Bright Data** is the alternative if its "Top 100 in one billable request" dataset holds up in a trial, which would make it the cheapest top-100 source on the market ($1.50/1K keywords PAYG).
3. **AI fallback: SearchAPI.io or Oxylabs.** SearchAPI.io covers ChatGPT, Perplexity, Gemini, Google AI Mode, AI Overview and Bing Copilot on one flat credit plan, and exposes ChatGPT `search_queries` (fan-out) plus `reference_links`, `web_results` and character-level `citations`. Oxylabs covers ChatGPT (with `search_queries`), Perplexity (with `related_queries`), Gemini and Google AI Mode. Bright Data has the widest engine list (ChatGPT, Perplexity, Gemini, Copilot, AI Mode) at $1.50/1K but its docs do not expose fan-out query text.
4. **Do not pick SerpApi as the only fallback.** It is the most mature SERP parser, but it is the named defendant in Google v. SerpApi (DMCA, amended complaint pending a second motion to dismiss) and in Reddit v. SerpApi et al. It has no ChatGPT, Perplexity or Gemini engine. It is also the most expensive at top-100 depth (10 searches per keyword).
5. **DataForSEO Standard stays the cheapest verified top-100 option** ($4.65 to $6.00 per 1K keywords; its own pages disagree, see section 3). Only three options undercut it, all needing a trial: the Bright Data top-100 dataset (about $1.50 per 1K keywords), SearchAPI.io `google_rank_tracking` (about $3.00 to $3.33 per 1K keywords if 1 credit per 100-result call) and Scrapingdog Light at 150K+ keywords (about $3.33 per 1K keywords).

---

## 2. Industry context (2025 to 2026)

| Date | Event | Effect on providers | Status |
|---|---|---|---|
| 2025-01-15 | Google requires JavaScript to serve Search results (anti-bot, later referred to as "SearchGuard" in litigation). | Scraping latency and cost rose; some SEO tools had outages. | VERIFIED (vendor blog): https://serpapi.com/blog/google-now-requires-javascript/ , https://oxylabs.io/blog/google-search-javascript |
| 2025-08 | Bing Search API retired (context only). | Pushes more AI and search tooling onto scraped SERPs. | UNVERIFIED in this session. |
| 2025-09-11 to 09-14 | Google stops honouring `num=100`; about 10 organic results per page. | Top-100 now needs about 10 page fetches per keyword on most vendors. | VERIFIED: https://serpapi.com/blog/google-experiments-with-restricting-results-per-page/ (posted 2025-09-16), https://dataforseo.com/update/google-organic-serp-api-critical-updates-depth (posted 2025-09-13) |
| 2025-09-19 | DataForSEO moves Organic SERP billing from per-100 to per-10 results. | Top-100 cost rose from $0.0006 to $0.00465 or $0.006 per keyword (Standard). | VERIFIED, see section 3. |
| 2025-10-22 | Reddit sues Perplexity, SerpApi, Oxylabs and AWMProxy (S.D.N.Y., DMCA anti-circumvention plus unjust enrichment). Alleges scraping of about 3 billion Google SERPs containing Reddit content in two weeks of July 2025. | Legal risk flag on SerpApi and Oxylabs. | VERIFIED (3rd party): https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681 , docket https://www.courtlistener.com/docket/71720563/reddit-inc-v-serpapi-llc/ |
| 2026-02 | Reddit files first amended complaint. Motions to dismiss argued (hearing reported for 2026-06-30). No ruling found. | Ongoing. | VERIFIED (3rd party): https://chatgptiseatingtheworld.com/2026/02/09/reddit-files-1st-amended-complaint-v-serpapi-oxylabs-awmproxy-perplexity-ai/ . Hearing date: UNVERIFIED (aggregator only). |
| 2025-12-19 | Google sues SerpApi (N.D. Cal., DMCA 1201 circumvention of SearchGuard). | Legal risk flag on SerpApi. | VERIFIED (3rd party): https://www.searchenginejournal.com/google-files-dmca-suit-targeting-serpapis-serp-scraping/563847/ |
| 2026-07-20 | Court dismisses Google's DMCA claims over non-copyrighted SERP content with prejudice; claims over licensed/copyrighted content dismissed with leave to amend. | Partial win for SerpApi. | VERIFIED (3rd party): https://www.seroundtable.com/google-amends-lawsuit-against-serpapi-41860.html ; searchengineland article URL returned HTTP 403 in this session. |
| 2026-08-10 | Google files amended complaint based on licensed content (Reddit licence plus two unnamed licences; Knowledge Panel images). | Case continues on narrower grounds. | VERIFIED (3rd party): https://www.mediapost.com/publications/article/417185/google-renews-battle-with-serpapi-over-scraping.html |
| 2026-08-25 | SerpApi moves to dismiss a second time; states "nothing about your service changes" and US Legal Shield unchanged. | Service continuity claimed. | VERIFIED: https://serpapi.com/blog/google-tried-again-were-moving-to-dismiss-their-claims-a-second-time/ |
| 2026-04-30 | ScraperAPI acquires Traject Data (ValueSERP, Scale SERP, SerpWow, Rainforest). | Product consolidation risk for ValueSERP. | VERIFIED: https://www.scraperapi.com/blog/scraperapi-traject-data-acquisition/ |
| 2026-07-01 | DataForSEO raises prices about 20% on eight APIs (Backlinks, Labs, Keywords Data, On-Page, etc.). SERP API not on the list. $100 monthly minimum for LLM Mentions and Backlinks removed. | Baseline SERP prices unchanged. | VERIFIED: https://dataforseo.com/update/pricing-update-in-dataforseo-apis |

Legal precedent favouring public-data scraping (relevant to Bright Data): Meta v. Bright Data (Jan 2024, court found logged-out scraping of public data did not breach Meta's terms; Meta dropped the case) and X Corp v. Bright Data (dismissed May 2024). VERIFIED (3rd party): https://www.mediapost.com/publications/article/392920/bright-data-didnt-violate-metas-terms-by-scrapin.html , https://www.proskauer.com/release/proskauer-secures-dismissal-of-scraping-claims-against-bright-data . Neither case involved Google Search or DMCA 1201, so they do not settle the SERP question.

---

## 3. Baseline: DataForSEO (primary)

### 3.1 Google Organic SERP

| Item | Value | Status |
|---|---|---|
| Endpoint | `POST /v3/serp/google/organic/task_post` (Standard), `/live/advanced` (Live) | VERIFIED: https://docs.dataforseo.com/v3/serp/google/organic/task_post/ |
| Base price per page (10 results) | Standard normal $0.0006; Standard high priority $0.0012; Live $0.002 | VERIFIED: https://dataforseo.com/apis/serp-api |
| Turnaround | Standard about 5 min (target up to 45 min); Priority up to 1 min; Live up to 6 s | VERIFIED: https://dataforseo.com/apis/serp-api |
| Top-100 billing | **Conflicting official sources.** The 2025-09-16 announcement says each extra page costs 0.75 x base, so top-100 Standard = $0.00465. The Help Center FAQ and the 2025-09-13 notice say 10 x base = $0.006. | VERIFIED conflict: https://dataforseo.com/update/important-serp-api-remains-fully-operational-pricing-update vs https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq . Confirm on the account dashboard. |
| Cost savers | `stop_crawl_on_match` (stop paging once target found, up to 10 targets); `search_param=start=N` offset; `max_crawl_pages`; unused pages refunded | VERIFIED: https://docs.dataforseo.com/v3/serp/google/organic/task_post/ , FAQ above |
| Position fields | `rank_group` = position among elements of the same type; `rank_absolute` = position among all SERP elements | VERIFIED: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/ |
| SERP features | 40+ item types incl. `ai_overview`, `people_also_ask`, `featured_snippet`, `local_pack`, `knowledge_graph`, `discussions_and_forums`, `perspectives`, `short_videos` | VERIFIED: same URL |
| AI Overview | `load_async_ai_overview=true` costs +$0.0006; `people_also_ask_click_depth` $0.00015 per click | VERIFIED: task_post URL above |
| Device / geo | `device` desktop or mobile; `location_code`/`location_name`/`location_coordinate`; `language_code` | VERIFIED: task_post URL above |
| Async | Task POST + postback_url/pingback; tasks GET | VERIFIED |

### 3.2 AI surfaces

| Surface | Price per request | Key fields | Status |
|---|---|---|---|
| Google AI Mode SERP | Standard $0.0012, Priority $0.0024, Live $0.004 | markdown, references, links | VERIFIED: https://dataforseo.com/pricing/google-serp/google-ai-mode-serp-api |
| ChatGPT LLM Scraper | Standard $0.0012, Priority $0.0024, Live $0.004 per results page | `markdown`, `sources` (cited), `search_results` (all retrieved), **`fan_out_queries`**, `brand_entities` | VERIFIED: https://dataforseo.com/pricing/ai-optimization/llm-scraper , https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-live-advanced/ |
| Gemini LLM Scraper | Same as ChatGPT | "only ChatGPT and Gemini are supported" in the scraper | VERIFIED: pricing URL above |
| Perplexity, Claude | Via LLM Responses API (official model APIs, not UI scraping) | Not the same as consumer UI answers | INFERRED from https://docs.dataforseo.com/v3/ai_optimization-overview/ (not re-read in detail) |

---

## 4. Provider profiles

### 4.1 SerpApi

**A. Traditional Google SERP**

| Item | Detail | Status |
|---|---|---|
| Endpoint | `GET https://serpapi.com/search?engine=google&q=...` | VERIFIED: https://serpapi.com/search-api |
| Plans | Starter $25/1K searches ($25.00/1K); Developer $75/5K ($15.00); Production $150/15K ($10.00); Big Data $275/30K ($9.17); Searcher $725/100K ($7.25); Volume $1,475/250K ($5.90); Infrastructure $2,750/500K ($5.50); Cloud 1M $3,750 ($3.75); Cloud 2M $5,675; Cloud 3M $7,600; up to Cloud 54M $106,050 | VERIFIED: https://serpapi.com/pricing |
| What is billed | Only successful searches. Cached (1 h cache, identical params), errored and failed searches are free. A 100-result response and an empty one both count as 1. | VERIFIED: https://serpapi.com/pricing |
| Top-100 | `num` no longer documented on the Google Search API page; SerpApi blog says `num` is "very inconsistent" and you usually get 10. Top-100 = 10 requests with `start=0,10,...,90` = **10 searches per keyword**. | VERIFIED: https://serpapi.com/search-api , https://serpapi.com/blog/google-experiments-with-restricting-results-per-page/ ; 10x count INFERRED |
| Position | `organic_results[].position`, ranking order in organic results (1 = top). Whether it continues across `start` pages was not confirmed. | VERIFIED (field); cross-page behaviour UNVERIFIED |
| SERP features | `ai_overview`, `related_questions` (PAA), `answer_box` (featured snippet), `local_results` (local pack), `knowledge_graph`, `perspectives`, `related_searches`, `immersive_products`, `things_to_know`, and more | VERIFIED: https://serpapi.com/search-api |
| Targeting | `location` (city-level recommended), `uule`, `lat`/`lon`, `gl`, `hl`, `device` (desktop, tablet, mobile), `radius` | VERIFIED: https://serpapi.com/search-api |
| Async | `async=true` then fetch via Searches Archive API; incompatible with `no_cache` | VERIFIED: https://serpapi.com/search-api |
| Rate limits | Hourly throughput per plan: 200/h (Starter) to 100,000/h (Infrastructure); Cloud 110,000/h to 640,000/h | VERIFIED: https://serpapi.com/pricing |
| SLA | No SLA stated on pricing page. US Legal Shield ($2M) from Production up; ZeroTrace and priority support on Cloud 1M+ | VERIFIED: https://serpapi.com/pricing |

**B. AI surfaces**

| Surface | Engine | Price | Fields | Fan-out exposed | Status |
|---|---|---|---|---|---|
| AI Overview (inline) | part of `engine=google` | included in the Google search | `ai_overview.text_blocks[]`, `references[]` (title, link, snippet, source, index), `reference_indexes` | No | VERIFIED: https://serpapi.com/ai-overview |
| AI Overview (deferred) | `engine=google_ai_overview&page_token=...` | Separate request; INFERRED to count as 1 search (successful searches are counted) | Same structure | No | VERIFIED: https://serpapi.com/google-ai-overview-api . Token lifetime: the API page says "expires within 1 minute"; the AI Overview results page says "within 4 minutes". Design for 1 minute. |
| Google AI Mode | `engine=google_ai_mode` | 1 search (INFERRED) | `text_blocks`, `references`, `reconstructed_markdown`, `shopping_results`, `related_questions`; multi-turn via `continuable=true` and `subsequent_request_token` | No | VERIFIED: https://serpapi.com/google-ai-mode-api |
| Bing Copilot | `engine=bing_copilot` | 1 search (INFERRED) | text blocks, references | No | VERIFIED: https://serpapi.com/bing-copilot-api |
| Others | Brave AI Mode, Naver AI Overview, DuckDuckGo Search Assist | 1 search (INFERRED) | | | VERIFIED: https://serpapi.com/use-cases/ai-search-engine-api , https://serpapi.com/blog/get-ai-generated-responses-from-search-engines-in-structured-json/ |
| ChatGPT, Perplexity, Gemini | **Not offered** | | | | VERIFIED (absence on SerpApi AI engine list, 2026-02-23 post and use-case page) |

**C. Legal, stability, maturity**

- Most mature parser in the market (80 to 100+ engines, founded 2016+; UNVERIFIED founding year). Pre-solved Google's JS challenge in January 2025 with "Ludicrous Speed" (UNVERIFIED, third-party claim).
- Defendant in Google v. SerpApi (N.D. Cal.) and Reddit v. SerpApi et al. (S.D.N.Y.). Status in section 2. Any adverse ruling could force service changes with little notice. This is the key reason not to depend on it as the sole fallback.
- Legal Shield covers customer liability up to $2M from Production plan up. VERIFIED: https://serpapi.com/pricing

### 4.2 Bright Data

**A. Traditional Google SERP**

| Item | Detail | Status |
|---|---|---|
| SERP API endpoint | Proxy-style or `POST https://api.brightdata.com/request` with a SERP zone; Google URL params plus `brd_json=1` for parsed JSON | VERIFIED: https://docs.brightdata.com/scraping-automation/serp-api/query-parameters/google |
| Pricing | Free 5,000/month; PAYG $1.50 per 1K successful requests; Scale $499/month incl. 380,000 requests then $1.30/1K; Enterprise custom with "premium SLA" | VERIFIED: https://brightdata.com/pricing/serp |
| What is billed | Successful requests only; retries, CAPTCHA, parsing included; async: only the send is billed, the collect is free. Exception: zones with custom headers or cookies bill every request. | VERIFIED: https://docs.brightdata.com/scraping-automation/serp-api/pricing-and-billing |
| Top-100 via SERP API | `num` "deprecated by Google on September 11, 2025"; paginate with `start=0,10,...` = 10 requests per keyword | VERIFIED: Google params URL above |
| **Top-100 via Scrapers dataset** | `POST /datasets/v3/trigger?dataset_id=gd_mfz5x93lmsjjjylob` with `keyword`, `country`, `language`, `start_page=1`, `end_page=10`, `collapse_aio`. Async (trigger, progress, snapshot). Docs state: "One successful API call = one billable request, regardless of page depth." | VERIFIED: https://docs.brightdata.com/scraping-automation/serp-api/get-top-100-google-results . **Must be validated in a trial**: it runs on the Scrapers (per-record) product, and a 1-request charge for 10 pages is far below every other vendor. |
| Position | Parsed `organic[].rank` (within organic) and `organic[].global_rank` (whole SERP) | VERIFIED (Bright Data's own GitHub skills repo): https://github.com/brightdata/skills/blob/main/skills/bright-data-best-practices/references/serp-api.md |
| SERP features | Parsed JSON covers organic, ads, PAA, knowledge, local, AI Overview (`brd_ai_overview=2`), etc. Full list not re-verified. | Partly VERIFIED |
| AI Overview | `brd_ai_overview=2` raises AIO capture (about 15 to 20% of queries), adds 5 to 10 s latency because a browser is launched. No extra charge stated. | VERIFIED: https://brightdata.com/products/serp-api/google-search/ai-overview ; no-extra-charge INFERRED |
| Targeting | `gl`, `hl`, `uule` (also `lat,lon,radius` beta), `brd_mobile` (0, 1, ios, android, ipad, android_tablet), `brd_browser`; 195 countries, city level | VERIFIED: Google params URL, pricing URL |
| Async | Yes; async results typically within 5 min, stored 48 h, "99.99% success rate in async mode" | VERIFIED (Bright Data skills repo URL above) |
| Rate limits | "Unlimited concurrency" on all tiers | VERIFIED: https://brightdata.com/pricing/serp . A separate rate-limit page exists: https://docs.brightdata.com/general/usage-monitoring/serp-rate-limit.md (content not read) |
| SLA | Premium SLA on Enterprise only | VERIFIED: pricing URL |

**B. AI surfaces (Web Scraper API "LLM scrapers")**

| Surface | Price | Fields | Fan-out exposed | Status |
|---|---|---|---|---|
| ChatGPT | $1.50/1K records PAYG; Scale $499 incl. 384,000 records then $1.30/1K; 5,000 free/month | `answer_text`, `answer_text_markdown`, `answer_html`, `citations`, `links_attached`, `search_sources` (url, title, snippet, rank), `recommendations`, `model`, `web_search`, `web_search_triggered`, `is_map`, `shopping_visible` | **No query text.** Only `web_search_triggered` (boolean) | VERIFIED: https://brightdata.com/pricing/web-scraper , https://docs.brightdata.com/products/scrapers/chatgpt/introduction , https://docs.brightdata.com/products/scrapers/concepts/query-fan-out |
| Perplexity, Gemini, Copilot, Google AI Mode | Same record pricing (INFERRED: no separate price found) | "prompt, answer, citations" | Gemini decides search itself; no control | VERIFIED (list): ChatGPT intro URL above |
| Grok | "Currently unavailable" | | | VERIFIED: same |
| AI Overview in SERP | Included in SERP request | `aio_text` in top-100 dataset; parsed AIO in SERP API | No | VERIFIED |

Sync `/scrape` accepts up to 20 inputs and falls back to async (HTTP 202 + `snapshot_id`) after about 1 minute; `/trigger` for batch. VERIFIED: ChatGPT intro URL above.

**C. Legal, stability, maturity**

- Largest proxy network vendor; courts sided with Bright Data against Meta (2024) and X (2024) on public-data scraping. Not named in the Google or Reddit suits. VERIFIED (3rd party), see section 2.
- Complexity: two product families (SERP API zones and Scrapers datasets) with different endpoints and async flows. The adapter must handle both.

### 4.3 Oxylabs

**A. Traditional Google SERP**

| Item | Detail | Status |
|---|---|---|
| Endpoint | Realtime `POST https://realtime.oxylabs.io/v1/queries` or Push-Pull `https://data.oxylabs.io/v1/queries`; `source=google_search`, `parse=true` | VERIFIED: https://developers.oxylabs.io/api-targets/search-engines/google/search/search.md |
| Pricing (Web Scraper API, pooled across all targets) | Free trial 2,000 results. Micro $49; Starter $99; Advanced $249. Google per 1K: $1.00 / $0.90 / $0.80. Other sites $1.15 / $1.10 / $0.95. JS rendering $1.35 / $1.30 / $1.25. Top-ups up to $249 (Micro) or $499. | VERIFIED: https://oxylabs.io/products/scraper-api/web/pricing (the `/serp/pricing` URL serves the same page) |
| Larger plans | Google results per plan: Micro 49,000; Starter 110,000; Advanced 311,250; Venture 712,857; Business 1,665,000; Corporate 4,000,000 | VERIFIED: https://developers.oxylabs.io/help-center/billing-and-payments/how-does-web-scraper-api-pricing-work.md |
| Venture/Business/Corporate prices | $499 / $999 / $2,000 per month (implies $0.70 / $0.60 / $0.50 per 1K Google) | UNVERIFIED (third party only): https://www.trustradius.com/products/oxylabs/pricing |
| What is billed | Results with 2xx or 4xx target status are billed; 5xx/6xx (Oxylabs errors) and 429 are not; client-side faults are billed | VERIFIED: https://developers.oxylabs.io/products/web-scraper-api/usage-and-billing/billing-information.md |
| Top-100 | "Maximum results per page will match Google's organic output, which is typically 10." Use `start_page`, `pages=10`. Each page is a separate "result" = **10 results billed per keyword**. | VERIFIED (10 per page); 10 billed INFERRED from "results refer to distinct entities of content (e.g., web page HTML)" |
| Position | `pos` (position among organic results) and `pos_overall` (position of the element within the whole SERP) | VERIFIED: search.md URL above |
| SERP features | organic, paid, pla, featured_snippet, related_questions, local_pack, local_service_ads, top_stories, videos, images, discussions_and_forums, what_people_are_saying, popular_products, jobs, hotels, flights, recipes, twitter, and more | VERIFIED: search.md URL above |
| AI Overview | Returned by `google_search` when `render=html` and `user_agent_type` set; `ai_overviews` array supports multiple AI blocks (incl. PAA, Things to know) in one request. Billed at JS rate (INFERRED). | VERIFIED: https://developers.oxylabs.io/api-targets/search-engines/google/ai-overviews.md |
| Targeting | `geo_location` (country/city/coordinates), `locale`, `domain`, `user_agent_type` (desktop, mobile, tablet variants) | VERIFIED: search.md URL |
| Async | Push-Pull with `callback_url`, batch queries | VERIFIED: https://developers.oxylabs.io/api-targets/llms-and-ai.md |
| Rate limits | Trial 10 jobs/s (3 rendered); Micro to Venture 50 jobs/s (13 rendered); Business and Corporate 100 jobs/s (25 rendered). Domain throttled to 1 req/s if success rate under 40% over 5 min. | VERIFIED: https://developers.oxylabs.io/products/web-scraper-api/usage-and-billing/rate-limits.md |
| SLA | Not found on pricing page | UNVERIFIED |

**B. AI surfaces**

All LLM sources use Push-Pull only, JS rendering on by default (so INFERRED to bill at the JS rate, $1.25 to $1.35/1K).

| Surface | Source | Fields | Fan-out exposed | Status |
|---|---|---|---|---|
| ChatGPT | `chatgpt` (prompt up to 4,000 chars, `search=true` for web search, `geo_location` country) | `llm_model`, `response_text`, `markdown_text`, `markdown_json`, `citations` (title, url, text, description, section), **`search_queries`**, `links`, `shopping_products`, `ads`, `raw_response` | **Yes (`search_queries`)** | VERIFIED: https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt.md |
| Perplexity | `perplexity` (8,000 chars) | `model`, `answer_results_md`, `additional_results.sources_results`, `top_sources`, `inline_products`, `related_queries`, `displayed_tabs` | Partial (`related_queries` are follow-up suggestions, not grounding queries) | VERIFIED: https://developers.oxylabs.io/api-targets/llms-and-ai/perplexity.md |
| Gemini | `gemini` (8,000 chars) | `response_text`, `markdown_text`, `citations`, `model` | No | VERIFIED: https://developers.oxylabs.io/api-targets/llms-and-ai/gemini.md |
| Google AI Mode | `google_ai_mode` (query under 400 chars, `render=html` required) | `response_text`, `citations` (grouped by text), `links` | No | VERIFIED: https://developers.oxylabs.io/api-targets/search-engines/google/ai-mode.md |
| AI Overview | via `google_search` + render | `ai_overviews[]` | No | VERIFIED (4.3 A) |
| Copilot | Not listed in docs | | | VERIFIED absence in https://developers.oxylabs.io/llms.txt ; marketing page also lists "ChatGPT Ads, ChatGPT Shopping" |

**C. Legal, stability, maturity**

- Large, established proxy and scraping vendor (Lithuania). ISO/IEC 27001 badge on pricing page (VERIFIED, page above).
- Named co-defendant in Reddit v. SerpApi et al. (S.D.N.Y., Oct 2025); no ruling found. Oxylabs' specific procedural status UNVERIFIED.
- Pricing page restructured in 2026 (Venture, Business, Corporate no longer shown). UNVERIFIED (third party): https://www.usagepricing.com/blueprint/activity/oxylabs-2026-07-06-scraper-api-four-tiers

### 4.4 SearchAPI.io

**A. Traditional Google SERP**

| Item | Detail | Status |
|---|---|---|
| Endpoint | `GET https://www.searchapi.io/api/v1/search?engine=google` | VERIFIED: https://www.searchapi.io/docs/google |
| Plans | Developer $40/10K ($4.00/1K); Production $100/35K ($3.00); BigData $250/100K ($2.50); Scale $500/250K ($2.00); Octo 500K $900 ($1.80); Octo 1M $1,500 ($1.50); Octo 2M $2,800 ($1.40); Octo 5M $5,000 ($1.00). 100 free requests. | VERIFIED: https://www.searchapi.io/pricing |
| Billing | Only successful (HTTP 200) searches | VERIFIED: pricing URL |
| Rate limit | Up to 20% of plan credits per hour | VERIFIED: pricing URL |
| SLA | "99.9% SLA" on every plan; Legal Protection Guarantee up to $2M from Production up | VERIFIED: pricing URL, https://www.searchapi.io/chatgpt-api |
| `engine=google` depth | `num` "Phased out by Google on September 2025. It is now constant 10"; paginate with `page` | VERIFIED: https://www.searchapi.io/docs/google |
| **`engine=google_rank_tracking`** | "Full top 100 in a single request", `num` 1 to 100 (default 100), `page` 1 to 10, organic only plus ads and rich-result attributes, "guaranteed no duplicates" | VERIFIED: https://www.searchapi.io/docs/google-rank-tracking-api , https://www.searchapi.io/google-rank-tracking-api . Charge of 1 search per call is INFERRED (no per-engine multiplier found on pricing page). Validate in trial. |
| Position | `organic_results[].position`; in `google_rank_tracking` positions 1 to 100 | VERIFIED |
| SERP features (`engine=google`) | AI Overview (inline, synchronous), answer box, related questions (AI-answered ones need Google Related Questions API with `next_page_token`), local results, knowledge graph, ads, shopping, jobs, etc. | VERIFIED: docs/google |
| Targeting | `location` (Locations API), `gl`, `hl`, `device` (desktop, mobile, tablet), coordinate-level for AI Mode | VERIFIED |
| Async | Not documented in pages read | UNVERIFIED |

**B. AI surfaces**

All AI engines are sold on the same search credits; INFERRED 1 credit per successful answer ("Pay only for successful ChatGPT answers").

| Surface | Engine | Fields | Fan-out exposed | Status |
|---|---|---|---|---|
| ChatGPT | `chatgpt` (prompt up to 4,000 chars, `web_search=true`, `expand_entities`) | `text_blocks` with `reference_indexes`, `markdown`, `reference_links` (cited; index, title, link, source, ref_id, date), `web_results` (full ranked retrieved set, position), `citations` (char index to source_indexes), **`search_queries`**, `response_metadata.model`, `is_web_search_performed` | **Yes** | VERIFIED: https://www.searchapi.io/docs/chatgpt-api |
| Perplexity | `perplexity` (`sources=web,scholar`) | `text_blocks`, `markdown`, `reference_links`, `related_questions`, `search_queries` (only under `search_implementation_mode: fast`) | Partial | VERIFIED: https://www.searchapi.io/docs/perplexity-api |
| Gemini | `gemini` | `text_blocks`, `markdown`, `reference_links`, `related_questions`, inline images/videos, typed cards | No | VERIFIED: https://www.searchapi.io/docs/gemini-api |
| Google AI Mode, AI Overview, Bing Copilot | `google_ai_mode`, `google_ai_overview`, Copilot engine | Listed on pricing/nav | Not checked | VERIFIED (listed): pricing URL. Doc pages at guessed URLs returned 404; fields UNVERIFIED |

**C. Legal, stability, maturity**

- Smaller US company (New York). Not named in the Google or Reddit suits (no evidence found). Offers a legal protection guarantee similar to SerpApi's.
- Fast-moving AI coverage (ChatGPT sample responses cite `gpt-5-5` model and June 2026 content), which suggests active maintenance. INFERRED.

### 4.5 Scrapingdog

| Item | Detail | Status |
|---|---|---|
| Endpoint | `GET https://api.scrapingdog.com/google/?query=...&results=10&country=us&page=0` | VERIFIED: https://www.scrapingdog.com/google-search-api/ |
| Pricing | Credit plans from Lite $40/200K credits to Nova Pro $30,000/1.1B. Google SERP Light API 5 credits/request; Google SERP Advance API 10 credits; Google AI Mode API 10 credits. Effective: Light $1.00/1K (Lite) to $0.333/1K (Pro $200/3M credits) to $0.278/1K (Business $500/9M); Advanced $2.00/1K to $0.667 to $0.556 | VERIFIED: https://www.scrapingdog.com/pricing/ |
| Top-100 | 10 calls of 10 results | VERIFIED (vendor blog, 2026-03-09): https://www.scrapingdog.com/blog/rank-tracker-api/ |
| SERP features | organic, ads, local results, `ai_overview` (text_blocks, references), `peopleAlsoAskedFor` | VERIFIED: google-search-api page |
| AI surfaces | Google AI Mode only on the pricing list; no ChatGPT/Perplexity/Gemini found | VERIFIED (absence on pricing page) |
| Concurrency | Scales by plan, 100 threads on Pro | VERIFIED (summarized from pricing page) |
| Legal/maturity | Indian company (OpenData Labs). No litigation found. Docs site returned 404s for guessed doc URLs. | Partly UNVERIFIED |

### 4.6 Traject Data ValueSERP (now ScraperAPI)

| Item | Detail | Status |
|---|---|---|
| Plans | $50/25K credits ($1.60/1K, 250/min); $240/200K ($1.20, 1,000/min); $1,000/1M ($1.00, 1,500/min); 10% off annual | VERIFIED: https://trajectdata.com/pricing/value-serp-api |
| Top-100 | `max_page` auto-paginates and concatenates; **1 credit per page retrieved**; max 5 pages real-time, up to 100 in Batches. Adds `position`, `page`, `position_overall`. | VERIFIED: https://docs.trajectdata.com/valueserp/search-api/pagination.md |
| AI Overview | `include_ai_overview` +1 credit if returned; `include_ai_overview_paa` +1 credit per AIO answer | VERIFIED: https://docs.trajectdata.com/valueserp/search-api/searches/google/search.md |
| Batches | Up to 15,000 searches per batch, schedulable, delivery to S3/GCS/Azure | VERIFIED: pricing URL |
| AI surfaces | None found (no ChatGPT/Perplexity/AI Mode) | VERIFIED absence on pricing page |
| Stability | Acquired by ScraperAPI 2026-04-30; roadmap risk | VERIFIED (section 2) |

### 4.7 Zenserp

| Item | Detail | Status |
|---|---|---|
| Plans | Small $49.99/25K ($2.00/1K); Medium $149.99/100K ($1.50); Large $299.99/250K ($1.20); Premium $499.99/500K ($1.00); Enterprise $899/1M ($0.90); 20% off annual | VERIFIED: https://zenserp.com/pricing-plans/ |
| AI Overview | 3 credits per request; paid plans only | VERIFIED: same |
| Concurrency | "not exceed 400 concurrent connections"; async batch endpoint | VERIFIED: same |
| Top-100 | Not documented in pages read; assume 10 requests | UNVERIFIED |
| AI surfaces | None found | UNVERIFIED |

### 4.8 Apify (`apify/google-search-scraper` and add-ons)

Pricing read from Apify's public API (`GET https://api.apify.com/v2/acts/apify~google-search-scraper`, pricing effective 2026-08-20). Tier names map to Apify subscription levels (FREE, BRONZE = Starter, SILVER = Scale, GOLD = Business; mapping INFERRED).

| Event | FREE | BRONZE | SILVER | GOLD | PLATINUM | DIAMOND |
|---|---|---|---|---|---|---|
| Search result page scraped | $0.0045 | $0.0025 | $0.00195 | $0.0018 | $0.0015 | $0.0012 |
| AI Overview add-on (per captured AIO) | $0.003 | $0.002 | $0.0015 | $0.001 | $0.0007 | $0.0005 |
| Google AI Mode add-on | $0.20 | $0.005 | $0.003 | $0.002 | $0.0015 | $0.001 |
| ChatGPT add-on | $0.20 | $0.005 | $0.004 | $0.003 | $0.0025 | $0.002 |
| Perplexity add-on | $0.20 | $0.013 | $0.01 | $0.009 | $0.008 | $0.007 |
| Copilot add-on | $0.20 | $0.005 | $0.004 | $0.003 | $0.0025 | $0.002 |
| Gemini add-on | $0.20 | $0.005 | $0.004 | $0.003 | $0.0025 | $0.002 |
| Actor start (per run) | $0.001 | $0.001 | $0.001 | $0.001 | $0.00075 | $0.0006 |

VERIFIED: https://api.apify.com/v2/acts/apify~google-search-scraper and https://apify.com/apify/google-search-scraper . Top-100 = `maxPagesPerQuery=10` = 10 page events. Organic `position`; paid results use separate `adPosition`. Whether AI add-ons are charged on top of a page event is INFERRED (the add-on is described as "extra cost ... per search query"). Apify is a marketplace; actors change without a contract SLA. Good for experiments, weak as a production fallback.

### 4.9 Serper (brief)

Prepaid packs $50/50K credits to $3,750/12.5M ($1.00 to $0.30/1K), 1 credit per 10 results, 2 credits for 11 to 100 results, credits expire after 6 months. UNVERIFIED (third party only: https://coldiq.com/blog/serper-pricing ; the serper.dev homepage did not show pricing). How Serper delivers 100 results after `num=100` removal is unknown. No AI engines. Not recommended for rank tracking without a trial.

---

## 5. Capability matrices

### 5.1 Traditional SERP

| Provider | Top-100 method | Billable units per top-100 keyword | Position semantics | AIO in SERP | Async/batch | Published SLA |
|---|---|---|---|---|---|---|
| DataForSEO | `depth=100` or `max_crawl_pages=10` in one task | 1 task, priced as 10 pages (0.75x discount disputed) | `rank_group`, `rank_absolute` | Yes; async AIO +$0.0006 | Yes (task queue, postback) | Not checked |
| SerpApi | 10 x `start` | 10 searches | `position` | Inline, or +1 search via `page_token` | `async=true` | None on pricing page |
| Bright Data SERP API | 10 x `start` | 10 requests | `rank`, `global_rank` | `brd_ai_overview=2` | Yes | Enterprise only |
| Bright Data Top-100 dataset | `start_page=1,end_page=10` | **1 request (per docs; to validate)** | Not checked | `aio_text` | Async only | Enterprise only |
| Oxylabs | `pages=10` | 10 results | `pos`, `pos_overall` | Yes (render=html) | Push-Pull, batch, callback | Not found |
| SearchAPI.io `google` | 10 x `page` | 10 searches | `position` | Inline | Not found | 99.9% |
| SearchAPI.io `google_rank_tracking` | `num=100` | **1 search (INFERRED)** | `position` 1 to 100 | Organic-only engine | Not found | 99.9% |
| Scrapingdog | 10 calls | 10 x 5 or 10 credits | Not checked | Yes | Not found | Not found |
| ValueSERP | `max_page=10` (batches) | 10 credits | `position`, `position_overall` | +1 credit | Batches, schedules | 99.95% uptime claim |
| Zenserp | Unverified | Assume 10 | Not checked | 3 credits | Batch endpoint | "SLA" on Medium+ (terms not read) |
| Apify | `maxPagesPerQuery=10` | 10 page events | `position` | +add-on | Actor runs | None |

### 5.2 AI surfaces

| Provider | AI Overview | AI Mode | ChatGPT | Perplexity | Gemini | Copilot | Fan-out query text |
|---|---|---|---|---|---|---|---|
| DataForSEO | Yes | Yes ($0.0012 std) | Yes ($0.0012 std) | API-based only | Yes | No | **Yes** (ChatGPT `fan_out_queries`) |
| SerpApi | Yes (page_token follow-up) | Yes | No | No | No | Yes (Bing Copilot) | No |
| Bright Data | Yes | Yes | Yes | Yes | Yes | Yes | **No** (boolean `web_search_triggered` only) |
| Oxylabs | Yes | Yes | Yes | Yes | Yes | No | **Yes** (ChatGPT `search_queries`) |
| SearchAPI.io | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** (ChatGPT `search_queries`; Perplexity in fast mode) |
| Scrapingdog | Yes | Yes | No | No | No | No | No |
| ValueSERP | Yes | No | No | No | No | No | No |
| Apify | Add-on | Add-on | Add-on | Add-on | Add-on | Add-on | Not checked |

---

## 6. Cost comparison

### 6.1 Assumptions

1. "Top-100 SERP" = one keyword, one location, one device, fetched to depth 100 = 10 Google pages. 30K, 150K, 300K keywords/month = 300K, 1.5M, 3M pages/month.
2. Prices are list prices from the pages cited, as of 2026-09-29. No negotiated discounts, no annual discounts, no tax.
3. For subscription vendors, cost = cheapest published plan whose quota covers the volume (unused quota is wasted). Where no published plan covers it, we apply the largest published per-1K rate and mark it INFERRED.
4. No early stopping. With DataForSEO `stop_crawl_on_match` or a "last known rank" page window, real costs can drop well below these figures on every per-page vendor.
5. AI observation = one prompt, one engine, one country, one answer. 10K and 100K/month. Follow-up turns, AIO `page_token` calls and retries are excluded.
6. Oxylabs and Bright Data plans are pooled across products; SERP and AI usage would share one plan. Tables price each workload alone.

### 6.2 Top-100 Google SERPs per month (USD)

| Provider and method | 30K keywords (300K pages) | 150K keywords (1.5M pages) | 300K keywords (3M pages) | Notes |
|---|---|---|---|---|
| **DataForSEO Standard** (baseline) | $139.50 to $180 | $697.50 to $900 | $1,395 to $1,800 | Low end = 0.75x extra pages per 2025-09-16 announcement; high end = 10x per current FAQ. VERIFIED rates; totals INFERRED |
| DataForSEO Priority | $279 to $360 | $1,395 to $1,800 | $2,790 to $3,600 | same |
| DataForSEO Live | $465 to $600 | $2,325 to $3,000 | $4,650 to $6,000 | same |
| **Bright Data Top-100 dataset** (1 billable per keyword) | $45 (PAYG) | $225 (PAYG) | $450 (PAYG) | **Only if the "one billable request regardless of depth" rule holds.** INFERRED |
| Bright Data SERP API (10 requests) | $450 PAYG / $499 Scale | $1,955 (Scale + overage) | $3,905 (Scale + overage) | INFERRED from VERIFIED rates |
| **Oxylabs** (10 results) | $249 (Advanced, 311,250 Google results) | $999 (Business) or about $1,200 at $0.80 | $2,000 (Corporate) or about $2,400 at $0.80 | Business/Corporate prices UNVERIFIED; $0.80 figure INFERRED from Advanced rate |
| SearchAPI.io `google_rank_tracking` (1 search) | $100 (Production 35K) | $500 (Scale 250K) | $900 (Octo 500K) | 1-credit billing INFERRED; validate |
| SearchAPI.io `google` (10 searches) | $900 (Octo 500K) | $2,800 (Octo 2M) | $5,000 (Octo 5M) | INFERRED |
| Scrapingdog Light (10 x 5 credits) | $200 (Pro) | $500 (Business) | $1,000 (Business Plus) | INFERRED; Light parser depth not checked |
| Scrapingdog Advanced (10 x 10 credits) | $200 (Pro) | $1,000 (Business Plus) | $2,000 (Corporate) | INFERRED |
| ValueSERP (10 credits) | $1,000 (1M plan) | about $1,500 | about $3,000 | Above 1M credits INFERRED at $1.00/1K |
| Zenserp (assume 10 searches) | $499.99 (Premium) | about $1,350 | about $2,700 | Above 1M INFERRED at $0.90/1K; 10x UNVERIFIED |
| Apify (10 page events) | $585 (Silver) / $540 (Gold) | $2,700 (Gold) | $5,400 (Gold) | Excludes Apify subscription fee; INFERRED |
| SerpApi (10 searches) | $2,750 (Infrastructure 500K) | $5,675 (Cloud 2M) | $7,600 (Cloud 3M) | INFERRED from VERIFIED plans |

### 6.3 AI answer observations per month (USD)

| Provider | Engine basis | 10K observations | 100K observations | Notes |
|---|---|---|---|---|
| **DataForSEO Standard** (baseline) | ChatGPT or Gemini LLM Scraper, or Google AI Mode | $12 | $120 | VERIFIED rate $0.0012; up to 45 min turnaround |
| DataForSEO Live | same | $40 | $400 | $0.004 |
| Bright Data | ChatGPT, Perplexity, Gemini, Copilot, AI Mode records | $15 (PAYG; 5K free/month would cut this) | $150 (PAYG) | $1.50/1K; VERIFIED rate |
| SearchAPI.io | ChatGPT, Perplexity, Gemini, AI Mode, Copilot | $40 (Developer 10K) | $250 (BigData 100K) | 1 credit per answer INFERRED; shared with SERP credits |
| Oxylabs | ChatGPT, Perplexity, Gemini, AI Mode (JS rate) | $49 (Micro, about 37,692 JS results) | $249 (Advanced, about 207,500 JS results) | JS-rate billing INFERRED; pooled plan |
| Scrapingdog | Google AI Mode only | $40 (Lite, 200K credits) | $90 (Standard, 1M credits) | 10 credits per request; VERIFIED |
| SerpApi | Google AI Mode, AIO, Copilot only | $150 (Production 15K) | $725 (Searcher 100K) | No ChatGPT/Perplexity/Gemini |
| Apify (Gold) | ChatGPT add-on + page event | about $48 | about $480 | Perplexity about $108 / $1,080. INFERRED stacking |

---

## 7. Recommendation

### 7.1 Is a provider adapter abstraction worthwhile? Yes.

Reasons, all from the findings above:

1. **Depth models differ.** Per-task depth (DataForSEO), per-page requests (SerpApi, Bright Data SERP API, SearchAPI `google`, Scrapingdog, Apify), per-page auto-concatenation (Oxylabs `pages`, ValueSERP `max_page`), and single-call top-100 (Bright Data dataset, SearchAPI `google_rank_tracking`). The scheduler should request "top N for keyword K" and let the adapter decide how.
2. **Position semantics differ.** `rank_group`/`rank_absolute`, `pos`/`pos_overall`, `rank`/`global_rank`, `position`/`position_overall`, and plain per-page `position`. Normalize to `organic_rank` (1 to 100 across pages, organic only) and `absolute_rank` (whole-SERP element index, nullable when a vendor does not provide it). Recompute organic rank ourselves from the concatenated, de-duplicated list when a vendor restarts positions per page.
3. **AI Overview retrieval differs.** Inline, deferred token with a 1 minute expiry (SerpApi), paid async flag (DataForSEO), browser flag with latency (Bright Data), render flag (Oxylabs), per-credit add-on (ValueSERP, Zenserp, Apify).
4. **AI answer schemas differ** (citations vs sources vs reference_links; fan-out present or absent). Normalize to `answer_markdown`, `cited_sources[]`, `retrieved_sources[]`, `fanout_queries[]` (nullable), `model`, `web_search_performed` (nullable).
5. **Legal and market volatility.** One active DMCA suit and one active multi-defendant suit against SerpApi, a vendor acquisition (Traject Data), and Google's anti-bot changes. A second vendor must be switchable by config, not by code rewrite.

Minimum interface (conceptual):

- `SerpProvider.fetchTopN({keyword, locale, device, depth, stopOnDomain?}) -> NormalizedSerp`
- `AiAnswerProvider.ask({engine, prompt, country, webSearch?}) -> NormalizedAnswer`
- Each adapter declares capabilities (`supportsSingleCallTop100`, `supportsFanout`, `supportsStopOnMatch`, `asyncOnly`, `aioMode`) so the router can pick a provider per job and fail over on error budget, not only on hard failure.
- Store raw vendor payloads alongside normalized rows for re-parsing and audit.
- Run a weekly cross-provider parity sample (for example 200 keywords) comparing organic rank agreement and AIO presence so a silent vendor regression is caught before failover is needed.

### 7.2 Fallback for SEO (traditional SERP): Oxylabs, with Bright Data as the trial candidate

- **Oxylabs**: lowest verified per-page Google rate among the large enterprise vendors ($0.80/1K on Advanced, likely $0.50 to $0.60/1K on larger plans; Scrapingdog Light is cheaper but is a smaller vendor with thinner docs), explicit `pos` and `pos_overall`, rich SERP feature parsing including multi-block AI Overviews, Push-Pull batch with callbacks, published rate limits, and the same plan also covers AI targets. At 30K keywords/month it costs about $249 vs $139.50 to $180 on DataForSEO Standard. Risk: co-defendant in Reddit's suit.
- **Bright Data**: run a paid trial of the top-100 dataset. If one billable request per keyword is confirmed at scale, it undercuts DataForSEO by 3x to 4x and becomes the preferred fallback (and arguably a primary candidate). Strongest legal track record of the group.
- **SearchAPI.io `google_rank_tracking`** is a close third if 1 credit per 100-result call is confirmed: $100 to $900/month across our volumes, 99.9% SLA, legal guarantee. It is organic-only, so SERP features would need a second call on page 1.
- Avoid SerpApi as the SEO fallback at top-100 depth: about 4x to 20x the DataForSEO Standard cost and active litigation. Keep it as a tertiary "parser of record" for spot checks if desired.

### 7.3 Fallback for AI visibility: SearchAPI.io (primary fallback), Oxylabs (secondary)

- **SearchAPI.io**: the only fallback with ChatGPT, Perplexity, Gemini, Google AI Mode, AI Overview and Copilot under one API and one credit pool, plus ChatGPT fan-out (`search_queries`), cited vs retrieved sources, and character-level citation offsets. $40 for 10K and $250 for 100K observations.
- **Oxylabs**: ChatGPT with `search_queries` (fan-out), Perplexity, Gemini, AI Mode. Push-Pull only. Cheap if already on an Oxylabs plan for SERP.
- **Bright Data** is cheapest per record ($1.50/1K) and covers Copilot, but documents no fan-out query text. Use it only if fan-out is not required for the fallback path.
- SerpApi, Scrapingdog and ValueSERP do not cover ChatGPT/Perplexity/Gemini and are unsuitable as AI fallbacks.

### 7.4 Things to validate in trials before committing

1. Bright Data top-100 dataset: bill per keyword or per page; success rate; latency; position fields present.
2. SearchAPI.io `google_rank_tracking`: credits charged per 100-result call; SERP features coverage; how it gets 100 results after `num` removal.
3. DataForSEO depth billing: 0.75x or 1.0x per extra page (two official pages disagree).
4. Oxylabs: confirm LLM sources bill at the JS rate, and current prices for Business and Corporate plans.
5. SerpApi: whether `google_ai_overview` follow-up calls are billed, and the actual `page_token` lifetime (1 vs 4 minutes in its own docs).
6. For each AI vendor: geo coverage (Bright Data publishes per-engine country lists on GitHub; Oxylabs AI Mode excludes France and others), answer freshness, logged-in vs logged-out state.

---

## 8. Sources (all accessed 2026-09-29)

Vendor pages (primary):

- SerpApi pricing: https://serpapi.com/pricing
- SerpApi Google Search API: https://serpapi.com/search-api
- SerpApi AI Overview results: https://serpapi.com/ai-overview
- SerpApi Google AI Overview API: https://serpapi.com/google-ai-overview-api
- SerpApi Google AI Mode API: https://serpapi.com/google-ai-mode-api
- SerpApi Bing Copilot API: https://serpapi.com/bing-copilot-api
- SerpApi AI engines: https://serpapi.com/use-cases/ai-search-engine-api
- SerpApi blog (AI engines, 2026-02-23): https://serpapi.com/blog/get-ai-generated-responses-from-search-engines-in-structured-json/
- SerpApi blog (num restriction, 2025-09-16): https://serpapi.com/blog/google-experiments-with-restricting-results-per-page/
- SerpApi blog (JS requirement): https://serpapi.com/blog/google-now-requires-javascript/
- SerpApi blog (second motion to dismiss, 2026-08-25): https://serpapi.com/blog/google-tried-again-were-moving-to-dismiss-their-claims-a-second-time/
- Bright Data SERP pricing: https://brightdata.com/pricing/serp
- Bright Data Web Scraper pricing: https://brightdata.com/pricing/web-scraper
- Bright Data SERP billing docs: https://docs.brightdata.com/scraping-automation/serp-api/pricing-and-billing
- Bright Data Google parameters: https://docs.brightdata.com/scraping-automation/serp-api/query-parameters/google
- Bright Data top-100: https://docs.brightdata.com/scraping-automation/serp-api/get-top-100-google-results
- Bright Data AI Overview product page: https://brightdata.com/products/serp-api/google-search/ai-overview
- Bright Data ChatGPT scraper product page: https://brightdata.com/products/web-scraper/chatgpt
- Bright Data ChatGPT scraper docs: https://docs.brightdata.com/products/scrapers/chatgpt/introduction
- Bright Data ChatGPT API reference: https://docs.brightdata.com/api-reference/scrapers/ai-search-apis/chatgpt-search-by-prompt
- Bright Data query fan-out concept: https://docs.brightdata.com/products/scrapers/concepts/query-fan-out
- Bright Data skills repo (SERP reference): https://github.com/brightdata/skills/blob/main/skills/bright-data-best-practices/references/serp-api.md
- Oxylabs pricing: https://oxylabs.io/products/scraper-api/web/pricing
- Oxylabs results per plan: https://developers.oxylabs.io/help-center/billing-and-payments/how-does-web-scraper-api-pricing-work.md
- Oxylabs billing: https://developers.oxylabs.io/products/web-scraper-api/usage-and-billing/billing-information.md
- Oxylabs rate limits: https://developers.oxylabs.io/products/web-scraper-api/usage-and-billing/rate-limits.md
- Oxylabs Google web search: https://developers.oxylabs.io/api-targets/search-engines/google/search/search.md
- Oxylabs AI Overviews: https://developers.oxylabs.io/api-targets/search-engines/google/ai-overviews.md
- Oxylabs AI Mode: https://developers.oxylabs.io/api-targets/search-engines/google/ai-mode.md
- Oxylabs LLMs overview: https://developers.oxylabs.io/api-targets/llms-and-ai.md
- Oxylabs ChatGPT: https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt.md
- Oxylabs Perplexity: https://developers.oxylabs.io/api-targets/llms-and-ai/perplexity.md
- Oxylabs Gemini: https://developers.oxylabs.io/api-targets/llms-and-ai/gemini.md
- Oxylabs JS requirement blog: https://oxylabs.io/blog/google-search-javascript
- SearchAPI.io pricing: https://www.searchapi.io/pricing
- SearchAPI.io Google: https://www.searchapi.io/docs/google
- SearchAPI.io Google Rank Tracking: https://www.searchapi.io/docs/google-rank-tracking-api and https://www.searchapi.io/google-rank-tracking-api
- SearchAPI.io ChatGPT: https://www.searchapi.io/docs/chatgpt-api and https://www.searchapi.io/chatgpt-api
- SearchAPI.io Perplexity: https://www.searchapi.io/docs/perplexity-api
- SearchAPI.io Gemini: https://www.searchapi.io/docs/gemini-api
- Scrapingdog pricing: https://www.scrapingdog.com/pricing/
- Scrapingdog Google Search API: https://www.scrapingdog.com/google-search-api/
- Scrapingdog rank tracker blog (2026-03-09): https://www.scrapingdog.com/blog/rank-tracker-api/
- ValueSERP pricing: https://trajectdata.com/pricing/value-serp-api
- ValueSERP pagination: https://docs.trajectdata.com/valueserp/search-api/pagination.md
- ValueSERP search parameters: https://docs.trajectdata.com/valueserp/search-api/searches/google/search.md
- ScraperAPI acquisition of Traject Data: https://www.scraperapi.com/blog/scraperapi-traject-data-acquisition/
- Zenserp pricing: https://zenserp.com/pricing-plans/
- Apify actor page: https://apify.com/apify/google-search-scraper
- Apify public API (pricing events): https://api.apify.com/v2/acts/apify~google-search-scraper
- DataForSEO SERP API: https://dataforseo.com/apis/serp-api
- DataForSEO Google Organic pricing: https://dataforseo.com/pricing/serp/google-organic-serp-api
- DataForSEO depth notice (2025-09-13): https://dataforseo.com/update/google-organic-serp-api-critical-updates-depth
- DataForSEO pricing update (2025-09-16): https://dataforseo.com/update/important-serp-api-remains-fully-operational-pricing-update
- DataForSEO depth FAQ: https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq
- DataForSEO cost explainer: https://dataforseo.com/help-center/serp-api-cost-explained
- DataForSEO July 2026 pricing update: https://dataforseo.com/update/pricing-update-in-dataforseo-apis
- DataForSEO task_post params: https://docs.dataforseo.com/v3/serp/google/organic/task_post/
- DataForSEO organic live advanced fields: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
- DataForSEO AI Mode pricing: https://dataforseo.com/pricing/google-serp/google-ai-mode-serp-api
- DataForSEO LLM Scraper pricing: https://dataforseo.com/pricing/ai-optimization/llm-scraper
- DataForSEO ChatGPT LLM Scraper fields: https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-live-advanced/

Third-party (legal and market):

- Search Engine Land, Reddit suit: https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681
- CourtListener docket, Reddit v. SerpApi: https://www.courtlistener.com/docket/71720563/reddit-inc-v-serpapi-llc/
- Reddit amended complaint coverage: https://chatgptiseatingtheworld.com/2026/02/09/reddit-files-1st-amended-complaint-v-serpapi-oxylabs-awmproxy-perplexity-ai/
- Search Engine Journal, Google v. SerpApi filing: https://www.searchenginejournal.com/google-files-dmca-suit-targeting-serpapis-serp-scraping/563847/
- Search Engine Roundtable, amended complaint: https://www.seroundtable.com/google-amends-lawsuit-against-serpapi-41860.html
- MediaPost, amended complaint (2026-08-12): https://www.mediapost.com/publications/article/417185/google-renews-battle-with-serpapi-over-scraping.html
- Search Engine Land, DMCA claims dismissed: https://searchengineland.com/google-loses-key-dmca-claims-against-serpapi-in-scraping-lawsuit-483185 (HTTP 403 in this session; not read)
- MediaPost, Meta v. Bright Data: https://www.mediapost.com/publications/article/392920/bright-data-didnt-violate-metas-terms-by-scrapin.html
- Proskauer, X v. Bright Data dismissal: https://www.proskauer.com/release/proskauer-secures-dismissal-of-scraping-claims-against-bright-data
- TrustRadius, Oxylabs plan prices: https://www.trustradius.com/products/oxylabs/pricing
- Coldiq, Serper pricing: https://coldiq.com/blog/serper-pricing

Pages that could not be loaded: searchengineland.com DMCA dismissal article (HTTP 403); SearchAPI.io doc pages for AI Mode, AI Overview and Copilot at guessed URLs (HTTP 404); Scrapingdog docs pages at guessed URLs (HTTP 404); serper.dev homepage did not expose pricing.
