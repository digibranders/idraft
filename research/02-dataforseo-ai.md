# DataForSEO AI APIs: research for a self-hosted AI visibility tracker

Research date: 2026-09-29. Every page listed in the Sources section was loaded live on that date (HTTP 200) and read from the raw HTML. No DataForSEO credentials were used, so nothing below comes from a live API call. Response examples are the ones DataForSEO publishes in its docs.

Labels used throughout:

- **VERIFIED [Sn]**: stated on a live DataForSEO page, where Sn is a number in the Sources list.
- **INFERRED**: my own conclusion from verified facts, such as arithmetic or reading a JSON example.
- **UNVERIFIED**: not stated on any page I could load. Treat it as an open question.

---

## 0. Executive summary

| Surface we want to track | Best DataForSEO endpoint | What it represents | Price per observation (Standard / Priority / Live) | Fan-out queries? | Citations? |
|---|---|---|---|---|---|
| ChatGPT (consumer) | `/v3/ai_optimization/chat_gpt/llm_scraper/...` | Scrape of the ChatGPT web UI in search mode [S9][S30] | $0.0012 / $0.0024 / $0.004 [S24] | Yes, `fan_out_queries` [S9][S36] | `sources` (cited) plus `search_results` (retrieved) [S9] |
| Gemini (consumer) | `/v3/ai_optimization/gemini/llm_scraper/...` | Scrape of the Gemini web UI [S13][S30] | $0.0012 / $0.0024 / $0.004 [S24] | No field in the schema [S13] | `sources` [S13] |
| Google AI Mode | `/v3/serp/google/ai_mode/...` | Scraped Google AI Mode SERP [S16] | $0.0012 / $0.0024 / $0.004 [S26] | No field in the schema [S18] | `references` [S18] |
| Google AI Overview | `ai_overview` item inside `/v3/serp/google/organic/...` | Scraped Google organic SERP [S20][S34] | $0.0006 / $0.0012 / $0.002 base, plus the same again when `load_async_ai_overview` fetches an async AIO [S19][S20][S27][S34] | No | `references` [S20][S34] |
| ChatGPT, Gemini, Claude, Perplexity (official APIs) | `/v3/ai_optimization/{platform}/llm_responses/...` | Calls to the vendor's official model API, not the consumer UI [S30][S31] | Live: $0.0006 plus the LLM vendor's charge. Standard: $0.0002 plus a $0.01 prepay [S25][S32] | Yes, `fan_out_queries` [S3][S40] | `annotations` [S3] |
| Precomputed mentions database | `/v3/ai_optimization/llm_mentions/...` | DataForSEO's own DB of Google AIO and ChatGPT (US, English) answers [S21][S38][S39] | $0.1 per request plus $0.001 per row [S28][S43] | Filterable via `search_scope` [S21][S40] | `sources`, `sources_domain` aggregates [S21][S22][S37] |
| AI search volume | `/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live` | Modelled estimate built partly from Google People Also Ask data [S23][S35] | $0.01 per task plus $0.0001 per keyword [S29] | n/a | n/a |

Monthly cost headline (4 engines, 4.33 weeks per month, cheapest Standard queue): **$20.78 for 1,000 prompts a week with 1 run**, and **$623.52 for 10,000 prompts a week with 3 runs**. If AI Overview piggybacks on the organic SERP calls you already make for rank tracking, those figures fall to between $15.59 and $18.19, and between $467.64 and $545.58. INFERRED, with the full math in section 11.

---

## 1. AI Optimization API family

### 1.1 Structure and methods

VERIFIED [S1]: the AI Optimization API has four sub-APIs:
- LLM Responses
- LLM Scraper
- AI Keyword Data
- LLM Mentions

VERIFIED [S1]: AI Keyword Data and LLM Mentions are Live only. LLM Responses and LLM Scraper support both Standard (task_post, then tasks_ready, then task_get) and Live, "depending on the selected AI platform".

The full endpoint list, VERIFIED from the docs sidebar [S1]:

```
/v3/ai_optimization/chat_gpt/llm_responses/{models|task_post|tasks_ready|task_get/$id|live}
/v3/ai_optimization/claude/llm_responses/{models|task_post|tasks_ready|task_get/$id|live}
/v3/ai_optimization/gemini/llm_responses/{models|task_post|tasks_ready|task_get/$id|live}
/v3/ai_optimization/perplexity/llm_responses/{models|live}            (Live only)
/v3/ai_optimization/chat_gpt/llm_scraper/{locations|languages|task_post|tasks_ready|task_get/advanced/$id|task_get/html/$id|live/advanced|live/html}
/v3/ai_optimization/gemini/llm_scraper/{locations|languages|task_post|tasks_ready|task_get/advanced/$id|task_get/html/$id|live/advanced|live/html}
/v3/ai_optimization/ai_keyword_data/{locations_and_languages|keywords_search_volume/live}
/v3/ai_optimization/llm_mentions/{filters|locations_and_languages}
/v3/ai_optimization/llm_mentions/{search_mentions|target_metrics|multi_target_metrics|top_mentioned_pages|top_mentioned_domains|top_mentioned_brands|top_mentioned_brand_categories|historical|timeseries_delta|timeseries_new_lost}/live
/v3/ai_optimization/llm_mentions/{target_metrics_lite|top_mentioned_domains_lite|top_mentioned_pages_lite|top_mentioned_brands_lite|top_mentioned_brand_categories_lite}/live
```

VERIFIED [S41]: the older LLM Mentions paths, such as `llm_mentions/search/live`, `aggregated_metrics`, `cross_aggregated_metrics`, `top_domains` and `top_pages`, still work. No deprecation date has been set. The new names are the ones listed above.

### 1.2 LLM Responses (official model APIs)

**What it is.** VERIFIED [S30]: LLM Responses "sends requests directly to the official LLM API providers". Its output reflects what the underlying model produces, not what the platform's interface shows. It is **not** the consumer UI.

**Methods by platform.** VERIFIED [S2][S4][S8]:
- ChatGPT, Gemini and Claude support Standard and Live.
- Perplexity supports Live only.
- Gemini gained the Standard method on 2025-11-19 [S40].

**Request fields for ChatGPT Live**, VERIFIED [S3]:

| Field | Notes |
|---|---|
| `user_prompt` | Required. Maximum 500 characters. |
| `model_name` | Required. A base name resolves to the latest version, for example `gpt-4.1` becomes `gpt-4.1-2025-04-14`. |
| `max_output_tokens` | 16 to 4096. Default 2048. Reasoning models need at least 1024. May be exceeded when web search is on. |
| `temperature` | 0 to 2. Default 0.94. Not supported on reasoning models. |
| `top_p` | 0 to 1. Default 0.92. Cannot be combined with `temperature`. |
| `web_search` | Boolean. Default false. |
| `force_web_search` | Needs `web_search`. Citations are still not guaranteed. Not supported on reasoning models. |
| `web_search_country_iso_code`, `web_search_city` | Search location. Not supported on o3-mini, o1-pro or o1. |
| `system_message` | Maximum 500 characters. |
| `message_chain` | Up to 10 turns, each with `role` user or ai and at most 500 characters. |
| `tag` | Free-text label. |

Task POST also takes `postback_url` and `pingback_url` [S4].

**Differences on other platforms:**
- Claude, VERIFIED [S6]: has `web_search`, `force_web_search`, `web_search_country_iso_code` (36 listed countries, for example US, GB, DE, IN, JP) and `web_search_city`. It also has `use_reasoning`, which needs `max_output_tokens` of at least 1025 and cannot be combined with force_web_search, temperature or top_p.
- Gemini, VERIFIED [S5]: has `web_search` and `use_reasoning`, but no country or city parameter.
- Perplexity, VERIFIED [S7]: has only `web_search_country_iso_code`, and only for Sonar models. Web search is on by default in Sonar models.

**Response fields**, VERIFIED [S3], in this order:

- `tasks[].cost`, which is the base price plus `money_spent`.
- Under `result[]`:
  - `model_name`
  - `input_tokens`, `output_tokens`, `reasoning_tokens`
  - `web_search`
  - `money_spent`, which is the vendor's token and feature charge
  - `datetime`
  - `items[]`, where each item has `type` `reasoning` or `message`
    - `sections[]`, each with `type`, `text` and `annotations[]`
      - each annotation has `title`, `url`, `start_index`, `end_index` and `text`
  - `fan_out_queries[]`

Gemini annotations add `direct_url`, because `url` is a Vertex AI redirect. VERIFIED [S5][S42].

Documented example, trimmed, VERIFIED [S3]:

```json
{
  "cost": 0.029631,
  "tasks": [{
    "result": [{
      "model_name": "gpt-4.1-mini-2025-04-14",
      "input_tokens": 8174, "output_tokens": 476, "reasoning_tokens": 0,
      "web_search": true, "money_spent": 0.0290312,
      "datetime": "2026-07-22 17:54:30 +00:00",
      "items": [{ "type": "message", "sections": [{ "type": "text", "text": "...",
        "annotations": [{ "title": "...", "url": "https://www.latribune.fr/...?utm_source=openai",
                          "start_index": 290, "end_index": 516, "text": "..." }] }] }],
      "fan_out_queries": ["current relevance of amusement park business in France 2024"]
    }]
  }]
}
```

INFERRED: the task cost in this example is 0.0006 + 0.0290312. That matches the Live formula exactly. With web search on, a cheap GPT model call costs about $0.03, which is roughly 25 times the price of one ChatGPT scraper result.

**Other documented example costs** (these are doc examples, not quotes):
- Gemini gemini-2.5-flash: $0.036219 [S5]
- Perplexity sonar-reasoning-pro: $0.006724 [S7]
- Claude claude-opus-4-0: $0.55051 [S6]

**Models endpoints.** VERIFIED [S37b]: these are free GET calls to `.../llm_responses/models`. Each returns `model_name`, `reasoning`, `web_search_supported` and `task_post_supported`.

The model lists below come from doc examples, not from a live call:
- ChatGPT, example version 0.1.20250812 [S37b]: gpt-5, gpt-5-mini, gpt-5-nano, gpt-4o, gpt-4o-mini, o4-mini, o3-mini, o1, gpt-4.1-nano and gpt-3.5-turbo-1106.
- Gemini [S37c]: 2.5 pro/flash/flash-lite, 2.0 flash and 1.5 families.
- Claude [S37d]: sonnet-4, opus-4, 3.7, 3.5, 3 families.
- Perplexity, example version 0.1.20260116 [S37e]: sonar, sonar-pro, sonar-reasoning-pro.

UNVERIFIED: the current live model lists. Call the Models endpoints with credentials to get them, since the doc examples are dated.

**Pricing**, VERIFIED [S25][S32]:
- Live: $0.0006 plus the price charged by the LLM.
- Standard: $0.0002 plus an automatic $0.01 prepayment. DataForSEO refunds the difference if the LLM charge is lower and bills the excess if it is higher.
- The web search surcharge follows each vendor's own pricing.

### 1.3 LLM Scraper (consumer web UI)

**What it is.** VERIFIED [S30]: LLM Scraper "directly scrapes the web interface of an LLM that users see". It has no control over model parameters and no conversation memory. It covers ChatGPT and Gemini only [S8b][S30].

**ChatGPT scraper request**, VERIFIED [S9b] for Task POST:

| Field | Notes |
|---|---|
| `keyword` | Up to 2000 characters. |
| `priority` | 1 = normal (default), 2 = high. |
| `location_name` / `location_code` | Required. |
| `language_name` / `language_code` | Required. |
| `force_web_search` | Boolean. Citations are still not guaranteed. |
| `expand_citations` | HTML endpoint only. Needs `force_web_search`. |
| `tag`, `postback_url`, `postback_data` (`advanced` or `html`), `pingback_url` | Task POST only. |

Live Advanced takes the same fields without `priority` or the postback fields [S10].

**Gemini scraper request.** VERIFIED [S12]: the same fields, except that it has no `force_web_search` and it adds `location_coordinate` in the form "lat,lng,radius".

**ChatGPT scraper response.** VERIFIED [S9] (Task GET Advanced), with the same schema on Live Advanced [S10]. Under `result[]`:

- Top-level fields:
  - `keyword`, `location_code`, `language_code`
  - `model`, the model version
  - `check_url`
  - `datetime`
  - `markdown`, the full answer
- `search_results[]`: every web result retrieved, including duplicates and unused ones. Each has `type` `chatgpt_search_result`, `url`, `domain`, `title`, `description` and `breadcrumb`.
- `sources[]`: the sources actually cited. Each has `type` `chat_gpt_source`, `title`, `snippet`, `domain`, `url`, `thumbnail`, `source_name`, `publication_date` and `markdown`.
- `fan_out_queries[]`
- `brand_entities[]`: each has `type` `chat_gpt_brand_entity`, `title`, `category`, `markdown` and `urls[]` (`url`, `domain`).
- `se_results_count`, `item_types`, `items_count`
- `items[]`, with these item types:
  - `chat_gpt_text`: `rank_group`, `rank_absolute`, `markdown`, `sources[]`, `brand_entities[]`
  - `chat_gpt_table`: `text`, `markdown`, `table` (`table_header`, `table_content`), `brand_entities[]`
  - `chat_gpt_navigation_list`: `title`, `sources[]`
  - `chat_gpt_images`: `items[]` with `alt`, `url`, `image_url`
  - `chat_gpt_local_businesses`: `items[]` with `title`, `description`, `address`, `phone`, `reviews_count`, `url`, `domain`, `rating`
  - `chat_gpt_products`: `items[]` with `product_id`, `merchants`, `id_to_token_map`, `title`, `rating`, `price`, `currency`, `tag`, `url`, `domain`, `images`, and `product_ids[]` (Google Shopping ids plus the `query` ChatGPT used)
  - `chat_gpt_ad`: `is_rendered`, `title`, `snippet`, `url`, `domain`, `image_url`, `advertiser` (`name`, `url`, `favicon_url`)

Documented example, trimmed, VERIFIED [S9]:

```json
"result": [{
  "keyword": "albert einstein", "location_code": 2840, "language_code": "en",
  "model": "gpt-4o",
  "check_url": "https://chatgpt.com/?q=albert%20einstein&hints=search",
  "datetime": "2025-08-14 09:26:26 +00:00",
  "search_results": [{ "type": "chatgpt_search_result", "url": "https://www.britannica.com/...?utm_source=chatgpt.com", "domain": "www.britannica.com" }],
  "sources": [{ "type": "chat_gpt_source", "title": "Albert Einstein", "domain": "...", "url": "..." }],
  "fan_out_queries": ["Albert Einstein biography"],
  "brand_entities": [{ "type": "chat_gpt_brand_entity", "title": "SEMrush", "category": "software" }]
}]
```

The request echo in the same example shows `"device": "desktop", "os": "windows"` [S9].

**Gemini scraper response.** VERIFIED [S13][S14]. Under `result[]`:

- `keyword`, `location_code`, `language_code`
- `model`, which is `"Fast"` in the 2026-02 example
- `datetime`
- `markdown`
- `sources[]`, with `type` `gemini_source` and the same fields as the ChatGPT sources
- `se_results_count`, `item_types`, `items_count`
- `items[]`, with these types:
  - `gemini_text`, with `markdown`, `original_text` and `sources[]`
  - `gemini_table`
  - `gemini_images`

VERIFIED [S13]: the Gemini scraper schema has **no** `fan_out_queries`, **no** `brand_entities`, **no** `search_results` and **no** `check_url`.

**HTML endpoints.** VERIFIED [S8b]: `live/html` and `task_get/html/$id` return the raw page.

**Pricing.** VERIFIED [S24]: one page for ChatGPT and Gemini together.
- Standard: $0.0012
- Priority: $0.0024
- Live: $0.004

The same page gives two different turnaround figures:
- The cards say: Standard up to 45 minutes, Priority up to 5 minutes, Live up to 90 seconds.
- The intro text says: normal up to 5 minutes, high up to 1 minute.

The docs give up to 120 seconds for Live [S8][S8b].

The documented Live example costs match: $0.004 for ChatGPT [S10] and $0.004 for Gemini [S14].

**Locations and languages:**
- ChatGPT scraper, VERIFIED [S11][S11c]: 215 locations in the CSV dated 2026-09-01, made up of 213 countries plus 2 regions (Taiwan and Hong Kong). All are country level, with no city targeting.
- ChatGPT scraper languages, VERIFIED [S11b]: 127 languages in the CSV dated 2023-05-02, which is the Google-style list.
- Gemini scraper, VERIFIED [S44]: "over 210 supported locations" and "over 40 languages". It also accepts GPS coordinates [S12].

### 1.4 Retrieval queries (query fan-out): where you get them

| Endpoint | `fan_out_queries` | Source |
|---|---|---|
| ChatGPT LLM Scraper | Yes. Needs `force_web_search: true` to appear reliably, and is still not guaranteed. | VERIFIED [S9][S36] |
| Gemini LLM Scraper | No | VERIFIED [S13] |
| LLM Responses (all 4 platforms) | Yes | VERIFIED [S3][S40] |
| Google AI Mode SERP | No | VERIFIED [S18] |
| Google organic `ai_overview` | No | VERIFIED [S20] |
| LLM Mentions `search_mentions` | Yes, for chat_gpt only | VERIFIED [S21] |

---

## 2. ChatGPT consumer surface

- **Does it scrape chatgpt.com?** Yes. VERIFIED [S30][S45]: it covers "ChatGPT's search mode", and the `check_url` in the example is `https://chatgpt.com/?q=...&hints=search` [S9].
- **Logged in or logged out?** UNVERIFIED. No page I loaded says. INFERRED: the check_url pattern, the absence of any account parameter, and the fixed `device: desktop, os: windows` echo all point to an anonymous (logged-out) desktop session. The example `model` value was `gpt-4o` in August 2025, which is consistent with a free-tier session. Confirm this with support before relying on it.
- **Citations.** `sources` (what was cited) and `search_results` (what was retrieved). VERIFIED [S9].
- **Fan-out queries.** Yes. VERIFIED [S9][S36][S46].
- **Brand entities.** Yes, since 2025-12-04. VERIFIED [S47].
- **Product and shopping cards.** Yes, via `chat_gpt_products`, which gained merchants and Google Shopping ids on 2026-03-12. VERIFIED [S9][S48].
- **Local business cards.** Yes. VERIFIED [S9].
- **Ads.** Yes, via `chat_gpt_ad` since 2026-05-28. The `is_rendered` flag was added on 2026-08-13. VERIFIED [S49][S50].
- **Location.** A country-level `location_code` from 215 options. VERIFIED [S11c]. The mechanism (proxy or otherwise) is UNVERIFIED.
- **Price.** $0.0012 Standard, $0.0024 Priority, $0.004 Live. VERIFIED [S24].
- **Turnaround.** Live up to 120 seconds (docs [S8b]) or up to 90 seconds (pricing [S24]). Standard up to 45 minutes. Priority up to 5 minutes [S24].

---

## 3. Gemini consumer surface

- **Scraped UI.** Yes, the "Gemini web versions". VERIFIED [S30][S13]. Launched 2026-02-26 [S44].
- **Logged in or logged out.** UNVERIFIED. The `model` value is `"Fast"` in the example [S14]. INFERRED: that label is the UI mode picker shown to a default user.
- **Citations.** `sources[]`, both at the top level and per `gemini_text` item. VERIFIED [S13].
- **Fan-out queries, brand entities, search_results, products, ads.** None in the schema. VERIFIED [S13]. Item types are limited to text, table and images.
- **Location.** Over 210 locations and over 40 languages, plus `location_coordinate`. VERIFIED [S44][S12].
- **Price and turnaround.** Same as the ChatGPT scraper. VERIFIED [S24].
- **Alternative with fan-out.** INFERRED: the Gemini LLM Responses API returns `fan_out_queries` and annotations, but it is the official Gemini API, not the consumer app. It also costs roughly $0.036 per call in the doc example [S5].

---

## 4. Google AI Mode and AI Overview

### 4.1 AI Mode SERP

**Endpoints.** VERIFIED [S16][S17][S18]:
- `POST /v3/serp/google/ai_mode/task_post`
- `GET /v3/serp/google/ai_mode/tasks_ready`
- `GET /v3/serp/google/ai_mode/task_get/advanced/$id`
- `GET /v3/serp/google/ai_mode/task_get/html/$id`
- `POST /v3/serp/google/ai_mode/live/advanced`
- `POST /v3/serp/google/ai_mode/live/html`
- `GET /v3/serp/google/ai_mode/languages`

**Parameters.** VERIFIED [S17]:
- `keyword` (700 characters maximum)
- `location_code`, `location_name` or `location_coordinate`
- `language_code` or `language_name`
- `priority`
- `device` (desktop or mobile)
- `os`
- `calculate_rectangles`, which doubles the charge
- `browser_screen_*`
- `tag`, `postback_url`, `postback_data`, `pingback_url`

Locations use the general Google SERP location list [S17]. The languages example lists 43 languages [S17b]. In July 2025 AI Mode was English only [S51].

Depth: the overview page says depth above the default raises cost, billed per 20 results on desktop [S16]. But no `depth` parameter appears on the Task POST or Live pages [S17][S18]. This is a documentation inconsistency (INFERRED). Budget one page per task.

**Response.** VERIFIED [S18]. Under `result[]`:

- `keyword`, `check_url`, `datetime`, `spell`, `refinement_chips`
- `item_types`, where the only listed type is `ai_overview`
- `items[]` containing one `ai_overview` object with:
  - `markdown`
  - `items[]`, whose element types are:
    - `ai_overview_element`: `title`, `text`, `markdown`, `links[]`, `images[]`, `references[]`
    - `ai_overview_video_element`
    - `ai_overview_table_element`
    - `ai_overview_expanded_element`
    - `ai_overview_shopping` (since 2025-10-17 [S52])
    - `ai_overview_paid` (ads, since 2026-07-30 [S53])
  - `references[]`, each with `source`, `domain`, `url`, `title` and `text`
  - `rectangle`

VERIFIED [S18]: there is no fan-out query field.

**Price.** VERIFIED [S26]:
- Standard: $0.0012
- Priority: $0.0024
- Live: $0.004

The example cost in the docs is $0.004 [S18].

**Personalization.** VERIFIED [S16]: "user preferences, search history, and other personalized search factors are ignored". DataForSEO says you can check any result by opening `check_url` in an incognito window.

### 4.2 AI Overview inside the organic SERP

**Where it appears.** VERIFIED [S34]: the `ai_overview` item "automatically" appears in the Google Organic SERP API response when detected. Its schema matches AI Mode, with extra fields `asynchronous_ai_overview`, `markdown`, `items[]` (same element types) and `references[]` [S20].

**`load_async_ai_overview` (boolean, default false).** VERIFIED [S19][S20][S34]:
- When false, you only get cached (synchronous) AI Overviews. If an async one is detected, `ai_overview` comes back as `null`.
- When true, DataForSEO makes an extra request to fetch the async AI Overview.
  - The surcharge is $0.0006 on Standard Task POST [S19] and $0.002 on Live [S20].
  - The pricing page describes it as "Add one base price" [S27]. So Priority is +$0.0012 (INFERRED from the base price).
- The surcharge is refunded if there is no async AI Overview, or if a cached one was present anyway [S34].

**`expand_ai_overview`.** HTML endpoints only, at no charge. Advanced results always come expanded. VERIFIED [S19][S34].

**Organic base price.** VERIFIED [S27][S54]:
- Standard: $0.0006
- Priority: $0.0012
- Live: $0.002

Since 2025-09-19 the base price covers depth 10 (one page). Each extra page costs 0.75 times the base.

**The "free" AI Overview.** INFERRED from [S27][S34]: if you already pull a Google organic SERP for rank tracking, cached AI Overviews cost nothing extra. Async ones cost one extra base price only when they are actually fetched. So the marginal cost of AI Overview tracking is between $0 and $0.0006 per keyword on Standard.

Related: AI Overview elements also appear inside PAA, Knowledge Graph and Product Considerations items [S34]. Bing's Copilot summary is available as `ai_overview` in the Bing SERP API [S55].

---

## 5. AI Keyword Data (AI search volume)

**Endpoint.** VERIFIED [S23]: `POST /v3/ai_optimization/ai_keyword_data/keywords_search_volume/live`.
- Up to 1000 `keywords` per task, each up to 250 characters, lowercased.
- `location_name`/`location_code` and `language_name`/`language_code` are required.
- Optional `tag`.
- Live only. At most 30 simultaneous requests.

Locations come from the `.../ai_keyword_data/locations_and_languages` endpoint, which is free [S23b]. UNVERIFIED: the exact coverage count, since the docs only show a truncated example.

**Response fields.** VERIFIED [S23]:
- `result[].location_code`, `language_code`, `items_count`
- `items[].keyword`, `ai_search_volume`
- `ai_monthly_searches[]`, each with `year`, `month` and `ai_search_volume`

These cover the last month plus a 12-month trend [S23][S29].

**Methodology.** VERIFIED:
- The endpoint page says values are "calculated using statistical data from questions in the 'People Also Ask' SERP element" [S23].
- The help centre calls it a "proprietary algorithm that considers multiple signals", including PAA data from DataForSEO's own SERP index [S35]. The article is dated 05.09.2025.
- Paraphrasing the rest of [S35]:
  - Grammatical forms are merged, so "tie" and "ties" get the same value.
  - For multi-word phrases, only questions containing all the words are counted.
  - The metric is question-based rather than query-based.
  - It estimates how often a keyword appears in questions people may ask AI tools.

INFERRED: this is not observed prompt telemetry from OpenAI or Google. It is a proxy derived from Google PAA. Treat it as a relative demand index, not a count of real prompts.

**Pricing.** VERIFIED [S29]:
- $0.01 per task plus $0.0001 per keyword item.
- Their own worked example: $110 per 1M keywords.
- Turnaround averages up to 2 seconds.

---

## 6. LLM Mentions API (mentions database)

**What it is.** VERIFIED [S38][S39][S43]:
- A database DataForSEO collects itself, of Google AI Overview and ChatGPT prompts and answers.
- At launch, ChatGPT coverage was "US only, model GPT-5" [S43].
- The docs say `chat_gpt` data is available for location 2840 and language `en` only [S21].
- Google AI Overview covers all locations in the `locations_and_languages` list [S43][S21b].

**Collection method.** UNVERIFIED in detail. DataForSEO says it relies on "internal data sources and proprietary databases", and that it does not use customer API responses [S38].

**Size and freshness.** VERIFIED:
- The help centre says the database holds over 300 million prompts and answers, is "updated continuously", and has a full update cycle of **60 days** [S39].
- The product page counters on 2026-09-29 showed 387,022,490 total prompts: 27,589,737 ChatGPT and 359,432,753 Google AIO [S38].
- Historical endpoints go back to 2025-08-01 [S37][S38].

**Search Mentions.** `POST /v3/ai_optimization/llm_mentions/search_mentions/live`. VERIFIED [S21].

Request fields:
- `target[]` holds up to 10 entities:
  - A domain entity: `domain`, `search_filter` (include or exclude), `search_scope` (any, sources, search_results) and `include_subdomains`.
  - A keyword entity: `keyword`, `search_filter`, `search_scope` (any, question, answer, brand_entities, fan_out_queries) and `match_type` (word_match or partial_match).
- `platform` (chat_gpt or google). If omitted, both platforms are returned.
- `location_*` and `language_*`
- `filters` (up to 8) and `order_by` (up to 3)
- `offset` (up to 1,000,000), `search_after_token`, and `limit` (default 100, maximum 1000)

Response `items[]` fields:
- `platform`
- `model_name`, which is always `google_ai_overview` for the google platform
- `location_code`, `language_code`
- `question`, `answer` (markdown)
- `sources[]`: `rank`, `title`, `domain`, `url`, `snippet`, `source_name`, `thumbnail`, `markdown`, `publication_date`
- `search_results[]`, chat_gpt only
- `ai_search_volume` and `monthly_searches[]`
- `first_response_at`, `last_response_at`
- `brand_entities[]`, chat_gpt only
- `fan_out_queries[]`, chat_gpt only
- `is_web_search_based`

**Aggregation endpoints.** VERIFIED [S22][S37]: Target Metrics, Multi-Target Metrics, Top Mentioned Domains, Pages, Brands and Brand Categories, plus their Lite versions.

Extra request fields: `links_scope`, `initial_dataset_filters`, `internal_list_limit`, `include_domains` and `exclude_domains`.

Response fields: `aggregated_metrics` grouped by `location`, `language`, `platform`, `sources_domain`, `search_results_domain` (chat_gpt only), `brand_entities_title` and `brand_entities_category`. Each group is a list of `{key, mentions, ai_search_volume}`. There is also a `total` with `mentions` and `ai_search_volume`.

Top Mentioned Brands data is chat_gpt only [S37].

**Time series endpoints.** VERIFIED [S37]:
- `historical`: monthly counts and AI search volume.
- `timeseries_delta`: the difference between two dates.
- `timeseries_new_lost`: new and lost mentions between two dates.

**How `ai_search_volume` is defined here.** VERIFIED [S36b]:
- For `google`, it comes directly from Google search volume.
- For `chat_gpt`, DataForSEO counts the PAA questions that contain the keyword. Their words: "collect all People Also Ask questions that include the target keyword".
- Aggregate totals are sums across all mentions.
- The two platforms are therefore not comparable.

**How citations are defined.** VERIFIED [S37f]: `sources` are the actual citations. `search_results` are everything retrieved.

**Pricing.** VERIFIED [S28][S43][S41]:
- $0.1 per request plus $0.001 per row, which DataForSEO describes as "from just $1.1 per 1,000 data rows".
- The calculator source confirms `basePricePerRequest: 0.1` and `pricePerRow: 0.001` [S28b].
- The static "$0.05" shown on the pricing page is a placeholder from before the calculator runs (INFERRED).
- The $100 monthly minimum from launch was removed. It is now fully pay-as-you-go [S41].
- Doc examples show $0.101 for a single-row aggregate call [S22] and $0.103 for a 3-row search [S21].
- Turnaround averages up to 2 seconds [S28].

**Limitations**, VERIFIED unless marked:
- ChatGPT data is US and English only.
- There is no Gemini, AI Mode, Claude or Perplexity data.
- The data is a panel of prompts chosen by DataForSEO, not your own prompts (INFERRED).
- The refresh cycle is 60 days, so it is not daily tracking.
- Brand and fan-out fields are ChatGPT only.

---

## 7. Perplexity, Claude, Grok and Copilot

| Platform | What exists | Source |
|---|---|---|
| Perplexity | LLM Responses Live only (`/v3/ai_optimization/perplexity/llm_responses/live`, `/models`). Uses the official Sonar API, with no consumer scraper. | VERIFIED [S7][S7b][S30] |
| Claude | LLM Responses Live and Standard (official Anthropic API). No consumer scraper. | VERIFIED [S6][S31] |
| Grok | Nothing found in the docs sidebar or the update feed. | VERIFIED absence [S1][S56] |
| Microsoft Copilot | Copilot Search summary returned as `ai_overview` in the Bing Organic SERP API (Advanced) since 2025-05-01. There is no standalone Copilot chat scraper. | VERIFIED [S55] |
| Yahoo AI Summary | In the SERP API since 2025-10-30. | VERIFIED [S56] (update title) |

---

## 8. Rate limits, concurrency, postbacks and retention

| Item | Value | Source |
|---|---|---|
| General call rate | Up to 2000 API calls per minute. Raise by contacting support. | VERIFIED [S2][S8b][S16] |
| Tasks per POST (Standard) | 100. Tasks beyond that get error 40006. | VERIFIED [S4][S9b][S17] |
| Tasks per Live call | 1 | VERIFIED [S3][S10] |
| LLM Responses Live concurrency | 30 per account per platform | VERIFIED [S2][S3] |
| LLM Mentions and AI Keyword Data concurrency | 30 simultaneous | VERIFIED [S21c][S23] |
| LLM Responses Standard completion window | Up to 72 hours. On failure the $0.01 is refunded. With a negative balance, results are not delivered. | VERIFIED [S4][S32] |
| Live execution timeout | Up to 120 seconds (LLM Responses, LLM Scraper, LLM Mentions) | VERIFIED [S2][S8b][S21] |
| Postback and pingback | Supported on all Standard endpoints. `$id` and `$tag` placeholders. Postbacks are gzip POSTs. Your server must answer within 10 seconds, or the task goes to tasks_ready. The scraper and SERP need `postback_data` (advanced or html). | VERIFIED [S4][S9b][S17] |
| tasks_ready | Up to 20 calls per minute and 1000 IDs per call. Only lists tasks completed in the previous 3 days and not yet collected. For more than 1000 tasks per minute, DataForSEO recommends postbacks. | VERIFIED [S4b] |
| Result retention | Task GET results can be fetched free "within the next 30 days" | VERIFIED [S9][S4c] |
| Sandbox | Free sandbox for all of these APIs. $1 trial credit. | VERIFIED [S1][S31b] |

---

## 9. Differences from the real consumer UI and caveats

1. **API is not UI.** VERIFIED [S30][S31b]: LLM Responses output "reflects what the underlying model produces, not what appears in the platform's interface." For consumer visibility, use LLM Scraper, AI Mode or the organic AIO.
2. **Personalization is ignored in SERP products.** VERIFIED [S16]: search history and user preferences are ignored. The same statement for LLM Scraper is UNVERIFIED.
3. **Login state is undocumented.** UNVERIFIED for both scrapers. INFERRED to be anonymous sessions, as covered in sections 2 and 3. Logged-in Plus or Pro users see different models, memory and connectors, none of which is represented.
4. **Location method.**
   - ChatGPT scraper: country-level `location_code` only [S11c].
   - Gemini: country codes or GPS coordinates [S12].
   - LLM Responses: ChatGPT and Claude take a web search country and city hint. Gemini takes none. Perplexity takes a country only [S3][S5][S6][S7].
   - How the scraper applies location (proxy exit IP or a UI setting) is UNVERIFIED.
5. **Model version drift.**
   - The scraper `model` field reports whatever the UI served: `gpt-4o` in the 2025-08 ChatGPT example, and `"Fast"` for Gemini [S9][S14].
   - In LLM Responses, `model_name` without a date suffix silently resolves to the "latest version" [S3].
   - Record `model` / `model_name` on every observation and treat any change as a break in the time series (INFERRED recommendation).
6. **Citations are not guaranteed.**
   - `force_web_search` does not guarantee sources or fan-out queries [S9b][S36].
   - `annotations` is `null` without web_search, and can be empty with it [S3].
   - Since 2026-07-28, Gemini annotations are built from `groundingSupports` and can contain duplicate URLs, so deduplicate per answer [S57].
7. **Retrieved versus cited.** `search_results` means retrieved and `sources` means cited [S9][S37f]. Count "citation share" from `sources` only.
8. **Ads.** ChatGPT ads can be served but not shown. Filter on `is_rendered: true` [S50]. AI Mode `ai_overview_paid.url` holds the advertiser homepage, not the landing page [S53].
9. **AIO async.** Without `load_async_ai_overview: true` you systematically miss async AI Overviews, which come back as `ai_overview: null` [S34]. That undercounts AI Overview presence.
10. **Documentation inconsistencies** to confirm with support:
    - Scraper turnaround: 45 minutes versus 5 minutes for Standard [S24].
    - AI Mode depth billing text with no depth parameter [S16][S17].
    - ChatGPT scraper languages CSV last updated 2023 [S11b].
    - The LLM Responses help article (Aug 2025) says Standard is ChatGPT and Claude only, which Gemini Standard later superseded [S32][S40].
11. **Mentions DB is a panel.** US English ChatGPT prompts plus Google AIO, on a 60-day refresh [S39][S21]. It cannot replace your own prompt tracking, but it is a cheap source of discovery and benchmark data (INFERRED).

---

## 10. Changes in 2025 and 2026 (from the DataForSEO update feed)

All dates VERIFIED [S56] and the linked update pages.

| Date | Change |
|---|---|
| 2025-05-01 | Bing Copilot Search summary in the Bing SERP API [S55] |
| 2025-07-01 | Google AI Mode SERP API launched, English only at launch [S51] |
| 2025-08-06 | AI Optimization API launched: LLM Responses (ChatGPT, Claude, Gemini, Perplexity) and AI Keyword Data [S58] |
| 2025-08-19 | ChatGPT LLM Scraper launched [S45] |
| 2025-09-19 | Organic SERP repriced: base covers 10 results, extra pages at 0.75 times base, calculate_rectangles adds 1 base [S54] |
| 2025-09-26 | `expand_citations` for ChatGPT scraper HTML [S56] |
| 2025-10-17 | `ai_overview_shopping` in AI Mode and organic AIO [S52] |
| 2025-10-29 | `fan_out_queries` in the ChatGPT LLM Scraper [S46] |
| 2025-11-11 | LLM Mentions API launched, at first with a $100 monthly minimum top-up [S43] |
| 2025-11-19 | Standard method for Gemini LLM Responses [S40] |
| 2025-12-04 | `brand_entities` in the ChatGPT scraper [S47] |
| 2025-12-10 | `first_response_at` and `last_response_at` in LLM Mentions [S59] |
| 2025-12-11 | Async AIO now collected in the Google databases and Labs API [S60] |
| 2025-12-15 | `fan_out_queries` added to LLM Responses on all 4 platforms. Brand entity search added to LLM Mentions [S40] |
| 2026-02-26 | Gemini LLM Scraper launched [S44] |
| 2026-03-12 | More product fields in `chat_gpt_products` [S48] |
| 2026-03-17 | Reasoning support: `use_reasoning` for Claude and Gemini, `reasoning` item, `reasoning_tokens` [S61] |
| 2026-05-28 | `chat_gpt_ad` in the ChatGPT scraper [S49] |
| 2026-07-07 | Extended LLM Mentions: renamed endpoints, historical and time series endpoints, Lite versions, monthly minimum removed [S41] |
| 2026-07-28 | Text-level `start_index`/`end_index`/`text` annotations for ChatGPT and Gemini LLM Responses. Gemini annotations moved to groundingSupports [S57] |
| 2026-07-30 | `ai_overview_paid` in the AI Mode SERP [S53] |
| 2026-08-13 | `is_rendered` on ChatGPT ads [S50] |
| 2026-09-17 | `direct_url` in Gemini LLM Responses annotations [S42] |

---

## 11. Cost model

### 11.1 Unit prices used (all VERIFIED)

| Engine | Endpoint | Standard | Priority | Live | Source |
|---|---|---|---|---|---|
| ChatGPT | chat_gpt/llm_scraper (advanced) | $0.0012 | $0.0024 | $0.004 | [S24] |
| Gemini | gemini/llm_scraper (advanced) | $0.0012 | $0.0024 | $0.004 | [S24] |
| Google AI Mode | serp/google/ai_mode (advanced) | $0.0012 | $0.0024 | $0.004 | [S26] |
| Google AIO, standalone | serp/google/organic (advanced), depth 10 | $0.0006 | $0.0012 | $0.002 | [S27] |
| AIO async surcharge | `load_async_ai_overview: true`, charged only when an async AIO is fetched | +$0.0006 | +$0.0012 | +$0.002 | [S19][S20][S27][S34] |

The Priority async surcharge of +$0.0012 is INFERRED from the rule "Add one base price" [S27].

### 11.2 Formulas

```
runs_per_engine_per_month = P_weekly x 4.33 x R
observations_per_month    = runs_per_engine_per_month x 4

cost_per_prompt_run (standalone AIO, worst case, async surcharge always charged)
  = 3 x p_llm_or_aimode + p_organic + p_async
    Standard: 3 x 0.0012 + 0.0006 + 0.0006 = $0.0048
    Priority: 3 x 0.0024 + 0.0012 + 0.0012 = $0.0096
    Live:     3 x 0.004  + 0.002  + 0.002  = $0.0160

cost_per_prompt_run (AIO piggybacks on existing rank-tracking SERP)
  = 3 x p_llm_or_aimode + [0 .. p_async]
    Standard: $0.0036 to $0.0042
    Priority: $0.0072 to $0.0084
    Live:     $0.0120 to $0.0140

monthly_cost = runs_per_engine_per_month x cost_per_prompt_run
```

The "standalone" column is an upper bound, because the async surcharge is refunded whenever no async AIO is fetched. INFERRED.

### 11.3 Monthly cost, 4 engines, 1 run per prompt per engine (R = 1)

| Prompts per week | Runs per engine per month | Observations per month | Standard (standalone AIO) | Standard (AIO piggyback) | Priority (standalone) | Live (standalone) | Live (piggyback) |
|---|---|---|---|---|---|---|---|
| 100 | 433 | 1,732 | $2.08 | $1.56 to $1.82 | $4.16 | $6.93 | $5.20 to $6.06 |
| 500 | 2,165 | 8,660 | $10.39 | $7.79 to $9.09 | $20.78 | $34.64 | $25.98 to $30.31 |
| 1,000 | 4,330 | 17,320 | $20.78 | $15.59 to $18.19 | $41.57 | $69.28 | $51.96 to $60.62 |
| 5,000 | 21,650 | 86,600 | $103.92 | $77.94 to $90.93 | $207.84 | $346.40 | $259.80 to $303.10 |
| 10,000 | 43,300 | 173,200 | $207.84 | $155.88 to $181.86 | $415.68 | $692.80 | $519.60 to $606.20 |

### 11.4 Monthly cost, 4 engines, 3 replicate runs (R = 3)

| Prompts per week | Runs per engine per month | Observations per month | Standard (standalone AIO) | Standard (AIO piggyback) | Priority (standalone) | Live (standalone) | Live (piggyback) |
|---|---|---|---|---|---|---|---|
| 100 | 1,299 | 5,196 | $6.24 | $4.68 to $5.46 | $12.47 | $20.78 | $15.59 to $18.19 |
| 500 | 6,495 | 25,980 | $31.18 | $23.38 to $27.28 | $62.35 | $103.92 | $77.94 to $90.93 |
| 1,000 | 12,990 | 51,960 | $62.35 | $46.76 to $54.56 | $124.70 | $207.84 | $155.88 to $181.86 |
| 5,000 | 64,950 | 259,800 | $311.76 | $233.82 to $272.79 | $623.52 | $1,039.20 | $779.40 to $909.30 |
| 10,000 | 129,900 | 519,600 | $623.52 | $467.64 to $545.58 | $1,247.04 | $2,078.40 | $1,558.80 to $1,818.60 |

Note on replicates. INFERRED: replicating AIO and AI Mode three times in the same week measures Google SERP volatility rather than LLM sampling variance. A cheaper design replicates only ChatGPT and Gemini (R = 3) and keeps AI Mode and AIO at R = 1.

For 1,000 prompts a week on Standard with standalone AIO, that design costs 4,330 x (3 x 2 x 0.0012 + 0.0012 + 0.0012) = **$41.57 per month**, compared with $62.35.

### 11.5 Per 100,000 and 1,000,000 AI observations per month

One observation is one engine result.

| Endpoint | Per 100k (Std / Pri / Live) | Per 1M (Std / Pri / Live) |
|---|---|---|
| ChatGPT LLM Scraper | $120 / $240 / $400 | $1,200 / $2,400 / $4,000 |
| Gemini LLM Scraper | $120 / $240 / $400 | $1,200 / $2,400 / $4,000 |
| Google AI Mode SERP | $120 / $240 / $400 | $1,200 / $2,400 / $4,000 |
| Google organic SERP for AIO, standalone | $60 to $120 / $120 to $240 / $200 to $400 | $600 to $1,200 / $1,200 to $2,400 / $2,000 to $4,000 |
| AIO piggyback on existing rank tracking | $0 to $60 / $0 to $120 / $0 to $200 | $0 to $600 / $0 to $1,200 / $0 to $2,000 |
| Blended equal 4-engine mix, standalone AIO worst case | $120 / $240 / $400 | $1,200 / $2,400 / $4,000 |
| Blended equal mix, AIO piggyback | $90 to $105 / $180 to $210 / $300 to $350 | $900 to $1,050 / $1,800 to $2,100 / $3,000 to $3,500 |

**Comparisons:**
- **LLM Responses (API path)**, INFERRED from doc example costs, which vary with prompt length, model and web search:
  - ChatGPT gpt-4.1-mini with web search: about $0.0296 per call [S3]. That is about $2,963 per 100k and $29,631 per 1M.
  - Gemini 2.5 flash: about $0.0362 per call [S5]. That is about $3,622 per 100k.
  - Swapping both scrapers for LLM Responses at 1,000 prompts a week with R = 1 raises the monthly cost from $20.78 to about $295.52.
- **LLM Mentions (database reads):** 100k rows cost 100 requests x $0.1 + 100,000 x $0.001 = $110. 1M rows cost $1,100 [S28]. Note that these are rows about DataForSEO's panel prompts, not observations of your own prompts.
- **AI Keyword Data:** 1M keywords cost $110 [S29].

### 11.6 Throughput check (INFERRED)

The largest scenario is 10,000 prompts a week, R = 3, 4 engines: 519,600 tasks a month, or about 120k a week. On Standard, at 100 tasks per POST and 2000 calls per minute [S17], that is far below the rate limit.

If you use Live for any LLM Responses platform, the 30-concurrent-per-platform cap applies [S3]. At about 30 to 120 seconds per call, that is roughly 15 to 60 calls per minute per platform, which caps you at about 150k to 600k calls a week. Use Standard with postbacks at scale, and prefer postbacks over tasks_ready above 1000 tasks per minute [S4b].

---

## 12. Recommendations for the tracker (INFERRED)

1. **Engines.**
   - ChatGPT: `chat_gpt/llm_scraper/task_post`, priority 1, `force_web_search: true`, `postback_data: advanced`.
   - Gemini: `gemini/llm_scraper/task_post`.
   - AI Mode: `serp/google/ai_mode/task_post`.
   - AIO: add `load_async_ai_overview: true` to the existing `serp/google/organic/task_post` rank-tracking calls.
2. **Store per observation:**
   - `model`, `datetime`, `check_url`
   - location and language
   - raw `markdown`
   - `sources[]` for citations and `search_results[]` for retrievals
   - `fan_out_queries[]`, `brand_entities[]`
   - item types
   - `is_rendered` ads
   - the task `cost`
3. **Brand detection.** Use your own matcher over `markdown`. DataForSEO `brand_entities` exist for ChatGPT only.
4. **Enrichment.** Use LLM Mentions `target_metrics` (about $0.101 per call) for monthly benchmark and discovery, and AI Keyword Data for prompt prioritisation. Label both as modelled or panel data in the UI.
5. **Open questions for DataForSEO support:**
   - Scraper login state and account tier.
   - Location mechanism.
   - Whether `model` reflects the UI model picker.
   - The actual scraper Standard turnaround SLA.
   - A current ChatGPT scraper language list.
   - Whether the Gemini scraper will gain fan-out and brand entities.

---

## Sources (all accessed 2026-09-29, HTTP 200 unless noted)

- S1: https://docs.dataforseo.com/v3/ai_optimization/overview/
- S2: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/overview/
- S2b: https://docs.dataforseo.com/v3/ai_optimization/llm_responses/overview/
- S3: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live/
- S4: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/task_post/
- S4b: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/tasks_ready/
- S4c: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/task_get/
- S5: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_responses/live/
- S5b: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_responses/task_post/
- S6: https://docs.dataforseo.com/v3/ai_optimization/claude/llm_responses/live/
- S7: https://docs.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/live/
- S7b: https://docs.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/overview/
- S8: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/overview/
- S8b: https://docs.dataforseo.com/v3/ai_optimization/llm_scraper/overview/
- S9: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/
- S9b: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_post/
- S10: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced/
- S11: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/locations/
- S11b: https://cdn.dataforseo.com/v3/languages/languages_ai_optimization_chat_gpt_llm_scraper_2023_05_02.csv
- S11c: https://cdn.dataforseo.com/v3/locations/locations_ai_optimization_chat_gpt_llm_scraper_2026_09_01.csv
- S12: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/task_post/
- S13: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/task_get/advanced/
- S14: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/live/advanced/
- S15: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/locations/ (example only, no CSV link)
- S16: https://docs.dataforseo.com/v3/serp/google/ai_mode/overview/
- S17: https://docs.dataforseo.com/v3/serp/google/ai_mode/task_post/
- S17b: https://docs.dataforseo.com/v3/serp/google/ai_mode/languages/
- S18: https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/
- S19: https://docs.dataforseo.com/v3/serp/google/organic/task_post/
- S20: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
- S21: https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live/
- S21b: https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/locations_and_languages/
- S21c: https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/overview/
- S22: https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/target_metrics/live/
- S23: https://docs.dataforseo.com/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live/
- S23b: https://docs.dataforseo.com/v3/ai_optimization/ai_keyword_data/locations_and_languages/
- S24: https://dataforseo.com/pricing/ai-optimization/llm-scraper
- S25: https://dataforseo.com/pricing/ai-optimization/llm-responses
- S26: https://dataforseo.com/pricing/google-serp/google-ai-mode-serp-api
- S27: https://dataforseo.com/pricing/google-serp/google-organic-serp-api
- S28: https://dataforseo.com/pricing/ai-optimization/llm-mentions
- S28b: https://dataforseo.com/wp-content/plugins/dataforseo-pricing/assets/js/calculator.js (llmCalculator state)
- S29: https://dataforseo.com/pricing/ai-optimization/ai-keyword-search-volume
- S30: https://dataforseo.com/help-center/what-is-llm-scraper-api-and-what-data-does-it-provide (updated 27.02.2026)
- S31: https://dataforseo.com/blog/llm-scraper-vs-llm-responses-how-to-choose-the-right-ai-data-solution (23.03.2026)
- S31b: https://dataforseo.com/apis/ai-optimization-api
- S32: https://dataforseo.com/help-center/how-the-price-for-using-llm-responses-endpoints-is-calculated (updated 07.08.2025)
- S33: https://dataforseo.com/help-center/how-to-track-llm-responses-with-dataforseo-apis (updated 07.08.2025)
- S34: https://dataforseo.com/help-center/how-to-scrape-google-ai-overviews-with-serp-api (updated 28.11.2025)
- S35: https://dataforseo.com/help-center/what-is-ai-search-volume-in-dataforseo (updated 05.09.2025)
- S36: https://dataforseo.com/help-center/how-to-access-search-queries-data-from-chatgpt (updated 10.11.2025)
- S36b: https://dataforseo.com/help-center/how-the-ai-search-volume-metric-works-in-llm-mentions (updated 08.07.2026)
- S37: LLM Mentions endpoint pages: https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/{target_metrics_lite, multi_target_metrics, top_mentioned_domains, top_mentioned_domains_lite, top_mentioned_pages, top_mentioned_brands, historical, timeseries_delta, timeseries_new_lost}/live/
- S37b: https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/models/
- S37c: https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_responses/models/
- S37d: https://docs.dataforseo.com/v3/ai_optimization/claude/llm_responses/models/
- S37e: https://docs.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/models/
- S37f: https://dataforseo.com/help-center/how-to-get-llm-citation-data-with-llm-mentions-api (updated 08.07.2026)
- S38: https://dataforseo.com/apis/ai-optimization-api/llm-mentions-api
- S39: https://dataforseo.com/help-center/how-often-is-dataforseo-api-data-updated
- S40: https://dataforseo.com/update/fan-out-queries-and-brand-entities (2025-12-15) and https://dataforseo.com/update/scale-up-with-the-standard-method-in-gemini-llm-responses-api (2025-11-19)
- S41: https://dataforseo.com/update/extended-llm-mentions-api-release (2026-07-07)
- S42: https://dataforseo.com/update/gemini-llm-responses-api-direct-urls (2026-09-17)
- S43: https://dataforseo.com/update/introducing-llm-mentions-api (2025-11-11)
- S44: https://dataforseo.com/update/gemini-llm-scraper-in-ai-optimization-api (2026-02-26)
- S45: https://dataforseo.com/update/chatgpt-llm-scraper-api (2025-08-19)
- S46: https://dataforseo.com/update/fan-out-queries-in-llm-scraper-endpoint (2025-10-29)
- S47: https://dataforseo.com/update/brand-entity-extraction-in-chatgpt-llm-scraper-api (2025-12-04)
- S48: https://dataforseo.com/update/more-product-details-in-chatgpt-llm-scraper-api (2026-03-12)
- S49: https://dataforseo.com/update/ad-results-support-in-llm-scraper-api (2026-05-28)
- S50: https://dataforseo.com/update/chatgpt-ads-rendered-status-now-available (2026-08-13)
- S51: https://dataforseo.com/update/track-ai-mode-with-google-serp-api (2025-07-01)
- S52: https://dataforseo.com/update/shopping-results-in-google-ai-mode-and-ai-overview (2025-10-17)
- S53: https://dataforseo.com/update/ads-in-ai-mode-serp-api (2026-07-30)
- S54: https://dataforseo.com/update/important-serp-api-remains-fully-operational-pricing-update (2025-09-16)
- S55: https://dataforseo.com/update/copilot-search-comes-to-bing-serp-api (2025-05-01)
- S56: https://dataforseo.com/wp-json/wp/v2/update (update feed listing, filtered from 2025-01-01) and https://dataforseo.com/updates
- S57: https://dataforseo.com/update/more-detailed-source-annotations-in-llm-responses-api (2026-07-28)
- S58: https://dataforseo.com/update/introducing-ai-optimization-api (2025-08-06)
- S59: https://dataforseo.com/update/first-last-response-timestamps-in-llm-mentions-api (2025-12-10)
- S60: https://dataforseo.com/update/upgraded-aio-collection-for-databases-and-labs-api (2025-12-11)
- S61: https://dataforseo.com/update/reasoning-support-in-llm-responses-chatgpt-claude-and-gemini (2026-03-17)

Not loaded or not available:
- No live API calls were made, because there were no credentials. Current model lists, exact location counts for AI Keyword Data, LLM Mentions and the Gemini scraper, and real-world per-call LLM costs therefore remain UNVERIFIED.
- The Gemini scraper locations and languages pages have no CSV download, so only example rows were visible [S15].
