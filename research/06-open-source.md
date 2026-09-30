# 06: Open-source AI visibility (GEO/AEO) trackers and SEO rank trackers

Research date: 2026-09-29. Purpose: learn architecture, data models, extraction methods and pitfalls from open-source projects, without forking them.

## Method and legend

- Repo metadata (stars, license SPDX, created, last push, language) came from the GitHub REST API (`gh api repos/<owner>/<repo>`) on 2026-09-29. "Last commit" is the latest commit on the default branch; "last push" can be later if other branches moved.
- Source files were read through the GitHub contents API (the same bytes as `raw.githubusercontent.com`). File links below use `https://github.com/<owner>/<repo>/blob/HEAD/<path>`.
- Snippets are kept under 15 words. Everything else is paraphrase.
- **VERIFIED**: I read it in the named file or API response (URL given).
- **INFERRED**: my reading of code or docs that I did not execute or fully trace.
- **UNVERIFIED**: claimed by a README or website, not checked in code.
- No code was cloned, installed or run.

## Identity and "not found" notes

| Name in brief | What I found | Status |
|---|---|---|
| Ansvisor | https://github.com/ansvisor/ansvisor | Found |
| Lettertrace | https://github.com/letterstory/lettertrace | Found |
| OneGlanse | https://github.com/aryamantodkar/oneglanse | Found |
| OpenCited | https://github.com/opencited/opencited | Found (1 star, no LICENSE file) |
| Habibi (AI visibility) | https://github.com/moaljumaa/habibi | Found (source-available custom license) |
| Cloro GEO Tracker | https://github.com/cloro-dev/geo-tracker (MIT). A `cloro-dev/monitor` repo appears in search results but returns HTTP 404 via the API (private or deleted). | Found |
| AEO Radar | https://github.com/hellowalt/aeo-radar (other repos share the name: `waseemnasir2k26/aeo-radar` is a GPL-2.0 WordPress plugin, `riz1k9/aeo-radar` is a 0-star Python project) | Found |
| Aperture (AI visibility) | https://github.com/anyin-ai/aperture. Not to be confused with Tailscale Aperture (an LLM gateway, unrelated). | Found |
| TraceAIO | https://github.com/jakubsuchy/traceaio (linked from https://traceaio.org/). GitHub name search for "traceaio" hit the search rate limit; the link was found via the website. | Found |
| "AEO Tracker" | Most likely https://github.com/danishashko/geo-aeo-tracker (276 stars). Several small repos share the name (e.g. `paulacavero/aeo-tracker`). | Found |
| SerpBear | https://github.com/towfiqi/serpbear | Found |
| Serposcope | https://github.com/serphacker/serposcope (archived, legacy) | Found |
| SEO Panel | https://github.com/sendtogeo/Seo-Panel | Found |
| "OpenSEO?" | https://github.com/every-app/open-seo (MIT, 21.7k stars). Several unrelated small repos share the name. | Found |

Additional serious projects discovered and reviewed: Limelit Open (`limelit-co/open`), Elmo (`elmohq/elmo`) and its derivatives GetCito and SpotlightsAI, goose-aeo, NameDrop, and two AGPL projects (Climby AI SEO and `Open-Source-SEO-Tools/ai-visibility-tracker`).

---

# Part A: AI visibility (GEO/AEO) trackers

## A1. Ansvisor

- Repo: https://github.com/ansvisor/ansvisor
- License: **MIT** (VERIFIED, GitHub API)
- Stars 125; created 2026-05-05; last push 2026-09-29 (VERIFIED, API). Forks exist such as `sebbhm/ansvisor-dataforseo` (DataForSEO-patched).
- Stack: JavaScript Express-style server (`server/src`), TypeScript web app (`web/src`), Supabase Postgres with 49+ SQL migrations, workers in the server process. (VERIFIED, repo tree)

**Architecture.** A Postgres `jobs` table replaces Bull/Redis; the file header says it is a "Supabase-based job manager" and cancellation uses in-memory AbortControllers (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/server/src/lib/job-manager.js). Workers: `tracking-worker.js`, `content-worker.js`. Nightly tracking is triggered through internal endpoints guarded by a bearer `CRON_SECRET` in cloud mode; `TRACKING_CONCURRENCY` (default 2 brands) bounds parallelism (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/server/.env.example).

**Provider strategy (VERIFIED, .env.example and lib files).**
- Official APIs for "API platforms": OpenAI Responses API with the `web_search` tool and `user_location` by region (https://github.com/ansvisor/ansvisor/blob/HEAD/server/src/lib/openai-tracker.js), plus an Anthropic tracker.
- Cloro (third-party scraping API) for UI surfaces: ChatGPT, AI Overviews, AI Mode, Copilot, Grok, ChatGPT Shopping. Results arrive by webhook with optional HMAC verification and 5 minute replay window (`cloro-webhook-verify.js`), or inline polling.
- OpenRouter is used only for analysis tasks. The env file states tracking cannot go through OpenRouter because provider-hosted web search is not relayed. This is a useful design fact.
- DataForSEO for keyword search volume; Scrape.do for site-audit fetching; Composio for GSC/GA4 OAuth.

**Data model (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/supabase/migrations/00001_initial_schema.sql).** `organizations`, `profiles`, `brands`, `brand_domains`, `brand_platforms` (platform, check_frequency, api_model), `competitors` (name, domain), `topics`, `prompt_sets`, `prompts` (text, category, platforms[], regions[], models[], topic_id), `prompt_results` (platform, response, citations jsonb, mention_count, citation_count, sentiment, visibility_score, model_used, region, competitor_mentions jsonb), `jobs`, `ai_traffic_logs`, `content_opportunities`, `prompt_volumes`, `webhook_configs`. Later migrations add mention position, fan-out query intents, shopping cards, daily pulse, many materialized aggregates, tracking runs, GSC stats and `api_keys`.

**Extraction (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/server/src/lib/response-parser.js).**
- Mentions: case-insensitive word-boundary regex over the answer after stripping markdown link URLs and bare URLs. Counts brand name plus each brand domain string.
- Citations: own-domain citations counted by hostname equality or subdomain suffix. A code comment notes an earlier substring check produced false positives.
- Position: rank of the brand's first occurrence among tracked entities (brand plus competitors), 1 = named first. NULL vs 0 used deliberately to mark "not computed" vs "computed, none".
- Sentiment: LLM-as-judge via `generateObject` with a zod schema (sentiment, confidence, reason), response truncated to 3,000 chars, degrades to neutral on failure, model configurable (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/server/src/lib/sentiment.js).

**Visibility score (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/server/src/config/visibility-score.js).**
`score = 100 × (0.60 × mention_rate + 0.25 × citation_rate + 0.15 × position_factor × shrink)`, where `shrink = mentionAnswers / (mentionAnswers + 20)`. The shrinkage stops a perfect position over a handful of answers from outranking brands with real volume. Returns null when there are no answers.

**Other features.** An "action center" with about 50 rule definitions grouped as close-gap, fix, grow, protect and recover (e.g. `c02-close-citation-gap.js`, `r02-recover-lost-citations.js`) (VERIFIED, tree). A GEO site audit with rubric JSON and signal modules (authority, content, EEAT, structure, trust). Estimated "AI volume" = Google volume × `AI_VOLUME_MULTIPLIER` (VERIFIED, `volume-analysis.js`).

**Security.** Org-level BYOK Anthropic key stored as AES-256-GCM ciphertext with a plaintext `last4` for display and `set_by` audit column (VERIFIED, https://github.com/ansvisor/ansvisor/blob/HEAD/supabase/migrations/00010_org_anthropic_keys.sql). API keys stored as SHA-256 hash plus prefix (VERIFIED, `00003_api_keys.sql`). A later migration enables RLS on exposed tables. Weak point: the Cloro webhook accepts unsigned deliveries when `CLORO_WEBHOOK_SECRET` is empty, which is the documented default (VERIFIED, .env.example comment).

**Borrow.** Shrinkage on the position term; own-domain citation by host/suffix; strip URLs before mention matching; sentiment only when mentioned; separating tracking providers (need web search) from analysis providers (any cheap model); action definitions as a rule registry.

**Weaknesses.** Score formula duplicated in server and web with "keep in sync" comments (VERIFIED). Domain strings counted as brand mentions (Lettertrace documents why this causes false positives). `AI_VOLUME_MULTIPLIER` is a single global constant, so "AI volume" is Google volume scaled by a guess (INFERRED). Heavy dependence on Cloro callback latency; env comments cite first results arriving up to 65 minutes after submission (VERIFIED).

## A2. Lettertrace

- Repo: https://github.com/letterstory/lettertrace
- License: **MIT** (VERIFIED, API)
- Stars 72; created 2026-07-21; last commit 2026-09-28 (VERIFIED)
- Stack: TypeScript, Next.js App Router on Vercel, Supabase Postgres (`supabase/schema.sql`), vitest, OAuth 2 server for MCP, Node CLI. (VERIFIED, tree)

**Provider strategy: BYOK official APIs with web search (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/lib/llm/index.ts).**
- OpenAI Responses API with `web_search_preview`, requesting `web_search_call.action.sources` because, per a code comment, the model searches but attaches no url_citation annotations about 30% of the time.
- Anthropic `web_search_20250305` server tool forced with `tool_choice`.
- Gemini `google_search` grounding; a comment warns JSON mode and search grounding must never be combined.
- Perplexity `sonar`. Optional "router keys" (OpenRouter-style gateways) and Brave Search keys.
- Keys encrypted with AES-256-GCM in a versioned `v1:iv:tag:ciphertext` envelope; a distinct `ConfigurationError` separates server misconfiguration from a bad user key (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/lib/crypto.ts).

**Data model (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/supabase/schema.sql).** `projects`, `project_members`, `competitors`, `topics`, `prompts` (topic_id, text, source, is_active), `runs` (provider, model, prompt_count, completed_count, status), `responses` (run_id, prompt_id, topic_id, provider, model, response_text), `mentions` (response_id, entity_type, competitor_id, entity_name, mentioned, mention_count, first_position float, sentiment, recommended), `sources` (response_id, url, domain, title, snippet, is_owned), `provider_keys`, `router_keys`, `search_keys`, `api_keys`, full OAuth tables, `web_mention_watch/runs/mentions`, `report_groups`, `activity_logs`, `ops_events`.

**Extraction (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/lib/mentions.ts).**
- Deterministic regex: one case-insensitive pattern per entity, terms sorted longest first, lookaround boundaries instead of `\b` so names with punctuation match.
- "Link surfaces" are blanked before matching (length-preserving, so offsets stay valid). A markdown link keeps its label unless the label itself looks like an address. So a linked brand name counts as a mention; a linked domain counts only as a citation.
- The domain label is deliberately **not** used as a mention term; the file explains it was a steady source of false positives.
- Sentiment and a boolean `recommended` come from one classification call on the provider's cheap model, and only for entities already detected (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/lib/engine.ts).

**Metrics (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/lib/metrics.ts).** Wilson score intervals on rates; share of voice across entities; "measurement quality" = share of answers naming at least one tracked entity; a verdict enum `no-data`, `no-competitors`, `thin-sample`, `real-gap`, `healthy`, where thin-sample uses the Wilson upper bound against a 0.5 floor. Per-URL "target page" cited-hit rates for prompts mapped to a page, with URL keys normalised (no scheme, www, query, fragment or trailing slash).

**Prompt strategy (VERIFIED, https://github.com/letterstory/lettertrace/blob/HEAD/docs/prompt-playbook.md).** Their measured rule: a prompt only measures something if the answer names companies. List-style prompts ("list the top 5 companies...") named about 3.7 companies per answer; how-to and "best X for Y" phrasings named about 0.1. "Give me a shortlist" is flagged as a trap. The playbook separates "named" from "cited" as two currencies.

**Scheduling.** Vercel cron hits `app/api/cron/run/route.ts`; per-project schedule and cadence pickers (VERIFIED, tree).

**Borrow.** Link-surface blanking with label retention; no domain-derived terms; confidence intervals and a measurement verdict; `recommended` flag distinct from sentiment; target-URL mapping per prompt; the prompt playbook's empirical guidance.

**Weaknesses / notes.** Hosted app ships marketing pixels (`components/rb2b-pixel.tsx`, `posthog.tsx`) (VERIFIED, tree); whether they load on self-host was not checked. OpenTelemetry export is off unless an endpoint is set (VERIFIED, `TELEMETRY.md`). `lib/llm/index.ts` is 96 KB, one file for all providers (VERIFIED size).

## A3. OneGlanse

- Repo: https://github.com/aryamantodkar/oneglanse
- License: **MIT** (VERIFIED)
- Stars 191; created 2025-09-09; last push 2026-09-28 (VERIFIED)
- Stack: TypeScript pnpm monorepo. `apps/web` (Next.js + tRPC), `apps/agent` (browser worker), Postgres via Drizzle (auth and workspaces only), ClickHouse for prompts, responses and analysis, Redis with BullMQ (VERIFIED, `packages/services/src/agent/queue.ts` imports `Queue` from bullmq).

**Provider strategy: logged-in UI scraping, no model APIs for collection (VERIFIED, README).** It drives ChatGPT, Gemini, Perplexity, Claude and Google AI Overview in Camoufox (anti-fingerprint Firefox) using the operator's own logged-in accounts. Residential proxies (ThorData) are required on a VPS (VERIFIED, .env.example). The README argues logged-out sessions give shorter answers and fewer citations. There is no cloud version for this reason.

**Data model (VERIFIED, https://github.com/aryamantodkar/oneglanse/blob/HEAD/packages/db/clickhouse-init/schema.sql).** ClickHouse `user_prompts` (ReplacingMergeTree), `prompt_responses` (model, model_provider LowCardinality, response, `sources Array(Tuple(title, cited_text, url, domain, favicon))`, is_analysed, prompt_run_at; partitioned by month), `prompt_analysis` (brand_analysis stored as a JSON string). Postgres holds `user`, `session`, `organization`, `member`, `workspaces`, `workspace_members`.

**Extraction: LLM-as-judge with a long rubric (VERIFIED, https://github.com/aryamantodkar/oneglanse/blob/HEAD/packages/services/src/analysis/analysisPrompt.ts).**
- Rules: quote a justifying passage before scoring or fall back to defaults; explicit anti-inflation mandate; absent brand means all metrics zero.
- Rank: absolute rank across the whole answer by first appearance, not rank within a sub-list.
- Visibility = 0.25 coverage + 0.25 placement + 0.20 structural prominence + 0.15 frequency + 0.15 contextual framing, with caps (single mention caps at 50; question-only mention caps at 10).
- Sentiment calibration rules (pros and cons present caps at 79; list entry without evaluative text is about 50 to 55).

**Scheduling (VERIFIED, https://github.com/aryamantodkar/oneglanse/blob/HEAD/packages/services/src/prompt/scheduler.ts).** pg_cron jobs call an internal API; the cron secret is stored as a Postgres role GUC so it is not written into the `cron.job` table.

**Borrow.** The absolute-rank definition; calibration anchors if we ever use an LLM judge for qualitative fields; ClickHouse-style columnar store for high-volume answer rows; storing `cited_text` with each source.

**Weaknesses / risks.**
- All headline numbers come from an LLM judge, so they are not reproducible run to run and drift with the judge model (INFERRED).
- Logged-in automation of consumer UIs with anti-detect browsers breaches most providers' terms and risks account bans (INFERRED from README design).
- Auth-session upload to a VPS defaults to `http://<VPS_IP>:3333/auth/sessions` with a bearer token, so session cookies and the token cross the network in plaintext unless the operator adds TLS (VERIFIED default URL in .env.example; risk INFERRED).

## A4. OpenCited

- Repo: https://github.com/opencited/opencited
- License: **none in repo**. The README says MIT, but there is no LICENSE file and the GitHub license API returns 404 (VERIFIED). Legally this is all-rights-reserved until a LICENSE is added.
- Stars 1; created 2026-04-13; last commit 2026-07-02 (VERIFIED)
- Stack: Bun, Next.js 16, Clerk auth, Neon Postgres via Drizzle, BullMQ + Valkey, Playwright (VERIFIED, README).

**Provider strategy.** Playwright crawls Perplexity and ChatGPT UIs (`packages/browser-crawler/src/providers/chatgpt.ts`, `perplexity.ts`) (VERIFIED, tree). ADR-0003 records that both providers expose inline links in prose and ChatGPT adds a separate "Sources" panel, so references carry a `kind` of inline-link or source-panel (VERIFIED, https://github.com/opencited/opencited/blob/HEAD/docs/adr/0003-multi-provider-architecture.md).

**Data model (VERIFIED, `packages/db/src/schema/*.ts`).** `promptQuery`, `promptQueryCrawl` (status, provider, query, prompt_snapshot, content, answer_format, word_count, source_count, brand_mention_count, load_time_ms), `crawlBrandMention` (brand_name, brand_url, context, mention_type target/competitor/other, position), `crawlReference` (kind, domain, url, title, position, is_own_domain, is_competitor_domain), `crawlVisibilityScore`, `crawledPage`, `pageAnalysis`, `competitor`, `domainProject`.

**Score (VERIFIED, README and https://github.com/opencited/opencited/blob/HEAD/docs/adr/0002-visibility-score.md).** `0.35 mention + 0.25 position (log decay) + 0.20 citation + 0.10 sentiment (LLM judge) + 0.10 co-mention`, then min-max normalised against the tracked peer set. README states v1 scores own-domain citations only.

**Borrow (ideas only; no code).** Storing a `prompt_snapshot` on every crawl so prompt edits do not rewrite history; distinguishing inline links from panel sources; ADR discipline.

**Weaknesses.** No license; min-max normalisation against peers makes a brand's score move when a competitor is added or removed (INFERRED).

## A5. Habibi

- Repo: https://github.com/moaljumaa/habibi
- License: **"Habibi Sustainable Use License"**, custom and not OSI-approved; GitHub reports `NOASSERTION` (VERIFIED, https://github.com/moaljumaa/habibi/blob/HEAD/LICENSE). It allows commercial self-use but forbids offering the software as a hosted or managed service to third parties; only the maintainer may host it.
- Stars 23; created 2026-07-22; last commit 2026-08-09 (VERIFIED)
- Stack: Next.js pages router, SQLite (`lib/db.ts`), node-cron, Playwright/Chrome profiles for scraping, MCP server (VERIFIED, tree).

**Provider strategy (VERIFIED, README).** Default path is OpenRouter search-grounded APIs for ChatGPT, Claude, Gemini and Perplexity with one key; direct adapters for OpenAI, Gemini and Perplexity. Optional browser engines drive logged-in ChatGPT, Claude, Perplexity and AI Overview, run in Temporary Chat or Incognito so account memory does not contaminate answers. The README states the API path is a proxy for, not identical to, consumer answers.

**Data model (VERIFIED, https://github.com/moaljumaa/habibi/blob/HEAD/lib/db.ts).** `brand`, `prompt`, `run` (with `sample_idx` 0..N-1 for non-determinism), `mention`, `citation`, `provider` (`api_key_enc`), `setting`, `user` (scrypt hashes).

**Extraction (VERIFIED, https://github.com/moaljumaa/habibi/blob/HEAD/lib/extract.ts).** Citations are deterministic from API metadata. Mentions come from one cheap LLM JSON call that returns which known brands appear and their order, with a fallback chain of models on OpenRouter.

**Scheduling.** `CRON_SCHEDULE` env with node-cron inside the app process; skipped if a run is in progress (VERIFIED, `lib/scheduler.ts`).

**Borrow (ideas only, license restricts code reuse).** N samples per prompt with `sample_idx`; cost estimate before a run and per-run/daily spend caps; memory-free chat modes for UI scraping.

**Weaknesses.** Single-tenant with signup gated by a shared secret. SSRF guard for site scraping is a hostname regex (`localhost`, RFC1918 prefixes, 169.254) with no DNS resolution, IPv6 or redirect check, so DNS rebinding or a redirect to an internal host would bypass it (VERIFIED regex at `lib/scrape.ts` line 36; bypass INFERRED). LLM-based mention detection can hallucinate or omit brands (INFERRED).

## A6. Cloro GEO Tracker (architecture reference)

- Repo: https://github.com/cloro-dev/geo-tracker
- License: **MIT** (VERIFIED). Note: Cloro's per-engine scraper repos (`cloro-dev/chatgpt-scraper`, `perplexity-scraper`, etc.) have **no license** (VERIFIED, org listing), and `ai-visibility-leaderboard` is NOASSERTION.
- Stars 2; created 2026-08-15; last commit 2026-09-08 (VERIFIED)
- Stack: Next.js route handlers only (no UI), Vercel Postgres via Drizzle, MCP endpoint, Grafana starter dashboards and SQL (VERIFIED, tree).

**Architecture (VERIFIED, README).** Cron tick hits `/api/cron`, which submits one Cloro async task per due prompt × engine. Cloro posts results to `/api/webhook`, which writes a `results` row. Without a public URL, the cron sweep polls instead. One secret (`CRON_SECRET`) is the API bearer token, the scheduler credential, and the root from which the webhook token is derived by HMAC so the URL given to the third party grants nothing else (VERIFIED, https://github.com/cloro-dev/geo-tracker/blob/HEAD/lib/webhooks.ts).

**Data model (VERIFIED, https://github.com/cloro-dev/geo-tracker/blob/HEAD/lib/db/schema.ts).** `prompts` (engines[], country, runs_per_day, enabled, last_run_at), `results` (engine, task_id, status pending/completed/failed, response jsonb, credits_charged, extraction_revision), `brands` (aliases, domains, is_own), `result_sources` (kind, position, url, domain, label), `result_brand_mentions` (mentioned, mention_count, first_position, cited, cited_source_count), `result_search_queries` (fan-out queries), `result_candidate_mentions` (untracked names from a hand-edited watchlist), `extraction_state`.

**Extraction (VERIFIED, https://github.com/cloro-dev/geo-tracker/blob/HEAD/lib/extract.ts).** Mechanical only: literal, non-overlapping alias matching and hostname lowercasing. `EXTRACTION_REVISION` is bumped whenever matching rules change, and finished results with an older revision are re-derived from the stored raw response. Revision 3 fixed alias double-counting.

**Borrow.** Raw response stored once, derived rows rebuilt by revision; async task + webhook with polling fallback; HMAC-derived webhook token; candidate-brand watchlist to discover unknown competitors; fan-out query table.

**Weaknesses.** Single secret for everything means one leak exposes the API and scheduler (INFERRED). Entirely dependent on a paid third-party scraping API.

## A7. AEO Radar

- Repo: https://github.com/hellowalt/aeo-radar
- License: **MIT** (VERIFIED)
- Stars 26; created 2026-04-19; last commit 2026-04-19, last push 2026-07-01 (VERIFIED)
- Stack: TypeScript, Playwright + stealth plugin, Prisma + SQLite, Next.js + Ant Design dashboard, macOS launchd scheduling (VERIFIED, README and `docs/decisions/0002-scheduling-on-macos.md`).

**Pipeline (VERIFIED, README).** Brand config, then the Claude CLI generates prompts, Playwright scrapes ChatGPT headless, the Claude CLI analyses each answer into JSON, results land in SQLite. The analyzer shells out with `execSync` piping a temp file into `claude -p` (VERIFIED, https://github.com/hellowalt/aeo-radar/blob/HEAD/src/pipeline/analyzer.ts).

**Keyword model and prompt strategy (VERIFIED, https://github.com/hellowalt/aeo-radar/blob/HEAD/prompts/generator-template.md).** Each keyword expands into four intent variants: recommendation, comparison, tutorial, procurement, in the target market's language.

**Data model (VERIFIED, https://github.com/hellowalt/aeo-radar/blob/HEAD/prisma/schema.prisma).** `aeo_keywords` → `aeo_prompts` (intent_type) → `aeo_results` (llm_platform, raw_response_md, screenshot_path) → `aeo_analysis` (brand_mentioned, brand_rank, brand_description, sentiment, sentiment_score, competitors JSON, referenced_domains JSON, referenced_urls JSON, total_recommendations); `aeo_crawl_runs`.

**Security problem (VERIFIED code, exploit INFERRED).** `web/src/app/api/screenshot/[...path]/route.ts` serves any file under `data/` with an image content type, and the SQLite database lives at `data/aeo.db`. With no dashboard auth, anyone who can reach the dashboard can download the whole database. The containment check uses `startsWith(dataDir)` without a trailing separator, so a sibling directory named like `data-x` would also pass.

**Borrow.** Keyword to intent-variant expansion; saving a screenshot per scraped answer as evidence.

**Weaknesses.** ChatGPT only by default; relies on a local Claude CLI subscription; ToS risk (the README has an explicit disclaimer).

## A8. Aperture (Anyin)

- Repo: https://github.com/anyin-ai/aperture
- License: **MIT** (VERIFIED)
- Stars 27; created 2026-03-09; last commit 2026-07-01 (VERIFIED)
- Stack: Python FastAPI + SQLAlchemy + Alembic backend (SQLite locally, Postgres on Neon/Railway), Next.js frontend with a catch-all proxy route (VERIFIED, `backend/requirements.txt`, tree).

**Providers (VERIFIED, README).** BYOK OpenAI and Perplexity `sonar`/`sonar-pro`; any OpenAI-compatible endpoint by custom Base URL in Settings.

**Data model (VERIFIED, `backend/app/models.py` class list).** `Brand`, `Competitor`, `Query`, `AuditRun`, `AuditResult`, `Setting`.

**Extraction (VERIFIED, https://github.com/anyin-ai/aperture/blob/HEAD/backend/app/services/analysis.py).** Regex with *conditional* word boundaries: a boundary is required only on a side where the name has a word character, so "C++" and "Node.js" match while "Arc" does not match inside "search". Alias counts are summed; the docstring admits additive double counting when an alias is a substring of another term.

**Security (VERIFIED, README "Security note").** API keys stored unencrypted in SQLite and no authentication. A user-settable base URL for model calls is a server-side request primitive; if exposed, it enables SSRF and key exfiltration to an attacker host (INFERRED).

**Borrow.** The conditional-boundary regex technique.

## A9. TraceAIO

- Repo: https://github.com/jakubsuchy/traceaio (site https://traceaio.org/)
- License: **Apache-2.0** (VERIFIED, API)
- Stars 13; created 2026-03-19; last commit 2026-07-06 (VERIFIED)
- Stack: TypeScript, Express server, React client, Postgres via Drizzle, Docker Compose, MCP, n8n node (VERIFIED, package.json and tree).

**Providers (UNVERIFIED in code, from website).** Browser models (ChatGPT, Perplexity, Gemini, Google AI Mode) via Apify with residential proxies at about 15 prompts/minute and about $0.05/prompt; API models (OpenAI, Anthropic) with web search.

**Prompt strategy (VERIFIED, `server/services/analyzer.ts`).** Topics are generated, then N prompts per topic (default 20); jobs are enqueued per prompt × model.

**Data model (VERIFIED, https://github.com/jakubsuchy/traceaio/blob/HEAD/shared/schema.ts).** `topics`, `prompts`, `responses` (brand_mentioned, competitors_mentioned[], sources[]), `competitors` (name_key unique, domain, category, mention_count, `merged_into`), `sources`, `source_unique_urls`, `source_urls` (normalized_url, normalized_url_stripped), `watched_urls` (ignore_query_strings), `analytics`, `analysis_runs`. Migration `002_hash_api_keys.sql` hashes API keys (VERIFIED filename).

**Borrow.** Competitor entity merging (`merged_into`) for auto-discovered names; two levels of URL normalisation; watched URLs for page-level citation tracking.

**Weaknesses.** Denormalised arrays on `responses` (competitors and sources as text[]) make per-entity analytics harder (INFERRED).

## A10. GEO/AEO Tracker (danishashko)

- Repo: https://github.com/danishashko/geo-aeo-tracker
- License: **MIT** (VERIFIED)
- Stars 276; created 2026-02-14; last commit 2026-08-12 (VERIFIED). Many forks (e.g. `scailetech/tech-geo-aeo-tracker`).
- Stack: Next.js 16, local-first state in IndexedDB/localStorage, optional Supabase KV sync (VERIFIED, README, tree).

**Providers (VERIFIED, README).** Bright Data AI Scraper API for six surfaces (ChatGPT, Perplexity, Gemini, Copilot, Google AI Mode, and others); OpenRouter for analysis; Gemini grounding; Bright Data SERP and Web Unlocker for page fetches.

**Prompt strategy (VERIFIED, README).** `{brand}` placeholder injection; "Persona Fan-Out" variants (CMO, SEO Lead, Founder); niche explorer for AI-generated high-intent queries.

**Score (VERIFIED, https://github.com/danishashko/geo-aeo-tracker/blob/HEAD/components/sovereign-dashboard.tsx around lines 937 to 980).** Additive heuristic capped at 100: +30 if mentioned, +20 if in the first 200 characters, +8/+15 for 2 or 3+ mentions, +20 if cited, +15 positive or +5 neutral sentiment. Drift alerts on score deltas between runs.

**Security (VERIFIED, https://github.com/danishashko/geo-aeo-tracker/blob/HEAD/proxy.ts).** The file itself states every API route is unauthenticated and several trigger paid calls. Mitigation is an in-memory per-IP rate limit keyed on `x-forwarded-for`, which a client can spoof, and which does not share state across serverless instances. On a public Vercel deploy this allows cost abuse of the deployer's Bright Data and OpenRouter keys (INFERRED). The cloud KV route does require a shared `x-sync-secret` header (VERIFIED, `app/api/state/route.ts`), and there is an `lib/server/ssrf.ts` helper (VERIFIED filename).

**Borrow.** Persona fan-out; citation opportunities (URLs where competitors are cited and you are not); drift alerts.

**Weaknesses.** 80 KB single dashboard component; all data in the browser by default, so no scheduled server-side history unless cloud mode is set up (INFERRED).

## A11. Limelit Open

- Repo: https://github.com/limelit-co/open (demo https://demo.limelit.co)
- License: **Apache-2.0** with NOTICE file (VERIFIED)
- Stars 152; created 2026-09-11; last commit 2026-09-28 (VERIFIED)
- Stack: single Go binary, SQLite with embedded migrations, Litestream for backups in deploy, server-rendered HTML templates, MCP over stdio or streamable HTTP with bearer token (VERIFIED, tree and README).

**Providers (VERIFIED, README, `internal/provider/*.go`).** ChatGPT, Claude, Perplexity and Gemini through vendor APIs with web search on. Google AI Overview, AI Mode and Bing Copilot through DataForSEO or SearchAPI, since they have no API. Targets use a spec string `engine:provider[:model][:online]` with `access` api or scraped (same convention as Elmo).

**Data model (VERIFIED, https://github.com/limelit-co/open/blob/HEAD/internal/store/migrations/0001_init.sql).**
- `prompt` (text, category, location_country, **branded** 0/1, tags JSON, active)
- `target` (spec, engine, provider, model, online, access api/scraped, enabled)
- `evaluation` (a batch run: planned, completed, failed)
- `chat` (one answer: prompt_id, target_id, status ok/failed/**no_answer_surface**, text, model, input/output tokens, calls)
- `mention` (chat_id, competitor_id, brand_key, brand_name, **offset_start, offset_end, list_rank**)
- `citation` (url as given, host, registrable site, title, position, source_type own/competitor/social/informational/other)
- `property`, `competitor`, `usage_day`, `settings`

**Metrics (VERIFIED, README "How the numbers are computed"; full method in `docs/methodology.md`).** Visibility = share of answers mentioning the brand; share of voice = brand mentions over all tracked brands' mentions in the same answers; position = mean list rank; citation share = share of cited sources on the brand's own site. Two denominator rules: branded prompts are excluded from the headline number, and an answer surface that did not render (e.g. no AI Overview shown) is excluded rather than counted as a miss. Every metric carries `n`.

**Extraction.** Text search for user-declared names; rank from the enclosing list item when the answer is a ranked list; no model decides what it saw (VERIFIED, README). Offsets stored so the UI highlights exactly what the matcher matched (VERIFIED, schema).

**Security.** Provider credentials encrypted at rest; key from `LIMELIT_SECRET` or an auto-generated key file written 0600 next to the DB; the file comment is candid that this protects backups and copied volumes, not a compromised host (VERIFIED, https://github.com/limelit-co/open/blob/HEAD/internal/secrets/secrets.go). Default listen address is `:1515` on all interfaces (VERIFIED, `cmd/limelit/main.go` line 111); I did not find dashboard auth, and the deploy README calls the default config wrong for anything public (INFERRED: dashboard is unauthenticated, so binding to all interfaces is risky on shared networks).

**Borrow.** Almost the whole metrics contract: branded flag, `no_answer_surface` status, `n` on every number, list_rank, source_type taxonomy, offsets. Apache-2.0 permits code reuse with NOTICE and change notes.

## A12. Elmo, plus derivatives GetCito and SpotlightsAI

- Elmo: https://github.com/elmohq/elmo. **MIT** (VERIFIED). Stars 370; last commit 2026-09-28 (VERIFIED).
- GetCito: https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool. **MIT** derivative of Elmo; LICENSE.md credits Elmo and Blue Whale Software, which is why GitHub shows NOASSERTION (VERIFIED). Stars 443; last commit 2026-08-27.
- SpotlightsAI: https://github.com/metaforismo/spotlightsai. **MIT** with Blue Whale Software copyright, same file layout as Elmo (VERIFIED LICENSE; derivation INFERRED from identical tree paths). Stars 0.

**Stack (VERIFIED, tree and package.json).** TypeScript monorepo: `apps/web` on TanStack Start, `apps/worker` on pg-boss using the same Postgres (own `pgboss` schema), `apps/cli` for Docker Compose setup and migrations, Drizzle migrations, Bruno e2e suites including cross-tenant isolation tests.

**Providers (VERIFIED, https://github.com/elmohq/elmo/blob/HEAD/packages/config/src/scrape-targets.ts).** `SCRAPE_TARGETS` env, format `model:provider[:version][:online]`. Providers: olostep, brightdata, direct, openrouter, dataforseo. Surfaces include chatgpt, google-ai-mode, copilot and others.

**Data model (VERIFIED, `packages/lib/src/db/migrations/0000_hot_excalibur.sql`, `0011_secrets.sql`).** `brands` (website, delay_override_hours), `competitors`, `prompts` (value, tags[], system_tags[]), `prompt_runs` (model, web_search_enabled, raw_output json, web_queries[], brand_mentioned, competitors_mentioned[]), `reports`, `secrets` (encrypted_value, RLS on). Later: multi-domain aliases, provider engines, orgs, billing, usage events, API keys, MCP OAuth.

**Scheduling (VERIFIED, https://github.com/elmohq/elmo/blob/HEAD/apps/worker/src/jobs/process-prompt.ts).** Each prompt reschedules itself with a pg-boss `singletonKey` per prompt and a failure backoff. Queue retries are set to zero on purpose because a failed job has already spent money on paid requests; recovery happens through the handler's own reschedule or a maintenance job.

**Borrow.** Target spec string; per-prompt self-scheduling with singleton keys; "no queue retry after paid fan-out"; cross-tenant e2e tests; web_queries captured per run.

**Weaknesses / notes.** GetCito commits a `.env.local` file to the repo; I checked its values and they are placeholders (`your_...`, `change_me`), not live secrets (VERIFIED), but committing any `.env.local` invites a real leak later.

## A13. goose-aeo

- Repo: https://github.com/gooseworks-ai/goose-aeo. **MIT** (VERIFIED). Stars 33; created 2026-03-24; last commit 2026-03-27, so effectively dormant (VERIFIED).
- Stack: TypeScript CLI + local dashboard, SQLite via Drizzle, providers for Claude, DeepSeek, Gemini, Grok, OpenAI, Perplexity (VERIFIED, tree).
- Metrics (VERIFIED, https://github.com/gooseworks-ai/goose-aeo/blob/HEAD/packages/core/src/services/runs/compute-metrics.ts): visibility_rate, avg_prominence_score, citation_rate, top_recommendation_rate (mention context `primary_recommendation`), share_of_voice, avg_sentiment_score, median_competitive_rank, total_cost_usd, stored per run in `run_metrics`.
- Borrow: `top_recommendation_rate` as a separate KPI; run-to-run diff service; cost estimate before a run.

## A14. NameDrop

- Repo: https://github.com/TheCraigHewitt/namedrop. **MIT** (VERIFIED). Stars 8; created 2026-08-05 (VERIFIED).
- Stack: Astro on one Cloudflare Worker, D1 database, Cloudflare Access for auth (no auth code in app), staggered cron triggers per surface because a cron trigger is killed at 15 minutes (VERIFIED, README).
- Providers: ChatGPT via Cloro (README flags the supply and ToS risk and keeps an OpenAI API fallback adapter), Perplexity and Gemini APIs, OpenAI for domain classification and calibration (VERIFIED, README).
- Data model (VERIFIED, `migrations/0001_init.sql`): `topics`, `prompts`, `brands`, `brand_aliases`, `brand_domains`, `domains` (with LLM-assigned domain type), `sweeps`, `runs`, `mentions`, `sources`, `fanouts`.
- Borrow: a `/api/calibrate` endpoint that samples prompts under different model and search settings, compares cost and which brands are detected, and writes nothing to trend data (VERIFIED, https://github.com/TheCraigHewitt/namedrop/blob/HEAD/src/pages/api/calibrate.ts); per-surface health page; a CONTEXT.md glossary that code, schema and UI share.

## A15. AGPL projects (study only)

- Climby AI SEO: https://github.com/Marc-Moeller/Climby-AI-SEO. **AGPL-3.0** (VERIFIED). Stars 9; last commit 2026-07-20. Next.js + oRPC + BullMQ + Postgres/Drizzle; GSC sync, rank and maps tracking, PAA research, GEO visibility (VERIFIED, README).
- GEO Visibility Tracker: https://github.com/Open-Source-SEO-Tools/ai-visibility-tracker. **AGPL-3.0** (VERIFIED). Stars 4; created 2026-09-12. Prompts tagged by intent (commercial/informational) and branded/unbranded, with a "commercial only" mode that skips informational prompts to save credits (VERIFIED, README). The README's example prompt names Climby, suggesting it was extracted from Climby (INFERRED).
- Implication: reading for ideas is fine; copying code into a hosted SaaS would trigger AGPL network-use source disclosure.

---

# Part B: SEO rank trackers and SEO monitoring

## B1. SerpBear

- Repo: https://github.com/towfiqi/serpbear. **MIT** (VERIFIED). Stars 2,095; created 2022-11-24; last commit 2026-05-14 (VERIFIED).
- Stack: Next.js pages router, Sequelize + SQLite, `croner` cron in `cron.js` calling internal API routes, cheerio parsing (VERIFIED, tree).

**Provider strategy (VERIFIED, README and `scrapers/services/`).** Pluggable scrapers: Serper, SerpApi, SearchApi, HasData, ValueSERP, SpaceSerp, Serply, CrazySERP, ScrapingAnt, ScrapingRobot, or raw proxies that fetch `google.com/search` directly (VERIFIED, `utils/scraper.ts` line 98). Google Ads API for keyword ideas and volume; Google Search Console integration.

**Keyword model (VERIFIED, https://github.com/towfiqi/serpbear/blob/HEAD/database/models/keyword.ts).** One row per keyword with device, country, city, latlong, domain, position, **history as a JSON string**, volume, url JSON, tags JSON, lastResult JSON, sticky, updating flag, lastUpdateError, settings. Scraping walks page 1 first and falls back through more pages when the site is not found, marking unscraped positions as skipped (VERIFIED, `utils/scraper.ts`). Failed keywords retry hourly (VERIFIED, `cron.js`).

**Security (VERIFIED, https://github.com/towfiqi/serpbear/blob/HEAD/pages/api/login.ts).** Single user from env vars, compared with plain `===`. JWT signed with no expiry claim. The cookie `maxAge` is set to `expireDate.getTime()`, an epoch timestamp in milliseconds, which makes the cookie last decades instead of the intended session duration (bug INFERRED from code). Scraper API keys and GSC private keys are stored in `settings.json`, encrypted with `cryptr` using `SECRET` (VERIFIED, `pages/api/settings.ts`).

**Borrow.** Pluggable SERP provider interface; page-1-first scraping with fallback; hourly retry of failures; skipped-position markers.

**Anti-patterns.** Rank history as a growing JSON blob inside the keyword row (no SQL analytics, rewrite cost grows with history). Session handling above.

## B2. OpenSEO (every-app/open-seo)

- Repo: https://github.com/every-app/open-seo. **MIT** (VERIFIED). Stars 21,691; created 2026-02-27; last commit 2026-09-19 (VERIFIED).
- Stack: TypeScript, TanStack Start, Cloudflare Workers with both D1 (`drizzle/`) and Postgres (`drizzle-pg/`) schemas, better-auth, Autumn billing, MCP server and agent skills (VERIFIED, tree and README).
- Provider strategy: BYOK DataForSEO for keyword research, rank tracking, backlinks, audits and AI visibility (DataForSEO AI search aggregated metrics, top pages and mentions search) (VERIFIED, README and `src/server/features/ai-search/services/brandLookup.ts`). The hosted version adds a 28% markup on DataForSEO calls (VERIFIED, README).

**Rank tracking data model (VERIFIED, https://github.com/every-app/open-seo/blob/HEAD/src/db/pg/app.schema.ts lines 212 to 356).**
- `rank_tracking_configs`: project, domain, location_code (default 2840 = US), language_code, devices both/desktop/mobile, serp_depth, schedule_interval daily/weekly/monthly/manual, next_check_at, last_skip_reason; partial unique indexes separating national and local (location_name) configs.
- `rank_tracking_keywords`: keyword, `match_case` (lowercased unless set, because Google can return different SERPs by case), search_volume, keyword_difficulty, cpc, metrics_fetched_at.
- `rank_check_runs`: status, keywords_total/checked, is_subset_run; a **partial unique index** allows only one pending or running run per config, which is the duplicate-trigger guard.
- `rank_snapshots`: one row per keyword × device × run; position NULL means not found; serp_features JSON; **no FK to the keyword** on purpose so history survives keyword deletion.

**Scheduling (VERIFIED, https://github.com/every-app/open-seo/blob/HEAD/src/server/features/rank-tracking/services/scheduledRankChecks.ts).** A */5 cron admits at most 1,000 task units (keywords × devices) per tick, sized against DataForSEO's 2,000 requests/minute cap where task_get polling dominates; throttled polls fall back to the live endpoint at about 3× cost; a 3-minute wall-clock deadline per tick; due configs resume oldest first.

**Borrow.** The four-table rank model, partial-unique-index run guard, admission budget, `match_case`, national vs local configs. MIT permits reuse with notice.

## B3. Serposcope

- Repo: https://github.com/serphacker/serposcope. **MIT** (VERIFIED). Stars 756; archived; last commit 2022-01-15 (VERIFIED). Java (GitHub labels it JavaScript due to assets).
- README says the code is legacy in survival mode and advises rewriting rather than forking (VERIFIED).
- Direct Google scraping with proxy pools and a captcha-solver integration (VERIFIED, `di/CaptchaSolverFactory*.java`, `models/base/Proxy.java`).
- Stores full SERPs, and a "rescan" recomputes ranks, bests and summaries for newly added targets from stored SERPs (VERIFIED, https://github.com/serphacker/serposcope/blob/HEAD/core/src/main/java/com/serphacker/serposcope/db/google/GoogleSerpRescanDB.java). Summaries track top 3 / top 10 / top 100 counts and a score in basis points with the previous score (VERIFIED, `GoogleTargetSummaryDB.java`).
- Borrow: store the full top-N SERP per check so competitors added later get backfilled history. Avoid: captcha solving and raw Google scraping.

## B4. SEO Panel

- Repo: https://github.com/sendtogeo/Seo-Panel. **GPL-2.0** (VERIFIED). Stars 138; last commit 2020-11-15, last push 2023-09-18 (VERIFIED). PHP + MySQL.
- Installer instructs chmod 666 on the config file and 777 on `tmp`, and ships a default admin login `spadmin`/`spadmin` (VERIFIED, README).
- Public SQL injection CVEs: CVE-2021-28419 (`order_col` in archive.php, 4.8.0) and CVE-2021-34117 (`api/user.api.php`, 4.9.0) (VERIFIED via https://www.strix.ai/cve/CVE-2021-28419 and https://www.acunetix.com/vulnerabilities/web/seo-panel-improper-neutralization-of-special-elements-used-in-an-sql-command-sql-injection-vulnerability-cve-2021-34117/). A public repo also advertises an authenticated RCE PoC for 4.6.0 (`Kr0ff/SeoPanel-4.6.0-RCE`, not reviewed).
- Value to us: none beyond a list of what not to do. GPL-2.0 would also bind any derived code.

---

# Part C: Comparative table

Legend for Extraction: RX = deterministic regex/text match; LLM = model decides mentions or scores; Hybrid = regex for mentions, LLM for sentiment or qualitative fields.

| Project | License (SPDX) | Stars | Last commit | Stack | Store / queue | Collection method | Extraction | Headline metric | Auth / key storage |
|---|---|---|---|---|---|---|---|---|---|
| Ansvisor | MIT | 125 | 2026-09-29 | JS server + TS web | Supabase PG; jobs table | APIs w/ web search + Cloro UI scrapes | Hybrid | 0.6 mention + 0.25 citation + 0.15 position (shrunk) | Supabase auth; AES-GCM org key; hashed API keys |
| Lettertrace | MIT | 72 | 2026-09-28 | Next.js, Vercel | Supabase PG | BYOK APIs w/ web search | Hybrid | Rates with Wilson CI + verdict | AES-GCM BYOK; OAuth server |
| OneGlanse | MIT | 191 | 2026-09-28 | Next.js + Camoufox agent | PG + ClickHouse; BullMQ/Redis; pg_cron | Logged-in UI scraping | LLM judge | LLM visibility 0 to 100 | Better Auth; sessions local |
| OpenCited | none (README claims MIT) | 1 | 2026-07-02 | Bun, Next.js | Neon PG; BullMQ/Valkey | Playwright UI (ChatGPT, Perplexity) | Hybrid | 0.35/0.25/0.20/0.10/0.10, peer min-max | Clerk |
| Habibi | Custom source-available | 23 | 2026-08-09 | Next.js | SQLite; node-cron | OpenRouter grounded APIs + optional UI | LLM for mentions | Mention rate over N samples | Shared-secret signup; encrypted keys |
| Cloro geo-tracker | MIT | 2 | 2026-09-08 | Next.js API only | PG; Vercel cron + webhook | Cloro API | RX (revisioned) | Raw rows, SQL/Grafana | One bearer secret; HMAC webhook token |
| AEO Radar | MIT | 26 | 2026-04-19 | Next.js + Playwright | SQLite; launchd | Headless ChatGPT UI | LLM (Claude CLI) | Mention, rank, sentiment | None; DB downloadable |
| Aperture | MIT | 27 | 2026-07-01 | FastAPI + Next.js | SQLite/PG | BYOK OpenAI, Perplexity | RX | Mention counts | None; plaintext keys |
| TraceAIO | Apache-2.0 | 13 | 2026-07-06 | Express + React | PG | Apify UI + APIs | Not traced | Mention and source counts | App auth; hashed API keys |
| GEO/AEO Tracker | MIT | 276 | 2026-08-12 | Next.js | IndexedDB; opt. Supabase KV | Bright Data AI scrapers | Hybrid | Additive 0 to 100 heuristic | Unauthenticated API routes |
| Limelit Open | Apache-2.0 | 152 | 2026-09-28 | Go binary | SQLite (+Litestream) | Vendor APIs + DataForSEO/SearchAPI | RX with list rank | Visibility, SoV, position, citation share, with n | AES-GCM keys; MCP bearer; dashboard auth not found |
| Elmo | MIT | 370 | 2026-09-28 | TanStack Start + worker | PG; pg-boss | Olostep, Bright Data, direct, OpenRouter, DataForSEO | RX (booleans) | Mention rates | Better Auth; encrypted secrets table |
| goose-aeo | MIT | 33 | 2026-03-27 | CLI + dashboard | SQLite | Six vendor APIs | LLM | Visibility, top-rec rate, SoV | Local only |
| NameDrop | MIT | 8 | 2026-08-05 | Astro, CF Worker | D1; CF cron | Cloro (ChatGPT) + APIs | RX | Visibility, SoV | Cloudflare Access |
| SerpBear | MIT | 2,095 | 2026-05-14 | Next.js | SQLite; croner | SERP APIs or proxies | n/a | Position + history | Env user, JWT no exp; cryptr settings |
| OpenSEO | MIT | 21,691 | 2026-09-19 | TanStack Start, CF Workers | D1 or PG; cron admission | DataForSEO | n/a | Position per device + SERP features | Better Auth; billing |
| Serposcope | MIT | 756 | 2022-01-15 | Java | H2/MySQL | Direct Google + captcha solver | n/a | Top3/10/100 + score | App users |
| SEO Panel | GPL-2.0 | 138 | 2020-11-15 | PHP | MySQL | Direct scraping | n/a | Rank reports | Default admin creds; SQLi CVEs |

---

# Part D: Top 10 ideas worth borrowing (with attribution and licensing)

Licensing rule of thumb for our closed-source SaaS: MIT and Apache-2.0 code may be copied with the copyright and license notice kept (Apache-2.0 also requires carrying NOTICE and stating changes, and grants a patent license). AGPL/GPL code must not be copied. Unlicensed or custom-licensed code (OpenCited, Habibi, Cloro scraper repos) must not be copied at all. Ideas, metric definitions and schemas described in prose are not copyrightable, so re-implementing an idea from any project is fine; copying its text or code is what the license governs.

1. **Denominator hygiene: branded-prompt exclusion and "no answer surface" status.** Tag prompts that name our own brand as branded and keep them out of headline visibility; record `no_answer_surface` when an AI Overview or similar did not render and drop it from denominators; show `n` next to every rate. Source: Limelit Open (Apache-2.0). Re-implement; copying code needs NOTICE.
2. **Confidence intervals and a measurement verdict.** Wilson intervals on rates plus an "informative rate" (share of answers naming any tracked entity) that classifies a run as thin-sample vs real gap. Source: Lettertrace (MIT).
3. **Deterministic mention matcher with link-surface handling.** Longest-first alias regex, lookaround or conditional boundaries (handles "Node.js", avoids "Arc" in "search"), blank URLs and address-like link labels but keep brand-name labels, no domain-derived terms, store offsets and list rank. Sources: Lettertrace (MIT), Aperture (MIT), Limelit (Apache-2.0). Keep LLMs for sentiment and "recommended" only, run only on detected entities (Ansvisor, Lettertrace, both MIT).
4. **Raw-once, derive-many with an extraction revision.** Store the raw provider payload immutably; derived mention/citation rows carry `extraction_revision` and are rebuilt when rules change. Source: Cloro geo-tracker (MIT). Pairs with Serposcope's full-SERP storage and rescan (MIT) so a competitor added later gets historical data.
5. **Visibility score with evidence shrinkage.** If we ship a composite, damp the position term by `mentions / (mentions + k)` so thin samples cannot top the leaderboard. Source: Ansvisor (MIT). Publish the formula; keep one implementation (Ansvisor duplicates it across server and web).
6. **Rank-tracking schema and run guard.** Config / keywords / runs / snapshots, `match_case`, national vs local configs, snapshots without FK to keywords, a partial unique index allowing one active run per config. Source: OpenSEO (MIT).
7. **Cost-aware scheduling.** Admission budget per cron tick sized to DataForSEO rate limits, task_post/task_get with live fallback, wall-clock deadline per tick (OpenSEO, MIT); per-prompt self-rescheduling with singleton keys, no queue retries after paid fan-out, failure backoff (Elmo, MIT); pre-run cost estimate and daily spend caps (Habibi idea only, custom license; goose-aeo MIT has the same idea in code).
8. **Provider abstraction as a target spec.** `engine:provider[:model][:online]` with `access: api|scraped`, so the same engine (e.g. ChatGPT) can be measured through the API or a UI-scrape vendor and compared. Sources: Elmo (MIT), Limelit (Apache-2.0). Keep tracking providers (must support web search/grounding) separate from analysis providers (any cheap model), per Ansvisor's documented OpenRouter limitation.
9. **Prompt design grounded in measurement.** List-style prompts that force named entities (Lettertrace playbook, MIT); keyword to four intent variants: recommendation, comparison, tutorial, procurement (AEO Radar, MIT); persona fan-out (GEO/AEO Tracker, MIT); intent and branded tags with a "commercial only" mode (idea from an AGPL project; re-implement only); N samples per prompt per engine (Habibi idea).
10. **Citation intelligence.** Source-type taxonomy own/competitor/social/informational/other (Limelit), inline-link vs source-panel kinds (OpenCited idea only, no license), fan-out query capture (Cloro, Elmo, NameDrop, all MIT), competitor merge for auto-discovered names (TraceAIO, Apache-2.0), per-prompt target URL cited-hit rate (Lettertrace, MIT), and a calibration endpoint that compares model/search settings without polluting trends (NameDrop, MIT).

Also worth copying as practice: signed, timestamped webhooks with constant-time compare and HMAC-derived callback tokens (Ansvisor, Cloro); AES-256-GCM key envelopes with versioning and `last4` for display (Lettertrace, Ansvisor); hashed API keys with prefix (Ansvisor, TraceAIO); cross-tenant e2e tests (Elmo).

---

# Part E: Anti-patterns observed

**Security**
- No authentication on dashboards that hold provider keys or trigger paid calls: Aperture (documented), AEO Radar, GEO/AEO Tracker API routes (documented), probably Limelit's dashboard bound to all interfaces (INFERRED).
- Plaintext API keys at rest: Aperture (documented).
- File-serving route that can return the database: AEO Radar `/api/screenshot/[...path]` serving `data/aeo.db`; prefix check without separator.
- Rate limiting keyed on a client-controlled `x-forwarded-for` header as the only guard for paid endpoints: GEO/AEO Tracker.
- User-settable model base URLs (Aperture) and site fetchers with regex-only private-host checks (Habibi) are SSRF surfaces. Resolve DNS, block private/link-local/IPv6 ranges, re-check after redirects, and use an egress proxy.
- Optional webhook signatures that default to off: Ansvisor's Cloro callback.
- Session secrets and auth cookies moved over plain HTTP by default: OneGlanse session upload.
- Env-var single-user login with non-constant-time compare, JWT without `exp`, and a cookie lifetime bug: SerpBear.
- Default admin credentials and world-writable config: SEO Panel, which also has public SQLi CVEs.
- Committed `.env.local` (placeholders only today): GetCito.

**Measurement**
- LLM-as-judge for core numbers (OneGlanse, AEO Radar, goose-aeo, Habibi mentions): non-reproducible, drifts with judge model, costs per answer. Use it only for sentiment and qualitative framing, never for "was the brand mentioned".
- Counting domain strings or URLs as brand mentions (Ansvisor counts domains; Lettertrace documents the false positives).
- Additive point heuristics with arbitrary constants (GEO/AEO Tracker) and peer min-max normalisation that shifts when the competitor list changes (OpenCited).
- Single samples per prompt; no confidence interval; treating "AI Overview not shown" as a miss; including branded prompts in visibility.
- Scaling Google volume by one global multiplier and calling it AI volume (Ansvisor).
- Prompts phrased as how-to or "best X for Y" that elicit explanations naming nobody (Lettertrace's measured finding).

**Architecture and operations**
- Rank history as a JSON blob in the keyword row (SerpBear).
- Denormalised arrays of competitors/sources on the response row (TraceAIO, Elmo's early `competitors_mentioned[]`) instead of fact tables.
- Scoring formula duplicated in two codebases with "keep in sync" comments (Ansvisor).
- Queue-level automatic retries after paid requests were already sent (Elmo explicitly avoids this).
- Logged-in consumer-UI automation with anti-detect browsers and residential proxies (OneGlanse, Habibi browser engines, AEO Radar, OpenCited): ToS exposure and account bans. If we need UI-fidelity data, buy it from a vendor that carries that risk (DataForSEO, SearchAPI, Bright Data, Cloro, Olostep), keep an API fallback, and label the access method on every data point.
- Browser-only local-first state for a product whose value is history (GEO/AEO Tracker default mode).
- Monolithic files (80 KB dashboard component; 96 KB provider module).

**Licensing traps**
- README says MIT, no LICENSE file (OpenCited): treat as all rights reserved.
- "Open source" projects under non-OSI licenses that forbid hosting (Habibi).
- AGPL projects (Climby, OSST tracker) are safe to read, unsafe to copy into a hosted product.
- Vendor scraper repos with no license (Cloro's per-engine scrapers).

---

# Source URL index

Repos: https://github.com/ansvisor/ansvisor · https://github.com/letterstory/lettertrace · https://github.com/aryamantodkar/oneglanse · https://github.com/opencited/opencited · https://github.com/moaljumaa/habibi · https://github.com/cloro-dev/geo-tracker · https://github.com/cloro-dev · https://github.com/hellowalt/aeo-radar · https://github.com/anyin-ai/aperture · https://github.com/jakubsuchy/traceaio · https://traceaio.org/ · https://github.com/danishashko/geo-aeo-tracker · https://github.com/limelit-co/open · https://github.com/elmohq/elmo · https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool · https://github.com/metaforismo/spotlightsai · https://github.com/gooseworks-ai/goose-aeo · https://github.com/TheCraigHewitt/namedrop · https://github.com/Marc-Moeller/Climby-AI-SEO · https://github.com/Open-Source-SEO-Tools/ai-visibility-tracker · https://github.com/towfiqi/serpbear · https://github.com/every-app/open-seo · https://github.com/serphacker/serposcope · https://github.com/sendtogeo/Seo-Panel

Key files read (all under `/blob/HEAD/`):
- Ansvisor: `server/src/config/visibility-score.js`, `server/src/lib/response-parser.js`, `server/src/lib/sentiment.js`, `server/src/lib/job-manager.js`, `server/src/lib/openai-tracker.js`, `server/src/lib/volume-analysis.js`, `server/src/lib/cloro-webhook-verify.js`, `server/.env.example`, `supabase/migrations/00001_initial_schema.sql`, `00003_api_keys.sql`, `00010_org_anthropic_keys.sql`
- Lettertrace: `lib/mentions.ts`, `lib/metrics.ts`, `lib/engine.ts`, `lib/llm/index.ts`, `lib/crypto.ts`, `supabase/schema.sql`, `docs/prompt-playbook.md`, `TELEMETRY.md`
- OneGlanse: `README.md`, `.env.example`, `packages/db/clickhouse-init/schema.sql`, `packages/db/drizzle/0000_famous_smiling_tiger.sql`, `packages/services/src/analysis/analysisPrompt.ts`, `packages/services/src/prompt/scheduler.ts`, `packages/services/src/agent/queue.ts`
- OpenCited: `README.md`, `docs/adr/0003-multi-provider-architecture.md`, `packages/db/src/schema/crawlBrandMention.ts`, `promptQueryCrawl.ts`, `crawlReference.ts`
- Habibi: `LICENSE`, `README.md`, `lib/db.ts`, `lib/extract.ts`, `lib/scheduler.ts`, `lib/scrape.ts`
- Cloro geo-tracker: `README.md`, `lib/db/schema.ts`, `lib/extract.ts`, `lib/webhooks.ts`
- AEO Radar: `README.md`, `prisma/schema.prisma`, `prompts/generator-template.md`, `src/pipeline/analyzer.ts`, `web/src/app/api/screenshot/[...path]/route.ts`, `prisma.config.ts`, `.env.example`
- Aperture: `README.md`, `backend/app/models.py`, `backend/app/services/analysis.py`, `backend/requirements.txt`
- TraceAIO: `shared/schema.ts`, `server/services/analyzer.ts`, `package.json`
- GEO/AEO Tracker: `README.md`, `proxy.ts`, `app/api/state/route.ts`, `components/sovereign-dashboard.tsx`
- Limelit: `README.md`, `internal/store/migrations/0001_init.sql`, `internal/secrets/secrets.go`, `internal/httpx/server.go`, `cmd/limelit/main.go`, `deploy/README.md`
- Elmo: `packages/config/src/scrape-targets.ts`, `packages/lib/src/db/migrations/0000_hot_excalibur.sql`, `0011_secrets.sql`, `apps/worker/src/boss.ts`, `apps/worker/src/jobs/process-prompt.ts`; GetCito `LICENSE.md`, `.env.local`; SpotlightsAI `LICENSE.md`, `README.md`
- goose-aeo: `packages/core/src/services/runs/compute-metrics.ts`, `packages/core/src/db/schema.ts`
- NameDrop: `README.md`, `migrations/0001_init.sql`, `src/pages/api/calibrate.ts`
- SerpBear: `database/models/keyword.ts`, `pages/api/settings.ts`, `pages/api/login.ts`, `cron.js`, `utils/scraper.ts`, `.env.example`, `README.md`
- OpenSEO: `README.md`, `src/db/pg/app.schema.ts`, `src/server/features/rank-tracking/services/scheduledRankChecks.ts`, `src/server/features/ai-search/services/brandLookup.ts`, `shareOfVoice.ts`
- Serposcope: `README.md`, `core/src/main/java/com/serphacker/serposcope/db/google/GoogleSerpRescanDB.java`, `GoogleTargetSummaryDB.java`
- SEO Panel: `README.md`; CVE references https://www.strix.ai/cve/CVE-2021-28419 and https://www.acunetix.com/vulnerabilities/web/seo-panel-improper-neutralization-of-special-elements-used-in-an-sql-command-sql-injection-vulnerability-cve-2021-34117/
