# DataForSEO: Traditional SEO APIs (SERP, Keywords Data, Labs)

Research date: 2026-09-29. All primary pages were fetched live on this date (raw HTML via curl, plus the dataforseo.com WordPress REST API for dated update posts, plus the Wayback Machine for two historical comparisons). Every claim is tagged:

* **VERIFIED**: seen on a primary DataForSEO page, URL given (see the source list at the end, IDs like [S1]).
* **INFERRED**: derived from verified facts (for example arithmetic, or reconciling two pages).
* **UNVERIFIED**: not confirmed on a primary page, or taken from a secondary source.

Prices are USD. The docs example payloads are often old (some show 2019 to 2023 prices); where an example `cost` disagrees with the pricing page, the pricing page wins.

---

## 0. Key takeaways for the platform design

1. **Top-100 is now 10x the price of top-10.** Since 19 Sep 2025 the Organic SERP base price covers one page (10 results) and every extra page is billed. As of the live FAQ (updated 02.07.2026, that is 2 July 2026), extra pages are billed at the full base price: top-100 standard = 10 x $0.0006 = $0.006. VERIFIED [S5][S6]. The 25% discount on pages 2+ that applied from Sep 2025 was removed between 11 Apr 2026 and 2 Jul 2026. INFERRED from Wayback snapshots [S7][S8] versus the live page [S5].
2. **Standard queue is 3.3x cheaper than Live** ($0.0006 vs $0.002 per page). Priority is 2x standard. VERIFIED [S3].
3. **Keyword metrics are cheap.** 10,000 keywords of Google Ads search volume cost $0.60 per refresh on the standard queue (10 tasks x $0.06). VERIFIED price [S12], INFERRED arithmetic.
4. **Labs and Keywords Data APIs went up about 20% on 1 July 2026**, and all monthly commitments were removed (everything is pay-as-you-go). SERP API was not in the list of repriced APIs. VERIFIED [S20].
5. **Docs contradict each other on the cost of `calculate_rectangles` and `load_async_ai_overview`**: "add one base price" (pricing page, help center, task_post docs) vs "multiply by 2" (overview pages). This matters a lot at depth 100. Test with the `cost` field before committing. VERIFIED contradiction [S1][S3][S4][S9].
6. **`position` is not a rank.** It is the alignment `left` / `right`. Use `rank_group` (rank among same-type items) or `rank_absolute` (rank among all items). VERIFIED [S10][S21].

---

## 1. SERP API: Google Organic

### 1.1 Endpoints (VERIFIED [S1][S10][S11][S13][S14])

| Purpose | Method and path | Billing |
|---|---|---|
| Set tasks (Standard queue) | `POST https://api.dataforseo.com/v3/serp/google/organic/task_post` | charged at posting |
| List completed, uncollected tasks | `GET /v3/serp/google/organic/tasks_ready` (also `/v3/serp/$se/tasks_ready` and `/v3/serp/tasks_ready`) | free |
| Get results, parsed organic + paid + featured snippet | `GET /v3/serp/google/organic/task_get/regular/$id` | free |
| Get results, full SERP incl. all features | `GET /v3/serp/google/organic/task_get/advanced/$id` | free |
| Get raw HTML | `GET /v3/serp/google/organic/task_get/html/$id` | free |
| Live, regular | `POST /v3/serp/google/organic/live/regular` | charged per request |
| Live, advanced | `POST /v3/serp/google/organic/live/advanced` | charged per request |
| Live, HTML | `POST /v3/serp/google/organic/live/html` | charged per request |

* The Regular function returns only `featured_snippet`, `organic` and `paid`; `item_types` still lists all features found. VERIFIED [S13].
* Live calls accept exactly one task per call. VERIFIED [S11].

### 1.2 Methods, turnaround and base price (VERIFIED [S3][S9])

| Mode | How | Turnaround (as published) | Price per SERP page (10 results) | Per 1K pages |
|---|---|---|---|---|
| Standard, normal priority (`"priority": 1`, default) | task_post then task_get | "5 minutes on average"; footnote: "target turnaround time is 45 minutes. Extended processing may occur." Help center calls 45 min the "guaranteed time". | $0.0006 | $0.60 |
| Standard, high priority (`"priority": 2`) | task_post then task_get | "up to 1 minute on average" | $0.0012 | $1.20 |
| Live | single POST | "up to 6 seconds on average" | $0.002 | $2.00 |

* Fetching deep results is slower: top-100 (10 pages) Live takes "on average 3 to 4 times longer" than page 1 only. VERIFIED [S5].

### 1.3 Depth, pages and billing (the num=100 aftermath)

Timeline (all VERIFIED unless marked):

| Date | Event | Source |
|---|---|---|
| 13 Sep 2025 | Google dropped `num=100`; DataForSEO sets default `depth` to 10 and warns about per-10 billing. | [S15] |
| 16 Sep 2025 | Announces new model from 19 Sep 2025 10:00 UTC: base price covers page 1 (10 results, 15 for Naver); extra pages 25% off (0.75 x base); `calculate_rectangles` now adds one base price instead of two. Top-100 standard example = $0.00465. | [S16] |
| 19 Sep 2025 | New model in effect for Organic type of Google, Bing, Yahoo, Baidu, Seznam, Naver. | [S17] |
| 29 Sep 2025 | Live Organic max `depth` = 200 (error `Invalid Field: 'depth'` above that). | [S18] |
| 2 Oct 2025 | Clarification: pages with fewer than 10 results trigger extra pages at 25% off; pages with more than 10 results are returned at no extra cost; over-billed pages refunded automatically. | [S19] |
| 18 to 25 Oct 2025 | A "Lite" technique fetched top-100 in 2 crawls (quoted example: depth 100 = $0.00105); Google blocked it within about a week. | UNVERIFIED (secondary: ppc.land [X1]); the primary post [S22] confirms Lite endpoints returned only top 10 and were deprecated 28 Oct 2025, and the prior cost structure was restored 28 Oct 2025 12:00 UTC. |
| 24 Oct / 17 Nov 2025 | `stop_crawl_on_match` added (up to 10 targets), then `target_search_mode`, `find_targets_in`, `ignore_targets_in`. | [S23][S24] |
| 11 Apr 2026 | Wayback copy of the FAQ still shows the 25% discount ($0.00465 for top-100 standard). | [S7] |
| 2 Jul 2026 | Live FAQ (Updated 02.07.2026) shows linear pricing: "Ten pages (1st to 10th): 10 x $0.0006 = $0.006"; formula "Base price x Number of additional pages". The cost-explained article no longer contains the "25% lower" sentence that its Nov 2025 copy had. | [S5][S4][S8] |

**Current billing rule (VERIFIED [S3][S4][S5]):**

* Billing is per requested SERP page of 10 results. `depth` is rounded up to the next 10. Default `depth` = 10.
* `depth` max: 700 on task_post [S1]; 200 on Live [S11][S18].
* `max_crawl_pages` max: 100; "you will be charged for each page crawled (10 organic results per page)"; it complements `depth` (the crawl stops at whichever limit binds first). [S1][S25]
* If the SERP has fewer results than requested, the difference is refunded automatically. [S5]
* `search_param: "start=N"` works as an offset (page 3 = `start=21`). `rank_absolute` and `rank_group` restart at 1 from the first crawled page, so `rank_absolute: 1` with `start=31` means actual rank 31. [S5]
* `stop_crawl_on_match`: "Your account will be billed for every SERP crawled until the conditions you specified in this array are met." [S1]

**Price per task at a given depth (INFERRED from verified base prices, linear rule):**

| Depth | Pages | Standard | Priority | Live |
|---|---|---|---|---|
| 10 | 1 | $0.0006 | $0.0012 | $0.002 |
| 20 | 2 | $0.0012 | $0.0024 | $0.004 |
| 30 | 3 | $0.0018 | $0.0036 | $0.006 |
| 50 | 5 | $0.003 | $0.006 | $0.010 |
| 100 | 10 | $0.006 | $0.012 | $0.020 |
| 200 | 20 | $0.012 | $0.024 | $0.040 (Live max) |

For reference, the removed 25% discount would have given top-100 = $0.00465 / $0.0093 / $0.0155. INFERRED.

### 1.4 Paid add-on parameters

| Parameter | What it does | Published cost | Source |
|---|---|---|---|
| Search operators in `keyword` (`site:`, `intitle:`, `inurl:`, `allintitle:` etc.) | operator queries | task cost x 5 | VERIFIED [S1][S3][S4] |
| `calculate_rectangles: true` | pixel coordinates in `rectangle` | task_post docs: "+$0.0006"; live docs: "+$0.002"; pricing page and help center: "Add one base price" (not per page) | VERIFIED [S1][S11][S3][S4][S5] |
| `load_async_ai_overview: true` | fetch AI Overviews that Google loads asynchronously | task_post: "+$0.0006"; live: "+$0.002"; refunded if no async AIO. Help center: standard $0.0006 + $0.0006 = $0.0012 | VERIFIED [S1][S11][S26] |
| `people_also_ask_click_depth` (1 to 4) | click PAA to expand more questions | +$0.00015 per click "regardless of task priority"; refunded for clicks not performed | VERIFIED [S1][S11] |
| `expand_ai_overview` | expand AIO in **HTML** results only | free | VERIFIED [S1][S26] |
| `depth` above default / `max_crawl_pages` | extra pages | x number of pages | VERIFIED [S3] |

**Contradiction to test:** the Google SERP overview and Google Organic overview docs give `cost = B * C * K * (D/default)`, with `C = 2` if `calculate_rectangles` or `load_async_ai_overview` is true. That multiplies the whole depth cost. The help center formula is `cost = B * K * (D/default) + C` with `C = +base price`. At depth 100 standard with async AIO: additive = $0.0066, multiplicative = $0.012. VERIFIED both texts [S9][S4]; which one the billing engine uses is UNVERIFIED. Read `tasks[].cost` on a sandbox-free real call to settle it.

### 1.5 Operational limits (VERIFIED)

| Item | Value | Source |
|---|---|---|
| General rate limit | 2,000 API calls per minute (POST + GET combined), raisable on request | [S1][S9][S27] |
| Tasks per task_post | max 100; extra tasks get error 40006 | [S1][S29] |
| Tasks per Live call | 1 | [S11] |
| Tasks Ready | 20 calls/min; up to 1,000 task ids per call; lists tasks completed in the previous 3 days and not yet collected; postback tasks appear only if delivery failed (HTTP <200 or >300); queue updates with a small delay, so above 1,000 tasks/min use callbacks | [S10][S27] |
| Result retention | Regular and Advanced: 30 days (free re-fetch); HTML: 7 days | [S13][S14][S21] |
| Error 40403 | "results expired": task created more than a month ago | [S29] |
| Callbacks | `pingback_url` (GET notify) or `postback_url` (POST gzip results; requires `postback_data`: `regular`, `advanced`, `html`); `$id` and `$tag` placeholders; 10 s timeout then task goes to Tasks Ready | [S1] |
| Callback source IPs | 144.76.154.130, 144.76.153.113, 144.76.153.106, 94.130.155.89, 178.63.193.217, 94.130.93.29 (HTML pingbacks: 94.130.155.89) | [S30] |
| Webhook Resend | `POST /v3/appendix/webhook_resend`, up to 100 ids, no double charge | [S31] |
| API Errors list | `POST /v3/$path/errors`, tasks that errored in the past 7 days, 10 calls/min | [S32][S27] |
| ID List | `POST /v3/$path/id_list`, 10 calls/min, up to 1,000 ids per call over 6 months | [S33] |
| Tasks Fixed (re-parsed results) | `GET /v3/serp/$path/tasks_fixed`, 20 calls/min | [S34] |
| Concurrency | 30 simultaneous requests applies to Labs, Trends, Backlinks, Content Analysis, AI Optimization, OnPage. SERP API is **not** in that list. Error 40209 = too many simultaneous queries | [S27][S29] |
| `tag` | user string up to 255 chars, echoed in `data`; usable per customer/project for cost attribution | [S1][S35] |
| `keyword` | up to 700 chars | [S1] |

### 1.6 Example task_post response (VERIFIED, docs example [S1]; note the example cost 0.0015 is an old price)

```json
{
  "status_code": 20000,
  "status_message": "Ok.",
  "cost": 0.0045,
  "tasks_count": 3,
  "tasks_error": 0,
  "tasks": [
    {
      "id": "01291721-1535-0066-0000-8f0635c0dc89",
      "status_code": 20100,
      "status_message": "Task Created.",
      "cost": 0.0015,
      "data": { "api": "serp", "function": "task_post", "se": "google", "se_type": "organic",
                "language_code": "en", "location_code": 2840, "keyword": "albert enstein",
                "device": "desktop", "os": "windows" },
      "result": null
    }
  ]
}
```

---

## 2. Advanced organic response format

### 2.1 Result-level fields (VERIFIED [S21])

| Field | Meaning |
|---|---|
| `keyword`, `type`, `se_domain`, `location_code`, `language_code` | echo of request |
| `check_url` | direct Google URL to reproduce the SERP (open in incognito to verify) |
| `datetime` | when the SERP was fetched, UTC `yyyy-mm-dd hh-mm-ss +00:00` |
| `spell` | autocorrection object: `keyword`, `type` in `did_you_mean`, `showing_results_for`, `no_results_found_for`, `including_results_for` |
| `refinement_chips` | object `type: refinement_chips`, `xpath`, `items[]` of `refinement_chips_element` (`title`, `url`, `domain`, `options[]` of `refinement_chips_option`) |
| `item_types` | array of all SERP feature types present |
| `se_results_count` | "total number of results in SERP" (Google's "About N results"; AI Mode returns 0) |
| `pages_count` | number of SERP pages retrieved |
| `items_count` | number of items returned |
| `items[]` | the SERP elements |

### 2.2 Item types (VERIFIED list from `item_types` doc [S21])

`answer_box`, `app`, `carousel`, `multi_carousel`, `featured_snippet`, `google_flights`, `google_reviews`, `third_party_reviews`, `images`, `jobs`, `knowledge_graph`, `local_pack`, `hotels_pack`, `map`, `organic`, `paid`, `people_also_ask`, `related_searches`, `people_also_search`, `shopping`, `top_stories`, `twitter`, `video`, `events`, `recipes`, `top_sights`, `scholarly_articles`, `popular_products`, `questions_and_answers`, `find_results_on`, `stocks_box`, `commercial_units`, `local_services`, `google_hotels`, `math_solver`, `currency_box`, `product_considerations`, `short_videos`, `refine_products`, `perspectives`, `discussions_and_forums`, `compare_sites`, `ai_overview`.

Sub-element types seen in the docs include `ai_overview_element`, `ai_overview_reference`, `ai_overview_video_element`, `ai_overview_table_element`, `ai_overview_expanded_element` (+ `ai_overview_expanded_component`), `people_also_ask_element`, `people_also_ask_expanded_element`, `people_also_ask_ai_overview_expanded_element`, `knowledge_graph_ai_overview_item`, `product_considerations_ai_overview_expanded_element`, `link_element`, `images_element`, `related_result`. VERIFIED [S21][S36][S37].

Note: `shopping` is listed in `item_types`; `events` search type was deprecated 15 Sep 2026 (the `events` SERP element type is still listed). VERIFIED [S38].

### 2.3 Rank semantics (VERIFIED [S21][S39])

| Field | Exact meaning |
|---|---|
| `rank_group` | "position within a group of elements with identical `type` values; positions of elements with different `type` values are omitted". Organic #1 is `rank_group: 1` even if ads and an AIO sit above it. |
| `rank_absolute` | "absolute position among all the elements in SERP". Counts all types. Right-column elements (desktop knowledge graph, shopping) are counted separately starting from 1. |
| `page` | SERP page number on which the element sits |
| `position` | **alignment**, `left` or `right`. Not a rank. |
| `xpath` | XPath of the element |
| `rectangle` | `{x, y, width, height}` in pixels from the top-left of the screen; `null` unless `calculate_rectangles: true` |

Docs example: an organic result with `"rank_group": 26, "rank_absolute": 30`. VERIFIED [S11].

Rank tracker implication (INFERRED): store both. "Organic position" for customers = `rank_group` of `type: organic` (decide whether `related_result` children count; `group_organic_results` default `true` nests them). "Visual position" = `rank_absolute` or `rectangle.y`.

### 2.4 `organic` item fields (VERIFIED [S21])

`type`, `rank_group`, `rank_absolute`, `page`, `position`, `xpath`, `domain`, `title`, `url`, `cache_url`, `related_search_url`, `breadcrumb`, `website_name`, `is_image`, `is_video`, `is_featured_snippet`, `is_malicious`, `is_web_story` (these `is_*` flags "no longer appear in SERP"; use `checks[]` with values `is_image`, `is_video`, `is_featured_snippet`, `amp_version`, `is_malicious`, `is_web_story`, `is_highly_cited`), `description`, `pre_snippet`, `extended_snippet`, `images`, `amp_version`, `rating {rating_type, value, votes_count, rating_max}`, `price {current, regular, max_value, currency, is_price_range, displayed_price}`, `highlighted`, `links` (sitelinks), `faq` (deprecated, always null), `extended_people_also_search`, `about_this_result` (deprecated, always null), `related_result[]`, `rectangle`.

```json
{
  "type": "organic",
  "rank_group": 26,
  "rank_absolute": 30,
  "page": 1,
  "position": "left",
  "domain": "www.t-mobile.com",
  "title": "Apple iPhone 12 Pro 5G | 4 colors in 512GB, 256GB & 128GB",
  "url": "https://www.t-mobile.com/cell-phone/apple-iphone-12-pro",
  "breadcrumb": "https://www.t-mobile.com › Phones › Apple",
  "checks": ["is_image"],
  "rating": { "rating_type": "Max5", "value": 4, "votes_count": 231, "rating_max": 5 }
}
```
(VERIFIED excerpt of docs example [S11], trimmed.)

Google `goto` redirect URLs: since Aug 2026 Google wraps organic links in `google.com/goto`; DataForSEO resolves them for 99.99% of organic SERPs; on 27 Aug 2026 it reported unresolved goto URLs in 52.26% of SERPs with AI Overview, 25.1% with local pack, 0.39% with featured snippet, then said on 28 Aug it now returns direct URLs across all affected elements with rare residual cases. VERIFIED [S40]. Risk: normalise and detect `google.com/goto` in stored URLs.

### 2.5 `featured_snippet` (VERIFIED [S21])

`type`, `rank_group`, `rank_absolute`, `page`, `position`, `xpath`, `domain`, `title`, `featured_title` (title of the source page), `description`, `timestamp`, `url`, `images[]`, `table {table_header[], table_content[]}`, `rectangle`.

### 2.6 `people_also_ask` (VERIFIED [S21][S37])

* `people_also_ask` has `items[]` of `people_also_ask_element`: `title`, `seed_question`, `xpath`, `expanded_element[]`.
* `expanded_element[]` is either `people_also_ask_expanded_element` (`featured_title`, `url`, `domain`, `title`, `description`, `images`, `timestamp`, `table`) or `people_also_ask_ai_overview_expanded_element` (an `items[]` of `ai_overview_element` with `references`). The AIO variant was added 9 May 2025.
* `people_also_ask_click_depth` 1 to 4, $0.00015 per click, refunds for unperformed clicks.

### 2.7 `ai_overview` (VERIFIED [S21][S26][S36])

```
ai_overview
  type, rank_group, rank_absolute, page, position, xpath
  asynchronous_ai_overview (bool: true = loaded async; false = from cache)
  markdown (full AIO text as Markdown)
  items[]
    ai_overview_element: position, title, text, markdown, links[] (link_element: title, description, url, domain), images[], references[]
    ai_overview_video_element: title, snippet, url, domain, image_url, source, date, timestamp
    ai_overview_table_element: markdown, table {table_header, table_content}, references[]
    ai_overview_expanded_element: title, text, components[] (ai_overview_expanded_component: title, text, markdown, images, links, references)
  references[] (ai_overview_reference: source, domain, url, title, text)
  rectangle
```

Docs example excerpt (VERIFIED [S11], trimmed):

```json
{
  "type": "ai_overview",
  "rank_group": 1,
  "rank_absolute": 1,
  "page": 1,
  "position": "left",
  "asynchronous_ai_overview": false,
  "markdown": "The BMW M4 F82 is a high-performance coupe ...[[1]](https://www.autoevolution.com/...)",
  "items": [
    {
      "type": "ai_overview_element",
      "title": null,
      "text": "The BMW M4 F82 is a high-performance coupe ...",
      "links": [{ "type": "link_element", "title": "according to Bankrate", "url": "https://www.bankrate.com/home-equity/heloc-rates/", "domain": "www.bankrate.com" }],
      "references": [
        { "type": "ai_overview_reference", "rank_group": 1, "rank_absolute": 1, "source": "autoevolution",
          "domain": "www.autoevolution.com", "url": "https://www.autoevolution.com/cars/bmw-m4-f82-2014.html#:~:text=...",
          "title": "BMW M4 Coupe (F82) ...", "text": "The load capacity was more than enough ..." }
      ]
    }
  ]
}
```

AIO loading rules (VERIFIED [S26]):
* `load_async_ai_overview: false` (default): cached AIO returned at no extra cost; async AIO returns `ai_overview: null`.
* `true`: async AIO fetched, extra charge applies; if the AIO was cached or absent, the extra charge is refunded.
* Google AIO can also appear inside Knowledge Graph, People Also Ask and Product Considerations.

Build note (INFERRED): an AI visibility product must set `load_async_ai_overview: true`, otherwise it undercounts AIO presence. The docs field description of the parameter explicitly says `false` returns only cached AIOs [S1].

### 2.8 Pixel rank

`calculate_rectangles: true` adds `rectangle {x, y, width, height}` to each element. Custom viewport: `browser_screen_width` (240 to 9999; default 1920 desktop, 360 Android, 375 iOS), `browser_screen_height` (240 to 9999; 1080 / 640 / 812), `browser_screen_resolution_ratio` (0.5 to 3; 1 / 3 / 3). Cost: see 1.4. VERIFIED [S1][S41].

---

## 3. Locations, languages, device

| Item | Detail | Status |
|---|---|---|
| Locations | `GET /v3/serp/google/locations` and `/v3/serp/google/locations/$country` (ISO filter). Fields: `location_code`, `location_name` (e.g. `London,England,United Kingdom`), `location_code_parent`, `country_iso_code`, `location_type` (`Country`, `State`, ...). Free. CSV download "last updated 2026-09-01". Russia and Belarus unsupported. | VERIFIED [S42] |
| Languages | `GET /v3/serp/google/languages`, fields `language_name`, `language_code` (ISO 639-1). CSV "last updated 2026-04-06". | VERIFIED [S43] |
| Location input | exactly one of `location_code` (e.g. 2840 = United States), `location_name`, or `location_coordinate` | VERIFIED [S1] |
| `location_coordinate` (Organic) | `"latitude,longitude,radius"`, max 7 decimals; radius min 199, max 199999, unit given as "(mm)" in the docs; example `53.476225,-2.243572,200` | VERIFIED [S1] (unit as written; treat as ambiguous) |
| `location_coordinate` (AI Mode) | `"latitude,longitude,zoom"`, zoom 4z to 18z, default 9z | VERIFIED [S44] |
| `device` | `desktop` (default) or `mobile` | VERIFIED [S1] |
| `os` | desktop: `windows` (default), `macos`; mobile: `android` (default), `ios` | VERIFIED [S1] |
| `se_domain` | auto-chosen, overridable (e.g. `google.co.uk`) | VERIFIED [S1] |
| Personalisation | ignored (no history, no user prefs) | VERIFIED [S2] |
| Desktop only | Google News, Images, Search by Image, Jobs | VERIFIED [S2] |
| Mobile pricing | same base price and per-page rule as desktop; FAQ confirms depth rule applies to mobile too | VERIFIED [S5] |
| Unsupported `search_param` / URL params | `lr`, `cr`, `as_qdr`, `as_sitesearch`, `as_occt`, `as_filetype` are auto-unset | VERIFIED [S1] |

---

## 4. Keywords Data API and DataForSEO Labs API

### 4.1 Keywords Data: Google Ads (VERIFIED [S12][S45][S46][S47])

Endpoints: `/v3/keywords_data/google_ads/search_volume/{task_post|tasks_ready|task_get|live}`, same pattern for `keywords_for_site`, `keywords_for_keywords`, `ad_traffic_by_keywords`; plus `/locations`, `/languages`, `/status`.

| Item | Value |
|---|---|
| Standard queue | $0.06 per task, up to 1,000 keywords per task, "1 to 3 hours depending on the load" |
| Live | $0.09 per task, up to 7 s; **12 requests per minute per account** |
| Billing | per task, "the price for 1 or 1000 keywords will be the same" |
| Keyword limits | 1,000 per task; 80 chars; 10 words; lowercased |
| History | `date_from` up to 4 years back; default last 12 months; `date_to` cannot be the current month |
| Freshness | Google "updates keyword data in the middle of the month"; `GET /v3/keywords_data/google_ads/status` returns `actual_data`, `date_update`, `last_year_in_monthly_searches`, `last_month_in_monthly_searches` |
| Gotchas | one policy-restricted keyword (weapons, drugs, etc.) in a batch means **no data for the whole batch**; Google Ads merges close variants, send them in separate requests if you need them split |

Result fields: `keyword`, `spell`, `location_code`, `language_code`, `search_partners`, `competition` (**string** `HIGH`/`MEDIUM`/`LOW`, paid only), `competition_index` (0 to 100), `search_volume`, `low_top_of_page_bid`, `high_top_of_page_bid`, `cpc` (USD), `monthly_searches[] {year, month, search_volume}`.

```json
{
  "keyword": "buy laptop",
  "spell": null,
  "location_code": 2840,
  "language_code": "en",
  "search_partners": false,
  "competition": "HIGH",
  "competition_index": 100,
  "search_volume": 2900,
  "low_top_of_page_bid": 1.69,
  "high_top_of_page_bid": 10.04,
  "cpc": 7.95,
  "monthly_searches": [{ "year": 2023, "month": 10, "search_volume": 2400 }]
}
```
(VERIFIED docs example [S46], trimmed.)

### 4.2 Keywords Data: Clickstream and DataForSEO Trends (VERIFIED [S48][S49][S50])

| Endpoint | Path | Price | Notes |
|---|---|---|---|
| Bulk Clickstream Search Volume | `/v3/keywords_data/clickstream_data/bulk_search_volume/live` | $0.012 per request + $0.00012 per item (1M keywords = $132) | up to 1,000 keywords, 12 months of `monthly_searches`, live only, 30 concurrent |
| Global Search Volume | `/v3/keywords_data/clickstream_data/global_search_volume/live` | $0.18 per task | `search_volume` + `country_distribution[] {country_iso_code, search_volume, percentage}` |
| DataForSEO Search Volume | `/v3/keywords_data/clickstream_data/dataforseo_search_volume/live` | $0.18 per task | normalised with Bing or clickstream (`use_clickstream`); 12 requests/min |
| DataForSEO Trends Explore | `/v3/keywords_data/dataforseo_trends/explore/live` | $0.0012 per task (5 keywords) | subregion/demography $0.0024, merged data $0.006 |
| Google Trends | `/v3/keywords_data/google_trends/...` | $0.0027 standard, $0.011 live, 5 keywords per task | live: 250 tasks/min system-wide |

### 4.3 DataForSEO Labs (Google) pricing (VERIFIED [S51])

All Labs endpoints are Live only; 2,000 calls/min; **30 simultaneous requests**. Billed per task plus per returned item.

| Group | Per task | Per item | Example |
|---|---|---|---|
| "All other endpoints" (keyword_overview, historical_keyword_data, keyword_ideas, keyword_suggestions, related_keywords, ranked_keywords, domain_intersection, serp_competitors, competitors_domain, bulk_keyword_difficulty, keywords_for_site, ...) | $0.012 | $0.00012 | 1M keywords = 1,000 x 0.012 + 1,000,000 x 0.00012 = $132 |
| Search Intent | $0.012 | $0.00012 per keyword | 1M keywords = $132 (footnote text says "$0.0012" per task, a typo against the $0.012 card) |
| Historical SERPs | none listed | $0.00012 per SERP (monthly snapshot) | 1,000 SERPs x 10 months = $1.20 |
| Historical Rank Overview | $0.12 | $0.0012 per month item | 1,000 domains x 6 months = $127.2 |
| Historical Bulk Traffic Estimation / Domain Metrics by Categories | $0.12 | $0.0012 per domain | 1M domains = $1,320 |
| `include_clickstream_data: true` | cost x 2 | | |

These already include the +20% of 1 July 2026 (previous $0.01 + $0.0001). INFERRED from [S20] plus the old docs example cost 0.0201 for one keyword with clickstream ((0.01 + 0.0001) x 2 = 0.0202).

### 4.4 Labs endpoints: paths, limits, fields (VERIFIED [S52] to [S64])

| Endpoint (`POST /v3/dataforseo_labs/google/.../live`) | Input limits | Key output |
|---|---|---|
| `keyword_overview` | up to 700 `keywords`; `include_serp_info`, `include_clickstream_data` | per keyword: `keyword_info`, `keyword_properties`, `search_intent_info`, `avg_backlinks_info`, optional `serp_info`, clickstream blocks |
| `historical_keyword_data` | up to 700 keywords | `history[] {year, month, keyword_info}` since 2019. Replaces the old Labs "Historical Search Volume" endpoint. There is no Labs `historical_search_volume` or Labs Google `search_volume` endpoint today. |
| `keyword_ideas` | up to 200 seed `keywords`; `limit` default 700, max 1,000; `ignore_synonyms` | keyword list with the same blocks |
| `keyword_suggestions` | one `keyword`; `limit` default 100, max 1,000 | long-tail containing the seed |
| `related_keywords` | one `keyword`; `depth` 0 to 4; `limit` max 1,000; `replace_with_core_keyword` | "searches related to" graph, `related_keywords[]` |
| `ranked_keywords` | `target` domain or URL; `limit` max 1,000; `item_types`; `load_rank_absolute`; `historical_serp_mode` | `metrics` (organic/paid/featured_snippet/local_pack/`ai_overview_reference` with `pos_1`, `pos_2_3`, `pos_4_10` ... `pos_91_100`, `etv`, `count`, `estimated_paid_traffic_cost`, `is_new`/`is_up`/`is_down`/`is_lost`), items with `keyword_data` + `ranked_serp_element.serp_item` (`rank_group`, `rank_absolute`, ...) |
| `domain_intersection` | `target1`, `target2`, `intersections`, `item_types` (organic, paid, featured_snippet, local_pack); `limit` max 1,000 | `keyword_data`, `first_domain_serp_element`, `second_domain_serp_element` |
| `serp_competitors` | up to 200 `keywords`; `item_types`; `limit` max 1,000 | `domain`, `avg_position`, `median_position`, `rating`, `etv`, `keywords_count`, `visibility`, `relevant_serp_items`, `keywords_positions` |
| `competitors_domain` | `target`; `exclude_domains`, `exclude_top_domains`, `max_rank_group` | `domain`, `avg_position`, `sum_position`, `intersections`, `full_domain_metrics`, `metrics`, `competitor_metrics` |
| `bulk_keyword_difficulty` | up to 1,000 keywords | `keyword_difficulty` per keyword |
| `search_intent` | up to 1,000 keywords; since 22 Sep 2026 language is no longer required (multilingual model) | `keyword_intent {label, probability}`, `secondary_keyword_intents[]`; labels `informational`, `navigational`, `commercial`, `transactional` |
| `historical_serps` | one `keyword`; `date_from` / `date_to` within 365 days | monthly SERP snapshots in Advanced-like format |
| `keywords_for_site` | `target`; `limit` max 1,000 | keywords relevant to a site |

Field semantics (VERIFIED [S52]):
* `keyword_info.competition`: **float 0 to 1** (Google Ads). `competition_level`: `LOW`/`MEDIUM`/`HIGH` (paid SERP only). Different from the Google Ads endpoint where `competition` is the string. Map carefully.
* `keyword_info.cpc` (USD), `search_volume`, `low_top_of_page_bid`, `high_top_of_page_bid`, `categories[]`, `monthly_searches[]`, `search_volume_trend {monthly, quarterly, yearly}` (percent change), `last_updated_time`.
* `keyword_properties.keyword_difficulty`: integer 0 to 100, logarithmic, "chance of getting in top-10 organic results", computed mainly from link profiles of the top 10 pages. Also `core_keyword`, `synonym_clustering_algorithm`, `detected_language`, `is_another_language`.
* `search_intent_info.main_intent`, `foreign_intent[]`, `last_updated_time`.
* `keyword_info_normalized_with_bing`, `keyword_info_normalized_with_clickstream`, `clickstream_keyword_info` (with `gender_distribution`, `age_distribution`).
* `serp_info`: `check_url`, `serp_item_types[]`, `se_results_count`, `last_updated_time`, `previous_updated_time`.

```json
{
  "keyword": "iphone",
  "keyword_info": { "competition": 1, "competition_level": "HIGH", "cpc": 6.45, "search_volume": 1220000,
                    "search_volume_trend": { "monthly": 0, "quarterly": -19, "yearly": 22 } },
  "keyword_properties": { "core_keyword": null, "keyword_difficulty": 89, "detected_language": "en" },
  "search_intent_info": { "main_intent": "informational", "foreign_intent": null },
  "serp_info": { "serp_item_types": ["organic", "popular_products", "people_also_ask"], "se_results_count": 13380000000 }
}
```
(VERIFIED docs example [S52], trimmed.)

### 4.5 Data freshness (VERIFIED [S65][S66][S67][S68])

* Labs Keywords Database: refreshed monthly, following the Google Ads cycle.
* Labs SERP Database: each query refreshed every 30 to 90 days depending on popularity and location.
* Weekly-refreshed Labs endpoints: Ranked Keywords, Competitors Domain, Subdomains, Domain Intersection, Page Intersection, Relevant Pages, Categories For Domain, Domain Metrics By Categories, Keywords For Site. Others read the underlying DBs in real time.
* `GET /v3/dataforseo_labs/status` returns `google.date_update` etc. (free).
* Since 11 Dec 2025 the Labs SERP data includes asynchronous AIOs.
* New ETV algorithm (SERP-feature-aware CTR, clickstream-normalised volume) via `use_new_etv: true`; default for all users from **1 Nov 2026**; already default for accounts created on or after 1 Sep 2026. `estimated_paid_traffic_cost` changes too.

Implication (INFERRED): Labs `ranked_keywords` is for discovery and competitor research, not for daily rank tracking; daily tracking needs the SERP API.

---

## 5. Autocomplete, PAA, AI Mode

### 5.1 Google Autocomplete (VERIFIED [S69][S70])

* Paths: `/v3/serp/google/autocomplete/task_post`, `/tasks_ready`, `/task_get/advanced/$id`, `/live/advanced`.
* Price per request = Organic base price: $0.0006 standard, $0.0012 priority, $0.002 live.
* Params: `keyword`, location/language, `cursor_pointer` (cursor position changes suggestions), `client` (`chrome`, `chrome-omni`, `gws-wiz`, `gws-wiz-serp`, `safari`, `firefox`, `psy-ab`, `toolbar`, `youtube`, `gws-wiz-local`, `img`, `products-cc`, ...).
* Items: `type: autocomplete`, `rank_group`, `rank_absolute`, `relevance`, suggestion text.

### 5.2 People Also Ask

No separate endpoint; it is an element of Organic Advanced, expandable via `people_also_ask_click_depth` (see 2.6). VERIFIED [S1][S21].

### 5.3 Google AI Mode (VERIFIED [S44][S71][S72][S73][S74][S75])

* Exists: `/v3/serp/google/ai_mode/task_post`, `/tasks_ready`, `/task_get/advanced/$id`, `/task_get/html/$id`, `/live/advanced`, `/live/html`, `/languages`. Launched 1 Jul 2025.
* Price per SERP: $0.0012 standard, $0.0024 priority, $0.004 live (2x Organic). Same 5 min / 1 min / 6 s turnaround claims.
* `calculate_rectangles` on AI Mode: "the charge per task will be multiplied by 2".
* Languages: the docs example lists 43 languages (Arabic to Vietnamese), so it is no longer English-only as at launch. Available countries follow Google's own AI Mode availability.
* Results retained 30 days.
* Response: `type: ai_mode`, `check_url` uses `udm=50`, `item_types: ["ai_overview"]`, `se_results_count: 0`, one `ai_overview` item with `markdown`, `items[]` (`ai_overview_element`, table, video, `ai_overview_shopping_element`), `references[]`.
* Since 30 Jul 2026: `ai_overview_paid` item with `text`, `markdown`, `items[]` of `ai_overview_paid_element` (`title`, `url`, `domain`, `ad_aclk`, `website_name`, `breadcrumb`, `snippet`, `images`).

```json
{
  "keyword": "iphone 16 price comparison",
  "type": "ai_mode",
  "check_url": "https://www.google.com/search?q=iphone%2016%20price%20comparison&hl=en&gl=GB&udm=50&uule=...",
  "item_types": ["ai_overview"],
  "se_results_count": 0,
  "items": [
    { "type": "ai_overview", "rank_group": 1, "rank_absolute": 1,
      "markdown": "The iPhone 16 series starts at **£599 / $599** ...",
      "items": [{ "type": "ai_overview_element", "text": "...",
        "references": [{ "type": "ai_overview_reference", "source": "CNET", "domain": "www.cnet.com", "url": "https://www.cnet.com/deals/best-iphone-16-deals/..." }] }] }
  ]
}
```
(VERIFIED docs example [S72], trimmed; live cost in example = 0.004.)

---

## 6. Account, billing, sandbox, errors

| Item | Detail | Status |
|---|---|---|
| Model | pay-as-you-go; "minimum payment amount is $50"; top up any amount above; balance does not expire | VERIFIED [S76][S77] |
| Trial | free $1 credit + free Sandbox, "unlimited trial period" | VERIFIED [S77] |
| Monthly commitments | removed 1 Jul 2026 (the $100/month for Backlinks API and LLM Mentions API) | VERIFIED [S20] |
| Refunds | 30-day no-question refund on first-time API credit purchases only | VERIFIED [S78] |
| Cost controls | daily cost limits per API/endpoint in dashboard (error 40203), duplicate-task limits per hour/day (40205/40206), IP whitelist (40207) | VERIFIED [S29] |
| Sandbox | `https://sandbox.dataforseo.com/v3/$path`, free, dummy data, same structure and same rate limits; supports pingback/postback; all-features demo: `https://sandbox.dataforseo.com/v3/serp/google/organic/task_get/advanced/00000000-0000-0000-0000-000000000000` | VERIFIED [S79] |
| `cost` field | top-level `cost` (total USD) and `tasks[].cost` (per task USD) in every response; `tasks_count`, `tasks_error` | VERIFIED [S1] |
| User Data | `GET /v3/appendix/user_data`, free, **6 calls/min**. Result: `login`, `timezone`, `rates.limits.{day,minute}.<api>.<function>`, `rates.statistics...`, `money.total`, `money.balance`, `money.limits...`, `money.statistics...`, `price.<api>.<function>.<priority_low/normal/high>[] {cost_type: per_request or per_result, cost}`, deprecated `backlinks_subscription_expiry_date`, `llm_mentions_subscription_expiry_date`. Pricing data excludes paid add-on parameters. | VERIFIED [S80][S27] |
| API Status | `GET /v3/appendix/status`, 10/min; statuses `major_outage`, `partial_outage`, `long_response_time`, `long_execution_time`, `webhook_delay`, `send_delay` | VERIFIED [S81] |
| Errors list | `GET /v3/appendix/errors`, 10/min | VERIFIED [S29][S27] |
| HTTP codes | "always return the 200 HTTP response code" except 401, 402, 404, 500 | VERIFIED [S29] |
| Rate limit headers | none documented in any page read. A live unauthenticated request returned only standard nginx/CORS headers and `WWW-Authenticate` (no `X-RateLimit-*`). Track limits via error 40202, 40209 and `user_data.rates.statistics`. | UNVERIFIED for authenticated responses (no credentials used) |
| AI-optimised responses | append `.ai` to any Live or Task GET URL: strips null/empty/false fields, drops `position` and `xpath`, rounds floats, default depth/limit 10 | VERIFIED [S82] |
| API v2 | closed 5 May 2026; v3 only | VERIFIED [S83] |

Status codes (VERIFIED [S29], selection):

| Code | Meaning |
|---|---|
| 20000 | ok |
| 20100 | task created |
| 40000 | only one task allowed (Live) |
| 40006 | more than 100 tasks in one POST |
| 40100 | not authorized |
| 40101 | search engine internal error |
| 40102 | no search results |
| 40103 | task execution failed, resubmit |
| 40104 | account verification required |
| 40106 | partial results; unretrieved pages not charged |
| 40200 / 40210 | payment required / insufficient funds |
| 40201 | account paused for unusual activity |
| 40202 | per-minute rate limit exceeded (2,000) |
| 40203 | cost limit exceeded |
| 40204 | access denied, subscription required |
| 40205 / 40206 | duplicate task limit per hour / per day |
| 40207 | IP not whitelisted |
| 40209 | too many simultaneous queries (30) |
| 40401 | task not found |
| 40403 | results expired (older than a month) |
| 40501 | invalid field |
| 40505 | outdated location parameters |
| 40506 | unknown fields in POST data |
| 40601 / 40602 | task handed / task in queue |
| 50000 | internal error |
| 50301 | third-party (e.g. Google Ads) unavailable |
| 50303 | update in progress |
| 50401 | live task timeout (120 s) |

---

## 7. Terms of service: storing and showing SERP data to customers

| Point | Detail | Status |
|---|---|---|
| ToS version | "UPDATED: 12 JUNE, 2026" | VERIFIED [S78] |
| Resale / white-label | The ToS contains **no clause** forbidding resale, sub-licensing, storage, caching or display to end users, and no attribution requirement. It even states "Certain services provided by DataForSEO are resold." | VERIFIED (absence) [S78] |
| SERP data restriction (7.1) | SERP data "shall not be used to compete with or adversely affect the business interests of the search engine providers from which such data originates." | VERIFIED [S78] |
| Indemnity (7.2) | customer indemnifies DataForSEO for claims from violating 7.1, "including any use of SERP data that violates the terms of service or legal rights of the search engine providers." | VERIFIED [S78] |
| Marketing statements | Google Shopping API page: "Can I use the data commercially in my product? Yes. The JSON is raw and white-label". Solutions pages target rank-tracking apps and SEO software vendors. | VERIFIED [S84]; applies to that product page, INFERRED to reflect general policy |
| Account removal | DataForSEO may remove any account "without advance notice for any reason without restitution" | VERIFIED [S78] |
| Duplicate tasks | identical tasks are "a user-side error", no refund | VERIFIED [S78] |
| DPA | GDPR Data Processing Agreement incorporated | VERIFIED [S78] |

Assessment (INFERRED): storing, transforming and showing SERP/keyword data inside a customer-facing, white-labelled SEO/AI-visibility tool is the intended use case and is not restricted by the ToS. The open risk is clause 7.1/7.2, which pushes Google ToS liability onto the customer. Get written confirmation from DataForSEO sales for the specific use (multi-tenant resale, data retention period), and do not expose a raw "Google search API" to end users.

---

## 8. Changes 2025 to 2026 (VERIFIED, from the dated update feed [S85])

| Date | Change |
|---|---|
| 2025-03-18 | Labs Keyword Overview and Historical Keyword Data endpoints (replace Historical Search Volume) |
| 2025-05-09 | AI Overviews inside People Also Ask |
| 2025-06-03 | `.ai` AI-optimised responses |
| 2025-06-24 | AIO references in Labs Ranked Keywords (`ai_overview_reference` metrics) |
| 2025-07-01 | Google AI Mode SERP endpoints |
| 2025-07-10 | `markdown` on AIO; AIO video/table/expanded elements |
| 2025-09-13 / 16 / 19 | num=100 removal; per-page billing from 19 Sep 2025 |
| 2025-09-29 | Live Organic max depth 200 |
| 2025-10-02 | Billing clarification for fewer/more results per page |
| 2025-10-17 | Shopping results in AI Mode and AIO |
| 2025-10-24 | `stop_crawl_on_match` |
| 2025-10-27 | Lite endpoints deprecated 28 Oct 2025; pagination pricing restored |
| 2025-11-17 | `target_search_mode`, `find_targets_in`, `ignore_targets_in` |
| 2025-12-11 | Async AIO captured in Labs and Google databases |
| 2026-05-05 | API v2 closed |
| 2026-07-01 | +20% on Labs, Keywords Data, Backlinks, Domain Analytics, most On-Page and Content Analysis; +22% Google Trends Explore; +50% Amazon Products/Sellers task_post; monthly commitments removed |
| by 2026-07-02 | SERP 25% extra-page discount removed (INFERRED, not announced in the update feed; see 1.3) |
| 2026-07-30 | Paid ads (`ai_overview_paid`) in AI Mode |
| 2026-08-27 / 28 | Google `goto` URL handling |
| 2026-09-04 | New Labs ETV algorithm (`use_new_etv`), default from 1 Nov 2026 |
| 2026-09-15 / 16 | Google Events SERP deprecated; Pinterest and Social Media APIs ended |
| 2026-09-22 | Labs Search Intent no longer requires language |
| 2026-09-25 | Local Finder desktop depth 20 to 10 per page |

---

## 9. Cost model

### 9.1 Formulas (INFERRED from verified prices)

```
pages            = ceil(depth / 10)
task_cost        = base_price x pages [x 5 if search operator] + addons
addons (per task)= base_price if calculate_rectangles        (additive reading)
                 + base_price if load_async_ai_overview (refunded if no async AIO)
                 + 0.00015 x paa_clicks
monthly_cost     = keywords x devices x runs_per_month x task_cost
runs_per_month   = 30 (daily)  or  52/12 = 4.333 (weekly)
base_price       = 0.0006 (standard) | 0.0012 (priority) | 0.002 (live)
```

### 9.2 Top-100 (depth 100 = 10 pages), no add-ons

Per task: standard $0.006, priority $0.012, live $0.020.

| Keywords | Frequency | Devices | Standard | Priority | Live |
|---|---|---|---|---|---|
| 1,000 | daily | desktop | $180.00 | $360.00 | $600.00 |
| 1,000 | daily | desktop + mobile | $360.00 | $720.00 | $1,200.00 |
| 1,000 | weekly | desktop | $26.00 | $52.00 | $86.67 |
| 1,000 | weekly | desktop + mobile | $52.00 | $104.00 | $173.33 |
| 5,000 | daily | desktop | $900.00 | $1,800.00 | $3,000.00 |
| 5,000 | daily | desktop + mobile | $1,800.00 | $3,600.00 | $6,000.00 |
| 5,000 | weekly | desktop | $130.00 | $260.00 | $433.33 |
| 5,000 | weekly | desktop + mobile | $260.00 | $520.00 | $866.67 |
| 10,000 | daily | desktop | $1,800.00 | $3,600.00 | $6,000.00 |
| 10,000 | daily | desktop + mobile | $3,600.00 | $7,200.00 | $12,000.00 |
| 10,000 | weekly | desktop | $260.00 | $520.00 | $866.67 |
| 10,000 | weekly | desktop + mobile | $520.00 | $1,040.00 | $1,733.33 |

Example formula: 10,000 x 2 x 30 x 0.006 = $3,600.

### 9.3 Recommended alternative depths (standard queue, per month)

| Keywords | Frequency | Devices | Top-10 ($0.0006) | Top-20 ($0.0012) | Top-50 ($0.003) |
|---|---|---|---|---|---|
| 1,000 | daily | desktop | $18 | $36 | $90 |
| 1,000 | daily | desktop + mobile | $36 | $72 | $180 |
| 5,000 | daily | desktop | $90 | $180 | $450 |
| 5,000 | daily | desktop + mobile | $180 | $360 | $900 |
| 10,000 | daily | desktop | $180 | $360 | $900 |
| 10,000 | daily | desktop + mobile | $360 | $720 | $1,800 |
| 10,000 | weekly | desktop | $26 | $52 | $130 |
| 10,000 | weekly | desktop + mobile | $52 | $104 | $260 |

Priority = 2x these, Live = 3.33x these.

Recommendation (INFERRED): track top-20 daily on the standard queue (most customer value sits in pages 1 to 2), run top-100 weekly, and use `stop_crawl_on_match` for "find my domain" checks where competitor depth is not needed (cost then equals the number of pages crawled until the match, so a site ranking #7 costs one page). Use Live only for on-demand user checks.

### 9.4 AI-visibility add-ons (standard queue, INFERRED)

| Add-on | Unit | 10,000 kw daily, desktop | 10,000 kw daily, desktop + mobile |
|---|---|---|---|
| `load_async_ai_overview` (+$0.0006 per task, additive reading, upper bound before refunds) | per task | $180 | $360 |
| Same under the "x2" reading at depth 20 | per task | $360 | $720 |
| AI Mode SERP ($0.0012 per keyword) | per task | $360 | $720 |
| PAA 1 click (+$0.00015) | per task | $45 | $90 |

### 9.5 Monthly search-volume refresh for 10,000 keywords (INFERRED arithmetic on VERIFIED prices)

| Option | Calls | Cost per refresh | What you get |
|---|---|---|---|
| **Google Ads search_volume, standard task_post** (cheapest) | 10 tasks x 1,000 kw | 10 x $0.06 = **$0.60** | volume, 12 to 48 months `monthly_searches`, cpc, competition, bids; 1 to 3 h turnaround |
| Google Ads search_volume, live | 10 calls | 10 x $0.09 = $0.90 | same, instant; 12 calls/min cap |
| Clickstream bulk_search_volume | 10 calls | 10 x 0.012 + 10,000 x 0.00012 = $1.32 | clickstream volume + 12 months |
| Labs keyword_overview | ceil(10,000/700) = 15 calls | 15 x 0.012 + 10,000 x 0.00012 = $1.38 | volume, cpc, competition, **keyword_difficulty**, **intent**, trends, backlinks averages |
| Labs keyword_overview + clickstream | 15 calls | $2.76 | adds clickstream-normalised volume and demographics |
| Labs bulk_keyword_difficulty | 10 calls | $1.32 | KD only |
| Labs search_intent | 10 calls | $1.32 | intent only |
| Global Search Volume (clickstream) | 10 calls | 10 x $0.18 = $1.80 | worldwide volume + country split |

Recommended monthly refresh (INFERRED): Labs `keyword_overview` at $1.38 per 10,000 keywords gives volume, CPC, KD and intent in one call, and its Keywords Database is refreshed monthly on the Google Ads cycle; use Google Ads `search_volume` ($0.60) only if you need exact Keyword Planner parity or more than 12 months of history. Schedule it after the mid-month Google Ads update (poll `google_ads/status` `actual_data`).

---

## 10. Risks and surprises

1. **Silent SERP price change**: the 25% extra-page discount disappeared by 2 Jul 2026 without a dedicated update post; top-100 cost rose about 29% ($0.00465 to $0.006 standard). Monitor the FAQ and `user_data.price` programmatically.
2. **Contradictory add-on formulas** (additive vs x2). At depth 100 with async AIO the difference is $0.0066 vs $0.012 per task.
3. **Standard queue has no hard SLA**: "5 minutes on average", "target 45 minutes", "extended processing may occur". Design for late tasks and use postbacks.
4. **Rank fields**: `position` is left/right; right-column `rank_absolute` restarts at 1; `start=` offsets restart ranks at 1.
5. **AIO undercount** unless `load_async_ai_overview: true`; and AIO references were the main source of unresolved `google.com/goto` URLs in Aug 2026.
6. **Google Ads batch poisoning**: one restricted keyword wipes out a 1,000-keyword batch. Pre-filter or fall back to Labs/clickstream.
7. **Type mismatch**: `competition` is a string in Google Ads endpoints and a 0 to 1 float in Labs.
8. **Labs freshness**: SERP-derived Labs data is 30 to 90 days old per query; ranked_keywords etc. refresh weekly. Not for daily tracking.
9. **ETV definition changes on 1 Nov 2026**: historical ETV charts will jump; store `use_new_etv` state.
10. **Rate caps**: Google Ads Live 12/min; user_data 6/min; Tasks Ready 20/min; Labs 30 concurrent.
11. **ToS 7.1/7.2** push search-engine ToS liability to the customer; no explicit resale permission in the ToS itself.
12. **Google instability**: num=100 removal (Sep 2025), Lite workaround killed within days (Oct 2025), Events tab removed (Sep 2026), goto URLs (Aug 2026). Budget for further per-page cost increases.

---

## 11. Sources (all accessed 2026-09-29)

| ID | URL |
|---|---|
| S1 | https://docs.dataforseo.com/v3/serp/google/organic/task_post/ |
| S2 | https://docs.dataforseo.com/v3/serp/overview/ |
| S3 | https://dataforseo.com/pricing/google-serp/google-organic-serp-api |
| S4 | https://dataforseo.com/help-center/serp-api-cost-explained (Updated 02.07.2026) |
| S5 | https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq (Updated 02.07.2026) |
| S6 | https://dataforseo.com/help-center/what-is-max-crawl-pages-and-how-does-it-work |
| S7 | https://web.archive.org/web/20260411140435/https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq |
| S8 | https://web.archive.org/web/20251116190015/https://dataforseo.com/help-center/serp-api-cost-explained |
| S9 | https://docs.dataforseo.com/v3/serp/google/overview/ and https://docs.dataforseo.com/v3/serp/google/organic/overview/ |
| S10 | https://docs.dataforseo.com/v3/serp/google/organic/tasks_ready/ |
| S11 | https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/ (and /live/regular/) |
| S12 | https://dataforseo.com/pricing/keywords-data/google-ads |
| S13 | https://docs.dataforseo.com/v3/serp/google/organic/task_get/regular/ |
| S14 | https://docs.dataforseo.com/v3/serp/google/organic/task_get/html/ |
| S15 | https://dataforseo.com/update/google-organic-serp-api-critical-updates-depth (2025-09-13) |
| S16 | https://dataforseo.com/update/important-serp-api-remains-fully-operational-pricing-update (2025-09-16) |
| S17 | https://dataforseo.com/update/organic-serp-api-pricing-changes-now-in-effect (2025-09-19) |
| S18 | https://dataforseo.com/update/new-depth-limit-live-organic-serp-api (2025-09-29) |
| S19 | https://dataforseo.com/update/billing-fewer-more-results-per-page-in-organic-serp-api (2025-10-02) |
| S20 | https://dataforseo.com/update/pricing-update-in-dataforseo-apis (2026-07-01) |
| S21 | https://docs.dataforseo.com/v3/serp/google/organic/task_get/advanced/ |
| S22 | https://dataforseo.com/update/important-changes-to-google-serp-api-lite-and-organic (2025-10-27) |
| S23 | https://dataforseo.com/update/serp-api-crawl-stop-on-match (2025-10-24) |
| S24 | https://dataforseo.com/update/enhanced-target-matching-for-google-organic-serp-api-new-crawl-control-parameters (2025-11-17) |
| S25 | https://dataforseo.com/help-center/what-is-max-crawl-pages-and-how-does-it-work |
| S26 | https://dataforseo.com/help-center/how-to-scrape-google-ai-overviews-with-serp-api |
| S27 | https://dataforseo.com/help-center/rate-limits-and-request-limits (Updated 20.08.2026) |
| S28 | https://dataforseo.com/help-center/best-practices-low-volume-serp-api-payload |
| S29 | https://docs.dataforseo.com/v3/appendix/errors/ |
| S30 | https://dataforseo.com/help-center/pingbacks-postbacks-with-dataforseo-api |
| S31 | https://docs.dataforseo.com/v3/appendix/webhook_resend/ |
| S32 | https://docs.dataforseo.com/v3/appendix/api_errors/ |
| S33 | https://docs.dataforseo.com/v3/appendix/id_list/ |
| S34 | https://docs.dataforseo.com/v3/appendix/tasks_fixed/ |
| S35 | https://dataforseo.com/help-center/how-to-track-api-usage-with-tag |
| S36 | https://dataforseo.com/update/more-ai-powered-feature-formats-in-serp-api (2025-07-10) |
| S37 | https://dataforseo.com/update/ai-overviews-in-paa (2025-05-09) |
| S38 | https://dataforseo.com/update/deprecation-of-google-events-serp-api (2026-09-16) |
| S39 | https://dataforseo.com/help-center/rank-absolute-vs-rank-group |
| S40 | https://dataforseo.com/update/googles-goto-rollout-we-already-resolve-99-99-of-urls (2026-08-27, updated 08-28) |
| S41 | https://dataforseo.com/help-center/pixel-ranking-in-serp-api |
| S42 | https://docs.dataforseo.com/v3/serp/google/locations/ |
| S43 | https://docs.dataforseo.com/v3/serp/google/languages/ |
| S44 | https://docs.dataforseo.com/v3/serp/google/ai_mode/task_post/ |
| S45 | https://docs.dataforseo.com/v3/keywords_data/google_ads/overview/ |
| S46 | https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/ (and /task_post/) |
| S47 | https://docs.dataforseo.com/v3/keywords_data/google_ads/status/ and https://docs.dataforseo.com/v3/keywords_data/overview/ |
| S48 | https://dataforseo.com/pricing/keywords-data/clickstream-api-pricing and https://docs.dataforseo.com/v3/keywords_data/clickstream_data/overview/ (plus bulk_search_volume, global_search_volume, dataforseo_search_volume live docs) |
| S49 | https://dataforseo.com/pricing/keywords-data/dataforseo-trends-api-pricing |
| S50 | https://dataforseo.com/pricing/keywords-data/google-trends |
| S51 | https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api |
| S52 | https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/ |
| S53 | https://docs.dataforseo.com/v3/dataforseo_labs/google/historical_keyword_data/live/ |
| S54 | https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live/ |
| S55 | https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/ |
| S56 | https://docs.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live/ |
| S57 | https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/ |
| S58 | https://docs.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live/ |
| S59 | https://docs.dataforseo.com/v3/dataforseo_labs/google/serp_competitors/live/ |
| S60 | https://docs.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live/ |
| S61 | https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/ |
| S62 | https://docs.dataforseo.com/v3/dataforseo_labs/google/search_intent/live/ and https://dataforseo.com/update/search-intent-api-no-longer-requires-language (2026-09-22) |
| S63 | https://docs.dataforseo.com/v3/dataforseo_labs/google/historical_serps/live/ |
| S64 | https://docs.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live/ and https://docs.dataforseo.com/v3/dataforseo_labs/overview/ and https://docs.dataforseo.com/v3/dataforseo_labs/google/overview/ |
| S65 | https://dataforseo.com/help-center/how-often-is-dataforseo-api-data-updated (Updated 18.08.2026) |
| S66 | https://docs.dataforseo.com/v3/dataforseo_labs/status/ |
| S67 | https://dataforseo.com/update/upgraded-aio-collection-for-databases-and-labs-api (2025-12-11) |
| S68 | https://dataforseo.com/update/new-etv-calculation-in-dataforseo-labs-api (2026-09-04) |
| S69 | https://dataforseo.com/pricing/google-serp/google-autocomplete-serp-api |
| S70 | https://docs.dataforseo.com/v3/serp/google/autocomplete/live/advanced/ |
| S71 | https://dataforseo.com/pricing/google-serp/google-ai-mode-serp-api |
| S72 | https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/ and /task_get/advanced/ and /overview/ |
| S73 | https://docs.dataforseo.com/v3/serp/google/ai_mode/languages/ |
| S74 | https://dataforseo.com/update/track-ai-mode-with-google-serp-api (2025-07-01) |
| S75 | https://dataforseo.com/update/ads-in-ai-mode-serp-api (2026-07-30) and https://dataforseo.com/help-center/parse-google-ai-overviews-ai-mode |
| S76 | https://dataforseo.com/pricing |
| S77 | https://dataforseo.com/faq |
| S78 | https://dataforseo.com/terms-of-service (UPDATED 12 JUNE 2026) |
| S79 | https://docs.dataforseo.com/v3/appendix/sandbox/ |
| S80 | https://docs.dataforseo.com/v3/appendix/user_data/ |
| S81 | https://docs.dataforseo.com/v3/appendix/status/ |
| S82 | https://dataforseo.com/update/ai-optimized-api-responses-now-available |
| S83 | https://dataforseo.com/update/dataforseo-api-v2-sunset-notice |
| S84 | https://dataforseo.com/google-shopping-api |
| S85 | https://dataforseo.com/wp-json/wp/v2/update (dated update feed, 200 most recent posts) |
| X1 | https://ppc.land/google-shuts-down-dataforseos-api-cost-cut-in-five-days/ (secondary source) |

Pages that could not be loaded: `https://dataforseo.com/apis/serp-api/pricing` returned HTTP 404 (pricing now lives under `/pricing/google-serp/...`). `https://dataforseo.com/dataforseo-labs-api` and `https://dataforseo.com/apis/keywords-data-api` returned 404 (not needed; pricing pages used instead). The Wayback copy of the depth FAQ from 2026-05-23 did not parse; the 2026-05-08 copy of the cost-explained article did not parse.
