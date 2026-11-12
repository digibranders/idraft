# WP-67: Engine and data expansion: forced search, official APIs, other surfaces, API keys

| Field | Value |
|---|---|
| Wave | W6: Blocked by the provider or the owner: AI Overview engine and cross-channel, discovery sources, engine expansion, LLM features, first-party signals |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-67-engine-expansion` in `.claude/worktrees/wp-67` (`infra/dev/wp-start WP-67 engine-expansion`) |
| Depends on (merged on develop first) | [WP-58 stats-api](WP-58-stats-api.md) |
| Owner decisions | D-26 Real provider spend: resume Eventus schedules and run the acceptance (default: A monthly AI budget of USD 10 for Eventus: its 72 prompts on 3 engines cost about USD 2.25 a month on the schedule (USD 4.70 at the 150 prompt base plan) and about USD 0.26 per full Run now, so USD 10 covers the schedule, the two acceptance runs and Run now headroom); D-27 LLM use (adjudication, category classification, candidate variants, onboarding suggestions) (default: No until a provider and a budget are chosen; rules and templates first) |
| Estimate | 12 Sonnet-agent tasks, about 9 hours with one task in flight |
| Rows | 10 (built already: 0, to do: 10) |

## Goal

Blocked by spend and product decisions (Phase 13 to 14): `chatgpt_web_forced_search` on request, official API engines with pinned models and the benchmark workload, consumer surfaces not on DataForSEO with a fallback provider, Copilot through Bing, fan-out from official APIs, DataForSEO LLM Mentions snapshots and the brand mentions landscape, public API keys for AI reads.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/07 sections 1, 3.4, 9
- docs/05
- docs/19 3.2.4

## Files this package owns

- `backend/src/idraft/providers/ (new adapters)`
- `backend/src/idraft/collectors/ai_benchmark.py (new)`
- `backend/src/idraft/api/api_keys/ (new)`

## Files it must not touch

- Any file another work package owns (each WP file lists its own); ask the coordinator for a lease instead
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` except by regeneration in the same push as your own API change
- `backend/src/idraft/api/main.py`, `permissions.py`, `problems.py`, `resources.py` (WP-01 registered everything); new problem codes go in your own module as `ProblemError` subclasses
- `apps/web/src/lib/navigation/registry.ts` except flipping your own page's status to `live`
- `apps/web/src/mocks/handlers/index.ts` (WP-02 registered your handler module)
- `apps/web/e2e/support.ts` (add `apps/web/e2e/support/<slug>.ts` instead)
- Message namespaces of other packages in `apps/web/messages/en.json`
- `docs/ai-visibility/tracker.json` and `TRACKER.md` (the coordinator owns them)
- The main checkout, `.claude/worktrees/release`, Colima and the `idraft-dev-*` containers

## Contract

New engine codes and API key routes, contract notes per part.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; Sonnet implementers per adapter; one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-67 engine-expansion`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-67-engine-expansion.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Forced search engine | BE-ENGINES-05 |
| 2 | Official API engines, pinned models, benchmark, fan-out comparison | BE-ENGINES-07, BE-ENGINES-11, BE-COLLECT-14, BE-FANOUT-08 |
| 3 | Other consumer surfaces and Copilot | BE-ENGINES-08, BE-ENGINES-09 |
| 4 | LLM Mentions snapshots and landscape | BE-COLLECT-21, BE-COMPETITORS-08 |
| 5 | Public API keys | BE-EXPORT-04 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Official API engines are never pooled with consumer engines (test)
- Every new route has its access line in `test_route_access.py` and is scanned by `test_cross_tenant.py` (inside the package's anchor block); every new table has RLS, grants and a `_TENANT_ROWS` entry
- Aggregates are one grouped query with a statement count test; new expensive parts are opt-in (`include=` or a parameter) and absent unless asked; branded prompts excluded by default
- `backend/openapi/v1.json` regenerated (`cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`) and, in the same push, `pnpm gen:api` and `pnpm typecheck` in apps/web
- Targeted pytest (`--no-cov`, `-n 2`) in the medium lane during work; `./check.sh` through `infra/dev/heavy` before the last push
- No real provider or LLM call in any test or check
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- Prove it bites (risky code: money, tenants, locks, cursors, statistics): for every guard the package adds, the reviewer removes or weakens it in a scratch commit that is never pushed, runs the targeted test, records that it fails, and restores the guard; the list of guards and the failing test names go into the package report
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-67: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-67 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-67 <status> | branch ai/wp-67-engine-expansion @ <short sha> | rows done <n>/10 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-ENGINES-05 | BE | NOT BUILT | `chatgpt_web_forced_search` engine (separate series, never mixed) |
| BE-ENGINES-07 | BE | NOT BUILT | Official API engines `openai_api_search`, `anthropic_api_search` (Clau |
| BE-ENGINES-08 | BE | NOT BUILT | Consumer surfaces not on DataForSEO: `perplexity_web`, `copilot_web`,  |
| BE-ENGINES-09 | BE | NOT BUILT | Microsoft Copilot through the Bing SERP `ai_overview` element |
| BE-ENGINES-11 | BE | NOT BUILT | Pinned model version per official API engine, model change makes a ver |
| BE-COLLECT-14 | BE | NOT BUILT | Workload `ai_benchmark` for official APIs (LLM Responses), weekly on 1 |
| BE-FANOUT-08 | BE | NOT BUILT | Fan-out from official API engines (Ph 14) and comparison to the scrape |
| BE-COLLECT-21 | BE | NOT BUILT | DataForSEO LLM Mentions dataset snapshots (`ai.external_mention_snapsh |
| BE-COMPETITORS-08 | BE | NOT BUILT | Brand mentions outside our answers: DataForSEO LLM Mentions landscape  |
| BE-EXPORT-04 | BE | NOT BUILT | Public API access with API keys for AI reads |
