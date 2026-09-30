# 04. Official LLM APIs with web-search grounding (benchmark and validation sources)

Research date: 2026-09-29. All URLs below were accessed on 2026-09-29 unless noted.
Role in the product: OPTIONAL benchmark and validation sources. The main tracker uses DataForSEO consumer-surface data.

Legend:
- **VERIFIED**: read directly on the cited primary page (docs, pricing page, terms) on the access date.
- **UNVERIFIED**: not confirmed on a primary page (secondary source, or page could not be loaded).
- **INFERRED**: my reasoning or estimate from verified facts. Treat as an assumption to test.

Method note: several docs sites now serve Markdown (`.md` suffix) or plain HTML. I pulled raw pages with curl and read them directly, because a summarizing fetch tool returned invented model names on the first pass (for example it listed `gpt-5.5` as the OpenAI flagship, which is wrong as of today). Every number in this file was re-read from the raw page text.

---

## 0. Executive summary

| Provider | Current flagship (API) | Cheapest search-capable model used below | Search fee | Queries (fan-out) exposed? | Location param | Est. cost per 1,000 grounded prompts (cheap / flagship)* |
|---|---|---|---|---|---|---|
| OpenAI | `gpt-6-astra` | `gpt-6-luna` | $10 per 1k `web_search` calls + search content tokens at model input rate | Yes: `web_search_call.action.queries` ("usually, but not always") | `user_location` (country, city, region, timezone) | ~$10.43 to $11.23 / ~$53 to $133 |
| Google Gemini | `gemini-3.8-flash` (most intelligent GA Flash); `gemini-3.1-pro-preview` is the Pro tier (Preview) | `gemini-3.1-flash-lite` | Gemini 3.x: $14 per 1k search queries after 5,000 free per month. Gemini 2.5: $35 per 1k grounded prompts after 1,500 RPD free | Yes: `groundingMetadata.webSearchQueries` (generateContent) or `google_search_call.arguments.queries` (Interactions API) | No country param for Search. `toolConfig.retrievalConfig.latLng` and `languageCode` exist (documented for user location; effect on Search grounding UNVERIFIED) | ~$15.28 / ~$17.23 (3.8 Flash, 2026 promo) or ~$24.20 (3.1 Pro Preview) |
| Anthropic | `claude-fable-5-1` (top); `claude-opus-5-5` is the recommended default | `claude-haiku-4-5` | $10 per 1,000 searches + result tokens as input | Yes: `server_tool_use.input.query` | `user_location` (city, region, country, timezone) | ~$14.30 to $20.30 / ~$51.20 (Opus 5.5) or ~$113 (Fable 5.1) |
| Perplexity | Agent API with any listed model; Sonar Chat Completions support ENDED 2026-09-27 | Agent API `perplexity/sonar` (or legacy `sonar`) | Agent `web_search` $2.50 per 1k ($1.00 fast). Legacy Sonar request fee $5 to $14 per 1k requests by context size | Yes: `output[].type=="search_results"`.`queries` (Agent API) | `user_location` (country, region, city, latitude, longitude). Search API: `country` | ~$4.58 (Agent, sonar) or ~$6.10 (legacy sonar, low) / ~$18.90 to $26.90 (legacy sonar-pro) or ~$23.70 (Agent, gpt-5.6-sol) |
| xAI | `grok-4.7` | `grok-4.3` (or `grok-4.20-0309-non-reasoning`, same price) | `web_search` $5 per 1k calls; `x_search` $5 per 1k posts, $10 per 1k profiles | Partially: tool call arguments via xAI SDK `tool_call.function.arguments`; Responses API `web_search_call` items (query field not documented on the pages read) | None documented for `web_search` | ~$7.38 to $13.62 / ~$10.40 to $20.40 |

*Worked assumptions in section 7: 1,000 prompts, 300 input tokens, 800 output tokens, ONE search per prompt, standard (non-batch) tier, no reasoning-token overhead. Ranges show "without" and "with" an assumed search-content token load. Real agentic runs often issue 2 to 5 searches; see the sensitivity table.

Headline risks for a visibility tracker:
1. **Google ToS**: Grounding with Google Search results may not be "cached", "analyzed", or collected "by automated or programmatic means"; Search Suggestions must be displayed with the grounded result. Using Gemini grounding as a bulk measurement source appears to conflict with these terms (VERIFIED text, legal reading INFERRED; get counsel).
2. **Perplexity Sonar is legacy**: support ended 2026-09-27; sync requests are being reformulated as Agent API requests. Build against the Agent API.
3. **None of the APIs is the consumer app.** Perplexity says the API uses the same search system "with differences in configuration". OpenAI says ChatGPT Deep Research adds clarification and prompt-rewriting steps the API lacks. Other providers make no equivalence claim.

---

## 1. OpenAI

### 1.1 Models (as listed today)

| Role | Model ID | Input / cached / output per 1M | Status | Source |
|---|---|---|---|---|
| Flagship | `gpt-6-astra` | $10.00 / $1.00 / $50.00 (short context); $20 / $2 / $75 long context (>272K input) | VERIFIED | https://developers.openai.com/api/docs/pricing.md ; https://developers.openai.com/api/docs/models/gpt-6-astra.md |
| Mid | `gpt-6-sol` | $2.00 / $0.20 / $10.00 | VERIFIED | same |
| Cheapest GPT-6 | `gpt-6-luna` | $0.10 / $0.01 / $0.50 | VERIFIED | same; model page lists `web_search` as a supported tool |
| Models page "recommended" trio | `gpt-6-astra`, `gpt-5.6-terra` ($2 / $0.20 / $12), `gpt-5.6-luna` ($0.20 / $0.02 / $1.20) | | VERIFIED | https://developers.openai.com/api/docs/models.md |
| Closest to ChatGPT | `chat-latest` ("Latest Instant model used in ChatGPT") | $5.00 / $0.50 / $30.00; lists `web_search` | VERIFIED | https://developers.openai.com/api/docs/models/chat-latest.md |
| Chat Completions search model | `gpt-5-search-api` | $1.25 / $0.125 / $10.00; 200k context | VERIFIED | pricing page "Specialized models" and web search guide |
| Legacy search-preview | `gpt-4o-search-preview`, `gpt-4o-mini-search-preview` | deprecated, shut down 2026-07-23 | VERIFIED | https://developers.openai.com/api/docs/guides/tools-web-search.md |
| Deep research | `o3-deep-research` ($10 / $2.50 / $40), `o4-mini-deep-research` ($2 / $0.50 / $8) | snapshots dated 2025-06-26 | VERIFIED | https://developers.openai.com/api/docs/models/o3-deep-research.md ; .../o4-mini-deep-research.md |

Note: the web search guide now recommends `gpt-5.5` with `high` or `xhigh` reasoning for deep-research-style runs, while the deep research guide still documents `o3-deep-research` and `o4-mini-deep-research`. Both VERIFIED; the docs are mid-transition.

### 1.2 Tool and parameters (Responses API)

- Tool: `{"type": "web_search"}`. Legacy `{"type": "web_search_preview"}` still accepted but lacks `filters`, `external_web_access`, `return_token_budget`. VERIFIED (web search guide).
- `search_context_size`: `low` | `medium` | `high`. "does not set an exact token count or guarantee a specific number of sources or citations." VERIFIED.
- `return_token_budget`: `default` | `unlimited` (GPT-5+ reasoning web search only). VERIFIED.
- `filters.allowed_domains` / `filters.blocked_domains`: up to 100 each, bare domains, include subdomains. VERIFIED.
- `user_location`: `{"type": "approximate", "country": "US", "city": "...", "region": "...", "timezone": "America/Chicago"}`. Country is ISO 2-letter; city and region free text. "user location is not supported for deep research models using web search." VERIFIED.
- `external_web_access`: `false` = cache-only mode; default `true`. VERIFIED.
- `search_content_types`: `text`, `image`; `image_settings.max_results`, `image_settings.caption`. VERIFIED.
- `tool_choice: "required"` forces a search; with `auto` search is optional. VERIFIED.
- `include: ["web_search_call.action.sources"]` returns the full source list; `include: ["web_search_call.results"]` returns raw results (images). VERIFIED.

### 1.3 Response fields

| Need | Field | Status |
|---|---|---|
| Generated search queries (fan-out) | `output[].type == "web_search_call"` then `action.type == "search"` with `action.queries` (docs: "usually (but not always)"; example JSON shows singular `action.query`) | VERIFIED (both spellings appear on the page; parse both) |
| Other agent actions | `action.type` in `open_page`, `find_in_page` (reasoning models) | VERIFIED |
| All consulted sources | `web_search_call.action.sources` (needs `include`); third-party feeds labeled `oai-sports`, `oai-weather`, `oai-finance` | VERIFIED |
| Inline citations | `message.content[0].annotations[]` with `type: "url_citation"`, `url`, `title`, `start_index`, `end_index` | VERIFIED |

"The number of sources is often greater than the number of citations." VERIFIED. This matters for a tracker: log both "cited" and "consulted".

### 1.4 Pricing (tools)

| Item | Price | Status |
|---|---|---|
| Web search (all models) | $10.00 per 1k calls + search content tokens billed at model rates | VERIFIED https://developers.openai.com/api/docs/pricing.md |
| Web search preview, reasoning models | $10.00 per 1k calls + content tokens at model rates | VERIFIED |
| Web search preview, non-reasoning models | $25.00 per 1k calls; content tokens free | VERIFIED |
| gpt-4o-mini and gpt-4.1-mini with non-preview tool | content billed as fixed 8,000 input tokens per call | VERIFIED |
| Only `search` actions incur the call fee (not `open_page` / `find_in_page`) | "Search actions incur a tool call cost" | VERIFIED wording; exclusion of other actions INFERRED |
| Whether `gpt-5-search-api` also pays the $10 per 1k call fee | not stated explicitly | UNVERIFIED |

### 1.5 Rate limits (per model, tiered)

Web search "uses the underlying model's tiered rate limits". VERIFIED.

| Model | Tier 1 RPM / TPM | Tier 5 RPM / TPM | Source |
|---|---|---|---|
| `gpt-6-luna` | 500 / 500,000 | 30,000 / 180,000,000 | model page, VERIFIED |
| `gpt-6-astra`, `gpt-6-sol` | 500 / 500,000 | 15,000 / 40,000,000 | model pages, VERIFIED |
| `chat-latest` | 500 / 30,000 | 15,000 / 40,000,000 | model page, VERIFIED |
| `o4-mini-deep-research` | 1,000 / 200,000 | 30,000 / 150,000,000 | model page, VERIFIED |

### 1.6 Data retention and display rules

- "When displaying web results or information contained in web results to end users, inline citations must be made clearly visible and clickable in your user interface." VERIFIED (web search guide).
- `/v1/responses` and `/v1/chat/completions`: not used for training; abuse monitoring retention 30 days; ZDR eligible with limitations. VERIFIED https://developers.openai.com/api/docs/guides/your-data.md
- Web search with live access is not HIPAA eligible; `external_web_access: false` can be BAA-covered in ZDR orgs. VERIFIED.
- Deep research background mode retains data about 10 minutes, so it is incompatible with ZDR. VERIFIED (deep research guide).

### 1.7 Representativeness vs ChatGPT

- `chat-latest` is described as "Latest Instant model used in ChatGPT" and supports `web_search`. VERIFIED. This is the closest API proxy to default ChatGPT answers.
- ChatGPT Deep Research runs a clarification step and a prompt-rewriting step with an intermediate model; "Deep research via the Responses API does not include a clarification or prompt rewriting step." VERIFIED (https://developers.openai.com/api/docs/guides/deep-research.md).
- The ChatGPT search help article (https://help.openai.com/en/articles/9237897-chatgpt-search) returned HTTP 403 and could not be read. UNVERIFIED what it currently says about search partners or API parity.
- Developer forum threads report API web search results that differ from ChatGPT UI (for example https://community.openai.com/t/web-search-in-api-underperforming-compared-to-chatgpts/1304647). UNVERIFIED as provider statements; anecdotal.
- INFERRED assessment: API output is a model-plus-tool approximation. ChatGPT adds its own system prompt, memory, personalization, model router, UI rendering (shopping cards, maps), and possibly different search backends or ranking. `chat-latest` + `web_search` + `user_location` is a reasonable "same family" benchmark, not a replica.

---

## 2. Google Gemini API

### 2.1 Models (as listed today)

| Role | Model ID | Paid input / output per 1M | Grounding with Google Search (paid) | Status | Source |
|---|---|---|---|---|---|
| Top GA model ("Our most intelligent Flash model") | `gemini-3.8-flash` | $0.75 / $3.75 through 2026-12-31; $1.50 / $7.50 from 2027-01-01 | 5,000 free search requests per month (shared across Gemini 3.x), then $14 per 1,000 requests. Free tier: Not available | VERIFIED | https://ai.google.dev/gemini-api/docs/pricing (updated 2026-09-24) |
| Pro tier | `gemini-3.1-pro-preview` | $2.00 / $12.00 (prompts up to 200k) | same $14 per 1k | VERIFIED (Preview) | same |
| Cheapest 3.x with grounding | `gemini-3.1-flash-lite` | $0.25 / $1.50 | same $14 per 1k | VERIFIED | same |
| Other 3.x | `gemini-3.5-flash-lite` $0.30 / $2.50; `gemini-3.5-flash` $1.50 / $9.00; `gemini-3.7-flash`, `gemini-3.6-flash` $0.75 / $3.75 (2026) | | same | VERIFIED | same |
| Legacy 2.5 | `gemini-2.5-flash-lite` $0.10 / $0.40; `gemini-2.5-flash` $0.30 / $2.50; `gemini-2.5-pro` $1.25 / $10 | 1,500 RPD free (Flash and Flash-Lite shared), then $35 per 1,000 grounded prompts | VERIFIED | same |

2.5 access caveat: "we are limiting access to the 2.5 models to users who have actively used them in the past ... For any new projects, use our latest models: 3.5 Flash-Lite or 3.8 Flash." VERIFIED https://ai.google.dev/gemini-api/docs/models (updated 2026-09-24).

Output price includes thinking tokens. VERIFIED.

### 2.2 Billing unit for grounding

- Gemini 3: "your project is billed for each search query that the model decides to execute. If the model decides to execute multiple search queries to answer a single prompt ... this counts as two billable uses". Empty queries are ignored. Gemini 2.5 and older: billed per prompt. VERIFIED https://ai.google.dev/gemini-api/docs/google-search (updated 2026-09-23).
- Pricing page footnote: "A customer-submitted request to Gemini may result in one or more queries to Google Search. You will be charged for each individual search query performed." VERIFIED.
- Retrieved search content is not billed as input tokens: the pricing page describes "Search Grounding (retrieved tokens excluded) versus Url_context / File Search (retrieved tokens included)". VERIFIED (stated in the Deep Research agent row; applying it to all grounding calls is INFERRED but consistent).
- URL context tool: free as a tool, content charged as input tokens. VERIFIED.

### 2.3 Tool names and request parameters

- Current docs lead with the **Interactions API**: `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `"tools": [{"type": "google_search"}]`. VERIFIED.
- `generateContent` is still documented in the API reference; the tool is `googleSearch` (REST) / `google_search` (SDK). `GoogleSearch` fields: `timeRangeFilter` (`startTime`, `endTime`), `searchTypes` (web search default, image search optional). Older models used `google_search_retrieval` with `dynamicRetrievalConfig`. VERIFIED https://ai.google.dev/api/generate-content
- Location: `toolConfig.retrievalConfig.latLng` ("The location of the user") and `languageCode` (BCP47). VERIFIED https://ai.google.dev/api/caching. Whether latLng changes Google Search grounding results (versus Maps grounding) is UNVERIFIED. There is no `country` or `user_location` field on the Search tool itself. VERIFIED by absence in the reference.
- URL context: `{"type": "url_context"}`; up to 20 URLs per request; 34MB max per URL; index cache first, then live fetch; `url_context_result` step with per-URL status (for example `"unsafe"`). VERIFIED https://ai.google.dev/gemini-api/docs/url-context
- Vertex (now "Gemini Enterprise Agent Platform"): Grounding with Google Search has "a limit of one million queries per day". VERIFIED https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search (updated 2026-09-28).

### 2.4 Response fields

generateContent (`candidates[].groundingMetadata`), VERIFIED from https://ai.google.dev/api/generate-content:

| Field | Meaning |
|---|---|
| `webSearchQueries[]` | the search queries run (fan-out). Directly exposed. |
| `imageSearchQueries[]` | image search queries |
| `groundingChunks[]` | union of `web {uri, title}`, `image {sourceUri, imageUri, ...}`, `retrievedContext`, `maps` |
| `groundingSupports[]` | `groundingChunkIndices[]`, `confidenceScores[]`, `renderedParts[]`, `segment {partIndex, startIndex, endIndex, text}` (byte offsets) |
| `searchEntryPoint` | `renderedContent` (HTML/CSS chip), `sdkBlob` |
| `retrievalMetadata.googleSearchDynamicRetrievalScore` | legacy dynamic retrieval score |

Interactions API, VERIFIED from https://ai.google.dev/gemini-api/docs/google-search:

| Step type | Fields |
|---|---|
| `google_search_call` | `arguments.queries[]` |
| `google_search_result` | `result[].search_suggestions` (HTML snippet) |
| `model_output` | `content[].text` with `annotations[]` of `type: "url_citation"`, `url`, `title`, `start_index`, `end_index` |

UNVERIFIED but widely observed: `groundingChunks[].web.uri` values are often `vertexaisearch.cloud.google.com/grounding-api-redirect/...` redirect URLs, not the publisher URL, with `title` holding the domain. The doc example shows direct URLs. Test before relying on domain extraction.

### 2.5 Display requirements and ToS (critical for a tracker)

From Gemini API Additional Terms, section "Grounding with Google Search", VERIFIED https://ai.google.dev/gemini-api/terms (updated 2026-04-28):
- "You will only use Grounding with Google Search in an application that is owned and operated by you and will only display the Grounded Results with the associated Search Suggestion(s) to the end user who submitted the prompt."
- Prohibits allowing anyone to "cache, frame, syndicate, resell, analyze, train on, or otherwise learn from Grounded Results or Search Suggestions".
- Examples of prohibited extraction include "using programmatic or automated means to collect Links".
- Storage allowed only in narrow cases (for example up to two years for display evaluation or end-user chat history).
- Google stores prompts, context, and output for 30 days for grounding, usable for debugging and testing.

From Vertex / Agent Platform docs, VERIFIED (URL above): "you must display the Search Suggestions in production"; show `renderedContent` "exactly as provided"; chip field "must be the same width as the grounded response"; tap goes directly to the Google SRP; no other results next to the chip; grounding support should be shown "both inline and in aggregate".

INFERRED: a visibility tracker that runs prompts in bulk, stores the answers, and computes share-of-voice from cited links is on the wrong side of "analyze", "learn from", and "programmatic ... collect Links". Treat Gemini grounding as a manual spot-check tool unless Google or counsel confirms otherwise.

### 2.6 Rate limits

- Per project, not per key. RPD resets at midnight Pacific. Tiers: Free; Tier 1 (billing linked, $250 billing cap); Tier 2 ($100 paid + 3 days, $2,000 cap); Tier 3 ($1,000 paid + 30 days). Spend-based limits per rolling 10 minutes: Tier 1 $10, Tier 2 $50, Tier 3 $200. Per-model numbers are shown only in AI Studio. VERIFIED https://ai.google.dev/gemini-api/docs/rate-limits (updated 2026-09-02).
- INFERRED: the $10 per 10 minutes Tier 1 spend limit caps grounding at roughly 700 queries per 10 minutes at $14 per 1k, before token costs.

### 2.7 Representativeness vs the Gemini app (and AI Mode / AI Overviews)

- No Google statement found that API grounding equals the Gemini app. UNVERIFIED either way.
- INFERRED: the Gemini app adds personalization, app-specific system prompts, extensions, and its own UI. Google AI Overviews and AI Mode are separate Search products; DataForSEO's consumer-surface data is the right source for those. API grounding shows what a Gemini model does with Google Search for a given query, which is directionally useful but not the app.

---

## 3. Anthropic Claude

### 3.1 Models (as listed today)

| Role | Model ID | Input / output per 1M | Web search support | Source |
|---|---|---|---|---|
| Top | `claude-fable-5-1` | $10 / $50 | yes (all versions) | VERIFIED https://platform.claude.com/docs/en/models/overview.md ; https://platform.claude.com/docs/en/about-claude/pricing.md |
| Recommended default | `claude-opus-5-5` | $4 / $20 | yes | VERIFIED |
| Balanced | `claude-sonnet-5-5` | $2 / $10 | yes | VERIFIED |
| Cheapest current | `claude-haiku-4-5` (`claude-haiku-4-5-20251001`) | $1 / $5 | basic `web_search_20250305`; dynamic filtering needs Claude 4.6+ | Price VERIFIED; Haiku support of basic tool INFERRED (tool reference lists no model restriction; dynamic filtering restriction VERIFIED) |

Tokenizer note: Claude 4.7 and later "produces approximately 30% more tokens for the same text". VERIFIED (pricing page). Batch API is 50% off; web search in batches is priced the same per search but throttled per org. VERIFIED.

### 3.2 Tool and parameters (Messages API)

VERIFIED https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md
- Versions: `web_search_20250305` (basic), `web_search_20260209` (dynamic filtering via code execution), `web_search_20260318` (adds `response_inclusion`). Tool `name`: `web_search`. No beta header needed (tool reference). VERIFIED.
- Params: `max_uses`, `allowed_domains` or `blocked_domains` (not both), `user_location {type: "approximate", city, region, country (ISO alpha-2), timezone (IANA)}`, `allowed_callers` (`["direct"]` to disable dynamic filtering), `response_inclusion` (`full` | `excluded`).
- Availability: Claude API, Claude Platform on AWS, Microsoft Foundry; Google Cloud basic only; not on Amazon Bedrock.
- Web fetch: `web_fetch_20250910` (basic), `web_fetch_20260209`, `web_fetch_20260309` (adds `use_cache`), `web_fetch_20260318`; params `max_uses`, `max_content_tokens`, `citations: {enabled: true}` (off by default), domain lists. "No additional charges beyond standard token costs." VERIFIED https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool.md

### 3.3 Response fields

| Need | Field | Status |
|---|---|---|
| Generated query | `content[].type == "server_tool_use"`, `name: "web_search"`, `input.query` | VERIFIED |
| Results | `web_search_tool_result.content[]` of `web_search_result` with `url`, `title`, `page_age`, `encrypted_content` | VERIFIED |
| Citations | text blocks with `citations[]` of `type: "web_search_result_location"`: `url`, `title`, `encrypted_index`, `cited_text` (up to 150 chars) | VERIFIED |
| Search count | `usage.server_tool_use.web_search_requests` | VERIFIED |
| Dynamic filtering | nested `server_tool_use` / `web_search_tool_result` pairs carry a `caller` field | VERIFIED |
| Errors | returned inside a 200 response: `too_many_requests`, `invalid_tool_input`, `max_uses_exceeded`, `query_too_long`, `request_too_large`, `unavailable` | VERIFIED |

Citation fields `cited_text`, `title`, `url` do not count toward token usage. VERIFIED.

### 3.4 Pricing

- "$10 per 1,000 searches, plus standard token costs for search-generated content." Search results count as input tokens in the turn and in later turns. Each search is one use regardless of result count; errored searches are not billed. VERIFIED.
- Doc example: one search produced `input_tokens: 6039`. Used below as the search-content assumption (INFERRED as typical).

### 3.5 Rate limits

- Tiers Start / Build / Scale / Custom with monthly spend caps $500 / $1,000 / $200,000 / none. Start tier: Haiku 4.5, Sonnet 5.5, Opus 5.5 each 1,000 RPM, 2,000,000 ITPM, 400,000 OTPM; Fable 5.x 1,000 RPM, 500,000 ITPM, 100,000 OTPM. Cached reads do not count toward ITPM for most models. VERIFIED https://platform.claude.com/docs/en/api/rate-limits.md
- Web search has its own org-level rate limit shown in the Console. VERIFIED (numbers not public).

### 3.6 Data retention and display rules

- "When displaying API outputs directly to end users, citations must be included to the original source." VERIFIED.
- Basic `web_search_20250305` and `web_fetch_20250910` are ZDR-eligible; dynamic filtering versions are not unless `allowed_callers: ["direct"]`. VERIFIED https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools.md
- Prompts and outputs "not retained by default", except Covered Models (Fable 5.1, Mythos 5.1, Fable 5, Mythos 5) which require 30-day retention. VERIFIED https://platform.claude.com/docs/en/manage-claude/api-and-data-retention.md
- Admins can disable web search org-wide or restrict domains in the Console. VERIFIED.

### 3.7 Representativeness vs Claude.ai

- No Anthropic statement found equating API web search with Claude.ai search. UNVERIFIED.
- INFERRED: Claude.ai uses its own system prompt, may use different tool versions, and applies user settings (search toggle, memory, projects). The API with the same model and `user_location` is a fair model-level benchmark, not an app replica.

---

## 4. Perplexity

### 4.1 Status change (important)

"Sonar Chat Completions support ended on September 27, 2026. Synchronous and streaming requests keep working: they are being reformulated as Agent API requests, rolling out gradually by model. Asynchronous Sonar requests are not reformulated and are no longer supported." VERIFIED https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md

Suggested mapping: `sonar` to preset `fast`, `sonar-pro` to `fast`, `sonar-reasoning-pro` to `low`, `sonar-deep-research` to `high`. VERIFIED https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to.md

### 4.2 Pricing

Legacy Sonar (from the pricing page's embedded pricing data; the prose Sonar tables are no longer on the page), VERIFIED https://docs.perplexity.ai/docs/getting-started/pricing.md:

| Model | Input / output per 1M | Request fee per 1k requests (low / medium / high search context) | Extra |
|---|---|---|---|
| `sonar` | $1 / $1 | $5 / $8 / $12 | |
| `sonar-pro` | $3 / $15 | $6 / $10 / $14 | |
| `sonar-reasoning-pro` | $2 / $8 | $6 / $10 / $14 | |
| `sonar-deep-research` | $2 / $8 | none | citation tokens $2/1M, reasoning tokens $3/1M, $5 per 1k search queries |

Agent API, VERIFIED (same page):

| Item | Price |
|---|---|
| `web_search` standard (`search_type: "web"`) | $2.50 per 1,000 invocations |
| `web_search` fast (`search_type: "fast"`) | $1.00 per 1,000 invocations |
| `fetch_url` | $0.50 per 1,000 invocations |
| `people_search`, `finance_search` | $5 per 1,000 |
| Model tokens | provider list rates, for example `perplexity/sonar` $0.25 / $2.50; `openai/gpt-5.6-luna` $0.20 / $1.20; `openai/gpt-5.6-sol` $4 / $20; `anthropic/claude-opus-5-5` $4 / $20 |
| Search context tokens | "you are charged for the exact number of search context tokens consumed" (explicit budget mode) |

Presets (median runs, not billed values): `fast` and `low` and `medium` use `openai/gpt-5.6-luna`; `high` and `xhigh` use `openai/gpt-5.6-sol`. VERIFIED.

Search API (raw results, no LLM answer): $5.00 per 1k requests ($1.00 fast); up to 5 queries per request = one billing unit; no token charges. VERIFIED.

### 4.3 Parameters

Agent API `web_search` tool, VERIFIED https://docs.perplexity.ai/docs/agent-api/tools/web-search.md:
- `search_type` (`web` | `fast`), `search_context_size` (`low` 300 tokens, `medium` 1,000, `high` 4,000 as max_tokens and max_tokens_per_page), `max_results` (1 to 50), `max_tokens`, `max_tokens_per_page`.
- `filters`: `search_domain_filter` (up to 20; prefix `-` to exclude), `search_recency_filter` (hour, day, week, month, year), `search_after_date_filter`, `search_before_date_filter`, `last_updated_after_filter`, `last_updated_before_filter`.
- `user_location`: `country` (ISO alpha-2), `region`, `city`, `latitude`, `longitude` (lat/long require country). Sits beside `filters`.
- Legacy Sonar equivalents: `web_search_options.search_context_size`, `web_search_options.user_location`, `num_search_results`, `search_mode`, `return_related_questions`, `return_images`. VERIFIED (migration how-to).
- Search API: `query` (string or array up to 5), `max_results` (1 to 20, default 10), `country`, domain and language filters, `search_type`. VERIFIED https://docs.perplexity.ai/docs/search/quickstart.md

### 4.4 Response fields

| API | Sources | Queries (fan-out) | Citations | Status |
|---|---|---|---|---|
| Agent API | `output[]` item `type: "search_results"` with `results[]`: `id`, `url`, `title`, `snippet`, `date`, `last_updated`, `source` | `search_results.queries[]` | presets add inline `[1]` or `[web:1]` markers mapping to `results[].id`; model-chosen models need prompting | VERIFIED |
| Agent API usage | `usage.tool_calls_details.search_web.invocation`; `usage.cost.total_cost` | | | VERIFIED |
| Legacy Sonar | top-level `citations[]` (URL strings) and `search_results[]` (`title`, `url`, `date`, `last_updated`, `snippet`, `source`) | `usage.num_search_queries` (count only, deep research) | inline `[n]` | VERIFIED https://docs.perplexity.ai/docs/legacy/sonar/quickstart.md |
| Legacy Sonar usage | `usage.cost.request_cost`, `usage.search_context_size` | | | VERIFIED |

### 4.5 Rate limits

Tiers by cumulative purchases: Tier 0 $0, Tier 1 $50, Tier 2 $250, Tier 3 $500, Tier 4 $1,000, Tier 5 $5,000. Agent API org-wide QPS: 1 / 3 / 8 / 17 / 33 / 33. Search API: 50 query units per second for all tiers (each query in a multi-query request is one unit). 429s are not billed. VERIFIED https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md

### 4.6 Data retention

"We do not retain any query data sent through the API and do not train on any of your data." SafeSearch is on by default for the API. VERIFIED https://docs.perplexity.ai/docs/resources/faq.md

### 4.7 Representativeness vs the Perplexity app

Provider statements, VERIFIED (FAQ):
- "The API uses the same search system as the UI with differences in configuration" and, in the same sentence, their outputs "may differ". (Split quote; the page joins the two parts with a dash.)
- "The underlying AI model might differ between the API and the UI for a given query."
- "the API offers exactly the same internet data access as Perplexity's web platform."

INFERRED: Perplexity is the closest of the five to its consumer product at the retrieval layer, but the app's model choice (Pro Search, model picker, subscription tier) and configuration differ. After the Sonar shutdown, the "fast" preset runs `openai/gpt-5.6-luna`, which weakens the model-level match with the app's default answers.

---

## 5. xAI Grok

### 5.1 Models (as listed today)

| Role | Model ID | Input / cached / output per 1M (<200k prompt) | Source |
|---|---|---|---|
| Flagship ("the most capable model we've built") | `grok-4.7` | $2.00 / $0.50 / $6.00 | VERIFIED https://docs.x.ai/developers/models.md ; https://docs.x.ai/developers/pricing.md |
| Cheapest text | `grok-4.3`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning` | $1.25 / $0.20 / $2.50 | VERIFIED |
| Retired 2026-05-15 | `grok-4-1-fast-*`, `grok-4-fast-*`, `grok-4-0709`, `grok-3`, etc. redirect to `grok-4.3` | | VERIFIED https://docs.x.ai/developers/migration/may-15-retirement.md |

Batch: 20% off for grok-4.3 and grok-4.20 models; no batch discount listed for grok-4.7. Priority processing 2x. US regional endpoint 1.1x. VERIFIED.

### 5.2 Live Search status

- Legacy Live Search (`search_parameters` on Chat Completions) is replaced by server-side Agent Tools on the Responses API. Third-party reports show HTTP 410 "Live search is deprecated. Please switch to the Agent Tools API", with retirement around 2026-01-12 (https://github.com/langchain-ai/langchain/issues/33961 ; https://community.make.com/t/x-ai-node-integration-error-410-live-search-deprecated-switch-to-agent-tools-api/102097). UNVERIFIED on a primary xAI page: the old URL https://docs.x.ai/docs/guides/live-search now serves the Web Search tool page, and the current release notes do not state a date.

### 5.3 Tools and parameters

VERIFIED https://docs.x.ai/developers/tools/web-search.md and https://docs.x.ai/developers/tools/x-search.md
- `web_search`: `allowed_domains` (max 5) or `excluded_domains` (max 5), not both; in the Responses API these go under `filters`. Also `enable_image_understanding`, `enable_image_search`.
- `x_search`: `allowed_x_handles` / `excluded_x_handles` (max 20), `from_date`, `to_date` (ISO8601), `enable_image_understanding`, `enable_video_understanding`.
- Location: no `user_location` or country parameter documented for `web_search`. VERIFIED by absence.

### 5.4 Response fields

VERIFIED https://docs.x.ai/developers/tools/citations.md and https://docs.x.ai/developers/tools/streaming-and-sync.md
- `response.citations`: all URLs encountered, returned by default; includes sources not used in the final answer.
- Inline citations: `[[N]](url)` in text (default on in Responses API; opt-in `include=["inline_citations"]` in the xAI SDK). Structured: `output_text.annotations[]` with `type: "url_citation"`, `url`, `start_index`, `end_index`, `title` (the citation number label).
- Tool outputs: Responses API `include: ["web_search_call.action.sources"]`; xAI SDK `include: ["web_search_call_output"]`, `x_search_call_output`.
- Queries: xAI SDK streaming exposes `tool_call.function.name` and `tool_call.function.arguments` (VERIFIED from example code). A `query` field on Responses API `web_search_call` items is not shown on the pages read. UNVERIFIED; test.
- Usage: `server_side_tool_usage_details` with `web_search_calls`, `x_search_calls`, `x_posts_fetched`, `x_users_fetched`. VERIFIED.

### 5.5 Pricing (tools)

| Tool | Price | Status |
|---|---|---|
| `web_search` | $5 per 1k calls (image search included at same rate) | VERIFIED |
| `x_search` | $5 per 1k posts, $10 per 1k profiles (per item fetched, per-item pricing in effect as of 2026-09-21) | VERIFIED |
| Tokens | input, reasoning, completion, image, cached all billed at model rates | VERIFIED |
| Usage-guideline violation caught pre-generation | $0.05 per request | VERIFIED |

INFERRED: the agent decides how many calls to make, so budget for 2 to 5 `web_search` calls on reasoning models.

### 5.6 Rate limits

Tiers by cumulative spend since 2026-01-01: T0 $0, T1 $50, T2 $250, T3 $1,000, T4 $5,000. `grok-4.7`: 150 RPS / 50M TPM at T0 up to 500 RPS / 100M TPM at T4. `grok-4.3`: 37 RPS / 10M TPM at T0 up to 208 RPS / 85M TPM at T4. VERIFIED https://docs.x.ai/developers/rate-limits.md

### 5.7 Data retention

No developer-docs retention statement found on the pages read. The xAI enterprise FAQ (https://x.ai/legal/faq-enterprise) returned HTTP 403. UNVERIFIED.

### 5.8 Representativeness vs the Grok app

No xAI statement found. UNVERIFIED. INFERRED: the Grok app and X integration add their own system prompt, personalization, and a heavier X-post retrieval mix. The API with `web_search` + `x_search` on `grok-4.7` is the closest proxy; X Search per-post pricing makes heavy X retrieval costly at scale.

---

## 6. Cross-provider comparison tables

### 6.1 Fan-out and citation visibility

| Provider | Queries exposed | Cited sources | Consulted but uncited sources | Positional citation offsets |
|---|---|---|---|---|
| OpenAI | `web_search_call.action.queries` (not always present) | `url_citation` annotations | `action.sources` (via `include`) | `start_index`/`end_index` (characters) |
| Gemini | `webSearchQueries[]` / `google_search_call.arguments.queries` | `groundingChunks` + `groundingSupports` / `url_citation` | chunks not referenced by any support (INFERRED) | `segment.startIndex`/`endIndex` (bytes) or `start_index`/`end_index` |
| Anthropic | `server_tool_use.input.query` (every search) | `web_search_result_location` citations | all `web_search_result` items | via citation blocks attached to text blocks |
| Perplexity | `search_results.queries[]` (Agent API) | `[n]` markers mapped to `results[].id` (preset or prompt dependent) | `search_results.results[]` | none structured; parse markers (INFERRED) |
| xAI | tool call arguments (SDK); Responses API unclear | `url_citation` annotations | `response.citations` | `start_index`/`end_index` |

### 6.2 Location support

| Provider | Field | Granularity | Notes |
|---|---|---|---|
| OpenAI | `user_location` | country, region, city, timezone | not for deep research models |
| Gemini | `toolConfig.retrievalConfig.latLng`, `languageCode` | lat/long, language | effect on Search grounding UNVERIFIED |
| Anthropic | `user_location` | city, region, country, timezone | unsupported country codes rejected with 400 |
| Perplexity | `user_location`; Search API `country` | country, region, city, lat/long | lat/long need country |
| xAI | none | none | cannot localize web search via params |

### 6.3 Display and ToS constraints relevant to measurement use

| Provider | Constraint | Status |
|---|---|---|
| OpenAI | inline citations must be visible and clickable when shown to end users | VERIFIED |
| Gemini | show Search Suggestions with every grounded answer; no cache, analyze, learn from, or programmatic link collection | VERIFIED |
| Anthropic | citations must be included when showing outputs to end users | VERIFIED |
| Perplexity | none found beyond general terms | UNVERIFIED (terms page not reviewed) |
| xAI | none found in developer docs | UNVERIFIED |

---

## 7. Worked costs: 1,000 prompts x 300 input x 800 output tokens, one search each

Formula: `(300k x input_rate + 800k x output_rate) / 1M + search_fee + search_content_tokens x input_rate`.
Assumptions (INFERRED): one search call per prompt; search content load of 8,000 tokens per call for OpenAI (the only documented fixed block), about 6,000 for Anthropic (doc example), about 5,000 for xAI (no doc figure), 1,000 for Perplexity `medium`, 0 for Gemini (retrieved tokens excluded). Reasoning or thinking tokens are billed as output and are NOT included; for reasoning models they can double or triple output cost. Free quotas ignored except where noted.

| Provider / model | Tokens only | + search fee | + search content (assumed) | Notes |
|---|---|---|---|---|
| OpenAI `gpt-6-luna` (cheap) | $0.43 | $10.43 | $11.23 | fee dominates |
| OpenAI `gpt-5.6-luna` | $1.02 | $11.02 | $12.62 | |
| OpenAI `gpt-6-sol` | $8.60 | $18.60 | $34.60 | |
| OpenAI `chat-latest` (ChatGPT proxy) | $25.50 | $35.50 | $75.50 | |
| OpenAI `gpt-6-astra` (flagship) | $43.00 | $53.00 | $133.00 | content tokens at $10/1M hurt |
| OpenAI `gpt-5-search-api` (Chat Completions) | $8.38 | $18.38 if $10/1k applies | n/a | per-call fee applicability UNVERIFIED |
| Gemini `gemini-3.1-flash-lite` (cheap) | $1.28 | $15.28 | $15.28 | first 5,000 queries per month free |
| Gemini `gemini-3.8-flash` (2026 promo) | $3.23 | $17.23 | $17.23 | $20.45 from 2027-01-01 |
| Gemini `gemini-3.1-pro-preview` | $10.20 | $24.20 | $24.20 | Preview |
| Gemini `gemini-2.5-flash-lite` (legacy) | $0.35 | $35.35 | $35.35 | $0.35 if under 1,500 RPD free; access restricted to prior users |
| Anthropic `claude-haiku-4-5` (cheap) | $4.30 | $14.30 | $20.30 | |
| Anthropic `claude-sonnet-5-5` | $8.60 | $18.60 | $30.60 | |
| Anthropic `claude-opus-5-5` (default flagship) | $17.20 | $27.20 | $51.20 | |
| Anthropic `claude-fable-5-1` (top) | $43.00 | $53.00 | $113.00 | 30-day retention required |
| Perplexity Agent `perplexity/sonar`, web, medium | $2.08 | $4.58 | $4.83 | fast search: $3.08 to $3.15 |
| Perplexity Agent `openai/gpt-5.6-luna` (`fast` preset model) | $1.02 | $3.52 | $3.72 | |
| Perplexity Agent `openai/gpt-5.6-sol` (`high` preset model) | $17.20 | $19.70 | $23.70 | |
| Perplexity legacy `sonar` (low / high context) | $1.10 | $6.10 / $13.10 | n/a | fee is per request, not per search |
| Perplexity legacy `sonar-pro` (low / high) | $12.90 | $18.90 / $26.90 | n/a | |
| xAI `grok-4.3` (cheap) | $2.38 | $7.38 | $13.63 | |
| xAI `grok-4.7` (flagship) | $5.40 | $10.40 | $20.40 | reasoning tokens extra |

Sensitivity to fan-out (search fee only, per 1,000 prompts), INFERRED:

| Searches per prompt | OpenAI | Gemini 3.x | Anthropic | Perplexity Agent (web) | xAI | Legacy Sonar |
|---|---|---|---|---|---|---|
| 1 | $10 | $14 | $10 | $2.50 | $5 | $5 to $14 (flat per request) |
| 3 | $30 | $42 | $30 | $7.50 | $15 | unchanged |
| 5 | $50 | $70 | $50 | $12.50 | $25 | unchanged |

Monthly example (INFERRED): 200 prompts x 5 engines x daily = 30,000 grounded prompts per engine-month. At one search each: OpenAI cheap about $313 to $337, Gemini 3.1 Flash-Lite about $388 (after 5,000 free queries), Anthropic Haiku about $429 to $609, Perplexity Agent sonar about $137 to $145, xAI grok-4.3 about $221 to $409.

---

## 8. Honest assessment: do API outputs represent the consumer products?

| Consumer product | Closest API configuration | Provider statement | Verdict (INFERRED) |
|---|---|---|---|
| ChatGPT | Responses API, `chat-latest`, `web_search`, `user_location` | `chat-latest` is "Latest Instant model used in ChatGPT" (VERIFIED); ChatGPT Deep Research adds clarification and rewriting steps not in the API (VERIFIED) | Same model family, different orchestration. Useful for query fan-out patterns and source-domain tendencies; not a reliable proxy for exact mentions or rank. |
| Gemini app | Gemini API `google_search` on `gemini-3.8-flash` | none found | Model-level signal only. ToS limits analysis use. AI Overviews and AI Mode need DataForSEO. |
| Perplexity app | Agent API `web_search` (or reformulated Sonar) | "same search system as the UI with differences in configuration"; "underlying AI model might differ" (VERIFIED) | Closest at retrieval level; answer model may differ, more so after the Sonar shutdown. |
| Claude.ai | Messages API `web_search_20260318` on `claude-opus-5-5` | none found | Model-level signal; app prompt and settings differ. |
| Grok app | Responses API `web_search` + `x_search` on `grok-4.7` | none found | Model-level signal; X-heavy app retrieval hard to match; no location control. |

Cross-cutting reasons APIs diverge from apps (INFERRED): app system prompts; personalization and memory; logged-in location from IP rather than a declared approximate location; model routers choosing different models per query; UI-only modules (shopping, local, maps cards); A/B tests; and nondeterminism (Perplexity notes temperature 0 does not guarantee identical output, VERIFIED in migration how-to).

Recommendation for the tracker (INFERRED):
1. Keep DataForSEO consumer-surface data as the primary truth.
2. Use APIs for (a) query fan-out analysis, where they are uniquely transparent (Gemini `webSearchQueries`, Anthropic `input.query`, Perplexity `queries`, OpenAI `action.queries`), (b) cheap trend sampling, (c) validating that consumer-surface citations are plausible.
3. Log `cited` vs `consulted` sources separately; they differ by design on OpenAI, xAI, and Perplexity.
4. Always send location where supported and record model ID and tool version per run, because aliases (`chat-latest`, `grok-4.7`) move.
5. Exclude Gemini grounding from automated storage and analysis until the ToS question is cleared with counsel.

---

## 9. Source index (all accessed 2026-09-29)

OpenAI
- https://developers.openai.com/api/docs/guides/tools-web-search.md (redirect target of platform.openai.com/docs/guides/tools-web-search)
- https://developers.openai.com/api/docs/pricing.md
- https://developers.openai.com/api/docs/models.md and model pages under /api/docs/models/
- https://developers.openai.com/api/docs/guides/deep-research.md
- https://developers.openai.com/api/docs/guides/your-data.md
- https://help.openai.com/en/articles/9237897-chatgpt-search (HTTP 403, not read)

Google
- https://ai.google.dev/gemini-api/docs/google-search (updated 2026-09-23)
- https://ai.google.dev/gemini-api/docs/pricing (updated 2026-09-24)
- https://ai.google.dev/gemini-api/docs/models (updated 2026-09-24)
- https://ai.google.dev/gemini-api/docs/url-context (updated 2026-09-23)
- https://ai.google.dev/gemini-api/docs/rate-limits (updated 2026-09-02)
- https://ai.google.dev/gemini-api/terms (updated 2026-04-28)
- https://ai.google.dev/api/generate-content ; https://ai.google.dev/api/caching
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search (updated 2026-09-28; old cloud.google.com Search Suggestions URL redirects here)

Anthropic
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool.md
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools.md
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference.md
- https://platform.claude.com/docs/en/about-claude/pricing.md
- https://platform.claude.com/docs/en/models/overview.md
- https://platform.claude.com/docs/en/api/rate-limits.md
- https://platform.claude.com/docs/en/manage-claude/api-and-data-retention.md

Perplexity
- https://docs.perplexity.ai/llms.txt
- https://docs.perplexity.ai/docs/getting-started/pricing.md
- https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md
- https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to.md
- https://docs.perplexity.ai/docs/agent-api/tools/web-search.md
- https://docs.perplexity.ai/docs/legacy/sonar/quickstart.md
- https://docs.perplexity.ai/docs/search/quickstart.md
- https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md
- https://docs.perplexity.ai/docs/resources/faq.md

xAI
- https://docs.x.ai/llms.txt
- https://docs.x.ai/developers/tools/web-search.md
- https://docs.x.ai/developers/tools/x-search.md
- https://docs.x.ai/developers/tools/citations.md
- https://docs.x.ai/developers/tools/streaming-and-sync.md
- https://docs.x.ai/developers/pricing.md
- https://docs.x.ai/developers/models.md
- https://docs.x.ai/developers/rate-limits.md
- https://docs.x.ai/developers/migration/may-15-retirement.md
- https://docs.x.ai/developers/release-notes.md
- https://docs.x.ai/docs/guides/live-search (now serves the Web Search page)
- Secondary: https://github.com/langchain-ai/langchain/issues/33961 ; https://community.make.com/t/x-ai-node-integration-error-410-live-search-deprecated-switch-to-agent-tools-api/102097
- https://x.ai/legal/faq-enterprise (HTTP 403, not read)
