# Rank ingest (Task 4 of the rank collection plan) Sub-plan

> Parent plan: `docs/superpowers/plans/2026-10-05-rank-collection.md`, Task 4. Decisions R1 to R16 hold. This file adds R17 to R22 and the steps.

**Goal:** a `seo_rank_ingest` tick that turns every `fetched` rank task into a SERP snapshot, its features, the rank observations of the project's own and competitor entities, the keyword's state, the current top 20 and the rank events, once per task and in one transaction.

**Architecture:** the tick mirrors `collectors/keyword_metrics.ingest` (claim `fetched` tasks, load the stored answer, parse, write per task in its own transaction, wait or fail on errors). Parsing is `providers/dataforseo/serp_parse.py`; rules are `idraft/ranks/`; the writer in `collectors/seo_rank_ingest.py` is the only code here that touches the database.

**Tech stack:** SQLAlchemy 2 Core async, PostgreSQL 18, the existing ledger, R2 raw storage, pytest with Testcontainers.

---

## Decisions

- **R17. The request is read from the answer.** DataForSEO's `task_get` answer echoes the posted task in `tasks[].data` (`depth`, `device`, `os`, `language_code`, `location_code`, `se_domain`, `tag`). The ledger does not keep the depth (it is part of the idempotency key only), so the parser reads the echo into `NormalizedSerp.request`. `depth`, `device` and `language_code` are read strictly (a missing one is a `schema_mismatch`, paths `tasks[].data.depth` and so on, added to `READS_PATHS`); `os` and `se_domain` are optional.
- **R18. Which keyword and which configuration.** The subject of a `seo_rank` task is `tracked_keyword` / the tracked keyword's id. The snapshot takes the keyword's *current* `config_version`: a configuration changed between planning and ingest is a window of minutes to hours, and `tracked_keyword_config_history` records the change itself.
- **R19. The snapshot time.** `observed_at` is the provider's `datetime` when it lies between 7 days before the task was fetched and one hour after it, else the fetch time. The same raw payload gives the same value on every ingest, which the one-snapshot-per-task key needs.
- **R20. The competitor set of a keyword.** The project's `competitor` entities that are attached (`removed_at` null) and have `track_seo`, plus the entities the keyword `include`s, minus the ones it `exclude`s. An included entity must be attached to the project, because its domain rules come from `core.project_domain_roles`. Watched entities and the project's own entities are not competitors.
- **R21. Events and attribution.** Events are written for the primary own entity (R15) and only when the check is applied (newer than the state). `overtaken_by` and `overtook` compare against each competitor's observation in the keyword's previous snapshot (the one the state names), within the smaller depth of the two checks.
- **R22. An older payload still leaves history.** A payload older than the state's last check gets its snapshot, features and observations (they are history), but moves neither the state nor the current results and writes no events.

## Files

Create:
- `backend/src/idraft/collectors/seo_rank_ingest.py`: the tick (`ingest`), `IngestReport`, `_keep`.
- `backend/src/idraft/collectors/seo_rank_context.py`: loads the project's rank context (`RankContext`: resolver, entities, primary own entity, per-keyword competitors, target URL).
- `backend/tests/collectors/test_seo_rank_ingest.py` and `backend/tests/collectors/rank_support.py`.

Modify:
- `providers/dataforseo/serp_parse.py` (`RequestEcho`, `request`), `schema` tests and fixtures.
- `collectors/ledger.py`: `FetchedTask` gains `run_id`, `provider_code`, `provider_endpoint`, `provider_task_id`, `cost_usd`.
- `db/dictionaries.py`: `urls_for` (a batch).
- `tests/db/support.py`: `seed_rank` already seeds rows; the ingest tests build their own world.

## Steps

- [ ] **1. The request echo.** `RequestEcho(depth, device, os, language_code, location_code, se_domain)` in `serp_parse.py`; tests: the echo of the fixtures, a missing `data.depth` is a mismatch with that path, a string depth is a mismatch, `os` and `se_domain` optional. Add the three paths to `READS_PATHS`.
- [ ] **2. `FetchedTask` fields and `urls_for`.** Tests: the ledger returns them; `urls_for` adds new URLs and hosts once, returns ids by hash, takes locks in (host, hash) order.
- [ ] **3. The context.** `load_context(db, workspace_id, project_id, keyword_id)`: entities (role, primary, track_seo, not removed), rules from `core.project_domain_roles` joined to `core.domains`, per-keyword competitor overrides, the target URL. Tests: R20 cases, a path-prefix rule, a removed entity, a keyword that excludes a competitor.
- [ ] **4. The writer, pure parts first.** Build rows from `NormalizedSerp`, `ResolvedSerp` and the url ids: snapshot arrays, features, observations, current results. Tests with no database for the row builders.
- [ ] **5. The tick.** Claim, load payload, parse, write in one transaction per task: keyword row (soft-deleted gets nothing and the task is ingested), observed_at (R19), URLs, snapshot `ON CONFLICT (collection_task_id, observed_at) DO NOTHING`, features, observations, the state row inserted if missing and locked `FOR UPDATE`, `apply_check` and `own_events` plus overtakes (R21), the state update (named columns), current results replaced, events inserted, `mark_ingested`. Errors as in `keyword_metrics.ingest`: a storage failure waits (`ingest_later`, 5 minutes, gives up after 1 day); a `schema_mismatch` fails the task with the raw kept (`ingest_failed`, `UNREADABLE`).
- [ ] **6. Database tests** (`tests/collectors/test_seo_rank_ingest.py`): one SERP gives a snapshot, features, an observation per entity, a state, 20 current results; ingest twice gives one snapshot; an older payload leaves history and no state change (R22); the second day's check writes the change and events; a deleted keyword; a storage failure waits and then gives up; `schema_mismatch`; two workspaces never mix; a competitor excluded for the keyword has no observation; a project without a primary own entity writes state and no events.
- [ ] **7. Gates, Opus review, fixes, commit.** `backend/check.sh`; an independent review on the Opus model (writer, tenancy, idempotence, locks); fixes; gates; fix commit.
