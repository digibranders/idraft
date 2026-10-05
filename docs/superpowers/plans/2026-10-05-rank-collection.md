# Rank Collection Implementation Plan (step 5, part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily rank checks for every tracked keyword, from the DataForSEO SERP, stored immutably, with current state and rank events, served through the API (Phase 4 of `docs/29-phase-roadmap.md`).

**Architecture:** The step 3 adapter and the task ledger already submit, poll, fetch and store SERP results. This step adds the `seo_rank` workload (what to check and at what depth), a pure parser of the stored SERP, pure rank, state and event rules, an ingest tick that writes one snapshot per task in one transaction, and the API for the rank columns and the Phase 4 routes. Keywords (part 1, merged 2026-10-05) is the model: same tick pattern as `keyword_metrics_ingest`, same tenancy rules.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy Core async on asyncpg, PostgreSQL 18 with RLS and monthly partitions, the worker's ledger and queues, zstd raw payloads in R2, pytest with Testcontainers. The real DataForSEO API is never called: all tests use the existing fakes.

Groundwork: the digest of the specs and the code (what exists, 14 contradictions between docs, open decisions) was written on 2026-10-05; its findings are folded into the decisions below. Worktree `.claude/worktrees/backend-rank`, branch `backend/rank`.

---

## Decisions (settled; do not reopen without the product owner)

Set by the product owner on 2026-10-05:

- **R1. Collection starts by itself.** The first tracked keyword of a project also creates its default rank schedule (`seo_rank`, selector `{"all": true}`, daily, 02:00 local, 6 hour window, standard queue), as `ensure_metrics_schedule` does for metrics. A new tracked keyword gets a first check within minutes: a system run on the standard queue, found by a new-keyword step beside the one for metrics, with the same quiet rules (one planned run at a time, 24 hours after a blocked one). Budgets and the project's status still stop spend.
- **R2. Check now is built, as the last API task** (live endpoint, `POST {P}/seo/check-now`, at most 100 keywords, `runs:trigger`).
- **R3. AI Overview stays a SERP feature in this step.** The snapshot has `has_ai_overview` and `ai_overview_state`, the features have an `ai_overview` row with its source URLs, and rank observations have `cited_in_ai_overview` and `ai_overview_citation_position`. The `ai.*` tables, `ai.observations` and `ai.citations` come in step 8 and are re-derived from the raw SERPs kept 400 days. `tracked_keyword_state.aio_observation_id` stays null.
- **R4. Change is against the previous successful check with the same or greater depth coverage** (doc 09 section 4), and the API says which check (`previous_observed_at`). For a daily keyword that is yesterday's check.

Engineering choices (from the digest, recommended there):

- **R5. Ingest is a tick** (`seo_rank_ingest`, every 30 seconds, one transaction per task, `fetched` tasks claimed through `ledger.fetched_tasks`), not a `process` job. Docs 06 section 4.4 and 21 section 5.2 are corrected in the docs task.
- **R6. One migration, 0013**, with seven tables: `seo.serp_feature_types` (seed), `seo.serp_snapshots`, `seo.serp_features`, `seo.domain_rank_observations`, `seo.tracked_keyword_state`, `seo.serp_current_results`, `seo.rank_events`. Every tenant table carries `workspace_id` and keys between tenant tables include it. `serp_current_results` and `tracked_keyword_state` gain `workspace_id` (doc 04 has none). `tracked_keyword_state` gains `consecutive_beyond smallint` for the two-check debounce of `new_ranking` and `lost_ranking`. One snapshot per task: `UNIQUE (collection_task_id, observed_at)`. Snapshots reference `seo.tracked_keywords` through `(tracked_keyword_id, workspace_id)`; children reference the snapshot.
- **R7. The same migration** gives the worker SELECT on `core.entities`, `core.entity_domains`, `core.project_entities`, `core.project_domain_roles` and `seo.tracked_keyword_competitors`; seeds the SERP price book rows (standard $0.0006, priority $0.0012, live $0.002 a page, endpoint `serp/google/organic`); adds the definer function for the raw route (review log F8); and moves stale `seo_rank` schedules' `next_run_at` to now (F72), so the planner starts them at their next window instead of recording past ones as missed.
- **R8. Code layout.** The normalized types and the parser live in `providers/dataforseo/serp_parse.py` (providers may import `extraction`); rank resolution, state and event rules are pure and live in a new package `sightline/ranks/` with its own import-linter contract; the workload and the ingest writer are in `collectors/`. Doc 12's path `domain/observations/serp.py` is corrected, because `domain` may not import `extraction`.
- **R9. Overlapping schedules.** A keyword is planned at most once per project-local day across `seo_rank` schedules; a tracked keyword that names a schedule is left out of the `all` selector of the others.
- **R10. `until_own_match_100` is refused** at the API with `422 validation_failed`, code `depth_profile_not_available`, on tracked keywords and schedules' keywords alike, until `stop_crawl_on_match` is sent by the adapter.
- **R11. Async AI Overview cost:** one cost event per task as the ledger writes today; a daily reconcile reports the difference to `user_data`. A separate `ai_overview` event waits for spike S-01.
- **R12. `max_serp_checks_per_month`** is enforced for check now only (`422 quota_exceeded`); schedules are limited by budgets.
- **R13. Rank history `summary`** is computed inline from the window's rows (at most about 100 per entity).
- **R14. Deferred:** competitor backfill and `ops.derivation_log` (step 7), the shared fetch cache `ops.fetch_cache`, the data quality tables and the 1% schema-hash sampling (keep `is_valid`, default true), `ops.task_attempts`, the load test with 10,000 recorded payloads, and the real 14-day run (needs the droplet, step 6). The acceptance is an accelerated test against fakes.

Rulings on the contradictions the digest found (docs are corrected in Task 11):

1. Check now is Phase 4 (R2); doc 06 section 1 is wrong.
2. Ingest as a tick (R5).
3. `ops.fetch_cache` is deferred (R14).
4. `workspace_id` on the state and current-results tables (R6).
5. `include=competitors` on tracked keyword rows keeps returning the keyword's overrides; competitor ranks are `include=competitor_ranks`. Doc 19 is corrected and the web session is told.
6. Previous rank per R4.
7. SERP-level events (`aio_appeared`, `aio_disappeared`, `feature_gained`, `feature_lost`) carry the project's primary own entity; a project without one writes no rank events (it has no rank to speak of either).
8. The debounce counter is `consecutive_beyond` (R6).
9. The AI Overview state mapping is written in the parser task: snapshot `absent` gives `absent`; `present` or `present_async_loaded` gives `present_cited` when an own entity is cited, else `present_not_cited`; `present_not_loaded` gives `not_loaded`; a failed check gives `unknown`. The API filter lists all five.
10. One cost event per task (R11).
11. Doc 26's tag pattern is stale; the code's tag format is the truth.
12. See R8.
13. `tracked_keywords.frequency` is not used by rank collection; the weekly depth profiles express cadence. Doc note only.
14. See R10.

---

## File structure

Created:
- `backend/src/sightline/db/migrations/versions/0013_rank_collection.py`.
- `backend/src/sightline/providers/dataforseo/serp_parse.py`: `NormalizedSerp` and the parser, version 1.
- `backend/src/sightline/ranks/` (`resolve.py`, `state.py`, `events.py`): pure rules, with an import-linter contract in `backend/pyproject.toml`.
- `backend/src/sightline/collectors/seo_rank.py` (workload and the new-keyword step), `collectors/seo_rank_ingest.py` (ingest tick).
- `backend/src/sightline/api/ranks/` (`routes.py`, `service.py`, `repository.py`), `api/schemas/ranks.py`.
- Tests under `backend/tests/` beside each, fixtures under `backend/tests/fixtures/dataforseo/serp/`, and `tests/worker/test_rank_end_to_end.py`, `tests/worker/test_rank_acceptance.py`.

Modified: `db/tables.py`, `worker/assembly.py` (workload registration, ingest tick, order), `keywords/writer.py` (default schedule), `api/keywords/{repository,filters,service}.py` and `api/schemas/keywords.py` (state, filters, sorts, includes), `api/operations/` (check-now run results, depth profile refusal), `providers/dataforseo/{serp,provider}.py` (live SERP endpoint), `collectors/{live,ledger}.py` (live SERP, claim order), docs 04, 06, 09, 10, 12, 19, 21, 26, 27, 29, 31 and the review log.

---

## Execution

Every task: tests first, `backend/check.sh` green, commit, then an independent review on the Opus model (Agent with `model: "opus"`, in the background), fixes, gates again, a fix commit. The real DataForSEO API is never called; fakes are `FakeProvider` (`tests/collectors/support.py`) and the httpx `FakeDataForSeo` (`tests/worker/test_dataforseo_end_to_end.py`); SERP fixtures are hand-written and marked synthetic until spike S-01 captures real ones. A task that is large gets a sub-plan like `2026-10-05-keyword-imports.md` before it is built. Merge to `main` only at the product owner's word. Tasks 2 and 3 can run beside Task 1.

### Task 1: Schema (migration 0013)

- [ ] Tables, partitions (registered in `ops.partitioned_tables`, created with `SELECT ops.maintain_partitions()`), RLS `tenant_isolation`, grants per role (API: SELECT; worker: SELECT, INSERT, and UPDATE on named columns of the state table, DELETE on the current results), the feature type seed (every code of doc 06 section 5.4), the price book rows, the worker read grants (R7), the raw route's definer function, the F72 update. Update `db/tables.py` and doc 04.
- [ ] Tests: the catalog, grant matrix, RLS, least-privilege and metadata-drift tests of `tests/db/`; the F72 update leaves no window missed (a planner test).
- [ ] Gates, Opus review (tenancy and grants), fixes, commit.

### Task 2: Normalized types and parser v1

- [ ] `providers/dataforseo/serp_parse.py` per doc 06 section 5 and doc 12 section 3: organic items in order, `related_result` folded in, `rank_group` checked and recomputed (`rank_recomputed`), URLs canonicalized and redirect wrappers unwrapped, duplicate canonical URLs dropped, `depth_returned`, features mapped (section 5.4), the AI Overview slot (section 5.5) and the state mapping of ruling 9, `spell`, `check_url`, `datetime` as `observed_at` (validated against the partition range, else the fetch time). Unreadable paths raise `schema_mismatch`.
- [ ] Fixtures: `tests/fixtures/dataforseo/serp/*.json` plus `registry.json` (`schema_hash`, `READS_PATHS`), all marked synthetic. Tests: SERP-ORG-01 to 10, FEAT-01 to 06, AI Overview cached, async and absent, `spell`, an empty result (40102), `schema_mismatch`; a gold-set harness (`pytest -m gold`) ready for captured fixtures.
- [ ] Gates, Opus review, fixes, commit.

### Task 3: Rank resolution, state and events (pure)

- [ ] `sightline/ranks/`: resolve ranks of own and competitor entities with `DomainResolver` (organic and absolute rank, ranking URL, owned features, AI Overview citation), the state transition (current, previous per R4, best, worst, `consecutive_beyond`, `url_changed_at`, stale), the categorical change table (doc 09 section 4: numeric, new, lost, unchanged_beyond, consistent_beyond, first_check), and the event rules with the two-check debounce. Depth coverage: beyond depth is never imputed. Out-of-order checks do not move the state.
- [ ] Tests: RANK-01 to 09, the change table, event conditions, depth coverage, Hypothesis properties. Import-linter contract: `ranks` imports nothing from `collectors`, `api` or the database.
- [ ] Gates, Opus review (methodology), fixes, commit.

### Task 4: The ingest writer

- [ ] `collectors/seo_rank_ingest.py` and its tick: claim `fetched` tasks, read the payload from R2, normalize, resolve, then one transaction: upsert `core.domains` and `core.urls`; insert the snapshot (`ON CONFLICT (collection_task_id, observed_at) DO NOTHING`; when nothing is inserted only mark the task ingested); features, rank observations and events computed against the state row locked `FOR UPDATE`; update the state only when `observed_at` is newer; replace `serp_current_results` only when newer; `ledger.mark_ingested`. A storage failure waits (`ingest_later`, 5 minutes, give up after 1 day); a deleted keyword gets nothing and its task is ingested; `schema_mismatch` fails the task with the raw kept.
- [ ] Tests (database): ingest twice gives one snapshot; an older payload does not move the state; a deleted keyword; a storage failure waits; `schema_mismatch`; two workspaces never mix.
- [ ] Gates, Opus review, fixes, commit.

### Task 5: The `seo_rank` workload and registration

- [ ] `collectors/seo_rank.py`: subjects, selection (selectors `all`, `groups`, `terms` with subtrees, `priority_lte`; active keywords of a collecting project; R9), depth per profile and weekday in the project's zone (`light` 10, `standard` 20, `deep` 50, `full` 100; the deep weekday replaces the daily check; `weekly` 100 and `weekly_light` 20 on that weekday only), the estimate from the price book, `config_snapshot`, staggering through `domain.tasks.scheduled_for`, `build_requests` with the provider location map. The default schedule with the first keyword (R1) in `keywords/writer.py`, and the new-keyword step (R1). `worker/assembly.py` registers the workload only with the ingest tick present (F62). `depth_profile_not_available` for `until_own_match_100` (R10).
- [ ] Tests: the depth plan per profile and weekday across a DST change; selectors; double planning inserts nothing; estimates; overlapping schedules; a budget-blocked run; the new-keyword step's quiet rules.
- [ ] Gates, Opus review (this starts spend), fixes, commit.

### Task 6: End to end against the fake DataForSEO

- [ ] `tests/worker/test_rank_end_to_end.py`: a schedule goes to an ingested state; a duplicate `tasks_ready` id; a Redis flush mid-run; a 40403 resubmission; the sweeper; a storage failure; a rate limit (closes F65). Zero duplicate snapshots; every task paid once.
- [ ] Gates, light review, commit.

### Task 7: API part 1, tracked keyword rows and the contract draft

- [ ] `state` on every row and on the detail (current rank cell, change, best and worst, features, AI Overview, target URL match, stale), the doc 19 filters and sorts (beyond depth last both ways), `include` of `sparkline`, `features`, `aio` and `competitor_ranks`, and `ranking_url_count`. Regenerate `openapi/v1.json` early in the task and send the web session the path (new names: API `new` and `lost` map to its `entered` and `dropped`).
- [ ] Tests: sort with nulls last, every filter, cursor stability, cross-tenant, a member limited to projects.
- [ ] Gates, Opus review, fixes, commit.

### Task 8: API part 2, history and SERP routes

- [ ] `api/ranks/`: rank-history (both formats, bands, failed points, inline summary per R13), snapshots list and detail, `serp-current`, `serp-features`, `aio-history`, `rank-events`, the raw route (`raw:read`, `410 raw_expired`).
- [ ] Tests: depth-aware encoding as a golden response (doc 19 section 4.2), `410` after expiry, permissions, cross-tenant, route-access registry.
- [ ] Gates, Opus review, fixes, commit.

### Task 9: Check now (live)

- [ ] A SERP live endpoint in `serp.py` and `provider.py` (`live/advanced`, one task a call, $0.002 a page), the SERP branch in `collectors/live.py`, claim order by priority (F48), a cost event recorded when a live call is paid but fails (F78), `POST {P}/seo/check-now` with the manual run limit, `max_serp_checks_per_month` (R12), the budget check, `503 provider_paused`, and `RunDetail.results.tracked_keyword_ids`.
- [ ] Tests: the live call (respx); a timeout records a cost event; the limits and quota; a paused provider.
- [ ] Gates, Opus review, fixes, commit.

### Task 10: Cost checks

- [ ] `balance_check` every 15 minutes (`account_state`; alert under 14 days of trailing spend) and a daily `cost_reconcile` comparing the `user_data` day spend with the day's cost events, reporting the difference (R11).
- [ ] Tests: a `user_data` fixture; the difference reported per day; running twice counts nothing twice.
- [ ] Gates, light review, commit.

### Task 11: Acceptance, docs, whole branch

- [ ] `tests/worker/test_rank_acceptance.py`: 5,000 keywords over 14 simulated days on a fixed clock: at least 98% of checks ingested within the window plus 6 hours, no duplicate snapshots, cost within 5% of the price book.
- [ ] Docs: As built notes and corrections in docs 04, 06 (sections 1, 4.3, 4.4), 09, 10, 12 (path), 19 (competitors name, depth refusal, rank routes), 21 (ingest as a tick), 26 (tag pattern), 27, 29, 31 and the review log (tasks, carried items; F72 and F77 close).
- [ ] Whole-branch Opus review, fixes, gates, commit. Report with check results and ask before merging.

---

## Self-review

- **Spec coverage.** Doc 29 Phase 4: scheduled rank checks by depth profile (Tasks 4, 5), check now (9), SERP snapshots and features (1, 2, 4), AI Overview as a feature (2, 4; the `ai` tables deferred by R3), competitor ranks (3, 4, 7), current state and rank events (3, 4), adapter polling and the sweeper (built in step 3), ingest (4), planner and fairness (5), retry policy and reconciliation (built; Task 6 proves), cost capture and reconciliation (10), the parser gold set (2). Deferred with reasons: R14.
- **Open points of the digest, each decided above:** R1 to R14 and the rulings 1 to 14.
- **Risks carried into the work:** every SERP fixture is synthetic until spike S-01 (re-run Task 2's tests on captured fixtures before the deploy); the live SERP answer shape is assumed equal to `task_get/advanced`; the async AI Overview surcharge may make budgets over-count until reconcile (R11); F46, F59 and the partition range of `observed_at` (validated in Task 2).
