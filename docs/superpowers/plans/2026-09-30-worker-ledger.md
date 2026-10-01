# Worker, Queues and Task Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with: gates green (`backend/check.sh`), an independent review on the Opus model, fixes, commit.

**Goal:** A worker process that plans collection runs from schedules, checks the budget, and submits paid work to a provider exactly as the ledger in PostgreSQL says, so that losing Redis or the process loses nothing and spends nothing twice.

**Architecture:** Step 2 of the build order (`docs/29-phase-roadmap.md` section 1.1), specified in `docs/21-scheduler-workers.md`. PostgreSQL is the ledger and Redis the transport: Taskiq messages carry task ids, and every handler reads the ledger row before acting. One process (`python -m sightline.worker`) runs two Taskiq receivers (`collect`, `process`), the planner and dispatcher ticks under Redis locks, and Taskiq's scheduler for maintenance jobs. Rules that need no I/O live in `sightline.domain`; everything that touches the ledger lives in `sightline.collectors`; the process and its messages live in `sightline.worker`.

**Tech stack:** Taskiq 0.13 with `taskiq-redis` (Redis streams), SQLAlchemy 2 Core on asyncpg as `app_worker`, Redis 8, pytest with Testcontainers, Hypothesis for the pure rules.

---

## Scope

Built here: the pure scheduling rules, the worker process, the ledger and its state machine, the budget check, the planner, the dispatcher, provider submission against the adapter contract, the reconciler's ledger steps, and the first maintenance job.

Not here, and where it arrives:

| Item | Arrives with |
|---|---|
| A real provider adapter, the provider rate limiter, raw payload storage | step 3 (DataForSEO client) |
| `poll_ready` and `fetch_task` (they store raw payloads), resolving `submit_unknown` by listing provider tasks | step 3 |
| A workload that plans real tasks (`seo_rank`), ingest jobs | step 5 (keywords and rank collection) |
| Manual runs and the run, task and requeue routes | step 5 |
| Healthchecks pings, alerts on a soft limit, the remaining maintenance jobs | step 10 (launch hardening), or the feature that needs the job |
| `cron` cadence (only `cloudflare_sync` uses it) | Phase 12 |

No workload and no provider is registered in production by this plan, so the deployed worker plans nothing and spends nothing until step 5. The engine is proven end to end in tests with a fake workload and a fake provider.

## Decisions

- **D1. The ledger decides, the queue only wakes.** A message names task ids. A handler locks the rows, checks their status, and exits when the work is no longer due. Taskiq has no retry middleware and no result backend; messages are acknowledged after the handler finishes, so a crash redelivers and the ledger check makes the redelivery harmless.
- **D2. Submission is at most once.** A task moves `pending` to `submitted` only with a provider task id. If the call may have reached the provider and the answer was lost (timeout, dropped connection), the task becomes `submit_unknown` and is never resubmitted by this plan; step 3 resolves it by asking the provider.
- **D3. Budget, twice.** When a run is planned: month-to-date spend of the budget group, plus what the runs under way are still expected to spend, plus the run's estimate, against every budget that applies (workspace or project, the group or `all`). Over a hard limit with `action_on_hard = 'pause'`, the run is `budget_blocked` and has no tasks. When a batch is dispatched: the same check with no estimate, so a budget used up since planning holds the project's tasks back; they stay `pending`, and the run records `status_reason = 'budget_exceeded'`. Spend is read from `ops.provider_cost_events`, not the hourly rollup, which would be up to an hour behind.
- **D4. A pending task does not wait for ever.** A task never submitted 24 hours after its run's window closed is `cancelled` (`window_missed`) by the reconciler: a rank check that late belongs to the next run. This is new to doc 21.
- **D5. Missed windows are not caught up.** After downtime only the latest missed occurrence of a schedule is planned; earlier ones are recorded as `cancelled` runs with `missed_window`, so gaps are visible (doc 21 section 3.1).
- **D6. The worker writes as `app_worker`**, which bypasses row-level security. Every row it writes takes `workspace_id` and `project_id` from the schedule or run it belongs to, never from a message or a provider. Tests connect as that role.
- **D7. Locks** are Redis keys with a random token, set with `NX` and a TTL, released by a script that deletes only its own token. A tick that outlives its TTL loses the lock and the next holder runs; every tick is safe to run twice (`FOR UPDATE SKIP LOCKED`, idempotency keys).
- **D8. Workloads and providers plug in.** A workload implements `plan` (schedule to task specs with estimates) and `build_requests` (tasks to provider requests); a provider implements the adapter contract of doc 05. Both are registered by name. The contract types needed for submission are defined now; the rest of doc 05 section 3 arrives with the first real adapter.
- **D9. Time.** Everything stored is UTC. A schedule's window start is local time in the schedule's zone, computed with `zoneinfo`: a local time that a spring-forward skips starts later by the size of the gap (02:30 becomes 03:30), and one that occurs twice starts at its first occurrence. A monthly schedule runs on one day of the month, 1 to 28, stored in `ops.schedules.month_day` (migration 0007); a later day would have no window in some months. The day is not read back from `next_run_at`: where a clock change carries a window past midnight (Nuuk, 23:00 to 00:00) that would move the schedule to the next day for good.

## File structure

| File | Responsibility |
|---|---|
| `backend/src/sightline/domain/workloads.py` | Task workloads, cost workloads, budget groups and their mapping (doc 04 section 11.4.1) |
| `backend/src/sightline/domain/schedules.py` | Occurrences of a schedule: next window start, missed occurrences |
| `backend/src/sightline/domain/tasks.py` | Idempotency key, partition month, stagger offset |
| `backend/src/sightline/domain/retries.py` | Retry policy per error kind (doc 21 section 6) |
| `backend/src/sightline/providers/contract.py` | The part of the adapter contract submission needs |
| `backend/src/sightline/collectors/ledger.py` | Statements on runs and tasks: create, claim, transitions, completion |
| `backend/src/sightline/collectors/budget.py` | Month-to-date spend and the budget verdict |
| `backend/src/sightline/collectors/registry.py` | Workload and provider registries |
| `backend/src/sightline/collectors/planner.py` | One planner tick |
| `backend/src/sightline/collectors/dispatcher.py` | One dispatcher tick |
| `backend/src/sightline/collectors/submission.py` | `submit_batch`: provider call and ledger outcome |
| `backend/src/sightline/collectors/reconciler.py` | The reconciler's ledger steps and the partition job |
| `backend/src/sightline/collectors/read_only.py` | The read-only savepoint workloads run in |
| `backend/src/sightline/worker/queues.py` | The two queues: the stream read loop, sends with dedupe keys, scheduled jobs and their claims |
| `backend/src/sightline/worker/{locks,ticks,scheduler,pauses}.py` | Redis locks, ticks under locks, the scheduler supervisor, provider pauses |
| `backend/src/sightline/worker/{app,assembly,healthcheck,__main__}.py` | The process, what it is made of, its healthcheck, its entrypoint |
| `backend/src/sightline/db/tables.py` | Adds the `ops` tables the worker reads and writes |
| `backend/src/sightline/db/migrations/versions/0006` to `0008` | Run guard over scheduled runs, schedule days, the dispatcher's index, budget deletion |

As built, the file list differs from the one planned: messages live with the code that sends them (`collectors/dispatcher.py`), because `collectors` may not import `worker`; brokers, dedupe and jobs are one module (`worker/queues.py`), and the jobs are registered in `worker/assembly.py`.

## Tasks

### Task 1: The rules that need no I/O

- [ ] Tests first (`tests/domain/`), with Hypothesis where a property says more than examples: every task workload maps to one budget group and every cost workload to one; the next occurrence is strictly after the given instant, falls at the local window time, and is right across both DST changes and for weekly and monthly cadences (a monthly rule on a day later than the 28th is refused); missed occurrences are listed oldest first; the stagger offset is stable for a subject, inside the first 80% of the window, and spread; the idempotency key changes with each identity field and the partition month is the window's month; each error kind gives the documented backoff, attempt limit and final status.
- [ ] `domain/workloads.py`, `schedules.py`, `tasks.py`, `retries.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 2: The worker process

- [ ] Tests first (`tests/worker/`, real Redis): a lock is exclusive, expires, and is released only by its holder; a dedupe key lets one message through and is cleared by the handler; a tick runs on its interval under its lock, survives an exception, and two runners never overlap; both queues receive at their concurrency; a message is acknowledged after its handler finishes and redelivered when the handler's process dies; shutdown waits for in-flight handlers and then stops; a scheduled job fires once with two schedulers; the heartbeat file is fresh while running and the healthcheck exits non-zero when it is stale.
- [ ] Worker settings, brokers, messages, dedupe, locks, ticks, app, healthcheck, entrypoint.
- [ ] Gates, Opus review, fixes, commit.

### Task 3: Ledger and budget

- [ ] Tests first (`tests/collectors/`, as `app_worker`): a run is created once per schedule and window; tasks insert in batches and a second insert adds nothing; claiming returns due tasks in order, skips locked rows, caps each project at 500 and does not return a task twice; each transition is refused from a status it does not follow; a failure applies the retry policy (back to `pending` with `next_attempt_at`, or `failed`, or `dead`); a run completes when its tasks are terminal, with errors at 2% or more; spend sums the right cost workloads for a group and month; the verdict covers workspace and project budgets, `all`, `alert_only`, and the soft limit.
- [ ] `db/tables.py` additions, `collectors/ledger.py`, `collectors/budget.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 4: Planner

- [ ] Tests first, with a fake workload: a due schedule becomes one run with staggered tasks and the next `next_run_at`; planning twice adds nothing; two planners at once plan each schedule once; missed occurrences become `cancelled` runs and only the latest is planned; a run over budget is `budget_blocked` with the budget named and no tasks; an inactive schedule, a schedule of a deleted or archived project and an unknown workload are skipped; the rows carry the schedule's workspace and project.
- [ ] `collectors/registry.py`, `collectors/planner.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 5: Dispatcher and submission

- [ ] Tests first, with a fake provider: due tasks are grouped by provider, endpoint and priority into batches of the provider's size, high priority first; a batch is enqueued once (dedupe) and its tasks marked dispatched; a project over budget is held back; accepted tasks become `submitted` with their provider id and a cost event; rejected tasks follow the retry policy; a timeout after the request was sent makes `submit_unknown`; a redelivered message submits nothing twice; an error that pauses the provider leaves tasks `pending`.
- [ ] `providers/contract.py`, `collectors/dispatcher.py`, `collectors/submission.py`, `worker/jobs.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 6: Reconciler and maintenance

- [ ] Tests first: a task dispatched 10 minutes ago is released (on age alone: see doc 21 section 8.2); a task `submitted` for 72 hours is `dead`; a pending task 24 hours past its window is `cancelled`; runs whose tasks are all terminal are completed; `ensure_partitions` creates the months ahead; both jobs are on the scheduler's list.
- [ ] `collectors/reconciler.py`, maintenance jobs in `worker/jobs.py`, scheduler wiring.
- [ ] Gates, Opus review, fixes, commit.

### Task 7: End to end, image, docs

- [ ] `tests/worker/test_end_to_end.py`: the real process loop with the fake workload and provider: a schedule becomes submitted tasks; Redis is flushed mid-run and the reconciler brings the work back with no second provider submission; the process is stopped mid-batch and a new one finishes.
- [ ] `backend/smoke.sh` starts the worker from the image as `app_worker` and waits for a fresh heartbeat.
- [ ] Docs: 21 (D3, D4, what is built), 22 (worker environment), 31, `review-log.md`, `backend/README.md`.
- [ ] Whole-branch Opus review, fixes, commit.
