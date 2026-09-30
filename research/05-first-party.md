# 05. First-party data integrations (GSC, Bing, Cloudflare, GA4, server logs)

Research date: 2026-09-29. All URLs below were accessed on 2026-09-29 unless noted.
Role in the product: first-party ground truth that the customer connects (OAuth, API key, or file upload), used to calibrate and validate the AI visibility tracker.

Legend:
- **VERIFIED**: read directly on the cited primary page on the access date.
- **UNVERIFIED**: not confirmed on a primary page (secondary source only, conflicting primary sources, or page could not be loaded).
- **INFERRED**: my reasoning from verified facts. Treat as an assumption to test.

Method note: Google Search Central and Google Help pages were pulled with curl and read as raw text, because the summarizing fetch tool truncated the Google blog body on the first pass. Cloudflare docs were read as Markdown (`index.md`). Bing help pages (`bing.com/webmasters/help/...`) are JavaScript-rendered; they were read in a real browser pane. No page in scope failed to load in the end, but three needed a fallback (noted inline).

---

## 0. Executive summary

| Source | AI-specific reporting that exists today | API access to the AI data? | Export path for the AI data | Core API limits that matter |
|---|---|---|---|---|
| Google Search Console | "Generative AI performance" reports (Search: AI Overviews + AI Mode; Discover: gen AI features). Impressions only, by page, country, device, date. No clicks, no queries. Rolled out worldwide 2026-08-31 | **No.** Not in the Search Analytics API reference; no AI `searchAppearance` value; not in bulk export schema | UI "Export" (chart + table, 1,000-row table limit) | 1,200 QPM per site, 1,200 QPM per user, 40,000 QPM and 30M QPD per project; 25,000 rows per call; ~50K rows per day per search type exposed |
| Bing Webmaster Tools | "AI Performance" (public preview since 2026-02-10): total citations, cited pages, average cited pages, grounding queries (sampled), page-level citations, query/page mapping; since 2026-06-16 also Intents, Topics, Citation Share, Compare | **No.** No AI method in the documented `IWebmasterApi`; help page documents only CSV/Excel export | CSV and Excel export, filter-aware | JSON endpoint only since SOAP/POX retirement on 2026-08-31; one API key per user; no published QPS limit |
| Cloudflare AI Crawl Control | Per-zone AI crawler requests, allowed vs unsuccessful, status codes, bytes, paths and path patterns, content format, and AI referrals (paid plans) | **Yes**, via GraphQL Analytics API (`httpRequestsAdaptiveGroups`) | Dashboard CSV / image; GraphQL | 300 GraphQL queries per 5 min per user (or per account/zone with account-based limiting); Free/Pro retention 7 days, Free query window 24h |
| Cloudflare Radar | Global AI bot traffic, crawl purpose, crawl-to-refer ratio by platform | Yes (`/radar/ai/bots/...`, `/radar/bots/crawlers/...`) | API | Data licensed **CC BY-NC 4.0** (non-commercial) |
| GA4 Data API | New default channel **"AI Assistant"** (medium `ai-assistant`, campaign `(ai-assistant)`), announced 2026-05-13. Excludes Google AI Overviews and AI Mode (those stay in Organic Search) | Yes, through standard dimensions (`sessionMedium`, `sessionDefaultChannelGroup`, `sessionCampaignName`) | API / BigQuery export | Standard property: 200,000 core tokens/day, 40,000/hour, 14,000 per project per property per hour, 10 concurrent |
| Server logs | Raw crawler and user-fetcher hits (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Agent, etc.) | N/A (customer ships logs) | N/A | Verify by published IP JSON or reverse DNS |

Top three design consequences:
1. **The only first-party AI-surface visibility data from Google and Microsoft is UI-only.** Plan an upload/ingest path for GSC Generative AI CSV exports and Bing AI Performance CSV/Excel exports, with a schema ready for when APIs arrive.
2. **Google AI Overviews and AI Mode clicks are indistinguishable** in the GSC API (they sit in `type=web`) and in GA4 (they are `google / organic`). Any AIO/AI Mode click attribution we show is modeled, not measured.
3. **Cloudflare Free/Pro retention is 7 days**, so we must poll daily at minimum and keep our own history.

---

## 1. Google Search Console

### 1.1 Search Analytics API: `searchanalytics.query`

Endpoint: `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`. `siteUrl` is `https://www.example.com/` (URL-prefix) or `sc-domain:example.com` (Domain property). VERIFIED: https://developers.google.com/webmaster-tools/v1/searchanalytics/query

| Parameter | Current values / behavior | Status |
|---|---|---|
| `dimensions[]` | `country`, `device`, `page`, `query`, `searchAppearance`, `date`, `hour`. "There is no limit to the number of dimensions that you can group by, but you cannot group by the same dimension twice." | VERIFIED (query ref) |
| `type` | `web` (default; the combined "All" tab; excludes Discover and Google News), `image`, `video`, `news` (the News tab in Search), `discover`, `googleNews` (news.google.com and Google News apps). `searchType` is deprecated | VERIFIED (query ref) |
| `dataState` | `final` (default, finalized only), `all` (includes fresh data), `hourly_all` (use when grouping by `hour`; hourly data may be partial) | VERIFIED (query ref) |
| `aggregationType` | `auto` (default), `byPage`, `byProperty`, `byNewsShowcasePanel` (only with `NEWS_SHOWCASE` filter and `type=discover` or `googleNews`). `byProperty` not supported for `discover` / `googleNews`. "The API will never change your aggregation type if the requested type is invalid" | VERIFIED (query ref) |
| `rowLimit` | 1 to 25,000; default 1,000 | VERIFIED (query ref) |
| `startRow` | Zero-based offset; if beyond results, returns 200 with zero rows | VERIFIED (query ref) |
| Filter operators | `equals` (default), `notEquals`, `contains`, `notContains`, `includingRegex`, `excludingRegex`; `groupType` only `and` | VERIFIED (query ref) |
| Dates | `startDate`/`endDate` in YYYY-MM-DD, Pacific Time | VERIFIED (query ref) |
| Response | `rows[].keys[]`, `clicks`, `impressions`, `ctr`, `position`, `responseAggregationType`, `metadata.first_incomplete_date` (with `dataState=all` grouped by date) or `metadata.first_incomplete_hour` (with `hourly_all` grouped by hour), both America/Los_Angeles | VERIFIED (query ref) |
| Hourly depth | UI shows 24 hours; "the API will return data for up to 10 days with an hourly breakdown" (announced 2025-04-09) | VERIFIED: https://developers.google.com/search/blog/2025/04/san-hourly-data |
| Web multimodal search type | Launched in UI 2026-09-24 (Lens, Circle to Search, image uploads, Chrome "Search this image"), with UI filter and Export. The API `type` enum on the reference page does **not** list it, and the query dimension is not available for multimodal | VERIFIED: https://developers.google.com/search/blog/2026/09/web-multimodal-in-sc ; https://support.google.com/webmasters/answer/17011259?hl=en (absence in API: VERIFIED on query ref) |

Pagination and completeness (VERIFIED: https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data):
- Recommended pattern: one query per day for one day of data, per `type`; page with `startRow` in steps of 25,000 until a response returns 0 rows.
- "Data is typically available after 2-3 days."
- "the Search Analytics method exposes a maximum of 50K rows of data per day per search type (web, image, and so on--sorted by clicks)."
- Grouping by `page` and/or `query` "may drop some data"; for accurate totals omit `page` and `query` (use `country`, `device`).
- `searchAppearance` requires a two-step query (first list appearance types, then filter by each).

`searchAppearance` values (API value / bulk export field), current list (VERIFIED: https://support.google.com/webmasters/answer/17011259?hl=en): `AMP_TOP_STORIES`, `AMP_BLUE_LINK`, `AMP_IMAGE_RESULT`, `FORUMS`, `EDU_Q_AND_A`, `JOB_DETAILS`, `JOB_LISTING`, `MATH_SOLVERS`, `ACTION`, `MERCHANT_LISTINGS`, `PRACTICE_PROBLEMS`, `PRODUCT_SNIPPETS`, `TPF_QA`, `RECIPE_FEATURE`, `RECIPE_RICH_SNIPPET`, `REVIEW_SNIPPET`, `SUBSCRIBED_CONTENT`, `TRANSLATED_RESULT`, `VIDEO`, `AMP_STORY`. Deprecated (NULL in recent dates): `SEARCH_APPEARANCE_ANDROID_APP`, `EVENTS_DETAILS`, `EVENTS_LISTING`, `TPF_FAQ`, `PAGE_EXPERIENCE`, `TPF_HOWTO`, `LEARNING_VIDEOS`, `ORGANIC_SHOPPING`, `SPECIAL_ANNOUNCEMENT`, `WEBLITE`. **There is no AI Overview or AI Mode appearance value.** VERIFIED.

### 1.2 Quotas (VERIFIED: https://developers.google.com/webmaster-tools/limits)

| Scope | Search Analytics | URL Inspection | All other resources (sites, sitemaps) |
|---|---|---|---|
| Per site | 1,200 QPM | 2,000 QPD, 600 QPM | n/a |
| Per user | 1,200 QPM | n/a | 20 QPS, 200 QPM |
| Per project | 40,000 QPM, 30,000,000 QPD | 10,000,000 QPD, 15,000 QPM | 100,000,000 QPD |

Load quota (Search Analytics only): short-term measured in 10-minute chunks, long-term in 1-day chunks. Page+query grouping or filtering is the most expensive; load grows with date range ("six month range are much more expensive than a query with a one day range"); avoid re-querying the same data. All quota errors return the same "quota exceeded" message. VERIFIED (same page). Example on the page: "User A can make up to 1,200 QPM combined to her 3 websites."

INFERRED: for an agency that connects one Google login owning 200 properties, all 200 share one 1,200 QPM per-user budget. Our scheduler must key rate limits by (OAuth user) and by (site).

### 1.3 Auth, permissions, `sites.list`

- OAuth 2.0 is the only supported protocol for user data. Scopes: `https://www.googleapis.com/auth/webmasters.readonly` (read-only) and `https://www.googleapis.com/auth/webmasters` (read/write). VERIFIED: https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- "in order to run searchAnalytics.query you need read permissions on that property." VERIFIED: https://developers.google.com/webmaster-tools/v1/prereqs
- Service accounts: OAuth credentials "for web applications, service accounts, or installed applications" are supported (VERIFIED, authorizing page). The service account email must be added as a user on the property in the Search Console UI; there is no public user-management API. Adding a service account as a property user: UNVERIFIED on a Google primary page today (commonly documented in Google's Indexing API prereqs and community threads: https://developers.google.com/search/apis/indexing-api/v3/prereqs).
- `sites.list`: `GET https://www.googleapis.com/webmasters/v3/sites`, returns `siteEntry[]` with permission level. VERIFIED: https://developers.google.com/webmaster-tools/v1/sites/list
- OAuth verification tier of `webmasters.readonly` (sensitive vs restricted): UNVERIFIED. Plan for Google OAuth app verification before public launch.

### 1.4 Retention and freshness

| Item | Fact | Status |
|---|---|---|
| History | "Last 16 months" in the Performance report; "If you'd like to extend the 16 months, you could use the Search Analytics API or bulk data exports to pull data and store it in your systems." | VERIFIED: https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops |
| Lag (final) | Typically 2 to 3 days | VERIFIED (all-your-data how-to) |
| Fresh | `dataState=all` includes preliminary data; `first_incomplete_date` marks where values may still change | VERIFIED (query ref) |
| Hourly | Up to 10 days via API with `hour` + `hourly_all` | VERIFIED (2025-04 blog) |

### 1.5 Anonymized queries

- "Some queries are omitted from the report to protect user privacy. These are called anonymized queries. They're included in chart totals, unless a query filter is applied." VERIFIED: https://support.google.com/webmasters/answer/17011259?hl=en
- "Search Console stores and shows only the most important data rows. Not all queries beyond anonymized queries are shown in the table. The most complete list of queries can be exported using bulk data exports." VERIFIED (same page).
- INFERRED: in the API, sum of rows grouped by `query` will be below the property total; compute "anonymized + truncated share" as total (no query dimension) minus sum of query rows, per day.

### 1.6 Bulk data export to BigQuery

VERIFIED: https://support.google.com/webmasters/answer/12917991?hl=en ; https://support.google.com/webmasters/answer/12917675?hl=en ; https://developers.google.com/search/blog/2023/02/bulk-data-export

| Item | Fact |
|---|---|
| Tables | `searchdata_site_impression` (aggregated by property), `searchdata_url_impression` (aggregated by URL, includes `is_[search_appearance]` booleans), `ExportLog` |
| Key fields | `data_date` (PT), `site_url`, `query`, `is_anonymized_query`, `country` (ISO-3166-1 alpha-3), `search_type` (web, image, video, news, discover, googleNews), `device`, `impressions`, `clicks`, `sum_top_position` (site table) or `sum_position` (URL table); URL table adds `url`, `is_anonymized_discover` |
| Position math | Zero-based. Average position = `SUM(sum_top_position)/SUM(impressions) + 1` (site) or `SUM(sum_position)/SUM(impressions) + 1` (URL) |
| Anonymized queries | Rows are **present** with `is_anonymized_query = true` and an empty/null `query`. So metrics are included; query text is not. The blog phrase "apart from anonymized queries" refers to the query text. Not subject to the daily row limit |
| Setup | Property **owner** only. Grant `search-console-data-export@system.gserviceaccount.com` the roles BigQuery Job User and BigQuery Data Editor on the customer's Cloud project; dataset name starts with `searchconsole` (one dataset per property if sharing a project) |
| Timing | First export up to 48 hours after setup; **no backfill** ("If you want to see historical data that precedes your initial setup, use the Search Console API"). Daily; retried for about a week on errors |
| Retention | Tables kept forever by default; set partition expiration of 14 days or more; schema changes break the export |
| Cost | Customer's Google Cloud billing; "There is a free usage level, but storage and query usage above the free quota will be charged." No Search Console fee |
| AI data | No AI Overview / AI Mode field or appearance flag in the schema |

### 1.7 AI Overviews and AI Mode in GSC today (the critical question)

| Question | Answer | Status / URL |
|---|---|---|
| Are AIO / AI Mode clicks and impressions in the main Performance report? | Yes. "sites appearing in AI features (such as AI Overviews and AI Mode) are included in the overall search traffic in Search Console", within the Web search type | VERIFIED: https://developers.google.com/search/docs/appearance/ai-features |
| Is there a dedicated AI report? | Yes. "Search Generative AI performance reports", dedicated reports for Search and Discover. Announced 2026-06-03 (subset of sites, UK first per Google's product blog); "As of August 31, 2026, we've rolled out these insights to all websites worldwide." | VERIFIED: https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports ; https://blog.google/products-and-platforms/products/search/new-controls-website-owners/ |
| Which features (Search report)? | AI Overviews and AI Mode ("We expect to update this list over time"). Search Labs experiments excluded | VERIFIED: https://support.google.com/webmasters/answer/16984139?hl=en |
| Metrics | **Impressions only** ("How often URLs from your site appeared in generative AI features"). No clicks, no CTR, no position | VERIFIED (blog + help) |
| Dimensions | Pages, Countries, Devices (Search only), Dates (hourly, daily, weekly, monthly). Search type filter: Web text, Web multimodal. **No queries** | VERIFIED (blog + help) |
| Counting | Aggregated by property: two results from the same site in one gen AI feature count as one impression | VERIFIED (help 16984139) |
| Relation to main report | "This data is included in the overall performance report" (Web search type) | VERIFIED (blog) |
| Row limit | 1,000 table rows (same as main report) | VERIFIED (help 16984139; Discover help 16983858) |
| API / bulk export | Not mentioned on any Google page; not in the query reference `type`/`dimensions`/`searchAppearance`; not in the BigQuery schema | VERIFIED absence on reference pages. Future API: UNVERIFIED |
| Export | UI Export button downloads chart and table; "~" or "-" values become zeros in downloads (Discover report) | VERIFIED: https://support.google.com/webmasters/answer/16983858?hl=en |
| Discover gen AI report | Impressions; Pages ("the page that served as the source"), Countries, Dates; one impression per result per session | VERIFIED (help 16983858) |
| Position semantics for AIO | "An AI Overview occupies a single position in search results, and all links in the AI Overview are assigned that same position." Clicking an external link in AIO counts as a click | VERIFIED: https://support.google.com/webmasters/answer/7042828 |
| Position semantics for AI Mode | "Position in AI Mode follows the same methodology as a Google Search results page." Follow-up questions are new queries; their impressions/clicks count to the new query | VERIFIED (same) |
| Opt-out control | "Search generative AI control" toggle in Search Console excludes a site from AI Overviews, AI Mode and Discover gen AI features; "isn't used as a ranking or inclusion signal affecting other parts of Search"; takes 1 to 2 days. Separate from Google-Extended (training/grounding in Gemini Apps and Vertex) and from `noindex` | VERIFIED: https://support.google.com/webmasters/answer/16908024?hl=en |

INFERRED design implication: we can show "AI feature impressions by page/country/device/day" only from customer-uploaded GSC exports (or future API). We cannot compute an AIO click-through rate from first-party data.

### 1.8 Other 2025 to 2026 Search Console features and their API status

| Feature | What it is | In API? | Status |
|---|---|---|---|
| Branded queries filter | AI-assisted branded vs non-branded split across web, image, video, news; "NOT based on a regular expression"; top-level (Domain) properties only, sufficient volume only; 16-month history from March 2025; generally available to eligible sites as of 2026-03-11; Insights card for branded vs non-branded clicks | No brand dimension or filter in the API reference | VERIFIED: https://developers.google.com/search/blog/2025/11/search-console-branded-filter ; https://support.google.com/webmasters/answer/17011259?hl=en |
| Search Console Insights (integrated) | Integrated into Search Console 2025-06-30; trending pages and queries, achievements | No API | VERIFIED: https://developers.google.com/search/blog/2025/06/search-console-insights |
| Query groups | AI-computed groups of similar queries in Insights (large properties only), 2025-10-27 | No API | VERIFIED: https://developers.google.com/search/blog/2025/10/search-console-query-groups |
| Social channels | Experiment: Search performance of associated social profiles in Insights, 2025-12-08 | No API | VERIFIED: https://developers.google.com/search/blog/2025/12/social-channels-search-console |
| AI-powered configuration | Natural-language setup of Performance report filters (experimental), 2025-12-04 | No API | VERIFIED: https://developers.google.com/search/blog/2025/12/ai-powered-configuration |
| Web multimodal type | See 1.1 | Not in API `type` enum | VERIFIED |

### 1.9 GSC position vs third-party rank trackers

- GSC chart position: "The average position of the topmost result from your site"; table position: average position for the URL or grouping. VERIFIED: https://support.google.com/webmasters/answer/7576553
- Impressions aggregated by property count once per SERP even with two results (property aggregation). VERIFIED (same).
- Bulk export stores `sum_top_position` zero-based; average is impression-weighted. VERIFIED (1.6).
- Differences vs rank trackers (INFERRED): GSC is impression-weighted across all real users, locations, devices, personalization and SERP layouts, and only counts impressions that actually happened (an item must be scrolled into view in a carousel to count; VERIFIED on help 7042828). Trackers sample one SERP per keyword per location/device/time and usually report organic rank excluding or separately counting features. An AI Overview occupies one position for all its links, so a page cited in an AIO at the top can show position 1 in GSC while a tracker shows it at organic rank 8. Queries with few impressions produce noisy averages.

---

## 2. Bing Webmaster Tools

### 2.1 API access and protocol

| Item | Fact | Status / URL |
|---|---|---|
| Protocol | SOAP and POX/HTTP retired **2026-08-31**. Use `https://ssl.bing.com/webmaster/api.svc/json/{Method}?apikey=...`. "All API methods remain fully available over JSON/HTTP with identical functionality", "Quotas, rate limits, and permissions are unchanged." Responses wrapped in `{"d": ...}`; dates in `/Date(ticks)/` format; errors `{"ErrorCode": n, "Message": "..."}` with HTTP 400; WSDL gone | VERIFIED: https://www.bing.com/webmasters/help/soap-pox-api-deprecation-s0appox01 (JS page, read in browser; redirected from `...soap-pox-api-retirement-s0appox01`) ; https://learn.microsoft.com/en-us/bingwebmaster/ |
| Auth option 1 | OAuth 2.0 (recommended). Register client in BWT Settings > API Access. Authorize `https://www.bing.com/webmasters/oauth/authorize`, token `https://www.bing.com/webmasters/oauth/token`. Scopes `Webmaster.read`, `Webmaster.manage`. Access token `expires_in: 3599`; refresh tokens supported | VERIFIED: https://learn.microsoft.com/en-us/bingwebmaster/oauth2 ; https://learn.microsoft.com/en-us/bingwebmaster/getting-access |
| Auth option 2 | API key: "Only one API key can be generated per user"; key is per user, valid for all their verified sites | VERIFIED: https://learn.microsoft.com/en-us/bingwebmaster/getting-access |
| Rate limits | Not published on the pages read | UNVERIFIED |

### 2.2 Traffic methods (from `IWebmasterApi`, 62 methods listed)

VERIFIED: https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi?view=bing-webmaster-dotnet

| Method | Returns | Notes | Status |
|---|---|---|---|
| `GetRankAndTrafficStats(siteUrl)` | Date, Clicks, Impressions | Site-level daily traffic | VERIFIED (method page via search listing) |
| `GetQueryStats(siteUrl)` | `QueryStats`: Query, Date, Impressions, Clicks, AvgImpressionPosition, AvgClickPosition | Remarks: "The data will be updated every week." | VERIFIED: https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats?view=bing-webmaster-dotnet |
| `GetPageStats(siteUrl)` | Same shape keyed by page | "detailed traffic statistics for top pages" | VERIFIED (interface list) |
| `GetQueryPageStats(siteUrl, query)` | Pages for one query | | VERIFIED (interface list) |
| `GetPageQueryStats(siteUrl, page)` | Queries for one page | No bulk multi-URL method; loop per page (community answer; a Microsoft employee suggested pulling `GetPageStats` then filtering) | VERIFIED list; bulk answer: https://learn.microsoft.com/en-us/answers/questions/5595644/how-do-i-retrieve-search-performance-metrics-in-bu |
| `GetQueryPageDetailStats(siteUrl, query, page)` | Detail for one pair | | VERIFIED (interface list) |
| `GetQueryTrafficStats(siteUrl, query)` | Query traffic over time | | VERIFIED (interface list) |
| `GetKeyword`, `GetKeywordStats`, `GetRelatedKeywords` | Bing keyword research impressions | | VERIFIED (interface list) |
| `GetCrawlStats`, `GetCrawlIssues`, `GetUrlInfo`, `GetLinkCounts`, `GetUrlLinks` | Crawl, index, links | | VERIFIED (interface list) |
| `SubmitUrl`, `SubmitUrlBatch`, `GetUrlSubmissionQuota`, `SubmitContent`, `SubmitFeed` | URL/content submission | | VERIFIED (interface list) |
| Any AI Performance / citation method | **None** | | VERIFIED absence |

Retention: The BWT Search Performance help page still says "(up to) the past six months" (VERIFIED: https://www.bing.com/webmasters/help/search-performance-c680da36), but the Bing Webmaster blog says the report was extended "from 6 to 16 months" in October 2024 (VERIFIED: https://blogs.bing.com/webmaster/March-2025/Supercharge-Your-Search-Performance-with-Bing-Webmaster-Tools). Secondary sources report 24 months since August 2025 (UNVERIFIED; no Bing primary page found). How far back the API methods return: UNVERIFIED; measure on first connect.

Note on Bing Search Performance: "Web and Chat" source includes "Learn more links from Chat response"; keyword and page tables are Web only. Impressions count each page from the site separately (unlike GSC property aggregation). VERIFIED (search-performance help page).

### 2.3 AI Performance (Copilot and Bing AI citations)

VERIFIED sources: https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview (2026-02-10) ; https://blogs.bing.com/search/June-2026/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare (2026-06-16) ; https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c (JS page, read in browser).

| Item | Detail |
|---|---|
| Surfaces | Microsoft Copilot, AI-generated summaries in Bing, select partner AI integrations. Aggregated; cannot split Copilot vs Bing summaries (INFERRED from "aggregated across supported AI surfaces") |
| Total Citations | Times content was visibly referenced as a source in AI answers in the date range; no placement info |
| Cited pages / Average cited pages | Unique pages cited per day; average over range |
| Grounding queries | "key phrases the AI used when retrieving content that was referenced"; grouped, short phrases, **not user prompts**; "represents a sample of overall citation activity" |
| Page-level citation activity | Citation counts by URL |
| Query to page mapping | Select a grounding query to see pages, or a page to see queries; one filter at a time |
| Intents (preview, 2026-06-16) | Informational, Media, Navigational, Commercial, Learn and Solve, Research, Live Event, Local, Comparison, Planning, Utility, Creation, Conversational, Other (AI/ML classifier) |
| Topics (preview) | Clusters of grounding queries (for example "Solar Energy") |
| Citation Share (preview) | "percentage of citations attributed to your site out of all citations shown across all sites for that same grounding query"; does not expose competitor domains |
| Compare (preview) | Overlay previous or custom period |
| Time ranges | 7 days, 30 days, 3 months, custom "within available historical data" |
| Refresh | "refreshed daily, with a short processing delay" |
| Sampling caveats | "Not all citation activity may appear", "Very low or infrequent citation activity may not surface", totals may differ across views; query and page views may be sampled over slightly different windows |
| Clicks | "A citation ... does not represent traffic, clicks, or user engagement" |
| Export | CSV and Excel: grounding query data with citation counts, page-level citation data, time-series across custom ranges. Exports reflect the currently applied filter. Topic-to-page requires export and join |
| API | **Not available.** No method in the API reference; help page mentions export only. A Microsoft Q&A answer (independent advisor, 2026-02-19): "no API is mentioned so the answer is not right now" (https://learn.microsoft.com/en-ca/answers/questions/5780844/bing-webmaster-tools-ai-performance-report-is-ther). Claims in secondary blogs that an API lands "during 2026": UNVERIFIED |

### 2.4 IndexNow

VERIFIED: https://www.indexnow.org/documentation ; https://www.indexnow.org/searchengines.json

- Key: 8 to 128 characters, `a-z A-Z 0-9 -`; hosted as a key file; `keyLocation` may point elsewhere on the same host (the location scopes which URLs are allowed).
- Up to 10,000 URLs per POST.
- Responses: 200, 202 (accepted, key validation pending), 400, 403 (invalid key), 422 (URLs not matching host/key), 429.
- Submitted URLs are "automatically shared with all other participating search engines."
- Participants listed in `searchengines.json`: Bing, Yandex, Seznam, Naver, Yep, Internet Archive, Amazon Bot. Google is not listed.
- Bing's AI Performance launch post recommends IndexNow to keep AI answers current (VERIFIED, Feb 2026 blog).

---

## 3. Cloudflare

### 3.1 AI Crawl Control (formerly AI Audit)

VERIFIED: https://developers.cloudflare.com/ai-crawl-control/ ; https://developers.cloudflare.com/ai-crawl-control/features/analyze-ai-traffic/ ; https://developers.cloudflare.com/ai-crawl-control/get-started/ ; https://developers.cloudflare.com/ai-crawl-control/changelog/

| Capability | Plan | Detail |
|---|---|---|
| Availability | All plans | "Available on all plans"; zero configuration for proxied zones |
| Detection | Free: user agent only; Enterprise Bot Management: detection IDs | "On the free plan, AI Crawl Control identifies AI crawlers based on their user agent strings" |
| Overview tab | All | Executive summary (total requests, change, top status, top path), managed robots.txt status, trends for total, allowed, unsuccessful requests, and **referrals (paid plans only)**; crawlers grouped by operator |
| Crawlers tab | All | Crawler, operator, data transfer, requests, Allow/Block action |
| Metrics tab | Free: "only displays metrics for the past 24 hours" | Requests over time (all, allowed 2xx, bytes), group by crawler, category, operator, host; status code distribution (incl. 403 and 402); Content Format (Accept vs Content-Type); Most popular paths and path Patterns |
| Top referrers / Referrals over time | **Paid plans only** | Referral sources (for example chatgpt.com, perplexity.ai), destination patterns, by operator or source |
| Directives tab | All | robots.txt tracking and violations (renamed 2026-04-17) |
| Export | All | Download CSV or image, filter-aware |
| Read-only role | All | "AI Crawl Control Read Only" role (2026-01-13), domain-scoped |
| Redirects for AI Training | Pro, Business, Enterprise | 301 verified AI training crawlers to canonical URL (2026-04-17) |
| Pay Per Crawl | Closed beta | HTTP 402 with price or 200 with payment intent; Cloudflare is Merchant of Record; dynamic pricing via `crawler-price` origin header (2026-06-16); crawler Discovery API `GET https://crawlers-api.ai-audit.cfdata.org/charged_zones` needs Web Bot Auth; "accrued earnings balance is not currently visible in the dashboard" |

Caveat (VERIFIED on bot reference page): the referrer-domain map attributes `google.com` and `youtube.com` to Google and `bing.com`, `msn.com` to Microsoft, so "AI referrals" by operator mixes classic search referrals with AI referrals for Google and Microsoft (INFERRED consequence). Use it for ChatGPT, Perplexity, Claude; do not treat Google totals as AI.

### 3.2 Programmatic access: GraphQL Analytics API

VERIFIED: https://developers.cloudflare.com/ai-crawl-control/reference/graphql-api/ ; https://developers.cloudflare.com/analytics/graphql-api/limits/ ; https://developers.cloudflare.com/analytics/graphql-api/account-based-rate-limiting/ ; https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/ ; https://developers.cloudflare.com/waf/analytics/security-analytics/ ; https://developers.cloudflare.com/fundamentals/api/reference/limits/

- Endpoint `https://api.cloudflare.com/client/v4/graphql`. Dataset: `viewer.zones(filter:{zoneTag}).httpRequestsAdaptiveGroups` ("the same data shown in the dashboard"). `httpRequestsAdaptiveGroups` is available on ALL plans.
- Documented filters: `requestSource: "eyeball"` (all plans), `userAgent_like` (all plans; spoofable), `edgeResponseStatus_geq/_lt` (all), `clientRequestPath_like` (all), `clientRefererHost_like` (**paid plans only**), `botDetectionIds_hasany` (Bot Management only).
- Useful dimensions shown in examples: `datetimeHour`, `botDetectionIds`, `userAgent`, `clientRequestHTTPHost`, `clientRequestPath`, `clientRefererHost`; metric `count`, `sum { edgeResponseBytes }`; `limit: 5000` in examples.
- Rate limits: 300 GraphQL queries per 5-minute window per user by default. Opt-in account-based limiting with header `X-Rate-Limit-Type: account-based`: 1 request/second (300 per 5 min) **per account and per zone**; Enterprise defaults 15 rps per account, 10 rps per zone. Global Cloudflare API: 1,200 requests per 5 min per user; GraphQL "Max 320/5 min".
- Query scope: up to 10 zones per zone-scoped query; 1 account per account-scoped query.
- Plan boundaries: query the `settings` node for `notOlderThan`, `maxDuration`, `maxPageSize`, `maxNumberOfFields` per dataset per zone.
- Retention / window for `httpRequestsAdaptive` (Security Analytics): Free 7 days / 24h window; Pro 7 days / 7 days; Business 31 days / 31 days; Enterprise 90 days / 31 days. VERIFIED for `httpRequestsAdaptive`; assuming the same for `httpRequestsAdaptiveGroups` is INFERRED (confirm with the `settings` node per zone).
- Token: Custom API token with Analytics Read (the GraphQL auth guide shows Account > Account Analytics > Read for account scope). VERIFIED: https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/ . Zone-level analytics read permission naming for zone scope: INFERRED.

Bot detection IDs and UA tokens (selection, VERIFIED: https://developers.cloudflare.com/ai-crawl-control/reference/bots/):

| Crawler | Operator | Cloudflare category | Detection IDs |
|---|---|---|---|
| GPTBot | OpenAI | AI Crawler | 123815556, 33563875 |
| ChatGPT-User | OpenAI | AI Assistant | 132995013, 33563857 |
| OAI-SearchBot | OpenAI | AI Search | 126255384, 33563986 |
| ClaudeBot | Anthropic | AI Crawler | 33563859 |
| Claude-SearchBot | Anthropic | AI Search | 33564301 |
| Claude-User | Anthropic | AI Assistant | 33564303 |
| PerplexityBot | Perplexity | AI Search | 33563889 |
| Perplexity-User | Perplexity | AI Assistant | 33564371 |
| Googlebot | Google | Search Engine | 120623194, 33554459 |
| Google-CloudVertexBot | Google | AI Crawler | 133730073, 33564321 |
| BingBot | Microsoft | Search Engine | 117479730, 33554461 |
| Bytespider | ByteDance | AI Crawler | 33563853 |
| CCBot | Common Crawl | AI Crawler | 133621792, 33563855 |
| Meta-ExternalAgent | Meta | AI Crawler | 124581738, 33563982 |
| Meta-ExternalFetcher | Meta | AI Assistant | 132272919, 33563980 |
| FacebookBot | Meta | AI Crawler | 33563972 |
| Applebot | Apple | AI Search | 120424214, 33563845 |
| Amazonbot | Amazon | AI Crawler | 118601807, 33563839 |
| DuckAssistBot | DuckDuckGo | AI Assistant | 126666910, 33564037 |
| MistralAI-User | Mistral | AI Assistant | 128950951, 33564323 |

### 3.3 Cloudflare Radar AI insights (public, global)

VERIFIED: https://developers.cloudflare.com/radar/ ; https://developers.cloudflare.com/radar/get-started/first-request/ ; https://developers.cloudflare.com/changelog/post/2025-07-01-radar-bots-insights/ ; https://developers.cloudflare.com/api/resources/radar/subresources/ai/subresources/bots/methods/summary_v2 ; https://developers.cloudflare.com/api/resources/radar/subresources/bots/subresources/web_crawlers/methods/summary/ ; https://developers.cloudflare.com/changelog/product/radar/

| Endpoint | Dimensions | Notes |
|---|---|---|
| `GET /radar/ai/bots/summary/{dimension}`, `/radar/ai/bots/timeseries`, `/radar/ai/bots/timeseries_groups/{dimension}` | `USER_AGENT`, `CRAWL_PURPOSE`, `INDUSTRY`, `VERTICAL`, `CONTENT_TYPE`, `RESPONSE_STATUS`, `RESPONSE_STATUS_CATEGORY` | Filters incl. `crawlPurpose`, `asn`, `contentType`, location; content type added 2026-02-12 |
| `GET /radar/bots/crawlers/summary/{dimension}`, `/radar/bots/crawlers/timeseries_groups/{dimension}` | `CLIENT_TYPE`, `USER_AGENT`, `REFERER`, `CRAWL_REFER_RATIO`, `VERTICAL`, `INDUSTRY`, `RESPONSE_STATUS`, `RESPONSE_STATUS_CATEGORY` | `clientType` filter: HUMAN, NON_AI_BOT, AI_BOT, MIXED_PURPOSE; `botOperator` filter |
| `GET /radar/bots`, `/radar/bots/{bot_slug}`, `/radar/bots/timeseries`, `/radar/bots/summary/{dimension}` | `bot`, `bot_operator`, `bot_category` | Verified bots directory |

- Crawl-to-refer ratio = HTML crawl requests from a platform's user agents divided by HTML requests whose Referer is that platform. VERIFIED: https://blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar/ (definition as summarized from Cloudflare blog search result; blog text read via search snippet, so treat exact wording as UNVERIFIED).
- `dateRange` up to 364d or 52w; aggregation intervals 15 minutes to 1 month.
- Auth: API token with Account > Radar > Read; base `https://api.cloudflare.com/client/v4/radar/`.
- **License: "Data available via Radar API endpoints is made available under the CC BY-NC 4.0 license."** Commercial redistribution in a paid product needs Cloudflare permission (INFERRED legal reading; get counsel).
- Radar data is global or per vertical/industry, never per customer zone.

### 3.4 How to pull per-zone AI crawler stats (recipe)

1. Customer creates a scoped API token (Analytics Read on their zones; optionally the AI Crawl Control Read Only role for dashboard users).
2. Call `settings { httpRequestsAdaptiveGroups { notOlderThan maxDuration maxPageSize } }` per zone to learn plan limits.
3. Hourly or daily job: `httpRequestsAdaptiveGroups` with `requestSource:"eyeball"`, one window within `maxDuration`, grouped by `datetimeHour`, `userAgent` (Free/Pro) or `botDetectionIds` (Bot Management), `clientRequestHTTPHost`, and separately by `clientRequestPath` for top paths; `edgeResponseStatus` buckets for allowed vs blocked.
4. Paid plans: second query with `clientRefererHost` OR-filters for AI assistant domains to count AI referrals by host and path.
5. Send `X-Rate-Limit-Type: account-based` so quota scales with zones.

---

## 4. Google Analytics 4 Data API

### 4.1 AI referral attribution

| Item | Fact | Status / URL |
|---|---|---|
| Built-in AI channel | "New AI Assistant traffic measurement" (What's new, 2026-05-13): medium `ai-assistant` "automatically assigned when the referrer matches a recognized AI Assistant"; channel group "AI Assistant"; campaign `(ai-assistant)` | VERIFIED: https://support.google.com/analytics/answer/9164320?hl=en |
| Channel definition | "AI Assistant is the channel by which users arrive at your site from sources like ChatGPT, Gemini, Deepseek, Copilot, or Grok. It excludes Google's AI Overviews and AI Mode." Rule: medium exactly matches `ai-assistant` | VERIFIED: https://support.google.com/analytics/answer/9756891?hl=en |
| Google AIO / AI Mode | "Organic Search ... including Google's AI Overviews and AI Mode" | VERIFIED (same page) |
| Recognized AI referrer list | Not published on the pages read; examples named: ChatGPT, Gemini, Claude, Deepseek, Copilot, Grok | UNVERIFIED (full list) |
| ChatGPT UTM | ChatGPT adds `utm_source=chatgpt.com` to referral links | VERIFIED via OpenAI help search snippet: https://help.openai.com/en/articles/12627856-publishers-and-developers-faq (page body not fetched; treat as UNVERIFIED wording) |
| UTM vs auto medium | How GA4 resolves a session that has `utm_source=chatgpt.com` but no `utm_medium` against the new `ai-assistant` referrer rule | UNVERIFIED; test on a live property |
| Custom channel option | Custom channel groups remain available for a self-maintained AI list | VERIFIED page exists: https://support.google.com/analytics/answer/13051316?hl=en |

Recommended referrer patterns for our own classifier (INFERRED list; maintain as data, not code): `chatgpt.com`, `chat.openai.com`, `openai.com`, `perplexity.ai`, `www.perplexity.ai`, `gemini.google.com`, `bard.google.com`, `copilot.microsoft.com`, `copilot.cloud.microsoft`, `edgeservices.bing.com`, `claude.ai`, `chat.deepseek.com`, `grok.com`, `x.ai`, `meta.ai`, `chat.mistral.ai`, `you.com`, `duckduckgo.com` (assist traffic not separable), plus `utm_source` values `chatgpt.com`, `perplexity`, `copilot`. Many assistant clicks from native apps carry no referrer and land in Direct (INFERRED).

### 4.2 Dimensions and metrics (API names)

VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema

- Dimensions: `sessionSource`, `sessionMedium`, `sessionSourceMedium`, `sessionDefaultChannelGroup`, `sessionPrimaryChannelGroup`, `sessionCampaignName`, `sessionManualSource` (from `utm_source`), `pageReferrer`, `landingPage`, `landingPagePlusQueryString`, `firstUserSource`, `date`.
- Metrics: `sessions`, `engagedSessions`, `engagementRate`, `keyEvents` ("The count of key events"), `sessionKeyEventRate`, `totalRevenue`; per-event variants `keyEvents:<event_name>` ("Specific key event rate metrics are also available for each registered key event").
- `conversions` is not a current metric name in the schema (renamed to key events) (INFERRED from schema contents).
- Cross-channel conversion reporting in the Data API is in alpha (2026-05-04) (VERIFIED, What's new page).
- OAuth scope `https://www.googleapis.com/auth/analytics.readonly`: INFERRED (standard; not re-read today).

### 4.3 Quotas

VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas

| Quota (Core, Realtime, Funnel each) | Standard | Analytics 360 |
|---|---|---|
| Tokens per property per day | 200,000 | 2,000,000 |
| Tokens per property per hour | 40,000 | 400,000 |
| Tokens per project per property per hour | 14,000 | 140,000 |
| Concurrent requests per property | 10 | 50 |
| Server errors per project per property per hour | 10 | 50 |
| Potentially thresholded requests per property per hour | 120 | 120 |

Daily quotas reset at midnight Pacific; hourly within an hour. INFERRED: the 14,000 per project per property per hour cap binds first for us, since all customers share our GCP project; request `returnPropertyQuota: true` and back off.

---

## 5. Server logs: AI crawlers and user fetchers

Rule of thumb: user agent strings are spoofable; verify by published IP ranges (JSON) or by reverse plus forward DNS. Robots tokens that never appear in logs: **Google-Extended** and **Applebot-Extended**.

| Agent (UA token) | Operator | Purpose | Honors robots.txt | Full UA (as documented) | IP / verification | Docs | Status |
|---|---|---|---|---|---|---|---|
| GPTBot | OpenAI | Training crawl | Yes | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot` | https://openai.com/gptbot.json | https://developers.openai.com/api/docs/bots | VERIFIED |
| OAI-SearchBot | OpenAI | ChatGPT search index | Yes | `...; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot` (Chrome/131 desktop base) | https://openai.com/searchbot.json | same | VERIFIED |
| ChatGPT-User | OpenAI | User-triggered fetch in ChatGPT / GPTs | "robots.txt rules may not apply" | `...; compatible; ChatGPT-User/1.0; +https://openai.com/bot` | https://openai.com/chatgpt-user.json | same | VERIFIED |
| OAI-AdsBot | OpenAI | Ad landing page checks | Not governed by robots.txt | `...; compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot` | https://openai.com/adsbot.json | same | VERIFIED (JSON URL not fetched) |
| ClaudeBot | Anthropic | Training data | Yes; supports Crawl-delay | Full UA not published on the help page | https://claude.com/crawling/bots.json (one list for all Anthropic bots) | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | VERIFIED (token, list); full UA UNVERIFIED |
| Claude-User | Anthropic | User-initiated fetch | Yes (site owners can disable it) | not published | same list | same | VERIFIED |
| Claude-SearchBot | Anthropic | Search index quality | Yes | not published | same list | same | VERIFIED |
| PerplexityBot | Perplexity | Search index (not training) | Yes | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)` | https://www.perplexity.com/perplexitybot.json | https://docs.perplexity.ai/guides/bots | VERIFIED |
| Perplexity-User | Perplexity | User-initiated fetch | "Generally ignores robots.txt rules" | `...; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)` | https://www.perplexity.com/perplexity-user.json | same | VERIFIED |
| Googlebot | Google | Search (incl. AIO, AI Mode, Discover) | Yes | e.g. `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` | https://developers.google.com/static/crawling/ipranges/common-crawlers.json (legacy `.../search/apis/ipranges/googlebot.json` still serves the same content); rDNS `crawl-*.googlebot.com` or `geo-crawl-*.geo.googlebot.com` | https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers ; https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests | VERIFIED |
| Google-Extended | Google | Robots token only: Gemini training and grounding in Gemini Apps / Vertex; "does not impact a site's inclusion in Google Search" | n/a | "doesn't have a separate HTTP request user agent string" | n/a | common crawlers page | VERIFIED |
| Google-CloudVertexBot | Google | Crawls requested by site owners for Vertex AI Agents | Yes | substring `Google-CloudVertexBot` | common-crawlers.json | common crawlers page | VERIFIED |
| GoogleOther | Google | Generic R&D crawl | Yes | `(compatible; GoogleOther)` | common-crawlers.json | common crawlers page | VERIFIED |
| Google-Agent | Google | Agents on Google infra acting on user request; experimenting with Web Bot Auth identity `https://agent.bot.goog` | User-triggered (ignore robots.txt) | `...(compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)...` | https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json | https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers | VERIFIED |
| Google-GeminiNotebook (formerly Google-NotebookLM, supported until Aug 2026) | Google | Fetch user-provided sources | User-triggered | `(compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)` | user-triggered-fetchers-google.json | same | VERIFIED |
| Bingbot | Microsoft | Bing index (also grounds Copilot) | Yes | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/W.X.Y.Z Safari/537.36` and variants | https://www.bing.com/toolbox/bingbot.json (creationTime 2024-01-03); rDNS ends `search.msn.com` | https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0 ; https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26 | VERIFIED |
| Applebot | Apple | Search (Siri, Spotlight, Safari) | Yes | `... (Applebot/0.1; +http://www.apple.com/go/applebot)` | https://search.developer.apple.com/applebot.json ; rDNS `*.applebot.apple.com` | https://support.apple.com/en-us/119829 | VERIFIED |
| Applebot-Extended | Apple | Robots token only (gen AI training); "does not crawl webpages" | n/a | none | n/a | same | VERIFIED |
| Meta-ExternalAgent | Meta | Training foundation AI models, etc. | Yes | `meta-externalagent/1.1 (+/documentation/sharing/webmasters/web-crawlers)` as rendered on the page (link path relative), or `meta-externalagent/1.1` | IP method not documented on page | https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/ | VERIFIED (IP method UNVERIFIED) |
| Meta-ExternalFetcher | Meta | User-requested link fetch | "may bypass robots.txt" | `meta-externalfetcher/1.1 (...)` | same | same | VERIFIED |
| Meta-WebIndexer | Meta | Meta AI search quality | Yes | `meta-webindexer/1.1 (...)` | same | same | VERIFIED |
| facebookexternalhit | Meta | Link previews on share | "might bypass robots.txt" for integrity checks | `facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)` | same | same | VERIFIED |
| Amazonbot | Amazon | Products and services, may train Amazon AI | Yes | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/W.X.Y.Z Safari/537.36` | https://developer.amazon.com/amazonbot/ip-addresses/ | https://developer.amazon.com/amazonbot | VERIFIED |
| Amzn-SearchBot | Amazon | Search (Alexa); not gen AI training | Yes | `...; compatible; Amzn-SearchBot/0.1) ...` | https://developer.amazon.com/amazonbot/searchbot-ip-addresses/ | same | VERIFIED |
| Amzn-User | Amazon | User actions (Alexa live answers) | "may not follow all robots.txt directives" | `...; compatible; Amzn-User/0.1) ...` | https://developer.amazon.com/amazonbot/live-ip-addresses/ | same | VERIFIED |
| CCBot | Common Crawl | Open crawl used widely for training | Yes | `CCBot/2.0 (https://commoncrawl.org/faq/)` | https://index.commoncrawl.org/ccbot.json ; rDNS `*.crawl.commoncrawl.org` | https://commoncrawl.org/ccbot | VERIFIED |
| DuckAssistBot | DuckDuckGo | Real-time fetch for AI-assisted answers; not training | Yes (72h to take effect) | `DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)` | https://duckduckgo.com/duckassistbot.json | https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot | VERIFIED |
| MistralAI-User | Mistral | User-triggered fetch in Vibe; not training | Yes | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)` | https://mistral.ai/mistralai-user-ips.json | https://docs.mistral.ai/robots | VERIFIED |
| Bytespider | ByteDance | AI crawler (per Cloudflare) | Not documented by ByteDance | token `Bytespider` | none published | Cloudflare bot reference only | UNVERIFIED (no operator doc) |

IP JSON URLs above returned HTTP 200 with a `prefixes` array on 2026-09-29 (checked with curl), except `developer.amazon.com/amazonbot/ip-addresses/`, which is an HTML page, not JSON.

---

## 6. Recommended ingestion design notes (INFERRED unless marked)

### 6.1 GSC
- **Connect**: OAuth with `webmasters.readonly`; call `sites.list`; store permission level. Support service-account mode for agencies (customer adds our SA email as a user).
- **Backfill**: on connect, pull 16 months day by day, per `type` in {web, image, video, news, discover, googleNews}. One-day windows keep load quota low (VERIFIED guidance).
- **Two query shapes per day per type**:
  1. Totals: `dimensions=[date,country,device]`, `aggregationType=byProperty` (accurate totals, no page/query loss).
  2. Detail: `dimensions=[date,query,page,country,device]` paged by `startRow += 25000` until 0 rows; expect at most ~50K rows/day/type.
  3. Page totals: `dimensions=[date,page]`, `aggregationType=byPage`.
- **Freshness tiers**: `final` for D-3 and older (immutable after write); `all` for D-1 and D-2 flagged provisional using `metadata.first_incomplete_date`; `hourly_all` + `hour` for the last 10 days for "today vs same weekday last week" alerts. Re-pull provisional days until they become final, then overwrite.
- **Storage keys**: (property, type, date, data_state, dims hash). Keep `position` as impression-weighted sum (`position * impressions`) so re-aggregation stays correct, mirroring BigQuery `sum_top_position`.
- **Large sites**: offer "Bring your BigQuery export": customer sets up bulk export in their project and grants our service account `bigquery.dataViewer` + `bigquery.jobUser` on that dataset. Use API for pre-export history (no backfill in export). Aggregate on read (rows repeat keys, VERIFIED).
- **Anonymized share metric**: daily total clicks minus sum of query-level clicks, exposed as "hidden query share".
- **Rate limiting**: token buckets at 1,200 QPM per Google user and per site, 40,000 QPM per project; exponential backoff on "quota exceeded"; wait 15 minutes on short-term load errors (VERIFIED guidance).
- **Generative AI report**: UI-only. Build (a) CSV upload for the Search and Discover gen AI exports (chart and table files; zeros for "~"/"-"), (b) schema `gsc_genai_impressions(property, surface{search,discover}, search_type{web_text,web_multimodal}, date, page, country, device, impressions, source{upload,api})`, (c) a feature flag to switch to API when Google ships it. Never infer AIO clicks from it.
- **Branded split**: not in API; implement our own brand classifier (regex plus customer brand list) and label it as ours, not Google's.

### 6.2 Bing
- JSON endpoint only (`/api.svc/json/`). Prefer OAuth (`Webmaster.read`) for multi-tenant; accept API key as fallback, stored encrypted, one per BWT user.
- Pull `GetUserSites`, then per site `GetRankAndTrafficStats` (daily), `GetQueryStats` and `GetPageStats` (weekly refresh, VERIFIED remark), then selective `GetPageQueryStats` for top pages. Parse `/Date(ms-offset)/`.
- Unknown API history depth and rate limits: probe on connect, record, and schedule conservatively (for example 1 request per second per key, INFERRED).
- **AI Performance**: upload path for CSV/Excel exports. Schema: `bing_ai_citations(site, date, grounding_query, page, citations, intent, topic, citation_share, export_filter)`. Because exports reflect the active filter and data is sampled, store the filter context and never sum across differently filtered exports. Show "sampled" badges.
- IndexNow: offer a submit endpoint that fans out to one participating engine (sharing is automatic, VERIFIED).

### 6.3 Cloudflare
- Customer-provided scoped token; discover zones; read `settings` to get `notOlderThan`/`maxDuration`.
- Poll at least daily on Free/Pro (7-day retention; 24h max window on Free). Hourly granularity, grouped by UA or detection ID, host, status bucket; top paths daily.
- Referral queries only when `clientRefererHost` filter is allowed (paid plans); otherwise fall back to GA4 or logs for AI referrals.
- Use account-based rate limiting header; batch up to 10 zones per zone-scoped query.
- Classify UAs with our own table (section 5) for Free zones; trust `botDetectionIds` where available.
- Radar: use only for internal benchmarks or with written permission due to CC BY-NC 4.0.

### 6.4 GA4
- One `runReport` per property per day: dimensions `date, sessionSource, sessionMedium, sessionDefaultChannelGroup, landingPage` (plus `sessionCampaignName` to catch `(ai-assistant)`), metrics `sessions, engagedSessions, keyEvents, totalRevenue`. Filter: `sessionMedium == "ai-assistant"` OR `sessionSource` matches our AI regex OR `sessionManualSource` matches AI UTM values. Store both Google's label and our label; report the delta.
- Keep Google AIO/AI Mode inside "Google organic" and say so in the UI (VERIFIED GA4 definition).
- Budget tokens against the 14,000 per project per property per hour cap; request property quota in responses; avoid high-cardinality `pageReferrer` except for sampling.

### 6.5 Server logs
- Ingest via log drain (S3/GCS/R2 bucket, Cloudflare Logpush where the customer has it, Vercel/Netlify drains) or agent upload.
- Classification pipeline: UA token match, then IP verification against cached JSON lists (refresh daily; Bing says refresh daily), then reverse+forward DNS for Google, Bing, Apple, Common Crawl. Label `verified | unverified | spoofed`.
- Categories: training (GPTBot, ClaudeBot, CCBot, Meta-ExternalAgent, Amazonbot, Bytespider), AI search index (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Applebot, Amzn-SearchBot, Meta-WebIndexer), user-triggered fetch (ChatGPT-User, Claude-User, Perplexity-User, Google-Agent, Meta-ExternalFetcher, MistralAI-User, DuckAssistBot, Amzn-User), classic search (Googlebot, Bingbot). User-triggered fetches are the closest first-party proxy for "an AI answer used this page right now".
- Do not count Google-Extended or Applebot-Extended; they never appear in logs.

---

## 7. Source list (all accessed 2026-09-29)

Google Search Console
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/limits
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- https://developers.google.com/webmaster-tools/v1/how-tos/search_analytics
- https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- https://developers.google.com/webmaster-tools/v1/prereqs
- https://developers.google.com/webmaster-tools/v1/sites/list
- https://developers.google.com/search/blog/2025/04/san-hourly-data
- https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
- https://blog.google/products-and-platforms/products/search/new-controls-website-owners/
- https://support.google.com/webmasters/answer/16984139?hl=en
- https://support.google.com/webmasters/answer/16983858?hl=en
- https://support.google.com/webmasters/answer/16908024?hl=en
- https://support.google.com/webmasters/answer/7042828
- https://support.google.com/webmasters/answer/7576553
- https://support.google.com/webmasters/answer/17011259?hl=en
- https://support.google.com/webmasters/answer/12918484?hl=en
- https://support.google.com/webmasters/answer/12917991?hl=en
- https://support.google.com/webmasters/answer/12917675?hl=en
- https://developers.google.com/search/blog/2023/02/bulk-data-export
- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops
- https://developers.google.com/search/blog/2025/11/search-console-branded-filter
- https://developers.google.com/search/blog/2025/06/search-console-insights
- https://developers.google.com/search/blog/2025/10/search-console-query-groups
- https://developers.google.com/search/blog/2025/12/social-channels-search-console
- https://developers.google.com/search/blog/2025/12/ai-powered-configuration
- https://developers.google.com/search/blog/2026/09/web-multimodal-in-sc

Bing
- https://learn.microsoft.com/en-us/bingwebmaster/
- https://learn.microsoft.com/en-us/bingwebmaster/getting-started
- https://learn.microsoft.com/en-us/bingwebmaster/getting-access
- https://learn.microsoft.com/en-us/bingwebmaster/oauth2
- https://learn.microsoft.com/en-us/bingwebmaster/api-protocols
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi?view=bing-webmaster-dotnet
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats?view=bing-webmaster-dotnet
- https://learn.microsoft.com/en-us/answers/questions/5595644/how-do-i-retrieve-search-performance-metrics-in-bu
- https://learn.microsoft.com/en-ca/answers/questions/5780844/bing-webmaster-tools-ai-performance-report-is-ther
- https://www.bing.com/webmasters/help/soap-pox-api-deprecation-s0appox01 (browser-rendered)
- https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c (browser-rendered)
- https://www.bing.com/webmasters/help/search-performance-c680da36 (browser-rendered)
- https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0 (browser-rendered)
- https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26 (browser-rendered)
- https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview
- https://blogs.bing.com/search/June-2026/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare
- https://blogs.bing.com/webmaster/March-2025/Supercharge-Your-Search-Performance-with-Bing-Webmaster-Tools
- https://www.indexnow.org/documentation
- https://www.indexnow.org/searchengines.json

Cloudflare
- https://developers.cloudflare.com/ai-crawl-control/
- https://developers.cloudflare.com/ai-crawl-control/get-started/
- https://developers.cloudflare.com/ai-crawl-control/features/analyze-ai-traffic/
- https://developers.cloudflare.com/ai-crawl-control/reference/graphql-api/
- https://developers.cloudflare.com/ai-crawl-control/reference/bots/
- https://developers.cloudflare.com/ai-crawl-control/changelog/
- https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/
- https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-site-owner/monitor-activity/
- https://developers.cloudflare.com/analytics/graphql-api/limits/
- https://developers.cloudflare.com/analytics/graphql-api/account-based-rate-limiting/
- https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/
- https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/
- https://developers.cloudflare.com/waf/analytics/security-analytics/
- https://developers.cloudflare.com/fundamentals/api/reference/limits/
- https://developers.cloudflare.com/radar/
- https://developers.cloudflare.com/radar/get-started/first-request/
- https://developers.cloudflare.com/changelog/post/2025-07-01-radar-bots-insights/
- https://developers.cloudflare.com/changelog/product/radar/
- https://developers.cloudflare.com/api/resources/radar/subresources/ai/subresources/bots/methods/summary_v2
- https://developers.cloudflare.com/api/resources/radar/subresources/bots/subresources/web_crawlers/methods/summary/
- https://blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar/ (search snippet only)

GA4
- https://support.google.com/analytics/answer/9164320?hl=en
- https://support.google.com/analytics/answer/9756891?hl=en
- https://support.google.com/analytics/answer/13051316?hl=en
- https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- https://help.openai.com/en/articles/12627856-publishers-and-developers-faq (search snippet only)

Crawlers
- https://developers.openai.com/api/docs/bots (redirected from platform.openai.com/docs/bots)
- https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
- https://claude.com/crawling/bots.json
- https://docs.perplexity.ai/guides/bots
- https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests
- https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
- https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers
- https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
- https://support.apple.com/en-us/119829
- https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/
- https://developer.amazon.com/amazonbot
- https://commoncrawl.org/ccbot
- https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
- https://docs.mistral.ai/robots
