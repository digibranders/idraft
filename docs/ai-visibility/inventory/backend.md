# AI visibility: backend inventory

Status: written 2026-11-12 by a read-only planning pass on branch `ai/prompts-slice1` (worktree `.claude/worktrees/ai-prompts`, tip `246d3574`). No code was changed and no test was run. Every BUILT row was checked against `backend/openapi/v1.json`, `backend/src/idraft` and migrations 0018 to 0020 at that tip.

Purpose: one list of every backend capability that the specs plan or mention for AI visibility, with its state today, so a plan can schedule all of it and an OpenAPI contract can be written first.

## 0. How to read this

**Paths.** `B` is `backend/src/idraft`, `{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`, `{W}` is `/api/v1/workspaces/{workspace_id}`.

**Sources** (short names used in the tables): doc NN is `docs/NN-*.md`; `S1` the slice 1 design (`docs/superpowers/specs/2026-11-11-ai-prompt-tracking-slice-1-design.md`); `HO` the backend handoff with items B1 to B19 (`docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md`); `RM` the roadmap (`docs/superpowers/plans/2026-11-12-ai-visibility-roadmap.md`); `D1`, `D2`, `D3` the plans of 2026-11-12; `CS` the competitor study (`docs/superpowers/specs/2026-11-12-ai-visibility-competitor-study.md`, ids AP, PR, DB, FO, CI, OP, GA, GD, GF, M, U, N); `SY` the web session synthesis (`nuwtonic-vs-idraft-synthesis.md`, sections 4 and 6) and `GA` its gap analysis (`topics-prompts-gap-analysis.md`, section 3) in the side session notes folder.

**STATUS words.**

| Word | Meaning |
|---|---|
| BUILT | In code at the tip; evidence names the route, file or migration |
| PARTIAL | Some of it is in code; the row says what is missing |
| NOT BUILT | Specified, nothing in code |
| DEFERRED BY OWNER | The owner decided to hold it or move it out of the backend session; the decision is quoted |

**Size** for one Sonnet implementer with an Opus review: S under half a day, M about a day, L several days.

**Risk codes.** `$` provider or LLM spend; `T` tenant isolation (new table or route needs row-level security, grants and the cross-tenant scan in `backend/tests/security/test_cross_tenant.py`); `P` performance at the base plan (150 prompts x 3 engines x 2 runs a week, about 3,900 answers a month, 92 day windows, months of history); `L` provider limits or data quality at DataForSEO.

**Owner decisions already made (2026-11-11 and 2026-11-12).** Quoted where a row depends on them.

| # | Decision | Source |
|---|---|---|
| OD-1 | Slice 1 engines are exactly `chatgpt_web`, `gemini_web`, `google_ai_mode`, each off until enabled per project | S1 section 2 |
| OD-2 | Base plan: 150 active prompts, twice a week, standard queue, 1 answer per engine (`BASE_PLAN`) | S1 section 4.7 |
| OD-3 | Cadence: twice a week (Monday and Thursday) for every prompt; weekly may become a per panel option later | HO section 5 decision 1 |
| OD-4 | A restore is not a `change_kind`: it re-points `current_version_id` and writes an audit entry; `change_kind` is `initial`, `wording`, `typo`, `context` | HO decision 2 |
| OD-5 | `prompt_type` comes from a server rule at create plus a person override (Add dialog and `PATCH`), no LLM. Rule: " vs " or "versus" gives `comparison`, "how to" gives `how_to`, a leading interrogative gives `question`; `filter[prompt_type_in]` on `GET {P}/prompts` | HO decision 3 |
| OD-6 | B5 (entity cells) and B6 (citations aggregate) are slice 2 pre-work, built now | HO decision 4 |
| OD-7 | Weekly series is `include=series` on the summary; the generic metrics routes come later, with the Overview page | HO decision 5 |
| OD-8 | API compression (gzip) and every ops or infrastructure task belong to a separate ops session, not the backend plans | HO decision 6 |
| OD-9 | Backend commits update `backend/openapi/v1.json` only; the web session runs `pnpm gen:api` in its own commit | HO decision 7 |
| OD-10 | Manual run cap stays 20 a day per project (`MANUAL_RUNS_PER_DAY`, `429 manual_run_limit`); D-5 is open for a separate session, current default kept | HO decision 8 |
| OD-11 | Page level AI readiness (W15, robots.txt per AI bot, `llms.txt`, JSON-LD) is NOT opened by the owner: "to be discussed in a separate session, no decision yet; keep the current default meanwhile (not in scope)". It is listed in the specs, so this inventory keeps it as an optional late wave | HO decision 9, RM section 7, CS Q5 |
| OD-12 | Run now uses the standard queue, not live endpoints | S1 section 8 |
| OD-13 | Rank tracking is on hold for DataForSEO side issues; nothing in slice 1 depends on rank checks; AI Overview per prompt goes to slice 2 with keyword links | S1 sections 1 and 8, memory note of 2026-11-11 |
| OD-14 | `chatgpt_web` (natural search) is the default ChatGPT series; `chatgpt_web_forced_search` is not collected unless a project asks | doc 07 section 4.2 (S-04 result) |

**Doc drift found during this pass** (fix in the plan's doc task, not here):

1. Doc 29 Phase 8 "As built (D1)" says `include=series` is not built. It is built (commits `fbbf689a`, `8bccb876`; `include` enum `series`, `entities` in `openapi/v1.json`). `compare=previous_period` on the summary (D1 Task 3, B4) is still not built.
2. The synthesis (AP-03) says `filter[funnel_stage_in]` is built on `GET {P}/prompts`. It is not: the route takes `filter[q]`, `filter[term]`, `filter[intent_in]`, `filter[country_iso]`, `filter[language_code]`, `filter[is_active]`, `cursor`, `limit`.
3. CS section 8 says "gzip is on now"; HO decision 6 and RM say compression is an ops task not yet in place. Treat compression as not in the backend scope (OD-8).
4. Doc 19 line 1246 says `GET {P}/ai/sources/domains` reads `ai.daily_domain_citations`; as built it is a direct query over `ai.citations` (no rollup table exists).
5. Doc 21 section 11 says Run now uses live endpoints; OD-12 chose the standard queue.

---

## 1. PROMPTS (prompt records, lint, bulk, discovery inbox)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-PROMPTS-01 | Tables `ai.prompts`, `ai.prompt_versions` (`change_kind`, `change_reason`, `created_by`, `text_hash`), `ai.prompt_terms` with RLS | doc 04 8.2 | BUILT: migration `0018_ai_prompts.py` | none | done | none | T |
| BE-PROMPTS-02 | `GET {P}/prompts` list with filters `q`, `term`, `intent_in`, `country_iso`, `language_code`, `is_active`, cursor | doc 19 3.7.1 | BUILT: `B/api/ai/prompt_routes.py`, openapi | 01 | done | none | P |
| BE-PROMPTS-03 | `POST {P}/prompts` single create with quota, country check against enabled engine locations, `is_branded` by own alias match | doc 19 3.7.1, S1 5 | BUILT: `prompt_service.py` | 01, ENGINES-01 | done | none | T |
| BE-PROMPTS-04 | `POST {P}/prompts/bulk-create` with `on_duplicate`, created, skipped, rejected | doc 19 3.7.1 | BUILT: openapi `PromptBulkCreate`, `PromptBulkResult` | 03 | done | none | none |
| BE-PROMPTS-05 | `GET/PATCH/DELETE {P}/prompts/{id}` (PATCH metadata only, DELETE is archive) | doc 19 3.7.1, S1 4.5 | BUILT: openapi `PromptPatch` | 01 | done | none | none |
| BE-PROMPTS-06 | `POST {P}/prompts/bulk-archive` by ids, archive or bring back within `max_active_prompts`, up to 1,000, audit entries | doc 19 line 1093, HO B7 | PARTIAL: built by ids only (`PromptBulkArchive` has `ids`, `archive`; D2 Task 6). `filter` body form of doc 19 not built | 01 | S for `filter` | whether the `filter` form is wanted at all | T |
| BE-PROMPTS-07 | `POST {P}/prompts/bulk-update` (topic, intent, importance, funnel, type on many) | doc 19 line 1092 | NOT BUILT | 01 | M | none | T |
| BE-PROMPTS-08 | `POST {P}/prompts/lint`: `contains_brand_alias`, `engine_limit` | doc 19 3.7.1, S1 4.5 | BUILT: `prompt_service.py` lines 226, 241 | 01 | done | none | none |
| BE-PROMPTS-09 | Lint rules `word_count` (5 to 60), `multiple_questions`, `leading_wording`, `language_mismatch`, `contains_competitor_alias` | doc 11 section 4, doc 19 `LintWarning.rule`, HO B17 | NOT BUILT | 08 | M | branded definition: own alias only (backend today) or also competitor aliases (doc 11 table row 1); GA 4.10 | none |
| BE-PROMPTS-10 | `prompt_type` server rule at create (OD-5) | HO B16, doc 11 section 1 | NOT BUILT: create sets what the caller sends; the web sends `question` | 03 | S | decided (OD-5) | none |
| BE-PROMPTS-11 | `filter[prompt_type_in]` on `GET {P}/prompts` | HO B16 | NOT BUILT | 02 | S | decided (OD-5) | none |
| BE-PROMPTS-12 | `filter[funnel_stage_in]`, `filter[importance_in]`, `filter[is_branded]`, `sort` on `GET {P}/prompts` | doc 19 3.7.1 filters, CS AP-03 | NOT BUILT (see drift 2) | 02 | S | who sets funnel stage (CS AP-03, open) | none |
| BE-PROMPTS-13 | `filter[panel]`, `panel_ids` on prompts | doc 19 3.7.1, HO B10 | NOT BUILT | PANELS-01 | S | none | none |
| BE-PROMPTS-14 | `context_preamble` (persona preamble) stored per version and sent with the text | doc 11 sections 1, 2, 4 | NOT BUILT (no column in 0018 `prompt_versions`; check before planning) | VERSIONS-02 | M | whether personas are in scope before panels | none |
| BE-PROMPTS-15 | `expected_frequency`, `source`, `creation_method` provenance fields | doc 11 section 1 | PARTIAL: `source`, `creation_method` in `Prompt` schema; `expected_frequency` not exposed | 01 | S | none | none |
| BE-PROMPTS-16 | Active prompt quota meter for the page header (used and limit) | CS AP-17, PR-12 | PARTIAL: `PromptLintResponse.quota` (`limit`, `used`) exists; no read on `GET {P}/prompts` meta | 02 | S | none | none |
| BE-PROMPTS-17 | `POST {P}/prompts/from-keywords/preview` (template generation, no LLM) | doc 19 line 1095, doc 11 5.3, HO B18 | NOT BUILT | BILLING-PLAN-LINKS-01 | M | slice 4 timing | none |
| BE-PROMPTS-18 | Table `ai.prompt_candidates` (inbox) with RLS | doc 11 5.2, doc 04 15 | NOT BUILT | 01 | M | slice 4 / Ph 11 timing | T |
| BE-PROMPTS-19 | `GET {P}/prompt-candidates`, `PATCH .../{id}`, `POST .../decide` (accept, reject, snooze, add to panel) | doc 19 3.7.3 | NOT BUILT | 18, PANELS-01 | L | none | T |
| BE-PROMPTS-20 | `POST {P}/prompt-candidates/generate` (templates, then budgeted LLM variants) | doc 19 3.7.3, doc 11 5.3 | NOT BUILT | 18, OPS-11 | L | whether LLM variants are allowed (spend) | $ |
| BE-PROMPTS-21 | `POST {P}/prompt-candidates/uploads` (CSV of questions, 30 day file retention) | doc 19 3.7.3, doc 11 5.1 | NOT BUILT | 18, EXPORT-05 | M | none | T |
| BE-PROMPTS-22 | Candidate sources: PAA and related searches from stored SERPs, GSC question queries, fan-out questions, competitor keywords | doc 11 5.1 | NOT BUILT | 18, FANOUT-01, rank data | L | PAA source depends on rank data (OD-13) | L |
| BE-PROMPTS-23 | Near-duplicate detection (trigram >= 0.8) for candidates and add | doc 11 3.1 and 5.2, CS AP-09 | NOT BUILT (exact duplicate only, `on_duplicate`) | 18 | M | none | P |
| BE-PROMPTS-24 | Modeled AI demand on candidates (`seo.ai_demand_snapshots`, AI Keyword Data endpoint), labeled, sort only | doc 07 8, doc 11 7 | NOT BUILT | BILLING-PLAN-LINKS-01 | M | spend approval | $ L |
| BE-PROMPTS-25 | Prompt metadata audit log entries (metadata changes are not versions) | doc 11 2 rule 5 | BUILT: audit entries on PATCH and bulk archive (D2 as built note) | 05 | done | none | none |

Narrative. The record layer is complete for slice 1. What is missing is small and mostly filters (`prompt_type`, funnel stage, importance, panel) plus the `prompt_type` rule the owner decided (OD-5), the five extra lint rules (needs one definition decision: branded means own brand only, as the backend does now), and the whole discovery inbox (slice 4, Phase 11). The inbox is the largest item here and the one with spend risk (LLM variants, modeled demand). `context_preamble` does not appear in migration 0018 and needs a migration if personas come before panels.

## 2. TOPICS (taxonomy scope and topic rows)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-TOPICS-01 | Prompts take topic terms (`term_ids` on create and patch), `ai.prompt_terms` | doc 04 5.3, 8.2 | BUILT: `PromptCreate.term_ids`, `PromptPatch.term_ids` | PROMPTS-01 | done | none | T |
| BE-TOPICS-02 | `POST {P}/term-assignments` with `subject_type: 'prompt'` | doc 19 3.5 | PARTIAL: route built for keywords; doc 19 as built says `subject_type_not_supported` for prompts until prompts exist. Check whether plan A enabled it | PROMPTS-01 | S | none | T |
| BE-TOPICS-03 | `TermNode.prompt_count` on vocabulary term trees | doc 19 3.5 | NOT BUILT (as built note: left out until prompts exist); verify | 01 | S | none | P |
| BE-TOPICS-04 | Topic rows in the summary, prompt weighted, rolled up to ancestors | doc 16 4, S1 4.5 | BUILT: `TopicSummaryRow`, `summary.py` | METRICS-01 | done | none | none |
| BE-TOPICS-05 | `filter[term]` subtree scope on summary, citations, sources, fan-out | HO B2, D1 Task 2 | BUILT: `term_subtree` helper, query param on all five routes | 04 | done | none | P |
| BE-TOPICS-06 | Topic tree of two levels with rollup note (Topics tab, D-3) | RM stage 0 | BUILT on the web from API rows; backend unchanged | 04 | none | decided (D-3) | none |
| BE-TOPICS-07 | One vocabulary shared by keyword topics and prompt topics (check) | RM risk 2, HO B9a | NOT BUILT as a check: unverified, "a grep and one query on `core.taxonomy_terms`" | 01 | S | none | none |
| BE-TOPICS-08 | SEO per topic, counts and Top 10 (B9a) | HO B9a | BUILT for the web through `GET {P}/tracked-keywords` with `filter[term]`, `filter[rank_lte]`; no backend work | 07 | none | none | L (rank data) |
| BE-TOPICS-09 | `GET {P}/seo/metrics/breakdown?dimension=term` with volume weighted visibility (B9b) | HO B9b, doc 19 line 1060, doc 09 | NOT BUILT | 07, CTR curves (`ops.ctr_curves`, doc 09 6.3) | M | rank data is on hold (OD-13) | L P |
| BE-TOPICS-10 | Topic detail `GET {P}/topics/tree`, `GET {P}/topics/{termId}` (Topic Explorer data) | doc 20 5.11 | NOT BUILT; superseded by the Topics tab (ADR-DS-022), likely not needed | 04 | none | confirm the routes are dropped | none |
| BE-TOPICS-11 | Pages repeatedly influencing a topic (cited in at least 25% of a topic's answers in each of the last 4 windows) | doc 14 6, doc 20 5.11 | NOT BUILT | SOURCES-02 | M | none | P |
| BE-TOPICS-12 | Fan-out queries grouped by the originating prompt's topic | CS FO-11, doc 16 F4 | PARTIAL: `filter[term]` on `GET {P}/ai/fanout-queries` scopes by topic; no per topic grouping | FANOUT-01 | S | none | none |

Narrative. Topic scoping is done everywhere it is needed for slice 1 and D2. Open items are the prompt side of the generic taxonomy routes (assignments and term counts; verify, they may already have been switched on in plan A), the vocabulary check before the web adds topic SEO columns, and the volume weighted SEO visibility per topic, which waits on rank data.

## 3. ENGINES (registry, project engines, provider coverage)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-ENGINES-01 | `ai.engines` registry seeded with `chatgpt_web`, `gemini_web`, `google_ai_mode` (class, vendor, `exposes_citations`, `exposes_fanout`, `max_prompt_chars`, location types) | doc 04 8.1, doc 07 1 | BUILT: `B/domain/ai_engines.py`, seed in 0018 | none | done | none | none |
| BE-ENGINES-02 | `ai.project_engines` with `is_enabled`, `location_ids`, `replicates`, provider mode | doc 04 8.1 | BUILT: 0018, `ProjectEngine` | 01 | done | none | T |
| BE-ENGINES-03 | `GET {P}/engines`, `PUT/DELETE {P}/engines/{code}` with `estimated_monthly_cost_usd`, `active_prompts` | doc 19 3.7.4 | BUILT: `B/api/ai/engine_routes.py` | 02, OPS-03 | done | none | $ |
| BE-ENGINES-04 | AI schedule created on first enable (two windows a week, Monday and Thursday) | S1 4.3, OD-3 | BUILT: `B/ai/schedule.py` `AI_SCHEDULE` | 03 | done | decided (OD-3) | $ |
| BE-ENGINES-05 | `chatgpt_web_forced_search` engine (separate series, never mixed) | doc 07 1 and 4.2 | NOT BUILT (not seeded); OD-14 says only on project request | 01 | S | only if a project asks | $ |
| BE-ENGINES-06 | `google_ai_overview` engine row (`serp_ai`, keyword level, collected with rank checks) | doc 07 1, ADR-DS-022 decision 11, HO B13 | NOT BUILT: no `google_ai_overview` code anywhere in `B` | AIO-01 | S | slice 2 start (OD-13) | L |
| BE-ENGINES-07 | Official API engines `openai_api_search`, `anthropic_api_search` (Claude), `perplexity_api`, `gemini_api_grounded`, `xai_api_search` (class `official_api`, never pooled) | doc 07 1 and 3.4, doc 05, Ph 14 | NOT BUILT; `TaskWorkload.AI_BENCHMARK` enum value exists only | COLLECT-14 | L | Ph 14, benchmark budget (S-16) | $ L |
| BE-ENGINES-08 | Consumer surfaces not on DataForSEO: `perplexity_web`, `copilot_web`, `claude_web` (registered inactive), fallback adapter (SearchAPI.io) | doc 07 1, doc 05 5 | NOT BUILT | 01 | L | which fallback provider, cost | $ L |
| BE-ENGINES-09 | Microsoft Copilot through the Bing SERP `ai_overview` element | doc 07 1, doc 29 Ph 15 | NOT BUILT | 01, AIO-02 | L | Ph 15 | L |
| BE-ENGINES-10 | Device per engine (`provider_params.device`, AI Mode only) | doc 11 1 | NOT BUILT as a setting (engines send desktop) | 02 | S | none | none |
| BE-ENGINES-11 | Pinned model version per official API engine, model change makes a version boundary | doc 07 3.4 | NOT BUILT | 07 | M | Ph 14 | L |
| BE-ENGINES-12 | Engine coverage note per country (location types per engine) used to refuse a country at save | S1 5, CS AP-11 | BUILT: `location_types` in `ai_engines.py`, refusal at save | 01 | done | none | none |

Provider coverage today (OD-1): ChatGPT (consumer, natural search), Gemini (consumer), Google AI Mode. Not in scope today: AI Overview per prompt (slice 2, needs keyword links), Perplexity, Copilot, Claude, Grok, Llama, official APIs (Ph 14), forced search ChatGPT (on request). The studied tool covers six engines (CS N1); doc 05 keeps official API engines as a separate class that is never pooled with consumer engines.

## 4. COLLECT (planning, providers, ingest, runs)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-COLLECT-01 | DataForSEO adapters: ChatGPT scraper, Gemini scraper, AI Mode, `task_post` up to 100 tasks, `task_get` | doc 07 3, S1 4.3 | BUILT: `B/providers/dataforseo/ai.py` | ENGINES-01 | done | none | $ L |
| BE-COLLECT-02 | Normalizers v1: text, markdown, sources, status (`complete`, `partial`, `empty`, `refused`, `error`), ads excluded, refusal and empty detection | doc 07 5 | BUILT: `B/providers/dataforseo/ai_parse.py` | 01 | done | none | L |
| BE-COLLECT-03 | Raw payload to R2 as `ai_raw` with SHA-256, `answer_hash` on the observation | doc 07 6, CS L4 | BUILT: `B/storage/raw.py`, `ai_prompt_ingest.py` | 02 | done | none | T |
| BE-COLLECT-04 | `provider_extras` (fan-out list, `search_results` count, `brand_entities`, ads) bounded at 16 KB with `truncated` | doc 07 2, HO B19 | BUILT: 0018 check, `ai_parse._bounded` | 02 | done | measure how often the bound cuts (Q2) | L |
| BE-COLLECT-05 | Workload `ai_prompt`: plan per active prompt, enabled engine, location in the prompt's country, spread in the 8 hour window, budget check before dispatch | S1 4.3, doc 21 2 | BUILT: `B/collectors/ai_prompt.py` `AiPromptWorkload` | 01 | done | none | $ P |
| BE-COLLECT-06 | Ingest tick `ai_prompt_ingest` (30 s): observation, citations, mentions, fact row in one transaction; unreadable answer stored as `error` | doc 21 as built | BUILT: `B/collectors/ai_prompt_ingest.py`, `B/worker/assembly.py` | 05 | done | none | P |
| BE-COLLECT-07 | `POST {P}/prompts/{id}/run-now` on the standard queue, 20 manual runs a UTC day, monthly answer quota | doc 19 3.7.5, S1 4.3 | BUILT: `prompt_routes.py`, `B/api/operations/runs.py` `MANUAL_RUNS_PER_DAY = 20` | 05 | done | OD-10 | $ |
| BE-COLLECT-08 | `POST {P}/ai/runs` bulk run, up to 150 prompts as ONE manual run, `meta.skipped` reasons, `422 nothing_to_run` | HO B7 | BUILT: openapi `RunBulk`, `RunBulkMeta`; D2 Task 5 | 07 | done | the cap itself (D-5) is open; current default kept (OD-10) | $ |
| BE-COLLECT-09 | Runs and run detail with `manual_runs_today`, estimated and actual cost, blocked by budget | doc 19 3.11.4 | BUILT: `GET {P}/runs`, `GET {P}/runs/{id}`, `RunPageMeta` | 05 | done | none | none |
| BE-COLLECT-10 | `GET {P}/runs/{run_id}/ai-coverage` (per engine valid of planned) | doc 19 3.7.5 | NOT BUILT | 09 | S | none | none |
| BE-COLLECT-11 | Replicates 1 to 5 per engine, priority subset (importance 1) with 3, 3, 1, spacing 20 minutes | doc 07 4.1, doc 11 8 | NOT BUILT: `replicates` column exists, planner sends 1 (S1 decision) | 05, STATS-01 | M | spend and whether replicates are bought at all (spike S-05 not run) | $ P |
| BE-COLLECT-12 | Workload `ai_mode_keyword`: AI Mode on tracked keywords of opt-in groups, weekly | doc 21 2, doc 11 6 | NOT BUILT: enum value only (`B/domain/workloads.py`) | 05, rank tracking | M | rank on hold (OD-13) | $ L |
| BE-COLLECT-13 | Live answers (`live_call`, up to 120 s) | doc 21 5.2 | DEFERRED BY OWNER: OD-12 chose the standard queue for Run now | 05 | none | decided | $ |
| BE-COLLECT-14 | Workload `ai_benchmark` for official APIs (LLM Responses), weekly on 100 core prompts | doc 21 2, doc 07 3.4, doc 11 8 | NOT BUILT | ENGINES-07 | L | Ph 14 | $ L |
| BE-COLLECT-15 | `superseded_by` on observations and its use (re-ingest after normalizer change) | doc 04 8.3, doc 13 6 | PARTIAL: column and partial index (0020) exist and the summary leaves superseded answers out; nothing sets it yet | EXTRACT-10 | S | none | none |
| BE-COLLECT-16 | Monthly partitions of `ai.observations`, `ai.citations`, `ai.entity_mentions`, `ai.observation_facts` and their upkeep | doc 04 12 | BUILT: registered in `ops.partitioned_tables` (0018 line 358) | none | done | none | P |
| BE-COLLECT-17 | Raw read `GET {P}/ai/observations/{id}/raw` through `ai.observation_raw()` (`raw:read`) | doc 19 3.7.6 | BUILT: 0018 function, openapi | 03 | done | none | T |
| BE-COLLECT-18 | Probe of how the AI endpoints read `+` and `%` in a prompt | doc 29 Ph 7 as built, `docs/ops/ai-first-run.md` | NOT BUILT as a test; listed in the first run guide | 01 | S | first real run date | L |
| BE-COLLECT-19 | Dev seed of the Eventus Security project (72 prompts, 3 countries, schedules paused) | D3 | BUILT: `B/devseed/`, `python -m idraft.cli seed-eventus` | 03, ENGINES-03 | done | none | $ (dev only, guarded) |
| BE-COLLECT-20 | Acceptance at full capacity: two consecutive runs of 150 prompts x 3 engines with at least 95% valid, costs within 10% | doc 29 Ph 7, S1 6 | NOT BUILT (no real run yet; needs "ship it") | 05 | M | the owner's go for real spend (about $0.54 a full run) | $ L |
| BE-COLLECT-21 | DataForSEO LLM Mentions dataset snapshots (`ai.external_mention_snapshots`), labeled third party, never in our rates | doc 07 9, doc 04 15.1 | NOT BUILT | none | M | Ph 13, spend ($0.1 a request plus rows) | $ T |

Narrative. Collection is end to end for the three engines on the standard queue, with Run now and the bulk run counted as one manual run each. What remains is replicates (needs spike S-05 and a spend decision), the AI Mode keyword workload and the AI Overview path (both wait on rank data), the per run coverage read, and the later engine classes. The first real full capacity run has not been made; it is the acceptance gate of Phase 7.

## 5. EXTRACT (mentions, citations roles, derivations)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-EXTRACT-01 | Stage 1 URL canonicalization into `core.urls` and `core.domains` | doc 13 stage 1, doc 14 3 | BUILT: `B/extraction/urls.py` | none | done | none | none |
| BE-EXTRACT-02 | Stage 2 domain role (own, competitor, third party) per citation | doc 13 stage 2 | BUILT: `B/extraction/domains.py` | 01 | done | none | none |
| BE-EXTRACT-03 | Stage 3 document structure (markdown blocks, inline marker mapping to `answer_block_index`, `first_char_offset`) | doc 13 stage 3 | NOT BUILT: columns exist; markdown parsing not done (link targets are blanked only) | none | M | none | none |
| BE-EXTRACT-04 | Stages 4 and 5 alias matching (Aho-Corasick, RE2) and disambiguation, UTF-16 offsets | doc 13 stages 4, 5 | BUILT: `B/extraction/aliases.py`, `ai_facts.py` | none | done | none | P |
| BE-EXTRACT-05 | Stage 7 mention assembly: count, first offset, `mention_order`, prominence, evidence spans, status | doc 13 stage 7 | PARTIAL: count, offset, order, spans, status built; `prominence` per entity: check `entity_mentions` (fact `own_prominence` exists in schema); structured rank fields null | 04 | S | none | none |
| BE-EXTRACT-06 | `ai.entity_mentions`, `ai.observation_facts`, `ai.derivations` written under the current derivation | doc 13 5 and 6 | BUILT: 0018, 0019 (mention order nullable) | 04 | done | none | T |
| BE-EXTRACT-07 | `ai.citations` with `citation_index`, `occurrences`, `domain_role`, `role_entity_id`, `citation_kind`, `referral_tag` | doc 14 2 | BUILT: 0018, `CitationOut` | 02 | done | none | T |
| BE-EXTRACT-08 | Validity rule (`is_valid` false for error, refused, empty, under 40 chars, truncated) | doc 13 5 | BUILT: `observation_facts.is_valid` | 06 | done | none | none |
| BE-EXTRACT-09 | Entity config version bump on alias, entity or role change | doc 19 3.4, S1 4.4 | BUILT in part: `entity_config_versions` in the summary response; `meta.rederivations` left out (doc 19 as built) | 06 | done | none | none |
| BE-EXTRACT-10 | Re-derivation job `rederive_range` (last 90 days on entity change, 30 days on extractor upgrade), flips `is_current` | doc 13 6, doc 21 5.2 | NOT BUILT (slice 2 per S1 4.4) | 06, OPS-08 | L | slice 2 timing | P |
| BE-EXTRACT-11 | `GET {P}/ai/derivations`, `GET/POST {P}/ai/rederivations`, `GET .../{derivation_log_id}` and table `ops.derivation_log` | doc 19 3.7.8, doc 04 7 | NOT BUILT (no `ops.derivation_log` migration) | 10 | M | none | T |
| BE-EXTRACT-12 | `POST {P}/ai/extraction/preview` (run the extractor on given text without storing) | doc 19 3.7.8 | NOT BUILT; `POST {P}/alias-test` covers alias matching only | 04 | S | none | none |
| BE-EXTRACT-13 | `GET {P}/ai/observations/{id}/derivations` | doc 19 3.7.6 | NOT BUILT | 11 | S | none | none |
| BE-EXTRACT-14 | `POST {P}/alias-test` with `observation_id` (test aliases on a stored answer) | doc 19 3.4 as built | NOT BUILT: as built note says no `observation_id` until observations exist; verify | 06 | S | none | T |
| BE-EXTRACT-15 | Stage 8 untracked entity candidates into `ai.entity_candidates` (list leads, vendor domains, proper noun chunker) | doc 13 stage 8 | NOT BUILT (table not in 0018) | 03 | L | slice 2 | T P |
| BE-EXTRACT-16 | `ai.citation_entity_links` (citation in the same block as a mention, method `same_block`) | doc 14 2, doc 04 15.1 | NOT BUILT | 03 | M | Ph 9 or 13 | T P |
| BE-EXTRACT-17 | AI gold set with doc 13 section 7 targets as merge gates | doc 29 Ph 8, doc 26 4 | NOT BUILT (fixture tests only) | 04 | L | who labels the gold set | none |
| BE-EXTRACT-18 | Showing which entity set a number used (version boundary on SOV when competitors change) | S1 4.4, doc 16 5 | PARTIAL: `entity_config_versions` returned; no boundary markers in series | 09, STATS-07 | M | none | none |

Narrative. Slice 1 light extraction is done and keeps evidence spans with UTF-16 offsets. The heavy pieces for slice 2 are the markdown structure stage (needed by structured rank, recommendation and citation markers), re-derivation with its job and log table, and entity candidates. These three unlock most of RECOMMEND and COMPETITORS. The gold set is the quality gate doc 29 asks for before Phase 8 acceptance.

## 6. METRICS (summary and metric routes)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-METRICS-01 | `GET {P}/ai/prompts-summary`: per prompt and engine Mentioned, Cited, outcome mix, Share of voice as `MetricCell`, topic rows, `include_branded` | S1 4.5 | BUILT: `B/api/ai/summary*.py` | EXTRACT-06 | done | none | P |
| BE-METRICS-02 | `last_observed_at`, `last_valid_at` on prompt and topic rows (B1) | HO B1 | BUILT: `6d681a54` | 01 | done | none | none |
| BE-METRICS-03 | Scope `filter[country_iso]`, `filter[term]`, `branded_only` (B2) | HO B2 | BUILT: `601bd4cc`, openapi params | 01 | done | none | none |
| BE-METRICS-04 | `include=series` weekly cells per engine (B3) | HO B3, OD-7 | BUILT: `fbbf689a` (see drift 1) | 01 | done | decided (OD-7) | P (response size, OD-8) |
| BE-METRICS-05 | `compare=previous_period` with `previous` cells and `compare_window` (B4) | HO B4, D1 Task 3 | NOT BUILT: no `compare` param on the summary | 01 | M | none (D1 contract written) | P |
| BE-METRICS-06 | `compare=previous_year`, `compare_from`, `compare_to` | doc 19 2.5 | NOT BUILT (D1: `previous_year` is `422`) | 05 | S | none | none |
| BE-METRICS-07 | `include=entities` per tracked entity cells (B5, at most 20 entities) | HO B5, OD-6 | BUILT: `41586c30`, `EntityCells` | 01 | done | decided (OD-6) | P |
| BE-METRICS-08 | `GET {P}/ai/metrics/overview` (Overview AI block: A1, A2, A5, A7, A8 per engine) | doc 19 3.7.9, doc 20 5.2 | NOT BUILT | 01, SOURCES-02 | M | OD-7 says later, with the Overview page | P |
| BE-METRICS-09 | `GET {P}/ai/metrics/{metric}` returning `MetricValue` (registry keys of doc 16 2.1) | doc 19 3.7.9, doc 16 2 | NOT BUILT | 08 | M | none | none |
| BE-METRICS-10 | `GET {P}/ai/metrics/{metric}/series` (granularity day, week, month) | doc 19 3.7.9 | NOT BUILT (summary series covers W11) | 09 | M | OD-7 | P |
| BE-METRICS-11 | `GET {P}/ai/metrics/{metric}/breakdown?dimension=` topic, intent, funnel, engine, country, language, persona, prompt type | doc 19 3.7.9, doc 16 4 | NOT BUILT | 09 | M | none | P |
| BE-METRICS-12 | `GET {P}/ai/prompt-explorer`, `GET {P}/ai/prompt-explorer/{prompt_id}` | doc 19 3.7.9, doc 11 9 | DEFERRED BY OWNER: S1 4.5 says the summary "replaces the Prompt Explorer reads of phase 9" | 01 | none | decided (S1) | none |
| BE-METRICS-13 | Mention and citation rate (A3), citation rate among answers with citations | doc 16 A2, A3 | PARTIAL: outcome mix gives A3; the "among answers with citations" denominator is not returned | 01 | S | none | none |
| BE-METRICS-14 | Citation share (A8, own units over all units) | doc 16 A8 | PARTIAL: `SourcesMeta.by_role` and `source_share` give it per domain; no own citation share cell in the summary | SOURCES-01 | S | none | none |
| BE-METRICS-15 | First mention rate (A12) from `own_mention_order = 1` | doc 16 A12 | NOT BUILT as a cell (column stored) | 01 | S | none | none |
| BE-METRICS-16 | Mention count share (`ai.mention_count_share`, exports only, labeled) | doc 16 5 | NOT BUILT | EXPORT-01 | S | none | none |
| BE-METRICS-17 | SOV including untracked mentions (uses `ai.entity_candidates`) | doc 16 5 | NOT BUILT | EXTRACT-15 | M | none | none |
| BE-METRICS-18 | Rollup `ai.daily_prompt_engine_metrics` (counts and sums, per entity) with `rollup_ai_day` job | doc 04 8.7, doc 16 13.1, doc 21 5.2 | NOT BUILT: S1 4.1 "computed by query over `ai.observation_facts` in slice 1"; slice 3 adds it when volume needs it | EXTRACT-06 | L | when to add (volume trigger) | P T |
| BE-METRICS-19 | Denominator view `ai.daily_prompt_engine_denominators` | doc 16 13.3 | NOT BUILT | 18 | S | none | none |
| BE-METRICS-20 | Metric caching and budgets (doc 16 13.4) | doc 16 13.4 | NOT BUILT | 09 | M | none | P |
| BE-METRICS-21 | Fan-out per answer mean (F2) and presence rate (F1) per prompt | doc 16 F1, F2, CS FO-14, FO-16 | PARTIAL: `fanout_count` on `ObservationSummary`; `FanoutMeta.answers_with_fanout`, `answers`; no per prompt cell in the summary | FANOUT-01 | S | none | none |
| BE-METRICS-22 | Country and language breakdown of every rate (M-11) | CS M-11, doc 16 4 | PARTIAL: country filter on the summary (B2); no breakdown by country in one read | 11 | S | none | none |
| BE-METRICS-23 | Response compression for large `include` reads | D1 open point 3, RM risk | DEFERRED BY OWNER: OD-8, ops session | 04, 07 | none | decided | P |
| BE-METRICS-24 | Data reads behind each AI Overview card and number (LAYOUTS-08): `ai.by_engine` and the AI numbers from METRICS-08; `ai.mention_trend` from METRICS-10 (or the summary `include=series` as an interim); `ai.citation_share_by_domain_type` from SOURCES-08 categories; `competitors.share_of_voice` and `competitors.summary` from COMPETITORS-03; `activity.key_changes` from REPORTS-02 (needs STATS-06); `activity.collection_status` from `GET {P}/runs` plus COLLECT-10; extra cards of the greater Overview from SOURCES-02, FANOUT-01, COMPETITORS-05, SOURCES-04, RECOMMEND-06 | LD 7.1, 7.2, doc 20 5.2, RM W13 | PARTIAL: interim data exists for by engine, trend, top domains, fan-out, new sources and collection status through the summary, sources, fan-out and runs routes; no overview route, no category data, no competitor route, no key changes | METRICS-08, 10, SOURCES-08, COMPETITORS-03, REPORTS-02 | M (overview route) plus S per card | the card list of the greater Overview | P |
| BE-METRICS-25 | `GET {P}/ai/stats/compare` for the Overview deltas (period change with paired interval and `is_detectable`) | doc 19 3.7.9, doc 16 V7 | NOT BUILT (route detail is STATS-05; the summary's own `compare` is METRICS-05) | METRICS-05, STATS-02 | M | none | P |

Overview aggregate routes of doc 19 3.7.9 at a glance (all `data:read`, Phase 9, none in `openapi/v1.json`): `GET {P}/ai/metrics/overview` (METRICS-08), `GET {P}/ai/metrics/{metric}` (METRICS-09), `GET {P}/ai/metrics/{metric}/series` (METRICS-10), `GET {P}/ai/metrics/{metric}/breakdown` (METRICS-11), `GET {P}/ai/stats/compare` (METRICS-25, STATS-05). OD-7 places them with the Overview page; the new layout requirement makes that page a customizable dashboard, so these routes become the first backend items of the Overview wave.

Narrative. The summary route carries slice 1 and most of the slice 2 pre-work. The one D1 task left is `compare=previous_period` (B4). The generic metric routes (overview, metric, series, breakdown) are deliberately later (OD-7) and come with the Overview page; the Prompt Explorer routes are replaced by the summary. The rollup table is the main performance lever and is planned for slice 3 when volume needs it: at 3,900 answers a month and 92 day windows the direct query is measured as enough in D1 and D2.

## 7. SOURCES (citations aggregate and source intelligence)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-SOURCES-01 | `GET {P}/ai/citations` cursor list, filters engine, prompt, term, role, registrable domain, url, branded; hardened cursor | doc 19 3.7.7, HO B6 | BUILT: openapi `CitationRow`, `CitationPage`; D2 Task 2 | EXTRACT-07 | done | none | T P |
| BE-SOURCES-02 | `GET {P}/ai/sources/domains` by registrable domain: units, observations, prompts, per engine, `source_share`, sorts | doc 19 3.7.7, doc 16 C1, C2, HO B6 | BUILT: `SourceDomainRow`, `SourcesMeta`; D2 Task 1 | 01 | done | none | P |
| BE-SOURCES-03 | `GET {P}/ai/sources/pages` by page with title, host | doc 19 3.7.7 | BUILT: `SourcePageRow`; D2 Task 2 | 01 | done | none | P |
| BE-SOURCES-04 | `compare=previous_period` on sources for New markers (C5), `previous` per row | doc 16 C5, HO B6 step 2 | BUILT: `compare` param, `SourceDomainRow.previous`; D2 Task 3 | 02 | done | none | none |
| BE-SOURCES-05 | Lost sources (C6: `min_support` then 0 for 2 full windows) | doc 16 C6, doc 14 8 | NOT BUILT | 04 | M | none | P |
| BE-SOURCES-06 | `GET {P}/ai/sources/changes` (new and lost list with `min_support`) | doc 19 3.7.7 | NOT BUILT (new via compare only) | 04, 05 | M | none | P |
| BE-SOURCES-07 | Source diversity (C3: distinct domains, effective number of sources), `GET {P}/ai/sources/diversity` | doc 16 C3, doc 19 3.7.7 | NOT BUILT | 02 | S | none | none |
| BE-SOURCES-08 | Domain categories in the source reads, `filter[category_in]`, `GET {P}/ai/sources/categories` (C4) | doc 14 4, doc 19 3.7.7 | PARTIAL: `core.domain_categories` table and `GET /api/v1/domain-categories` built (0010); domains carry no category data yet; no category route | 02 | M | category seed list source | none |
| BE-SOURCES-09 | Category classification pipeline: seed list of 2,000 domains, rules (`.gov`, `.edu`, `docs.`), budgeted LLM classification | doc 14 4 | NOT BUILT | 08, OPS-11 | L | LLM spend, who curates the seed list | $ |
| BE-SOURCES-10 | Workspace category overrides `core.workspace_domain_categories`, `GET/PUT/DELETE {W}/domain-category-overrides` | doc 19 3.7.7, doc 04 15.1 | NOT BUILT | 08 | M | permission (`entities:write` proposed, doc 20 11) | T |
| BE-SOURCES-11 | `GET {P}/ai/sources/domains/{domain_id}` detail (pages, prompts, engines, trend) | doc 19 3.7.7 | NOT BUILT; partly served by `filter[registrable_domain]` on pages and citations | 02 | S | none | none |
| BE-SOURCES-12 | Competitor source overlap (C7 Jaccard), `GET {P}/ai/sources/competitor-overlap` (M-05 source gap) | doc 16 C7, doc 19 3.7.7, CS M-05 | NOT BUILT | 02, EXTRACT-06 | M | none | P |
| BE-SOURCES-13 | Retrieved but not cited (C8, ChatGPT), table `ai.retrieval_results`, `GET {P}/ai/sources/retrieved-not-cited` | doc 16 C8, doc 04 8.4, doc 19 3.7.7, CS FO-07 | NOT BUILT: only the `search_results` count is stored; the list is dropped by the normalizer | COLLECT-02 | L | slice 2 timing; storage growth | P T |
| BE-SOURCES-14 | `GET {P}/ai/sources/influential-pages` (pages repeatedly influencing a topic) | doc 19 3.7.7, doc 14 6 | NOT BUILT | TOPICS-11 | M | none | P |
| BE-SOURCES-15 | Publishers `core.publishers`, `core.publisher_domains`, `GET /api/v1/publishers` | doc 14 2, doc 19 3.7.7 | NOT BUILT | 08 | M | who maintains the publisher list | none |
| BE-SOURCES-16 | Publisher opportunities (doc 14 7: `opportunity_d`, `reach_d >= 3`), `GET {P}/opportunities/publishers` | doc 14 7, doc 19 3.8.3, CS OP-04 to OP-10 | NOT BUILT | 02, EXTRACT-06 | M | none | P |
| BE-SOURCES-17 | Opportunity task status (todo, done, owner) for a condition row | CS OP-12 | NOT BUILT (NEW, needs a small table) | 16 | M | in scope at all (NEW) | T |
| BE-SOURCES-18 | `ai.project_source_stats` (first seen, last seen, counts, nightly recount) | doc 14 2 | NOT BUILT: `first_seen_at`, `last_seen_at` computed per window in the reads | 02 | M | when volume needs it | P |
| BE-SOURCES-19 | `ai.daily_domain_citations` rollup | doc 16 13.4, doc 04 15 | NOT BUILT: direct query chosen (HO B6); volume at which it is needed is not measured | 02 | M | none | P |
| BE-SOURCES-20 | Prompt to page mapping: own URL cited per prompt and engine, prompts citing no own page (M-02, PR-51) | CS M-02, PR-51 | PARTIAL: `GET {P}/ai/sources/pages?filter[domain_role_in]=own&filter[prompt_id]=` and citations give it; no "prompts with no own page" read | 03 | S | none | none |
| BE-SOURCES-21 | Quote or claim per citation (CI-11) | CS CI-11, Q1 | NOT BUILT: unknown whether the payload has it; check one raw payload first | COLLECT-03 | S check, M build | none | L |
| BE-SOURCES-22 | Unresolved redirect and engine internal link flags, excluded from shares by default with toggles | doc 14 9, doc 20 5.9 | PARTIAL: `CitationOut.flags` exists; no include toggles on the source reads (verify exclusion) | 02 | S | none | none |
| BE-SOURCES-23 | Canonicalizer upgrade path `core.url_remap` | doc 14 9, doc 04 15.1 | NOT BUILT | EXTRACT-01 | M | none | none |
| BE-SOURCES-24 | Time to first citation for owned pages (sitemap `lastmod`) | doc 14 8 | NOT BUILT | GEO-02 | M | none | none |
| BE-SOURCES-25 | Ads presence per engine | doc 29 Ph 13 | PARTIAL: ads kept in `provider_extras` and excluded; no read | COLLECT-04 | S | none | none |

Narrative. D2 built the core source reads: citations list, domains, pages and new sources against the previous period. Everything else in doc 14 and doc 19 3.7.7 is Phase 13 source intelligence: categories, overlap, retrieved-not-cited (which needs a new table and a normalizer change, since today only the count is kept), publishers and opportunities. Retrieved-not-cited is the most actionable signal doc 07 names and is slice 2 per S1.

## 8. FANOUT (ChatGPT query fan-out)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-FANOUT-01 | `GET {P}/ai/fanout-queries` grouped by normalized text, `min_support`, `cited_domains` (association), `meta.answers_truncated`, `engines_without_fanout` | doc 19 3.7.7, HO B19 | BUILT: `FanoutQueryRow`, `FanoutMeta`; D2 Task 4 | COLLECT-04 | done | none | P L |
| BE-FANOUT-02 | Table `ai.fanout_queries` (normalized text, sequence) filled at ingest | doc 04 8.4, doc 29 Ph 7 | NOT BUILT: reads `provider_extras` instead (doc 13 as built D2) | COLLECT-06 | M | when the jsonb read becomes too slow | P T |
| BE-FANOUT-03 | Unbounded fan-out list (lift the 16 KB cut) | HO B19, CS Q2 | NOT BUILT: measured share of truncated answers unknown | COLLECT-04 | S measure, M fix | none | L |
| BE-FANOUT-04 | Fan-out keyword coverage (F3: queries matching a tracked keyword) | doc 16 F3 | NOT BUILT | 01, keywords | M | none | none |
| BE-FANOUT-05 | Fan-out queries where own ranks (F5, `matched_keyword`, `own_rank`) | doc 16 F5, doc 29 Ph 15 | NOT BUILT | 04, rank data | M | OD-13 | L |
| BE-FANOUT-06 | Own domain retrieved vs cited per query (FO-07) | CS FO-07 | NOT BUILT | SOURCES-13 | M | none | none |
| BE-FANOUT-07 | Fan-out queries into the keyword inbox and as `fanout` link suggestions | doc 11 5.1 and 6, CS M-20 | NOT BUILT | 04, BILLING-PLAN-LINKS-01, keyword inbox | M | Ph 11 | none |
| BE-FANOUT-08 | Fan-out from official API engines (Ph 14) and comparison to the scraper | doc 29 Ph 14 | NOT BUILT | ENGINES-07 | M | Ph 14 | $ |

Narrative. The exposure route is built and honest about the 16 KB cut. The table form, keyword coverage and rank coverage are later; F3 and F5 tie AI retrieval to SEO and are the cross-channel payoff.

## 9. COMPETITORS (entity cells, competitor reads, discovery, brand mentions)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-COMPETITORS-01 | Tracked entities per project (own, competitor, watch, `track_ai`, colors) | doc 19 3.4 | BUILT: `{P}/entities` routes | none | done | none | T |
| BE-COMPETITORS-02 | Per entity mention and SOV cells per prompt, topic and engine (B5) | HO B5 | BUILT: `include=entities` (METRICS-07) | 01 | done | decided (OD-6) | P |
| BE-COMPETITORS-03 | `GET {P}/ai/competitors` (SOV, recommendation, citation share per entity per engine, top competitor) | doc 19 3.7.9, doc 20 5.10, CS DB-17, DB-28 | NOT BUILT; web derives top competitor from B5 | 02 | M | none | P |
| BE-COMPETITORS-04 | Competitor gap A14 with a paired interval | doc 16 A14 | NOT BUILT | 03, STATS-02 | M | none | none |
| BE-COMPETITORS-05 | Prompts lost to a named competitor (competitor named, own not), sorted by importance (M-23) | CS M-23 | PARTIAL: data in `observation_facts`; `filter[outcome_in]` on observations; no aggregate read | 02 | S | none | none |
| BE-COMPETITORS-06 | Entity candidates read and actions: `GET {P}/entity-candidates`, `POST .../{name}/accept`, `.../ignore` (competitor discovery, M-22, DB-20) | doc 19 3.4, doc 13 stage 8 | NOT BUILT | EXTRACT-15 | M | slice 2 | T |
| BE-COMPETITORS-07 | SEO competitor suggestions `GET {P}/competitor-suggestions` | doc 19 3.4 (Ph 5) | NOT BUILT | rank data | M | OD-13 | L |
| BE-COMPETITORS-08 | Brand mentions outside our answers: DataForSEO LLM Mentions landscape (questions where a competitor is named and we are not) | doc 07 9, doc 11 5.1 | NOT BUILT (see COLLECT-21) | COLLECT-21 | M | Ph 13, spend | $ |
| BE-COMPETITORS-09 | Cross-channel competitor views `GET {P}/xch/competitors`, `GET {P}/xch/domain-dominance` | doc 19 3.8.2 | NOT BUILT | rank data, 03 | L | Ph 10b | L P |
| BE-COMPETITORS-10 | LLM suggestions for competitors and topics at onboarding (DB-31) | CS DB-31 | NOT BUILT (NEW, low) | OPS-11 | M | in scope at all | $ |
| BE-COMPETITORS-11 | ChatGPT `brand_entities` (provider NER) exposed as a candidate source | doc 07 2 | NOT BUILT: stored in `provider_extras`, not read | COLLECT-04, EXTRACT-15 | S | none | none |

Narrative. Competitor cells inside the summary exist. The dedicated competitor route, the paired gap, the "prompts we lose" read and competitor discovery from answers (entity candidates) are the remaining slice 2 items. Brand mentions outside our own answers exist in the specs only as the optional third-party LLM Mentions dataset (Ph 13), never mixed into our rates.

## 10. PANELS

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-PANELS-01 | Tables `ai.prompt_panels`, `ai.panel_memberships` (history `valid_from`, `valid_to`, exclusion constraint), RLS | doc 04 8.2, HO B10 | NOT BUILT | PROMPTS-01 | M | none (cadence decided, OD-3) | T |
| BE-PANELS-02 | Seed a locked core panel per project with every active prompt from its creation date, keep the two schedules | S1 8, HO B10 | NOT BUILT | 01 | S | decided | none |
| BE-PANELS-03 | `GET/POST/PATCH/DELETE {P}/panels` (lock change needs `panels:core:modify`) | doc 19 3.7.2 | NOT BUILT | 01, OPS-09 | M | none | T |
| BE-PANELS-04 | `GET/POST {P}/panels/{id}/memberships`, `.../memberships/remove` with reason on locked, `meta.churn_90d`, `churn_warning` above 10% | doc 19 3.7.2, doc 11 3 | NOT BUILT | 03 | M | none | T |
| BE-PANELS-05 | Panel aware planner: selector `panels: ["core"]`, dedupe by version, engine, location, replicate, window | doc 21 3, doc 11 3 | NOT BUILT (planner takes every active prompt) | 01, COLLECT-05 | M | none | $ |
| BE-PANELS-06 | Discovery panel engines ChatGPT and AI Mode only; experiment configurable | doc 11 8 | NOT BUILT | 05 | S | confirm (GA 4.4) | $ |
| BE-PANELS-07 | Window metrics use membership history (panel scoped rates) | doc 11 3, doc 17 4 | NOT BUILT | 01, METRICS-01 | M | none | P |
| BE-PANELS-08 | `GET {P}/panels/{id}/sizing` (detectable change from flip rate, doc 17 7) | doc 19 3.7.2, doc 11 3.2, CS M-17 | NOT BUILT | STATS-04 | M | none | none |
| BE-PANELS-09 | `GET {P}/panels/{id}/promotion-candidates` (3 valid per engine in 90 days, tracked entity in 30%, not branded, not near duplicate) | doc 11 3.1, doc 19 3.7.2 | NOT BUILT | 01, PROMPTS-23 | M | none | P |
| BE-PANELS-10 | Per panel cadence option (weekly) | OD-3 | NOT BUILT; allowed later by OD-3 | 05 | S | when asked | $ |
| BE-PANELS-11 | Experiment panels (treatment and control, frozen) | doc 11 3, doc 29 Ph 15 | NOT BUILT | 01, STATS-02 | L | Ph 15 | $ |

Narrative. Panels are unblocked by OD-3 and are slice 4. The first cut is the two tables, the locked core seed, the four route groups and the panel aware planner; sizing and promotion need the flip rate from slice 3.

## 11. VERSIONS

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-VERSIONS-01 | One `initial` version per prompt, observations point at the version | S1 4.2 | BUILT: 0018, `PromptSubject.prompt_version_id` | PROMPTS-01 | done | none | none |
| BE-VERSIONS-02 | `GET {P}/prompts/{id}/versions`, `POST .../versions` with `If-Match`, `change_kind` (`wording`, `typo`, `context`), `change_reason` | doc 19 3.7.1, HO B11 | NOT BUILT | 01 | M | decided (OD-4) | T |
| BE-VERSIONS-03 | `POST .../versions/{vid}/restore`: re-point `current_version_id`, audit entry, no new row | doc 11 2 rule 3, OD-4 | NOT BUILT | 02 | S | decided (OD-4) | none |
| BE-VERSIONS-04 | Core panel protection: new version on a locked core member needs `panels:core:modify` unless `typo` | doc 11 2 rule 4, doc 19 3.7.1 | NOT BUILT | 02, PANELS-01 | S | none | none |
| BE-VERSIONS-05 | `GET {P}/prompts/{id}/timeline` (versions and panel membership history) | doc 19 3.7.1, doc 11 9 | NOT BUILT | 02, PANELS-04 | S | none | none |
| BE-VERSIONS-06 | `GET {P}/prompt-versions` project wide feed (B12) | HO B12 | NOT BUILT (new route, not in doc 19) | 02 | S to M | none | T |
| BE-VERSIONS-07 | Version boundaries in metric series responses | doc 11 2 rule 2, doc 17 9, doc 19 4.6 | NOT BUILT | 02, METRICS-10 | M | none | none |
| BE-VERSIONS-08 | Remove `restore` from the `PromptVersion.change_kind` union in doc 19 | OD-4 | NOT BUILT (doc change only); the schema already limits `change_kind` to the 0018 values | 02 | S | decided | none |

Narrative. Versions are unblocked by OD-4 and are slice 4. The table already has `change_reason` and `created_by`, so B11 is routes and rules, not a migration.

## 12. ALERTS

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-ALERTS-01 | Tables `ops.alert_rules`, `ops.alert_events`, `ops.alert_digests`, `ops.webhook_endpoints`, `ops.webhook_deliveries` | doc 04 11.5 | NOT BUILT (no migration) | none | M | none | T |
| BE-ALERTS-02 | `GET /api/v1/alert-rule-types`, `{P}/alert-rules` CRUD, `.../test` | doc 19 3.11.5 | NOT BUILT | 01 | M | none | T |
| BE-ALERTS-03 | `POST {P}/alert-rules/preview` backtest (count of matches in the last 30 days) | doc 20 5.17 (proposed) | NOT BUILT, not in doc 19 | 02 | M | none | P |
| BE-ALERTS-04 | `GET {P}/alert-events`, `POST .../acknowledge`; anomaly hold, flapping mute | doc 19 3.11.5, doc 20 5.17 | NOT BUILT | 01 | M | none | T |
| BE-ALERTS-05 | `evaluate_alerts` job (debounced 10 minutes) | doc 21 5.2 | NOT BUILT | 01 | M | none | P |
| BE-ALERTS-06 | `ai_mention_lost`, `ai_mention_gained` (prompt engine, at least 2 answers a window, "possible change" unless detectable) | doc 11 10, CS M-01, PR-41 | NOT BUILT | 05, STATS-02 | M | none | none |
| BE-ALERTS-07 | `ai_citation_lost`, `ai_citation_gained` | doc 11 10 | NOT BUILT | 06 | S | none | none |
| BE-ALERTS-08 | `ai_panel_change` (paired 95% interval excludes zero, weekly) | doc 11 10 | NOT BUILT | 05, PANELS-07, STATS-02 | M | none | none |
| BE-ALERTS-09 | `ai_competitor_sov_overtake` per topic | doc 11 10 | NOT BUILT | 05, COMPETITORS-02 | S | none | none |
| BE-ALERTS-10 | `ai_new_source` (domain crosses `min_support` in a topic for the first time) | doc 11 10, doc 14 6 | NOT BUILT | 05, SOURCES-04 | S | none | none |
| BE-ALERTS-11 | `ai_model_changed` (new `model_reported` per engine, makes a version boundary) | doc 11 10, CS M-19 | NOT BUILT; `model_reported` stored | 05 | S | none | none |
| BE-ALERTS-12 | `ai_collection_degraded` (valid rate under 90% for an engine in a run; ops) | doc 11 10, CS PR-11 | NOT BUILT | 05 | S | none | L |
| BE-ALERTS-13 | Digests: `GET {P}/alert-digests`, `.../{id}`; email delivery (daily or hourly) | doc 19 3.11.5, doc 08 12.2 | NOT BUILT; email provider exists (`B/providers/email.py`) | 04 | M | none | none |
| BE-ALERTS-14 | Outbound webhooks (Slack, custom URL): endpoints, test, rotate secret, deliveries, redeliver, signed payloads | doc 19 3.11.5 and 5 | NOT BUILT | 01, SSRF fetch (GEO-01) | L | none | T (SSRF) |
| BE-ALERTS-15 | Platform alerts for operators (`ops.platform_alerts`) | doc 19 3.11.5b, doc 25 | NOT BUILT; belongs to ops (OD-8) | none | none | decided (ops session) | none |

Narrative. Alerts are specified in full and nothing is built, not even the SEO rule types. AI change alerts need detectability (STATS-02) to avoid noise; `ai_model_changed`, `ai_collection_degraded` and `ai_new_source` do not and can come first. Webhooks need the SSRF-safe fetcher.

## 13. REPORTS (overview, diagnostics, digests, client reports)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-REPORTS-01 | `GET {P}/overview/ai?engines=` (Overview AI block) | doc 20 5.2 | NOT BUILT; same as METRICS-08 | METRICS-08 | M | none | P |
| BE-REPORTS-02 | `GET {P}/overview/changes` (detectable AI changes, BH filtered) | doc 20 5.2 | NOT BUILT | STATS-06 | M | none | none |
| BE-REPORTS-03 | `GET {P}/overview/competitors` (SEO and AI SOV per engine) | doc 20 5.2 | NOT BUILT | COMPETITORS-03 | M | none | L |
| BE-REPORTS-04 | Answer diff over time (latest vs last that named you; entities and sources) (M-03) | CS M-03, DS 23 6.3 | NOT BUILT; all inputs stored | EXTRACT-06 | M | none | none |
| BE-REPORTS-05 | Prompt diagnostics `GET {P}/diagnostics/prompts/{id}` (evidence then hypotheses, M-18) | doc 19 3.8.3, doc 15 8, doc 20 5.14 | NOT BUILT | STATS-02, SOURCES-13 | L | Ph 15 | none |
| BE-REPORTS-06 | Keyword diagnostics with linked prompts evidence (E8) | doc 19 3.8.3 | NOT BUILT | rank data | L | Ph 15, OD-13 | L |
| BE-REPORTS-07 | Shareable report link and PDF per client project (M-12) | CS M-12 | NOT BUILT (NEW: PDF and branding) | EXPORT-01, SAVEDVIEWS-01 | L | in scope at all | T (public link) |
| BE-REPORTS-08 | Scheduled report digests by email (M-13) | CS M-13 | NOT BUILT (digest routes specified, report content NEW) | ALERTS-13 | M to L | in scope at all | none |
| BE-REPORTS-09 | Chart annotations (user notes, release markers) for AI charts (M-14) | CS M-14 | NOT BUILT (NEW for AI) | none | M | in scope at all | T |
| BE-REPORTS-10 | "Updated" header meta from the last completed AI run | CS PR-13, AP-23 | BUILT: `last_observed_at` (B1) and `GET {P}/runs?filter[workload_in]` | METRICS-02 | done | none | none |
| BE-REPORTS-11 | Caveat block in every export header (logged-out sessions, country level, model changes, ads excluded) | doc 07 10 | NOT BUILT | EXPORT-01 | S | none | none |

Narrative. Nothing in REPORTS beyond freshness exists. Server side reports, PDF and annotations are NEW in the competitor study and need an owner yes before planning.

## 14. GEO (page level AI readiness and first-party AI signals)

OD-11 applies to GEO-01 to GEO-09: page level AI readiness is NOT opened by the owner. The specs list it (CS M-09, M-10, GD-15 to GF-02; RM stage 5), so a plan may schedule it only as an optional late wave behind an owner decision. GEO-10 to GEO-16 are the first-party AI signals of doc 18 (Phase 12), which are specified and not affected by OD-11.

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-GEO-01 | SSRF-safe fetch service (http, https, ports 80 and 443, resolved IP checks against private ranges, re-check each redirect up to 5, 10 s, 5 MB, no cookies, fixed user agent, `collect` queue) with blocklist unit tests | doc 24 7.3 and 14 | NOT BUILT | none | M | OD-11 (open), or needed earlier by webhooks (ALERTS-14) and discovery crawl | T (SSRF) |
| BE-GEO-02 | robots.txt check per AI bot (GPTBot, Google-Extended, PerplexityBot, ClaudeBot, Applebot-Extended and others) using the bot registry | CS M-09, doc 18 bot registry | NOT BUILT (NEW) | 01, GEO-13 | S to M | OD-11 (open) | T |
| BE-GEO-03 | `llms.txt` presence and parse | CS M-09 | NOT BUILT (NEW) | 01 | S | OD-11 (open) | none |
| BE-GEO-04 | Sitemap and meta robots checks for a page | CS M-09 | NOT BUILT (NEW) | 01 | S | OD-11 (open) | none |
| BE-GEO-05 | JSON-LD found vs expected for the page type (Article, BreadcrumbList, FAQ) (M-10, GD-16) | CS M-10, GD-16 | NOT BUILT (NEW) | 01, 08 | M | OD-11 (open) | none |
| BE-GEO-06 | Page checklist (pass, warning, fail with the HTML fact), no score (GD-15) | CS GD-15 | NOT BUILT (NEW) | 02 to 05 | M | OD-11 (open) | none |
| BE-GEO-07 | Page watchlist and URL import for checks | doc 32 sections 5, CS GA-01, GA-02 | NOT BUILT here (doc 32 page watchlist is a separate feature) | doc 32 | M | OD-11 and doc 32 go | T |
| BE-GEO-08 | Page type label and freshness and authorship facts (GD-19, GD-21) | CS GD-19, GD-21 | NOT BUILT (NEW, low) | 01 | M | OD-11 (open) | none |
| BE-GEO-09 | Fix inbox with suggested snippet, status (suggested, reviewed, done), never writes to the site (GF-02, GD-17) | CS GF-02, GD-17 | NOT BUILT (NEW) | 06 | L | OD-11 (open) | T |
| BE-GEO-10 | Content gap: topics and entities in competitor recommending answers absent from owned pages (GD-18) | CS GD-18, doc 29 Ph 15 | NOT BUILT | 01, RECOMMEND-01 | L | Ph 15 | none |
| BE-GEO-11 | GA4 AI referral sessions: Google AI Assistant channel and our classifier side by side, `fp.ai_referral_daily`, `fp.ai_referrer_rules`, `GET {P}/fp/ai-referrals`, `GET /api/v1/fp/referrer-rules` (M-21) | doc 18, doc 19 3.10 | NOT BUILT: GA4 property listing route exists (`{W}/connections/{id}/properties/ga4`), no sync | Google connection (built) | L | Ph 12 | T |
| BE-GEO-12 | Cloudflare AI crawler requests (`cloudflare_sync`), `GET {P}/fp/ai-crawlers` | doc 18, doc 21 2 | NOT BUILT | connections | L | Ph 12 | T |
| BE-GEO-13 | AI bot registry `fp.ai_bot_registry`, `fp.bot_ip_ranges`, `GET /api/v1/fp/bot-registry` | doc 18 12, doc 19 3.10 | NOT BUILT | none | M | Ph 12 | none |
| BE-GEO-14 | Server log upload `POST /api/v1/ingest/logs`, `fp.log_hits_daily` | doc 19 3.10 (V1.5) | NOT BUILT | 13 | L | V1.5 | T |
| BE-GEO-15 | GSC generative AI report import (CSV), `fp.gsc_generative_ai_daily`, `GET {P}/fp/genai-impressions` | doc 18, doc 16 10 | NOT BUILT | fp imports | M | Ph 12 | T |
| BE-GEO-16 | Bing Webmaster AI Performance import (AI citations, grounding queries), `GET {P}/fp/bing-ai` | doc 18, doc 11 5.1 | NOT BUILT | fp imports | M | Ph 12 | T |

Narrative. Nothing in GEO is built. The SSRF-safe fetcher is the shared prerequisite for readiness checks, webhooks and discovery crawls, so it is worth planning once even if readiness stays closed. The first-party AI signals (referrals, crawlers, generative impressions, Bing AI) are Phase 12 and tie AI visibility to traffic (M-21).

## 15. AIO (AI Overview)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-AIO-01 | Keyword level AI Overview presence and citation from rank checks (`has_ai_overview`, `ai_overview_state`, `GET {P}/tracked-keywords/{id}/aio-history`) | doc 09, doc 10, doc 06 | BUILT on the SEO side: `SerpSnapshotSummary`, `AioCitations`, `aio-history` route, `CostWorkload.AI_OVERVIEW` | rank data | done | OD-13 (data issues at the provider) | L |
| BE-AIO-02 | AI Overview answers as `ai.observations` (`serp_snapshot_id`, `tracked_keyword_id` columns already exist) | doc 04 8.3, doc 07 5.3 | NOT BUILT: columns and indexes in 0018, nothing writes them | ENGINES-06, AIO-01 | M | slice 2 start | L P |
| BE-AIO-03 | AI Overview per prompt through the primary linked keyword, summary cell with `source_state` (`no_linked_keyword`, `not_tracked`, `no_surface`, `ok`) and `checks` beside `n` (B13) | HO B13, ADR-DS-022 decision 11 | NOT BUILT | 02, BILLING-PLAN-LINKS-01 | L | OD-13; decide at slice 2 start | L |
| BE-AIO-04 | AIO citation rate by rank bucket `GET {P}/xch/aio-citation-by-rank` with Wilson intervals | doc 19 3.8.2, doc 29 Ph 10a | NOT BUILT | AIO-01, STATS-01 | M | Ph 10a | L |
| BE-AIO-05 | AI Mode on tracked keywords (`ai_mode_keyword`) | doc 11 6 | NOT BUILT (COLLECT-12) | COLLECT-12 | M | OD-13 | $ L |
| BE-AIO-06 | AI Overview extraction (mentions and citations of the AIO answer through the same extractor) | doc 07 5.3 | NOT BUILT | 02, EXTRACT-04 | M | none | P |

Narrative. AI Overview exists at keyword level on the SEO side and is fed by rank checks, which are on hold. Per prompt AIO needs keyword links (BILLING-PLAN-LINKS-01) and the engine seed, and the roadmap says to decide at slice 2 start because of the provider's rank data issues.

## 16. RECOMMEND (recommendation, structured rank, prominence, sentiment, claims)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-RECOMMEND-01 | Stage 6 structured list parsing: `structured_rank`, `structured_list_size`, `structured_list_index`, `had_structured_list` | doc 13 stage 6 | NOT BUILT (columns null) | EXTRACT-03 | M | none | none |
| BE-RECOMMEND-02 | Stage 9 recommendation rules (`is_recommended`, confidence, ambiguous) | doc 13 stage 9, HO B14 | NOT BUILT (`own_recommended` null) | EXTRACT-03, 01 | L | none | none |
| BE-RECOMMEND-03 | Stage 10 sentiment by lexicon, own brand, four classes; competitor sentiment only when enabled | doc 13 stage 10, CS DB-09, M-07 | NOT BUILT (`own_sentiment` null) | EXTRACT-03 | M | competitor sentiment on or off (cost) | $ |
| BE-RECOMMEND-04 | Stage 11 budgeted LLM adjudication (uncertain mentions, ambiguous recommendations, low confidence sentiment), cache, cost events, `extraction_llm` budget (default USD 10 a project a month) | doc 13 stage 11, doc 24 7.2 | NOT BUILT | OPS-11 | L | approve LLM spend and provider | $ T (prompt injection from answer text) |
| BE-RECOMMEND-05 | Prominence fact `own_prominence` filled and A11 cell | doc 16 A11, HO B14 | PARTIAL: column in `ObservationFacts`; check whether ingest fills it (stage 7 formula is simple) | EXTRACT-05 | S | none | none |
| BE-RECOMMEND-06 | Summary cells `recommended` (A5), recommended given mentioned (A6), structured top 3 and top 5 (A9), median rank (A10), sentiment shares (A13) | doc 16 A5, A6, A9, A10, A13, HO B14 | NOT BUILT | 01 to 03, METRICS-01 | M | none | P |
| BE-RECOMMEND-07 | Rank shown only as structured list rank; `own_mention_order` never shown as rank | GA 4.14 | BUILT as a rule (API names `own_mention_order`) | none | done | none | none |
| BE-RECOMMEND-08 | Claims: `ai.claims`, `ai.claim_occurrences`, `GET {P}/ai/claims`, `.../{id}`, `PATCH` review (accurate, inaccurate, outdated, disputed) behind a flag (M-08) | doc 04 8.6, doc 19 3.7.10 | NOT BUILT (schema reserved) | 04 | L | Ph 15 | $ T |

Narrative. All of RECOMMEND is slice 2 extractor work on top of the missing markdown structure stage (EXTRACT-03). The LLM stage is optional and the only part with spend; it also carries the prompt injection risk doc 24 7.2 addresses.

## 17. STATS (intervals, volatility, flip rate, compare)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-STATS-01 | `ci` on `MetricCell` (Wilson for a prompt engine cell; fixed panel interval for prompt weighted rates) | doc 17 3.2, 4.2, HO B15 | NOT BUILT: `MetricCell` has no `ci` (web computes Wilson client side, W4) | METRICS-01 | M | none | none |
| BE-STATS-02 | Paired comparison on the core panel (bootstrap) and `is_detectable` on compare | doc 17 6.1, HO B15 | NOT BUILT (web uses an interim unpaired test, D-2) | 01, METRICS-05, PANELS-07 | L | none | P |
| BE-STATS-03 | Unpaired comparison (Newcombe) when panels changed or engines compared | doc 17 6.2 | NOT BUILT | 01 | M | none | none |
| BE-STATS-04 | Flip rate `ai.flip_rate` and mention volatility (V4), citation volatility (V5 Jaccard) | doc 17 8, doc 16 V4, V5 | NOT BUILT | METRICS-01 | M | none | P |
| BE-STATS-05 | `GET {P}/ai/stats/volatility`, `GET {P}/ai/stats/interval`, `GET {P}/ai/stats/compare`, `GET {P}/ai/stats/movers` | doc 19 3.7.9 | NOT BUILT | 01 to 04 | L | none | P |
| BE-STATS-06 | Benjamini-Hochberg filter on mover lists (V1 to V3 new and lost mentions and citations) | doc 17 6.4, doc 16 8 | NOT BUILT | 05 | M | none | none |
| BE-STATS-07 | Version boundaries and structural breaks (model change, entity set change, version change) in series | doc 17 9 | NOT BUILT | VERSIONS-07, ALERTS-11 | M | none | none |
| BE-STATS-08 | Within-run instability across replicates (V6) | doc 16 V6 | NOT BUILT | COLLECT-11 | S | depends on replicates | $ |
| BE-STATS-09 | Population intervals (cluster bootstrap) and competitor gap bootstrap | doc 17 4.3, doc 29 Ph 14 | NOT BUILT | 02 | L | Ph 14 | P |
| BE-STATS-10 | Answer similarity (MinHash) | doc 29 Ph 14, doc 17 8.4 | NOT BUILT | none | M | Ph 14 | P |
| BE-STATS-11 | What-if sizing (how many prompts detect N points) | CS M-17, doc 17 7 | PARTIAL: formula in the web (`apps/web/src/lib/stats/panel.ts`); server side with PANELS-08 | 04 | S | none | none |
| BE-STATS-12 | Statistical reference values test set (Wilson in SQL and Python agree) | doc 29 Ph 9 | NOT BUILT | 01 | S | none | none |
| BE-STATS-13 | Spike S-05 replicate independence (30 prompts x 20 replicates per engine) | doc 07 12 | NOT BUILT (spike not run) | none | M | spend approval | $ |

Narrative. Statistics are slice 3. The server interval on `MetricCell` and the paired verdict replace the web's interim test and are the prerequisites for honest AI change alerts. Flip rate also feeds panel sizing.

## 18. SAVEDVIEWS

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-SAVEDVIEWS-01 | Table `core.saved_views` with RLS (screen key, `query_string`, `columns`, `sort`, `visibility`, `is_pinned`) | doc 04 11.6, HO B8 | NOT BUILT | none | M | none | T |
| BE-SAVEDVIEWS-02 | `GET/POST/PATCH/DELETE {P}/saved-views` (`views:write`; workspace views need editor; duplicate name `409`) | doc 19 3.11.5a | NOT BUILT | 01, OPS-09 | M | none | T |
| BE-SAVEDVIEWS-03 | Screen key `ai.prompts` and the other AI screens | HO B8 | NOT BUILT | 02 | S | none | none |
| BE-SAVEDVIEWS-04 | `views:write` permission (owner, or editor and above for workspace views) | doc 19 3.11.5a | BUILT as a key: `Permission.VIEWS_WRITE` in `B/api/permissions.py`; no route uses it yet | none | done | none | T |

Narrative. A platform item shared with Rankings (HO B8); the web ships presets without persistence until then. Saved views hold a table's query per project; layouts (section 18a) hold cards per workspace and are a separate table by design.

## 18a. LAYOUTS (customizable Overview and drawers)

Owner requirement added 2026-11-12 (through the coordinator): the AI visibility Overview must be a greater version of the preview dashboard with full layout customization: customize mode, card catalog, per-user and shared layouts, presets. Sources: the layout design `docs/superpowers/specs/2026-09-30-layout-customization-design.md` (`LD`) sections 2, 3, 6, 7, 9; doc 19 3.11.5c; doc 04 11.6a; review log F10. Nothing of the layouts API is in `backend/src` or `backend/openapi/v1.json`; the rules exist on the web only (`apps/web/src/lib/layouts`: `catalog.ts`, `resolve.ts`, `sanitize.ts`, `draft.ts`, 47 unit tests per LD section 15).

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-LAYOUTS-01 | Table `core.layouts` (`owner_user_id` null is the team default, `screen`, `document` jsonb at most 16 KB, `schema_version`, `updated_by`), unique partial indexes personal and team, `tenant_isolation` RLS, grants `app_api` only | LD 9.1, doc 04 11.6a | NOT BUILT: no migration (doc 04: "The migration is not written yet", review log F10) | none | M | F10: keep personal rows private by an application check (LD 9.1) or a policy on `auth.current_user_id()` | T |
| BE-LAYOUTS-02 | `GET {W}/layouts/{screen}`: resolve personal, else team, else `source: 'builtin'` with a null document; `ETag`; `404` for an unknown screen; a damaged stored value counts as absent | LD 6.3, 9.2, doc 19 3.11.5c | NOT BUILT | 01 | S | none | T |
| BE-LAYOUTS-03 | `PUT/DELETE {W}/me/layouts/{screen}` personal layout, session only (no API keys), `If-Match` when a row exists, `412 precondition_failed` | LD 9.2, doc 19 3.11.5c | NOT BUILT | 01, 06 | M | none | T |
| BE-LAYOUTS-04 | `PUT/DELETE {W}/layouts/{screen}/default` team default (the shared layout), `layouts:manage`, `If-Match`, audit `layout.default.set`, `layout.default.remove` with before and after documents | LD 9.2, 9.3, doc 19 3.11.5c | NOT BUILT | 01, 05, 06 | M | none | T |
| BE-LAYOUTS-05 | Permission `layouts:manage` (owner and admin; stricter than workspace saved views) | LD 9.3, doc 24 3.2 | NOT BUILT: not in `Permission` (`B/api/permissions.py`) | none | S | LD open point 1 proposes owner and admin; confirm | T |
| BE-LAYOUTS-06 | Document validation: known screen, `schema: 1`, card types and metric keys in the catalog for that screen, allowed widths, at most 12 cards and 6 numbers, 16 KB, `options` a flat object of strings; `422 validation_failed` with field paths | LD 9.2, doc 19 3.11.5c | NOT BUILT. LD says the key list reaches the API as JSON generated from `packages/contracts`; that package does not exist, the catalog lives in `apps/web/src/lib/layouts/catalog.ts` | 07 | M | where the generated catalog JSON lives and how the backend gets it (checked in file under `backend/`, regenerated by the web session as with `gen:api`) | none |
| BE-LAYOUTS-07 | Screen keys accepted by the API: `overview`, `ai_overview`, `rankings`, `prompts`, `citations`, `sources`, `pages`, `inspector.keyword`, `inspector.prompt`, `inspector.page`, `inspector.citation` | LD section 4 | NOT BUILT | 06 | S | none | none |
| BE-LAYOUTS-08 | Card catalog for `ai_overview`: AI cards `ai.by_engine`, `ai.mention_trend` (up to 4, one per engine), `ai.citation_share_by_domain_type`, `competitors.summary`, `competitors.share_of_voice`, `activity.key_changes`, `activity.collection_status`; AI headline numbers Mention rate, Citation rate, Recommendation rate, Share of voice per engine | LD 7.1, 7.2 | PARTIAL: catalog in the web (`catalog.ts`); the API side is the generated JSON of 06. The "greater" Overview will add AI cards (citations top domains, fan-out, prompts lost to a competitor, new sources, recommendation, sentiment); each new card type adds catalog keys and a data route (METRICS-24) | 06 | S per card key | which extra AI cards the greater Overview has (the catalog is code, reviewed per card, LD 7.4) | none |
| BE-LAYOUTS-09 | Built-in default per screen lives in the client; the API never stores it | LD 6.3, 9.2 | BUILT on the web (`resolve.ts`); nothing needed in the backend | none | done | none | none |
| BE-LAYOUTS-10 | Presets: several ready-made layouts per screen a person can pick | owner requirement 2026-11-12 | NOT BUILT. LD section 3 put "Several named layouts per page" and "Role-based defaults" out of scope; LD section 6 leaves room in the document. Two shapes: presets as code in the catalog (no storage, like the built-in default; backend needs nothing beyond 06 accepting their keys) or stored named layouts (adds `name`, changes the unique indexes, a list route) | 01 | S (code presets) to M (stored) | presets in code or stored and named; whether a team can save its own presets | T (stored) |
| BE-LAYOUTS-11 | Sharing a layout with one person | LD section 3 (out of scope) | NOT BUILT: out of scope in LD; the team default is the shared layout of the first release | 01 | M | confirm "shared layouts" means the team default | T |
| BE-LAYOUTS-12 | Per-project layout overrides | LD section 3 (out of scope), LD decision 5 (one layout per person per workspace) | NOT BUILT, by owner decision 5 of LD | none | none | none unless the new requirement reopens it | none |
| BE-LAYOUTS-13 | Tests: a member cannot read or write another member's personal row; the team default needs `layouts:manage`; API keys refused; cross-tenant scan; `412` race | LD 13, HO rule 4 | NOT BUILT | 01 to 05 | S | none | T |
| BE-LAYOUTS-14 | Document upgrade on read per `schema` step and sanitizing (unknown cards dropped, widths and options defaulted) | LD 6.3, 6.4 | BUILT on the web (`sanitize.ts`); backend stores `schema_version` only | 01 | done | none | none |
| BE-LAYOUTS-15 | Deletion with the user or workspace (no retention rule beyond that) | doc 04 11.6a | NOT BUILT (follows from the FK `ON DELETE CASCADE` in 01) | 01 | none | none | none |

Narrative. The layouts API is fully specified (five routes, one table, one permission) and not started in the backend; the web already has the rules, the catalog and the built-in defaults. Two decisions block the contract: how personal rows stay private inside a workspace (F10) and how the backend receives the catalog key list, since `packages/contracts` does not exist. The owner's new "presets" requirement goes beyond LD (which ruled out named layouts per page); presets defined in code need no backend change, stored named presets need a schema change and must be decided before LAYOUTS-01 is migrated. Each card on the greater AI Overview needs its own data read; that list is METRICS-24.

## 19. EXPORT

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-EXPORT-01 | Server exports `POST/GET {P}/exports`, `.../{id}`, `.../download`, `DELETE`, table `ops.exports`, `ops.jobs` | doc 19 3.11.6, doc 04 11.8 | NOT BUILT; web exports CSV client side (W5) | none | L | none | T |
| BE-EXPORT-02 | Export kinds for AI: prompt rates, answers, citations, sources, fan-out | CS M-16, doc 19 3.11.6 | NOT BUILT | 01 | M | none | P |
| BE-EXPORT-03 | Workspace exports `POST {W}/exports` (costs, audit) | doc 19 3.11.6 | NOT BUILT | 01 | M | none | T |
| BE-EXPORT-04 | Public API access with API keys for AI reads | doc 19 3.2.4, CS M-16 | NOT BUILT (API key routes absent from openapi; `auth.api_keys` table exists) | none | L | when to open the API | T |
| BE-EXPORT-05 | Upload store for CSV imports (prompt candidates, first-party files) | doc 19 3.7.3, 3.10 | PARTIAL: keyword import upload exists (`{P}/keyword-imports/upload`); no generic upload | none | M | none | T |

## 20. BILLING-PLAN-LINKS (base plan, quotas, budgets, keyword to prompt links, matrix)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-BILLING-PLAN-LINKS-01 | Table `core.keyword_prompt_links` (link types, status, primary) | doc 04 9, doc 11 6 | NOT BUILT | PROMPTS-01 | M | slice 4 (or slice 2 for AIO) | T |
| BE-BILLING-PLAN-LINKS-02 | `GET/POST/PATCH/DELETE {P}/keyword-prompt-links` | doc 19 3.8.1 | NOT BUILT | 01 | M | none | T |
| BE-BILLING-PLAN-LINKS-03 | `POST {P}/keyword-prompt-links/suggest`, `.../decide` (cluster, semantic, fan-out suggestions) | doc 19 3.8.1, doc 11 6 | NOT BUILT | 02, FANOUT-04 | M | Ph 10a | P |
| BE-BILLING-PLAN-LINKS-04 | Keyword to prompt coverage (keywords with no prompt, prompts with no keyword) (M-25) | CS M-25, doc 15 5 | NOT BUILT | 01 | S | none | none |
| BE-BILLING-PLAN-LINKS-05 | SEO and AI matrix `GET {P}/xch/matrix`, `.../rows`, `.../clusters`, `core.xch_keyword_weekly` | doc 19 3.8.2, doc 15 3 | NOT BUILT | 01, rank data | L | Ph 10a, OD-13 | L P |
| BE-BILLING-PLAN-LINKS-06 | Page intelligence `GET {P}/pages`, `.../{url_id}`, `.../series`, `.../insights` (citations plus rank plus GSC per page; M-06) | doc 19 3.8.2, doc 15 6, doc 32 | NOT BUILT | SOURCES-03, rank data, GSC | L | Ph 10a | L P |
| BE-BILLING-PLAN-LINKS-07 | `GET {P}/xch/rank-citation-association`, `GET {P}/opportunities/ai-first`, `GET {P}/opportunities/keywords-to-prompts`, `.../send-to-inbox` | doc 19 3.8.2, 3.8.3 | NOT BUILT | 05, PROMPTS-18 | L | Ph 10b | L |
| BE-BILLING-PLAN-LINKS-08 | Base plan constant `BASE_PLAN` (150 prompts, twice a week, standard queue, 1 answer) driving schedules, estimates and the quota default | S1 4.7, OD-2 | BUILT: `BASE_PLAN`, `max_active_prompts` default 150 | none | done | decided | none |
| BE-BILLING-PLAN-LINKS-09 | Quotas `max_active_prompts`, `max_ai_observations_per_month` checked on create, Run now, bulk run | doc 04 4.1 | BUILT: `core.workspace_quotas`, `B/api/operations/runs.py`, `run_repository.py` | 08 | done | none | $ |
| BE-BILLING-PLAN-LINKS-10 | `ai_prompt` budget check before dispatch, blocked runs visible with estimate and budget | doc 11 8, doc 27 | BUILT: `B/collectors/budget.py`, `Run.blocked_by_budget_id` | 09 | done | none | $ |
| BE-BILLING-PLAN-LINKS-11 | Budgets CRUD `GET/POST/PATCH/DELETE {W}/budgets` | doc 19 3.11.2 | PARTIAL: `GET {W}/budgets/status` and `{W}/costs` built; budget CRUD routes not in openapi | 10 | M | none | $ T |
| BE-BILLING-PLAN-LINKS-12 | `extraction_llm` budget group and cost events | doc 13 stage 11 | NOT BUILT | 11 | S | approve spend | $ |
| BE-BILLING-PLAN-LINKS-13 | Billing and plans (plan changes edit the quota row and schedule, not code) | S1 4.7 | NOT BUILT (out of AI scope) | 08 | L | product decision | $ |
| BE-BILLING-PLAN-LINKS-14 | Manual run counter shown before the click ("14 of 20 left today") | CS PR-12 | BUILT: `RunPageMeta.manual_runs_today`, `RunBulkMeta.manual_runs_today` | 09 | done | OD-10 | none |
| BE-BILLING-PLAN-LINKS-15 | Cost forecast and unit costs `GET {W}/costs/forecast`, `.../unit-costs` | doc 19 3.11.2 | NOT BUILT | 10 | M | none | none |

## 21. OPS (backend operations items that belong to AI; infrastructure goes to the ops session)

| ID | Capability | Spec | Status and evidence | Deps | Size | Owner decision needed | Risks |
|---|---|---|---|---|---|---|---|
| BE-OPS-01 | Cross-tenant suite covers every AI route and table | HO rule 4 | BUILT for slice 1 and D2 (`fd49fdc1` and earlier); every new route must be added | none | per route S | none | T |
| BE-OPS-02 | Statement count tests (no N+1) for every aggregate | HO rule 6 | BUILT for summary and D2 reads | none | per route S | none | P |
| BE-OPS-03 | Price book rows for AI endpoints (standard $0.0012 a task) and engine cost estimate | doc 07 7, S1 4.3 | BUILT: 0018 seed of `ops.provider_price_book` | none | done | none | $ |
| BE-OPS-04 | Schema hash check of provider payloads in the test suite | doc 29 Ph 7 risks | PARTIAL: `B/providers/dataforseo/schema_hash.py` exists; check whether AI payloads are covered | COLLECT-02 | S | none | L |
| BE-OPS-05 | DataForSEO shared limiter (2,000 calls a minute), 100 tasks a post, 30 day result retention, id sweeper | doc 07 11 | BUILT for the standard queue (`B/worker/limiter.py`, ledger) | none | done | none | L |
| BE-OPS-06 | Partial index for superseded answers | 0020 | BUILT | none | done | none | P |
| BE-OPS-07 | EXPLAIN check at full capacity for summary, sources and fan-out reads (partition pruning) | D1, D2 query plans | PARTIAL: optional checks listed, not a gate | none | S | none | P |
| BE-OPS-08 | Job runner for long backend jobs (`ops.jobs`, re-derivation, exports, rollups) | doc 04 11.8, doc 21 5.2 | NOT BUILT (Taskiq jobs exist for collection; no `ops.jobs` table) | none | M | none | P |
| BE-OPS-09 | Permissions `panels:core:modify`, `views:write`, `alerts:write`, `exports:create`, `layouts:manage` in the role matrix | doc 19 2.13, doc 24 3.2, LD 9.3 | PARTIAL: the first four are in `B/api/permissions.py` with role grants; `layouts:manage` is missing (LAYOUTS-05) | none | S | none | T |
| BE-OPS-10 | As built notes in doc 19 and doc 29 at the end of each plan | HO rule 9 | BUILT for A, B, D1 (partly, see drift 1), D2 | none | per plan S | none | none |
| BE-OPS-11 | LLM client for extraction and generation (provider adapter, JSON schema output, data delimiters, cost events) | doc 13 stage 11, doc 24 7.2 | NOT BUILT | none | M | which provider and model; spend cap | $ T |
| BE-OPS-12 | API compression (gzip) | D1 open point 3 | DEFERRED BY OWNER: OD-8, ops session | none | none | decided | P |
| BE-OPS-13 | VPS, release, backups, platform alerts, observability | OD-8 | DEFERRED BY OWNER: ops session | none | none | decided | none |
| BE-OPS-14 | Quality counters and data quality flags for AI (`ops.data_quality_flags`, `ops.quality_counters_daily`) | doc 26 9, doc 25 9 | NOT BUILT | none | M | none | L |

---

## 22. Every doc 19 AI route against `backend/openapi/v1.json`

Exists means present in `openapi/v1.json` at `246d3574`.

| Route | Doc 19 | Ph | In openapi | Inventory id |
|---|---|---|---|---|
| `GET {P}/prompts` | 3.7.1 | 6 | yes | PROMPTS-02 |
| `POST {P}/prompts` | 3.7.1 | 6 | yes | PROMPTS-03 |
| `POST {P}/prompts/bulk-create` | 3.7.1 | 6 | yes | PROMPTS-04 |
| `POST {P}/prompts/bulk-update` | 3.7.1 | 6 | no | PROMPTS-07 |
| `POST {P}/prompts/bulk-archive` | 3.7.1 | 6 | yes (ids only) | PROMPTS-06 |
| `POST {P}/prompts/lint` | 3.7.1 | 6 | yes | PROMPTS-08 |
| `POST {P}/prompts/from-keywords/preview` | 3.7.1 | 6 | no | PROMPTS-17 |
| `GET/PATCH/DELETE {P}/prompts/{id}` | 3.7.1 | 6 | yes | PROMPTS-05 |
| `GET/POST {P}/prompts/{id}/versions` | 3.7.1 | 6 | no | VERSIONS-02 |
| `POST {P}/prompts/{id}/versions/{vid}/restore` | 3.7.1 | 6 | no | VERSIONS-03 |
| `GET {P}/prompts/{id}/timeline` | 3.7.1 | 6 | no | VERSIONS-05 |
| `GET {P}/prompt-versions` (new, HO B12) | none | slice 4 | no | VERSIONS-06 |
| `GET/POST {P}/panels`, `PATCH/DELETE {P}/panels/{id}` | 3.7.2 | 6 | no | PANELS-03 |
| `GET/POST {P}/panels/{id}/memberships`, `.../memberships/remove` | 3.7.2 | 6 | no | PANELS-04 |
| `GET {P}/panels/{id}/sizing` | 3.7.2 | 9 | no | PANELS-08 |
| `GET {P}/panels/{id}/promotion-candidates` | 3.7.2 | 9 | no | PANELS-09 |
| `GET {P}/prompt-candidates`, `PATCH .../{id}`, `POST .../decide`, `.../generate`, `.../uploads` | 3.7.3 | 11 | no | PROMPTS-19 to 21 |
| `GET {P}/engines`, `PUT/DELETE {P}/engines/{code}` | 3.7.4 | 6 | yes | ENGINES-03 |
| `POST {P}/prompts/{id}/run-now` | 3.7.5 | 7 | yes | COLLECT-07 |
| `POST {P}/ai/runs` (bulk run, HO B7) | 3.7.5 as built | slice 1+ | yes | COLLECT-08 |
| `GET {P}/runs/{run_id}/ai-coverage` | 3.7.5 | 7 | no | COLLECT-10 |
| `GET {P}/ai/observations`, `.../{id}`, `.../{id}/raw` | 3.7.6 | 7 | yes | COLLECT-17, EXTRACT-06 |
| `GET {P}/ai/observations/{id}/derivations` | 3.7.6 | 8 | no | EXTRACT-13 |
| `GET {P}/ai/citations` | 3.7.7 | 7 | yes | SOURCES-01 |
| `GET {P}/ai/sources/domains` | 3.7.7 | 9 | yes | SOURCES-02 |
| `GET {P}/ai/sources/pages` | 3.7.7 | 9 | yes | SOURCES-03 |
| `GET {P}/ai/fanout-queries` | 3.7.7 | 9 | yes | FANOUT-01 |
| `GET {P}/ai/sources/domains/{domain_id}` | 3.7.7 | 13 | no | SOURCES-11 |
| `GET {P}/ai/sources/categories` | 3.7.7 | 13 | no | SOURCES-08 |
| `GET {P}/ai/sources/changes` | 3.7.7 | 13 | no | SOURCES-06 |
| `GET {P}/ai/sources/diversity` | 3.7.7 | 13 | no | SOURCES-07 |
| `GET {P}/ai/sources/competitor-overlap` | 3.7.7 | 13 | no | SOURCES-12 |
| `GET {P}/ai/sources/retrieved-not-cited` | 3.7.7 | 13 | no | SOURCES-13 |
| `GET {P}/ai/sources/influential-pages` | 3.7.7 | 13 | no | SOURCES-14 |
| `GET/PUT/DELETE {W}/domain-category-overrides` | 3.7.7 | 13 | no | SOURCES-10 |
| `GET /api/v1/publishers` | 3.7.7 | 13 | no | SOURCES-15 |
| `GET {P}/ai/derivations` | 3.7.8 | 8 | no | EXTRACT-11 |
| `POST {P}/ai/extraction/preview` | 3.7.8 | 8 | no | EXTRACT-12 |
| `GET/POST {P}/ai/rederivations`, `GET .../{id}` | 3.7.8 | 8 | no | EXTRACT-11 |
| `GET {P}/ai/prompts-summary` (new in S1) | 3.7 as built | slice 1 | yes | METRICS-01 to 07 |
| `GET {P}/ai/metrics/overview` | 3.7.9 | 9 | no | METRICS-08 |
| `GET {P}/ai/metrics/{metric}` | 3.7.9 | 9 | no | METRICS-09 |
| `GET {P}/ai/metrics/{metric}/series` | 3.7.9 | 9 | no | METRICS-10 |
| `GET {P}/ai/metrics/{metric}/breakdown` | 3.7.9 | 9 | no | METRICS-11 |
| `GET {P}/ai/competitors` | 3.7.9 | 9 | no | COMPETITORS-03 |
| `GET {P}/ai/prompt-explorer`, `.../{id}` | 3.7.9 | 9 | no (replaced by the summary) | METRICS-12 |
| `GET {P}/ai/stats/interval`, `compare`, `movers`, `volatility` | 3.7.9 | 9 (14) | no | STATS-05 |
| `GET {P}/ai/claims`, `.../{id}`, `PATCH .../{id}` | 3.7.10 | 15 | no | RECOMMEND-08 |
| `GET {P}/entity-candidates`, `.../accept`, `.../ignore` | 3.4 | 8 | no | COMPETITORS-06 |
| `POST {P}/alias-test` | 3.4 | 2 | yes (no `observation_id` yet) | EXTRACT-14 |
| `GET {P}/competitor-suggestions` | 3.4 | 5 | no | COMPETITORS-07 |
| `GET/POST/PATCH/DELETE {P}/keyword-prompt-links`, `.../decide`, `.../suggest` | 3.8.1 | 6, 10a | no | BILLING-PLAN-LINKS-02, 03 |
| `GET {P}/xch/matrix`, `.../rows`, `.../clusters`, `{P}/xch/aio-citation-by-rank`, `{P}/xch/competitors`, `{P}/xch/domain-dominance`, `{P}/xch/rank-citation-association` | 3.8.2 | 10a, 10b | no | BILLING-PLAN-LINKS-05, 07, AIO-04, COMPETITORS-09 |
| `GET {P}/pages`, `.../{url_id}`, `.../series`, `{P}/pages/insights` | 3.8.2 | 10a | no | BILLING-PLAN-LINKS-06 |
| `GET {P}/opportunities/keywords-to-prompts`, `.../send-to-inbox`, `{P}/opportunities/ai-first`, `{P}/opportunities/publishers` | 3.8.3 | 10b, 13 | no | BILLING-PLAN-LINKS-07, SOURCES-16 |
| `GET {P}/diagnostics/prompts/{id}`, `GET {P}/diagnostics/keywords/{id}` | 3.8.3 | 15 | no | REPORTS-05, 06 |
| `POST {P}/keyword-candidates/create-prompts` | 3.9 | 11 | no | PROMPTS-22 |
| `GET {P}/fp/ai-referrals`, `{P}/fp/ai-crawlers`, `{P}/fp/bing-ai`, `{P}/fp/genai-impressions`, `/api/v1/fp/referrer-rules`, `/api/v1/fp/bot-registry` | 3.10 | 12 | no | GEO-11 to 16 |
| `{P}/alert-rules` and the rest of 3.11.5 | 3.11.5 | 5, 9 | no | ALERTS-02 to 14 |
| `{P}/saved-views` | 3.11.5a | 5 | no | SAVEDVIEWS-02 |
| `GET {W}/layouts/{screen}` | 3.11.5c | 1 | no | LAYOUTS-02 |
| `PUT/DELETE {W}/me/layouts/{screen}` | 3.11.5c | 1 | no | LAYOUTS-03 |
| `PUT/DELETE {W}/layouts/{screen}/default` | 3.11.5c | 1 | no | LAYOUTS-04 |
| `{P}/exports` | 3.11.6 | 3 | no | EXPORT-01 |
| `GET/POST {P}/schedules`, pause, resume | 3.11.3 | 3 | yes | ENGINES-04 |
| `GET {P}/runs`, `.../{id}`, `.../cancel` | 3.11.4 | 3 | yes | COLLECT-09 |
| `GET {P}/runs/{id}/tasks`, `POST .../retry-failed` | 3.11.4 | 4 | no | OPS (ops session) |

Count: 21 of 67 route rows above exist in openapi, two of them partially (bulk archive without `filter`, alias test without `observation_id`).

## 23. Every doc 04 AI table against the migrations

| Table | Spec | Migration | Inventory id |
|---|---|---|---|
| `ai.engines` | 04 8.1 | 0018 | ENGINES-01 |
| `ai.project_engines` | 04 8.1 | 0018 | ENGINES-02 |
| `ai.prompts` | 04 8.2 | 0018 | PROMPTS-01 |
| `ai.prompt_versions` | 04 8.2 | 0018 | VERSIONS-01 |
| `ai.prompt_terms` | 04 8.2 | 0018 | TOPICS-01 |
| `ai.prompt_panels` | 04 8.2 | none | PANELS-01 |
| `ai.panel_memberships` | 04 8.2 | none | PANELS-01 |
| `ai.observations` (partitioned) | 04 8.3 | 0018, 0020 index | COLLECT-06 |
| `ai.observation_raw()` function | 04 8.3 | 0018 | COLLECT-17 |
| `ai.citations` (partitioned) | 04 8.4 | 0018 | EXTRACT-07 |
| `ai.fanout_queries` | 04 8.4 | none | FANOUT-02 |
| `ai.retrieval_results` | 04 8.4 | none | SOURCES-13 |
| `ai.derivations` | 04 8.5 | 0018 | EXTRACT-06 |
| `ai.entity_mentions` (partitioned) | 04 8.5 | 0018, 0019 | EXTRACT-06 |
| `ai.observation_facts` (partitioned) | 04 8.5 | 0018 | EXTRACT-06 |
| `ai.claims`, `ai.claim_occurrences` | 04 8.6 | none (reserved) | RECOMMEND-08 |
| `ai.daily_prompt_engine_metrics` | 04 8.7 | none | METRICS-18 |
| `ai.daily_prompt_engine_denominators` (view) | 04 15, 16 13.3 | none | METRICS-19 |
| `ai.daily_domain_citations` | 04 15, 16 13.4 | none | SOURCES-19 |
| `ai.project_source_stats` | 04 15, 14 2 | none | SOURCES-18 |
| `ai.citation_entity_links` | 04 15.1, 14 2 | none | EXTRACT-16 |
| `ai.entity_candidates` | 04 15, 13 stage 8 | none | EXTRACT-15 |
| `ai.prompt_candidates` | 04 15, 11 5.2 | none | PROMPTS-18 |
| `ai.external_mention_snapshots` | 04 15.1, 07 9 | none | COLLECT-21 |
| `core.keyword_prompt_links` | 04 9 | none | BILLING-PLAN-LINKS-01 |
| `core.publishers`, `core.publisher_domains` | 04 15, 14 2 | none | SOURCES-15 |
| `core.workspace_domain_categories` | 04 15.1 | none | SOURCES-10 |
| `core.domain_categories` | 04 5.1 | 0010 | SOURCES-08 |
| `core.url_remap` | 04 15.1 | none | SOURCES-23 |
| `core.saved_views` | 04 11.6 | none | SAVEDVIEWS-01 |
| `core.layouts` | 04 11.6a, LD 9.1 | none (review log F10) | LAYOUTS-01 |
| `core.xch_keyword_weekly` | 04 15, 15 3 | none | BILLING-PLAN-LINKS-05 |
| `seo.ai_demand_snapshots` | 04 7.2 | none | PROMPTS-24 |
| `ops.alert_rules`, `ops.alert_events`, `ops.alert_digests`, `ops.webhook_endpoints`, `ops.webhook_deliveries` | 04 11.5 | none | ALERTS-01 |
| `ops.derivation_log` | 04 7 | none | EXTRACT-11 |
| `ops.jobs`, `ops.exports` | 04 11.8 | none | OPS-08, EXPORT-01 |
| `fp.ai_referrer_rules`, `fp.ai_referral_daily`, `fp.ai_bot_registry`, `fp.bot_ip_ranges`, `fp.log_hits_daily`, `fp.gsc_generative_ai_daily`, `fp.gsc_generative_ai_breakdown`, `fp.bing_ai_performance` | 04 15, 18 12.1 | none | GEO-11 to 16 |

Later migrations planned by the plans: none of D1, D2, D3 adds one (D2: "No migration"). The next AI migrations follow the items: panels and memberships (PANELS-01), entity candidates and derivation log (EXTRACT-15, 11), keyword links (BILLING-PLAN-LINKS-01), saved views (SAVEDVIEWS-01), retrieval results and fan-out table (SOURCES-13, FANOUT-02), prompt candidates (PROMPTS-18), alerts (ALERTS-01), rollups (METRICS-18), `context_preamble` if personas are planned (PROMPTS-14).

## 24. Worker and collector steps

| Step | State | Id |
|---|---|---|
| Planner tick: `ai_prompt` plan per schedule window | BUILT | COLLECT-05 |
| `submit_batch` and `fetch_task` for AI endpoints, `ready_poll` | BUILT | COLLECT-01 |
| `ai_prompt_ingest` tick (normalize, store raw, extract light, facts) | BUILT | COLLECT-06 |
| Reconciler, id sweeper, window missed cancellation | BUILT (shared ledger) | OPS-05 |
| Partition upkeep `ops.ensure_monthly_partitions` | BUILT | COLLECT-16 |
| `ai_mode_keyword` workload | NOT BUILT | COLLECT-12 |
| `ai_benchmark` workload, `benchmark_call` | NOT BUILT | COLLECT-14 |
| `live_call` for AI | DEFERRED BY OWNER (OD-12) | COLLECT-13 |
| `extract_observation` as its own job | NOT BUILT (extraction runs inside ingest) | EXTRACT-10 |
| `rederive_range` | NOT BUILT | EXTRACT-10 |
| `classify_batch` (LLM adjudication) | NOT BUILT | RECOMMEND-04 |
| `rollup_ai_day` | NOT BUILT | METRICS-18 |
| `evaluate_alerts` | NOT BUILT | ALERTS-05 |
| Entity candidate upsert at ingest | NOT BUILT | EXTRACT-15 |
| Project source stats upsert and nightly recount | NOT BUILT | SOURCES-18 |
| `ga4_sync`, `cloudflare_sync`, `bing_sync`, file imports | NOT BUILT | GEO-11 to 16 |
| Discovery jobs (`discovery` workload, PAA, GSC questions) | NOT BUILT | PROMPTS-22 |

---

## 25. Build order dependencies

A line `X -> Y` means Y needs X first. Items already BUILT are leaves and are left out unless they explain an edge.

```
Wave 1 (slice 1 finish and small decided items, no migration)
  METRICS-05 (B4 compare) -> METRICS-06, STATS-02, REPORTS-02
  PROMPTS-10, PROMPTS-11 (B16, OD-5)
  PROMPTS-12 (funnel, importance, branded filters)
  PROMPTS-09 (B17 lint)            [needs the branded definition decision]
  COLLECT-10 (ai-coverage), BILLING-PLAN-LINKS-14 is built
  TOPICS-07 (vocabulary check) -> TOPICS-09 (B9b)   [B9b also waits on rank data]
  SOURCES-20, COMPETITORS-05, METRICS-13, 14, 15, 21 (small reads over stored facts)
  SOURCES-21 check, FANOUT-03 measure, OPS-04 check (one look at raw payloads)

Wave 2 (slice 2 extraction core)
  EXTRACT-03 (markdown structure) -> RECOMMEND-01 -> RECOMMEND-02 -> RECOMMEND-06
  EXTRACT-03 -> RECOMMEND-03 -> RECOMMEND-06
  EXTRACT-03 -> EXTRACT-16 (citation entity links)
  OPS-08 (jobs) + migration (ops.derivation_log) -> EXTRACT-10 -> EXTRACT-11, EXTRACT-13, EXTRACT-18
  migration (ai.entity_candidates) -> EXTRACT-15 -> COMPETITORS-06, METRICS-17, COMPETITORS-11
  OPS-11 (LLM client) + BILLING-PLAN-LINKS-12 -> RECOMMEND-04   [owner spend decision]
  COMPETITORS-03 (ai/competitors) -> COMPETITORS-04 (needs STATS-02 for the interval)

Wave 3 (slice 2 retrieval and AIO)
  COLLECT-02 change + migration (ai.retrieval_results) -> SOURCES-13 -> FANOUT-06, REPORTS-05
  FANOUT-02 (optional table) -> FANOUT-04 -> FANOUT-05 (rank data), FANOUT-07
  migration (core.keyword_prompt_links) -> BILLING-PLAN-LINKS-02 -> AIO-03
  ENGINES-06 -> AIO-02 -> AIO-06 -> AIO-03       [rank data, OD-13: decide at slice 2 start]

Wave 4 (slice 3 statistics)
  STATS-01 (ci on MetricCell) -> STATS-03, STATS-12
  STATS-04 (flip rate) -> PANELS-08, STATS-11
  METRICS-05 + PANELS-07 -> STATS-02 -> STATS-05 -> STATS-06 -> REPORTS-02
  METRICS-18 (rollup, when volume needs it) -> METRICS-19, METRICS-08 to 11 speedups
  VERSIONS-07 + ALERTS-11 -> STATS-07
  STATS-13 (spike S-05) -> COLLECT-11 (replicates) -> STATS-08

Wave 5 (slice 4: panels, versions, inbox, alerts)
  OPS-09 (permissions) -> PANELS-03, SAVEDVIEWS-02, ALERTS-02, EXPORT-01
  migration (panels) -> PANELS-01 -> PANELS-02 -> PANELS-03 -> PANELS-04 -> PROMPTS-13, VERSIONS-05
  PANELS-01 -> PANELS-05 (panel aware planner) -> PANELS-06, PANELS-10
  PANELS-01 -> PANELS-07 -> STATS-02, ALERTS-08
  VERSIONS-02 -> VERSIONS-03, VERSIONS-04 (needs PANELS-01), VERSIONS-06, VERSIONS-07
  migration (prompt candidates) -> PROMPTS-18 -> PROMPTS-19 -> PROMPTS-20 (OPS-11), PROMPTS-21 (EXPORT-05)
  PROMPTS-23 (near duplicates) -> PROMPTS-19, PANELS-09
  BILLING-PLAN-LINKS-01 -> PROMPTS-17
  migration (alerts) -> ALERTS-01 -> ALERTS-02, 04, 05 -> ALERTS-11, 12, 10 (no stats needed)
  STATS-02 -> ALERTS-06, 07, 08;  COMPETITORS-02 -> ALERTS-09
  ALERTS-04 -> ALERTS-13 -> REPORTS-08
  migration (saved views) -> SAVEDVIEWS-01 -> SAVEDVIEWS-02 -> SAVEDVIEWS-03

Overview wave (customizable AI Overview, owner requirement 2026-11-12; can start after wave 1, in parallel with wave 2)
  decisions F10 and catalog JSON source -> LAYOUTS-06, LAYOUTS-07
  presets decision -> LAYOUTS-01 (migration shape) -> LAYOUTS-02 -> LAYOUTS-03, LAYOUTS-04 (needs LAYOUTS-05) -> LAYOUTS-13
  METRICS-08 (overview) -> METRICS-24 cards by engine and AI numbers
  METRICS-09 -> METRICS-10 (series) -> ai.mention_trend card; METRICS-11 (breakdown)
  METRICS-05 -> STATS-02 -> METRICS-25 (stats/compare) -> REPORTS-02 (key changes card)
  COMPETITORS-03 -> competitors cards;  SOURCES-08 (categories) -> citation share by domain type card
  each new card type -> LAYOUTS-08 catalog key -> its data read in METRICS-24

Wave 6 (Phase 10a, 13, cross channel and source intelligence)
  SOURCES-04 -> SOURCES-05 -> SOURCES-06
  SOURCES-08 -> SOURCES-09 (OPS-11), SOURCES-10, SOURCES-15 -> SOURCES-16 -> SOURCES-17
  SOURCES-02 -> SOURCES-07, SOURCES-11, SOURCES-12, SOURCES-18, SOURCES-19
  TOPICS-11 -> SOURCES-14
  rank data + BILLING-PLAN-LINKS-01 -> BILLING-PLAN-LINKS-05, 06 -> 07, AIO-04, COMPETITORS-09
  EXPORT-01 -> EXPORT-02, REPORTS-11, METRICS-16, REPORTS-07
  COLLECT-21 -> COMPETITORS-08

Wave 7 (optional late wave, only after the owner opens it: OD-11)
  GEO-01 (SSRF fetcher; also unblocks ALERTS-14 and discovery crawl) -> GEO-02, GEO-03, GEO-04 -> GEO-05 -> GEO-06 -> GEO-09
  GEO-13 (bot registry) -> GEO-02, GEO-12, GEO-14
  Phase 12 first party: connections (built) -> GEO-11, GEO-15, GEO-16; GEO-12

Wave 8 (Phase 14, 15)
  ENGINES-07 -> COLLECT-14 -> FANOUT-08, ENGINES-11
  STATS-02 -> STATS-09, STATS-10;  RECOMMEND-04 -> RECOMMEND-08;  REPORTS-05, REPORTS-06, GEO-10, PANELS-11, ENGINES-08, ENGINES-09
```

Cross-wave rules: every new route joins the cross-tenant scan (OPS-01) and gets a statement count test (OPS-02) in the same task; every API change regenerates `backend/openapi/v1.json` in its own commit and the web regenerates its client (OD-9).

## 26. Contract-first surface

Grouped so one OpenAPI contract can be written per group before code. "New schema" lists the component names to add; "changed" lists additions to existing components. All reads take the existing scope parameters (`from`, `to` at most 92 days, `filter[engine_code_in]`, `filter[prompt_id]`, `filter[term]`, `include_branded`) unless noted.

**C1. Prompt metadata and lint (wave 1).**
- Changed `GET {P}/prompts`: `filter[prompt_type_in]`, `filter[funnel_stage_in]`, `filter[importance_in]`, `filter[is_branded]`, `sort`; later `filter[panel]`.
- Changed `POST {P}/prompts`, bulk create: `prompt_type` optional, server rule fills it (OD-5).
- Changed `LintWarning.rule` enum: `word_count`, `multiple_questions`, `leading_wording`, `language_mismatch`, `contains_competitor_alias`.
- New `POST {P}/prompts/bulk-update` with `PromptBulkUpdate` (`ids` or `filter`, `set: {term_ids, intent, funnel_stage, prompt_type, importance}`), response `{matched, updated}`.
- Changed `PromptBulkArchive`: optional `filter` (exactly one of `ids`, `filter`).
- New `PromptPage.meta.quota` (`limit`, `used`).

**C2. Summary additions (wave 1 and 2).**
- Changed `GET {P}/ai/prompts-summary`: `compare` (`none`, `previous_period`), `EngineSummary.previous`, `PromptsSummary.compare_window` (D1 Task 3 contract as written).
- Changed `EngineSummary`: `cited_among_with_citations`, `first_mention`, `fanout_per_answer` (ChatGPT only), later `recommended`, `recommended_given_mentioned`, `structured_top3`, `structured_top5`, `structured_rank_median`, `prominence`, `sentiment: {positive, neutral, negative, mixed}`, each a `MetricCell`.
- Changed `MetricCell`: `ci: {low, high, method} | null` (wave 4).

**C3. Collection status (wave 1).**
- New `GET {P}/runs/{run_id}/ai-coverage` with `AiCoverage` (per engine: planned, answered, valid, by status, skipped with reasons).

**C4. Extraction and derivations (wave 2).**
- New `GET {P}/ai/derivations`, `GET/POST {P}/ai/rederivations`, `GET {P}/ai/rederivations/{id}`, `GET {P}/ai/observations/{id}/derivations`, `POST {P}/ai/extraction/preview`; schemas `Derivation`, `RederivationJob`, `ExtractionPreview`.
- Changed `POST {P}/alias-test`: accepts `observation_id`.
- Changed entity mutations: `meta.rederivations`.
- Changed `ObservationDetail`: `blocks` (computed), mention `structured_rank`, `is_recommended`, `sentiment`; citation `answer_block_index`, `first_char_offset` filled.

**C5. Competitors and entity candidates (wave 2).**
- New `GET {P}/ai/competitors` with `CompetitorRow` (entity, per engine `mentioned`, `share_of_voice`, `cited`, `citation_share`, later `recommended`, `gap`).
- New `GET {P}/ai/prompts-lost` or a `filter[lost_to_entity_id]` on the summary (decide in the contract) for M-23.
- New `GET {P}/entity-candidates`, `POST .../{normalized_name}/accept`, `.../ignore` with `EntityCandidate` (doc 19 3.4 as written).

**C6. Retrieval and fan-out (wave 3).**
- New `GET {P}/ai/sources/retrieved-not-cited` with `RetrievedRow` (domain or page, retrieved, cited, own flag).
- Changed `FanoutQueryRow`: `own_retrieved`, `own_cited` (FO-07), later `matched_keyword_id`, `own_rank` (F5).
- Changed `FanoutMeta`: `keyword_coverage` (F3).

**C7. Keyword links and AI Overview (wave 3).**
- New `GET/POST {P}/keyword-prompt-links`, `PATCH/DELETE .../{link_id}`, later `.../suggest`, `.../decide`; schema `KeywordPromptLink`.
- Changed `ai.engines` seed and `EngineCode`: `google_ai_overview`.
- Changed `EngineSummary` for AIO: `source_state` (`no_linked_keyword`, `not_tracked`, `no_surface`, `ok`), `checks`.

**C8. Statistics (wave 4).**
- New `GET {P}/ai/stats/interval`, `GET {P}/ai/stats/compare` (with `is_detectable`), `GET {P}/ai/stats/movers` (BH filtered), `GET {P}/ai/stats/volatility` (flip rate, citation Jaccard).
- New generic `GET {P}/ai/metrics/overview`, `GET {P}/ai/metrics/{metric}`, `.../series`, `.../breakdown` returning `MetricValue` with `version_boundaries` (doc 19 4.6), when the Overview page needs them (OD-7).

**C9. Panels and versions (wave 5).**
- New `GET/POST {P}/panels`, `PATCH/DELETE {P}/panels/{id}`, `GET/POST .../memberships`, `POST .../memberships/remove`, `GET .../sizing`, `GET .../promotion-candidates`; schemas `Panel`, `PanelMembership`, `PanelSizing`, `PromotionCandidate`; `meta.churn_90d`, `churn_warning`.
- New `GET/POST {P}/prompts/{id}/versions` (`If-Match`, `change_kind` without `restore`, `change_reason`), `POST .../versions/{vid}/restore`, `GET {P}/prompts/{id}/timeline`, `GET {P}/prompt-versions`; schemas `PromptVersionCreate`, `PromptTimeline`, `PromptVersionFeedRow`.
- New permission `panels:core:modify`.

**C10. Prompt discovery inbox (wave 5).**
- New `GET {P}/prompt-candidates`, `PATCH .../{id}`, `POST .../decide`, `POST .../generate`, `POST .../uploads`, `POST {P}/prompts/from-keywords/preview`; schemas `PromptCandidate`, `CandidateDecision`, `GenerateRequest`, `FromKeywordsPreview`.

**C11. Alerts and digests (wave 5).**
- New `GET /api/v1/alert-rule-types` (with the seven AI types of doc 11 10), `{P}/alert-rules` CRUD, `.../test`, `.../preview`, `{P}/alert-events`, `.../acknowledge`, `{P}/alert-digests`, `.../{id}`; webhooks under `{W}/webhook-endpoints` later (needs GEO-01).
- New permission `alerts:write`.

**C12. Saved views and exports (wave 5 and 6).**
- New `{P}/saved-views` CRUD (`views:write`), schema `SavedView` with screen keys including `ai.prompts`, `ai.citations`, `ai.fanout`.
- New `{P}/exports` (create, list, get, download, delete) with AI export kinds and the caveat header (doc 07 10); permission `exports:create`.

**C12a. Layouts and the Overview aggregates (Overview wave).**
- New `GET {W}/layouts/{screen}`, `PUT/DELETE {W}/me/layouts/{screen}`, `PUT/DELETE {W}/layouts/{screen}/default` with `LayoutDocument`, `NumberItem`, `CardItem`, `ResolvedLayout` exactly as doc 19 3.11.5c; `ETag` and `If-Match`; errors `404`, `412 precondition_failed`, `422 validation_failed`; session only.
- New permission `layouts:manage`; audit actions `layout.default.set`, `layout.default.remove`.
- Screen enum including `ai_overview`, `prompts`, `citations`, `sources`, `inspector.prompt`, `inspector.citation`; card and metric key enums from the generated catalog JSON.
- If presets are stored: `name` on the document row, `GET {W}/layouts/{screen}/presets` (proposal, not in doc 19); if presets are code, nothing.
- New `GET {P}/ai/metrics/overview`, `GET {P}/ai/metrics/{metric}`, `.../series`, `.../breakdown`, `GET {P}/ai/stats/compare` (also in C8), one per Overview card family, each returning `MetricValue` with n and the scope parameters.

**C13. Source intelligence (wave 6).**
- New `GET {P}/ai/sources/changes` (new and lost, `min_support`), `.../diversity`, `.../categories`, `.../competitor-overlap`, `.../influential-pages`, `.../domains/{domain_id}`, `GET {P}/opportunities/publishers`, `GET /api/v1/publishers`, `{W}/domain-category-overrides`.
- Changed `SourceDomainRow`, `SourcePageRow`: `category`, `first_seen_at` from stats; `filter[category_in]` on source reads.

**C14. Cross channel (wave 6).**
- New `{P}/xch/matrix`, `.../rows`, `{P}/xch/aio-citation-by-rank`, `{P}/pages`, `{P}/pages/{url_id}`, `.../series`, `{P}/pages/insights`; later 10b routes.

**C15. Optional late wave, only if the owner opens it (OD-11).**
- New `POST {P}/page-checks` (URLs to check, SSRF-safe fetch), `GET {P}/page-checks`, `GET {P}/page-checks/{id}` with `PageCheckResult` (`robots_ai_bots: [{bot_code, allowed, rule}]`, `llms_txt: {present, valid}`, `sitemap`, `meta_robots`, `jsonld: {found, expected_for_page_type, missing}`, `checks: [{code, status, fact}]`); no score. Route names are proposals, not in doc 19.
- First-party AI signals (Phase 12, not under OD-11): `GET {P}/fp/ai-referrals`, `{P}/fp/ai-crawlers`, `{P}/fp/genai-impressions`, `{P}/fp/bing-ai`, `/api/v1/fp/referrer-rules`, `/api/v1/fp/bot-registry` as doc 19 3.10.

## 27. Counts

| Status | Count |
|---|---|
| BUILT | 65 |
| PARTIAL | 26 |
| NOT BUILT | 202 |
| DEFERRED BY OWNER | 5 |
| Total capability rows | 298 |

Counted over the area tables (sections 1 to 21 and 18a). DEFERRED BY OWNER rows: COLLECT-13 (live answers), METRICS-12 (Prompt Explorer routes), METRICS-23 and OPS-12 (gzip, ops session), OPS-13 (ops work). Page level AI readiness (GEO-01 to GEO-09) is counted as NOT BUILT because the owner has not decided it (OD-11), not deferred it. The route table (section 22), table list (section 23) and worker steps (section 24) repeat ids and are not counted again.

## 28. Not verified in this pass

- Whether plan A switched on `subject_type: 'prompt'` for term assignments and `TermNode.prompt_count` (TOPICS-02, 03): the doc 19 as built text says not until prompts exist.
- Whether ingest fills `own_prominence` (EXTRACT-05, RECOMMEND-05).
- Whether `context_preamble` exists anywhere (PROMPTS-14): not seen in 0018 by grep of the table list only.
- Whether the AI payloads are covered by `schema_hash.py` (OPS-04), and which permissions already exist in `B/api/permissions.py` (OPS-09).
- That no layouts code exists anywhere in `backend/src` (grep for `layout` found no backend module; only the web `apps/web/src/lib/layouts`).
- Share of answers that hit the 16 KB bound, and whether the payload carries a quote per citation (CS Q1, Q2).
