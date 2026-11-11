# AI prompt tracking, slice 1: prompts and answers

Status: approved in chat by the owner on 2026-11-11 (scope), written spec awaiting review.
Roadmap: build order step 8 in [29-phase-roadmap.md](../../29-phase-roadmap.md), the first slice of phases 6 and 7 plus the light part of 8 and 9.
Specs this slice takes a subset of: [04](../../04-data-model.md) section 8, [07](../../07-dataforseo-ai-integration.md), [11](../../11-ai-prompt-system.md), [13](../../13-ai-extraction-engine.md), [16](../../16-metrics-methodology.md), [19](../../19-api-specification.md) section 3.7.

## 1. Goal

The owner adds prompts to a project. idraft asks ChatGPT, Gemini and Google AI Mode each prompt once a week, keeps every answer, and shows per prompt and per topic whether the own brand was mentioned, whether the own domain was cited, and how the share of voice splits between the own brand and its competitors. An answer can be opened and read with the brand names and the cited sources marked.

Why this first: every number the later slices add (replicates, intervals, recommendation, sentiment, panels) sits on stored answers and their mentions. Collecting answers early starts the history that cannot be made later.

Rank tracking is on hold (DataForSEO confirmed issues on their side), so nothing here depends on rank checks.

## 2. Scope

In slice 1:

- Prompts: create one, create many by pasting a list, archive. Text is fixed once saved (see section 4.2). Fields: text, language, country, topic (existing taxonomy), importance.
- Engines per project: `chatgpt_web`, `gemini_web`, `google_ai_mode`. Each is off until the owner turns it on in project settings, where the monthly cost estimate is shown first.
- Collection: weekly per active prompt and enabled engine, one answer each (no replicates). A "Run now" button per prompt, through the same queue and budget check as every other collection.
- Storage: every answer in `ai.observations`, the raw provider payload in R2, citations in `ai.citations`.
- Extraction, light: own and competitor mentions by the existing alias matcher, citation domain roles by the existing domain resolver. No recommendation, sentiment, list rank or untracked entity discovery.
- Metrics per prompt, engine and topic over a window (28 days by default): Mentioned, Cited, the four outcomes, Share of voice. Each as a count of valid answers ("4 of 6") with the ratio.
- Screens: Topics & Prompts page (Topics and Prompts tabs), Add prompts dialog, prompt inspector with the answer list, answer viewer, Engines section in project settings.

Out of slice 1 (later slices, named so nothing is lost):

| Left out | Goes to |
|---|---|
| Replicates, Wilson and fixed-panel intervals, period comparison, volatility | Slice 3 |
| Recommendation, structured list rank, prominence, sentiment, untracked entity candidates | Slice 2 |
| Panels (core, discovery, experiment), locking, prompt version screens and restore, text edits | Slice 4 |
| Prompt candidates inbox, keyword to prompt generation and links, alerts | Slice 4 |
| AI Overview column per prompt | Slice 2 (see section 8) |
| Fan-out queries, retrieved-but-not-cited results | Slice 2 |
| LLM Responses official API benchmarks, other engines | Post-MVP |

## 3. Approach

Chosen: all three engines end to end. ChatGPT, Gemini and AI Mode are all `task_post` then `task_get` on the standard queue, so the second and third engine add an adapter and a normalizer each, not a new pipeline. The other options (one engine first, backend before screens) were rejected: they hide each engine's quirks until late and leave the owner with nothing to judge in the app.

Work starts with a spike (section 7) because three DataForSEO endpoints have never been called from this code base and the spec marks S-04 and S-06 as not run.

## 4. Design

### 4.1 Data

Tables exactly as in doc 04 section 8, so no later migration reshapes them:

- Created and used now: `ai.engines` (seeded), `ai.project_engines`, `ai.prompts`, `ai.prompt_versions`, `ai.prompt_terms`, `ai.observations` (monthly partitions), `ai.citations`, `ai.derivations`, `ai.entity_mentions`, `ai.observation_facts`.
- Not created in slice 1: panels, memberships, fan-out, retrieval results, claims, rollups, `core.keyword_prompt_links`.

Columns for later slices (`is_recommended`, `sentiment`, `structured_rank`, `own_prominence` and the like) stay null. Every table carries `workspace_id` and the row-level security policy of the existing tables; the cross-tenant test suite gets the new tables and routes.

Metrics are computed by query over `ai.observation_facts` in slice 1, with no rollup tables. Slice 3 adds `ai.daily_prompt_engine_metrics` when volume needs it (1,000 prompts a week is about 13,000 answers a month, which a query handles).

### 4.2 Prompt text and versions

Every prompt has one `ai.prompt_versions` row (`change_kind = 'initial'`) and observations point at the version, so the history is correct from the first answer. The slice has no way to edit text: to change a prompt, archive it and add a new one. The versions screen and `POST .../versions` come in slice 4 and write rows to the same table.

### 4.3 Collection

A new workload `ai_prompt` implements the existing `Workload` protocol (`collectors/registry.py`): `plan`, `batch_key`, `build_requests`, with ingest following the pattern of `seo_rank_ingest.py`. The pieces:

- Provider adapters in `providers/dataforseo/ai.py`: ChatGPT scraper, Gemini scraper, AI Mode (`task_post` and `task_get`, up to 100 tasks per post), prices in the price book.
- Normalizers (version 1, doc 07 section 5): answer text and markdown, cited sources, status (`complete`, `partial`, `empty`, `refused`, `error`), ads excluded from mentions and citations, refusal and empty detection. Raw payload to R2 as `ai_raw`.
- Planner: one task per active prompt, enabled engine and location, spread through the window like rank checks. The estimate is checked against the `ai_prompt` budget before dispatch; a blocked run shows its estimate and the budget that blocked it.
- Weekly schedule: created per project when the first engine is enabled, using the existing schedules table.
- Run now: `POST /prompts/{prompt_id}/run-now`, a manual run on the standard queue with progress through the existing run state, the same way rank "Check now" works since the accuracy audit. The doc 19 text says live endpoints; the standard queue is chosen because it costs a third as much ($0.0012 against $0.004) and a live call can hold a request for 120 seconds.

### 4.4 Extraction, light

After an observation is stored, in the same worker step:

1. Canonicalize cited URLs (`extraction/urls.py`), resolve domain roles for own, competitor and third party (`extraction/domains.py`).
2. Match the project's entity aliases on the answer text (`extraction/aliases.py`, stages 4 and 5) with their disambiguation.
3. Write `ai.citations`, `ai.entity_mentions` (role, count, first offset, mention order, evidence spans, status) and one `ai.observation_facts` row under the project's current `ai.derivations` row.

An alias or domain change bumps the project's entity configuration version. Re-deriving old answers under the new version is the doc 13 section 6 job and is slice 2; until then the metrics read the derivation current when each answer was stored, and the screen says which entity set a number used.

### 4.5 API

The routes of doc 19 sections 3.7.1, 3.7.4, 3.7.5 and 3.7.6, cut to what slice 1 uses. The OpenAPI contract is written first so the web work can start from mocks.

| Route | Slice 1 |
|---|---|
| `GET/POST {P}/prompts`, `POST {P}/prompts/bulk-create`, `GET/PATCH/DELETE {P}/prompts/{id}` | Yes. `PATCH` changes metadata only; `DELETE` is the archive |
| `POST {P}/prompts/lint` | Brand alias check and length per engine only |
| `GET {P}/engines`, `PUT/DELETE {P}/engines/{code}` | Yes, with `estimated_monthly_cost_usd` |
| `POST {P}/prompts/{id}/run-now` | Yes |
| `GET {P}/ai/observations`, `.../{id}`, `.../{id}/raw` | Yes (mentions and citations in the detail) |
| `GET {P}/ai/prompts-summary` (new, replaces the Prompt Explorer reads of phase 9) | Per prompt and engine: Mentioned, Cited, outcome mix, SOV as `MetricCell`, plus topic rows |
| Versions, panels, candidates, timeline, sizing | No |

Metric cells follow the `MetricValue` contract: `numerator`, `denominator`, `n_observations`, value null when the denominator is 0. `ci` is null in slice 1. Branded prompts are excluded unless `include_branded` is set, as doc 16 rule 4 says. Share of voice is the per-observation form of doc 16 section 5.

Permissions: `data:read` to read, `prompts:write` to change prompts, `projects:write` for engines, `runs:trigger` for Run now, `raw:read` for the raw payload. All existing.

### 4.6 Web

Built from the design preview (`apps/web/design-preview/prompts*.js`, ADR-DS-022) with the real design system components, not copied markup.

- Topics & Prompts page, route `.../ai/prompts`, with the two tabs of ADR-DS-022 that exist in slice 1 (Panels and Versions stay out of the navigation until slice 4): Topics (the default; one row per topic with its prompts under it, a column per enabled engine showing Mentioned and Cited as counts) and Prompts (one row per prompt, filters for topic, country and engine, window control).
- Add prompts dialog: one prompt, or a pasted list with one prompt per line and a shared topic, language and country; shows the lint result and how many will be added against the quota before it saves.
- Prompt inspector: the prompt facts, the per engine counts, the list of answers (date, engine, status, outcome).
- Answer viewer: the answer text with own and competitor mentions marked and the cited sources listed with their role; a link to the raw payload for people with `raw:read`.
- Engines in project settings: three toggles, the cost estimate per engine, a clear note that turning one on starts weekly spend.

The page shows "No data yet" until the first answers arrive, and states the weekly cadence, so an empty table is not read as a failure.

## 5. Errors and limits

- A provider task that fails is retried by the existing ledger rules; an answer that cannot be read is stored with `status = 'error'` and a code, counted in coverage and left out of every rate.
- A prompt over an engine's length limit (700 characters for AI Mode, 2,000 for the scrapers) is skipped for that engine with the reason recorded, and the form warns before saving.
- The quota check uses `max_active_prompts` (1,000 by default). The monthly spend is limited by the `ai_prompt` budget.
- A country with no supported provider location for the engine is rejected when the prompt is saved, not at collection time.

## 6. Testing

- Normalizer fixtures from real payloads captured in the spike, one per engine plus refusal, empty, ads and partial cases.
- Planner and workload tests against the fake provider the existing collectors use; budget block and spread tests.
- Extraction tests on stored fixture answers: mentions with offsets, competitor mentions, citation roles, ad exclusion.
- Route tests with the cross-tenant suite, permission tests, quota and duplicate tests, bulk-create with rejects.
- Web: unit tests for the model and columns, MSW mock handlers for every new route, e2e for add prompts, enable engine, read an answer.
- One real run with 5 prompts on the Eventus Security project once the owner agrees to ship, compared against the same prompts typed by hand into the three products.

## 7. Order of work

Each step is its own task, reviewed by an independent senior reviewer before the next starts.

1. Spike S-04 and S-06: about 20 real calls, about $0.05. Output: captured payloads, the real turnaround, whether ChatGPT cites with web search not forced (the doc 07 section 4.2 rule decides the ChatGPT variant: natural if at least 60% of commercial prompts return citations).
2. Migration 0018 (tables, row-level security, grants, first partitions, partition upkeep) and the engine seed.
3. OpenAPI contract for the routes above, then mock handlers in the web app.
4. Prompts and engines routes.
5. DataForSEO adapters and normalizers.
6. Workload `ai_prompt`, schedule and run now.
7. Light extraction at ingest.
8. Read routes: observations and prompts-summary.
9. Web screens in the order of section 4.6.

Steps 2 to 8 are backend, step 9 and the mock handlers of step 3 are web. They split into two plans so a second session can build the screens from the contract while the backend is built.

## 8. Decisions and open points

Decided:

- Replicates are 1 in slice 1; the column exists, the UI offers no choice.
- No panels in slice 1: every active prompt counts. When panels arrive in slice 4, the core panel is created with every prompt as a member from its creation date, so history stays complete.
- Engines are opt-in per project, because switching one on spends money.
- Run now uses the standard queue.

Open, to settle with the owner:

1. **AI Overview per prompt.** The mock shows it as a fourth engine. It is not an answer idraft asks for; ADR-DS-022 decision 11 reads it from the rank checks of the prompt's primary linked keyword. That needs prompt to keyword links, which are not in slice 1, and the rank data it reads is the data DataForSEO has issues with. Proposed: leave the column out of slice 1 and add it in slice 2 with the links. This differs from the earlier chat summary, which said AI Overview comes free in slice 1.
2. **Which project first.** Proposed: Eventus Security, with 5 to 10 prompts typed by the owner, for the first real run.
3. **Spend before the first run.** Proposed: 5 prompts on 3 engines weekly is about $0.02 a week; the spike is about $0.05 once.
