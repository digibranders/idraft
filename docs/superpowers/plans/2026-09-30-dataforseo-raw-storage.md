# DataForSEO Client, Rate Limiter and Raw Payload Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with: gates green (`backend/check.sh`), an independent review on the Opus model, fixes, commit.

**Goal:** The worker can send tasks to DataForSEO, find out when they are ready, fetch their results and keep the exact bytes in R2, at the provider's rate and never paying twice; and the Phase 0 test runs can be made against the live API.

**Architecture:** Step 3 of the build order (`docs/29-phase-roadmap.md` section 1.1), specified in `docs/05-provider-integrations.md` section 3, `docs/06-dataforseo-seo-integration.md` sections 1 to 4, 6 and 9, `docs/21-scheduler-workers.md` sections 7 and 8, and `docs/23-backup-disaster-recovery.md` section 9. The DataForSEO adapter lives in `sightline.providers` (no database, no Redis). The rate limiter and the jobs live in `sightline.worker`; the ledger steps and raw payload registry in `sightline.collectors`. Normalising a SERP and writing SEO facts is step 5.

**Tech stack:** httpx (one shared `AsyncClient` per provider), Redis Lua token buckets, `aiobotocore` for R2's S3 API, `zstandard` at level 6, MinIO in tests through Testcontainers.

---

## Scope

Built here: the rest of the provider contract that fetching needs, DataForSEO error classification, the SERP adapter (`task_post`, `tasks_ready`, `task_get/advanced`, `id_list`, `user_data`), the shared rate limiter, raw payload storage in R2 with its registry, the ledger steps `submitted` to `ready` to `fetched`, the `poll_ready` and `fetch_task` jobs, the id sweeper, resolving `submit_unknown` by asking the provider (review log F36), and the tools for the Phase 0 test runs.

Not here, and where it arrives:

| Item | Arrives with |
|---|---|
| Normalising a SERP, `ingest_serp`, the shared fetch cache (`ops.fetch_cache`) | step 5 (rank collection) |
| `live` mode ("check now") | step 5 (manual runs) |
| Balance check and daily cost reconciliation jobs (`user_data`) | step 10 (launch hardening); the client call is built here |
| The local spool (`SPOOL_DIR`) | not needed yet: see D5 |
| AI spikes S-04 to S-06 | step 8, with the AI adapter |

No workload is registered in production by this plan, so the deployed worker still plans and sends nothing. The DataForSEO provider is registered when its credentials are set.

## Decisions

- **D1. The contract grows by what fetching needs.** `Provider` gains `list_ready(endpoint)`, `fetch(endpoint, provider_task_id)` returning a `FetchResult` with the exact response bytes, and `find_submitted(endpoint, since, until)` returning the tasks the provider holds with their tags. A provider that cannot list its tasks says so, and `submit_unknown` then keeps its current path (ended after the result lifetime and charged its estimate).
- **D2. The tag is the link.** Every request carries `tag = i:<installation>:t:<task id in base36>:a:<attempt>:r:<run id, 32 hex>` (doc 06 section 3.1). `tasks_ready`, `id_list` and results echo it, so a provider id is matched to our task without a lookup table. An echo names a task only when installation, task, attempt and run all match. (First written with 8 hex digits of the run id; the Task 1 review showed those are a timestamp for version 7 ids.)
- **D3. One limiter, taken before every call.** A Redis Lua token bucket per scope under `rl:dataforseo:`: all calls (1,000 per minute), and one per endpoint family with its own limit (`tasks_ready` 20, `id_list` 10, `user_data` 6, `errors` 10 per minute). A call waits for a token up to its deadline; one that would wait longer is not made and is reported as `rate_limited` without reaching the provider. On `rate_limited` from the provider the global rate is halved for 10 minutes (an override key), and `retry_after` from the answer is passed to the retry policy (F41).
- **D4. What the adapter says about a failed call is exact.** A connection that never opened is `upstream_unavailable` (not sent). A timeout or a dropped connection after the request was written is `timeout` (outcome unknown). HTTP status and DataForSEO `status_code` are checked at the top level and per task (doc 06 section 9).
- **D5. Raw payloads go straight to R2.** The exact response bytes are hashed (sha256), compressed with zstd level 6, and written to `raw/v1/<retention_class>/dataforseo/<endpoint_slug>/<yyyy>/<mm>/<dd>/<sha256>.json.zst`, then registered in `ops.raw_payloads` with `expires_at` from the class retention. A payload already registered is not written again. If R2 fails, the fetch fails and is tried again: DataForSEO keeps results for 30 days, so an R2 outage delays collection and loses nothing. The local spool of doc 22 is not built.
- **D6. Ready and fetched are ledger states.** `poll_ready` moves a task from `submitted` to `ready` with a conditional update and sends `fetch_task` only when the update changed a row. `fetch_task` stores the payload, records its id and moves the task to `fetched`. Both are safe to run twice. The id sweeper (reconciler) sends `fetch_task` for tasks still `submitted` two hours after submission.
- **D7. `submit_unknown` is resolved by asking the provider (F36).** The reconciler lists the provider's tasks posted around each unknown submission (`id_list`, with metadata). A task found by its tag becomes `submitted` with its provider id and reported cost. One still not found 15 minutes after its submission goes back to `pending` for a new submission (doc 21 section 6). Spike S-01 confirms that `id_list` returns the tag; until it does, this path is off by a setting and the current one applies.
- **D8. Fixtures.** Tests use responses shaped from DataForSEO's documentation, marked as synthetic in `backend/tests/fixtures/dataforseo/`. Spike S-01 captures real ones, which replace them.
- **D9. The Phase 0 test runs are tools, not production code.** `backend/spikes/` holds a script per spike that uses the real client, spends no more than a cap passed on its command line, and writes its result to `docs/spikes/S-xx.md`. They run only with credentials, and only when the product owner says so.

## File structure

| File | Responsibility |
|---|---|
| `backend/src/sightline/config/settings.py` | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `R2_RAW_ENDPOINT`, `R2_RAW_BUCKET`, `R2_RAW_ACCESS_KEY_ID`, `R2_RAW_SECRET_ACCESS_KEY` |
| `backend/src/sightline/providers/contract.py` | `FetchResult`, `ReadyTask`, `SubmittedTask`, the new `Provider` methods |
| `backend/src/sightline/providers/dataforseo/{errors,tags,client,serp}.py` | Error classification, tags, the HTTP client with limiter hooks, the SERP adapter |
| `backend/src/sightline/storage/raw.py` | Compression, keys, the R2 client |
| `backend/src/sightline/collectors/raw_payloads.py` | Registering payloads in `ops.raw_payloads` |
| `backend/src/sightline/collectors/{ledger,fetching,reconciler}.py` | Ready and fetched transitions, `poll_ready` and `fetch_task`, the id sweeper and the `submit_unknown` resolver |
| `backend/src/sightline/worker/{limiter,assembly}.py` | The Redis token buckets; wiring the provider, jobs and ticks |
| `backend/spikes/` | The Phase 0 test runs |

## Tasks

### Task 1: Contract, settings, errors and tags (pure)

- [ ] Tests first: every documented DataForSEO status maps to its kind (doc 06 section 9), at the top level and per task; HTTP 401, 402, 429 and 5xx map; a tag round-trips and a malformed or mismatched one is refused; the settings read the new variables and keep the credentials secret; `FetchResult` holds bytes and refuses a negative cost.
- [ ] `providers/contract.py`, `providers/dataforseo/errors.py`, `tags.py`, settings, doc 22 (`R2_RAW_ENDPOINT`, `R2_RAW_BUCKET`).
- [ ] Gates, Opus review, fixes, commit.

### Task 2: Rate limiter

- [ ] Tests first (real Redis): a bucket gives its rate and no more over a window; two workers share it; a call that would wait past its deadline is not made; the override halves the global rate for its time and then lapses; the keys are under `rl:` (the documented ACL).
- [ ] `worker/limiter.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 3: The DataForSEO client and SERP adapter

- [ ] Tests first (httpx `MockTransport`): `task_post` sends up to 100 tasks with our tags, basic auth and no callback URL, and maps accepted and refused tasks with their cost; `tasks_ready` returns ids with tags; `task_get/advanced` returns the exact bytes; `id_list` returns tags and costs; `user_data` returns balance and limits; a connect error is `upstream_unavailable` and a read timeout `timeout`; every call takes the limiter first; credentials never reach a log line.
- [ ] `providers/dataforseo/client.py`, `serp.py`, synthetic fixtures.
- [ ] Gates, Opus review, fixes, commit.

### Task 4: Raw payload storage

- [ ] Tests first (MinIO): a payload is stored under its key, compressed, and read back byte for byte; the same bytes twice are stored once; the registry row has size, hash, class and expiry; an R2 failure raises and registers nothing; keys follow doc 23 section 9.1.
- [ ] `storage/raw.py`, `collectors/raw_payloads.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 5: Ready, fetched, and the reconciler's provider steps

- [ ] Tests first: `poll_ready` moves only `submitted` tasks and sends one `fetch_task` per task; `fetch_task` stores the payload once and moves the task to `fetched`, and a second delivery does nothing; an expired result follows the retry policy; the id sweeper fetches tasks `submitted` two hours ago; an unknown submission found by its tag becomes `submitted` with its cost, and one not found after 15 minutes goes back to `pending`, only when the resolver is on.
- [ ] `collectors/fetching.py`, ledger transitions, reconciler steps, jobs and ticks in `worker/assembly.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 6: End to end, image, docs

- [ ] `tests/worker/test_dataforseo_end_to_end.py`: the real process with a fake workload against a fake DataForSEO (an httpx transport) and MinIO: a schedule becomes fetched tasks with their payloads in storage, each sent and paid once; an unknown submission is resolved.
- [ ] `backend/smoke.sh` unchanged in behaviour (no credentials in CI); docs 05, 06, 21, 22, 23, 31, review log, README.
- [ ] Whole-branch Opus review, fixes, commit.

### Task 7: The Phase 0 test runs

- [ ] `backend/spikes/` with S-01 (billing, tag echo, `id_list`), S-02 (payload sizes and zstd ratio), S-03 (AI Overview presence with and without async loading) and S-15 (turnaround by hour), each with a spend cap; a fixture capture tool writing to `backend/tests/fixtures/dataforseo/`.
- [ ] Run with the product owner's credentials and approval; write `docs/spikes/S-01.md`, `S-02.md`, `S-03.md`, `S-15.md`; replace the synthetic fixtures; update docs 27 and 28 with the measured numbers.
