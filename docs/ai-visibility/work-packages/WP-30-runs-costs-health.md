# WP-30: Runs, costs, budgets and collection health (W21 freshness)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-30-runs-costs-health` in `.claude/worktrees/wp-30` (`infra/dev/wp-start WP-30 runs-costs-health`) |
| Depends on (merged on develop first) | [WP-03 contract-pack](WP-03-contract-pack.md), [WP-07 app-parts-a](WP-07-app-parts-a.md) |
| Owner decisions | D-26 Real provider spend: resume Eventus schedules and run the acceptance (default: A monthly AI budget of USD 10 for Eventus: its 72 prompts on 3 engines cost about USD 2.25 a month on the schedule (USD 4.70 at the 150 prompt base plan) and about USD 0.26 per full Run now, so USD 10 covers the schedule, the two acceptance runs and Run now headroom) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 35 (built already: 22, to do: 13) |

## Goal

One session end to end: `GET {P}/runs/{id}/ai-coverage` (C3), `GET {P}/ai/collection/daily` (N5), budget CRUD, cost forecast and unit costs, the `+` and `%` probe as a test, the schema hash check of AI payloads; on the web the sidebar collection line, the Updated link to the run, collection progress while a run answers, the degraded notice, the AI run inspector, unit cost per answer, the budgets and usage page with the AI meters.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/19 3.7.5, 3.11.2, 3.11.4
- overview-and-charts.md N5
- docs/27 (costs)

## Files this package owns

- backend/src/idraft/api/operations/ (coverage, collection daily, budgets, forecast)
- `backend/tests/api/operations/`
- `apps/web/src/features/operations/`
- `apps/web/src/features/costs/`
- `apps/web/src/features/workspace-settings/budgets/`
- `apps/web/src/components/app/shell/sidebar.tsx (collection line only)`

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

Implements C3 and N5 from the contract pack; budgets CRUD and forecast as doc 19 3.11.2.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; one Sonnet backend implementer, two Sonnet web implementers; one Sonnet reviewer; prove-it-bites on budget arithmetic and tenant scope.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-30 runs-costs-health`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-30-runs-costs-health.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | ai-coverage and collection daily | BE-COLLECT-10, OV-N5 |
| 2 | Budgets CRUD, forecast, unit costs | BE-BILLING-PLAN-LINKS-11, BE-BILLING-PLAN-LINKS-15 |
| 3 | Probe test and schema hash check | BE-COLLECT-18, BE-OPS-04 |
| 4 | Built rows confirmed | BE-COLLECT-01..09, BE-COLLECT-16, BE-COLLECT-17, BE-COLLECT-19, BE-BILLING-PLAN-LINKS-08..10, BE-BILLING-PLAN-LINKS-14, BE-OPS-03, BE-OPS-05, BE-OPS-06, BE-REPORTS-10 |
| 5 | Web: sidebar line, Updated link, progress, degraded notice, run inspector, unit costs | WB-NAV-03, WB-OPS-01..07 |
| 6 | Web: budgets and usage page | WB-SET-15 |
| 7 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- No real provider call is made by any test or check
- Prove it bites on budget and quota arithmetic
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
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

- One commit per task, message `WP-30: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-30 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-30 <status> | branch ai/wp-30-runs-costs-health @ <short sha> | rows done <n>/35 | steps <n>/8 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-COLLECT-01 | BE | BUILT | DataForSEO adapters: ChatGPT scraper, Gemini scraper, AI Mode, `task_p |
| BE-COLLECT-02 | BE | BUILT | Normalizers v1: text, markdown, sources, status (`complete`, `partial` |
| BE-COLLECT-03 | BE | BUILT | Raw payload to R2 as `ai_raw` with SHA-256, `answer_hash` on the obser |
| BE-COLLECT-04 | BE | BUILT | `provider_extras` (fan-out list, `search_results` count, `brand_entiti |
| BE-COLLECT-05 | BE | BUILT | Workload `ai_prompt`: plan per active prompt, enabled engine, location |
| BE-COLLECT-06 | BE | BUILT | Ingest tick `ai_prompt_ingest` (30 s): observation, citations, mention |
| BE-COLLECT-07 | BE | BUILT | `POST {P}/prompts/{id}/run-now` on the standard queue, 20 manual runs  |
| BE-COLLECT-08 | BE | BUILT | `POST {P}/ai/runs` bulk run, up to 150 prompts as ONE manual run, `met |
| BE-COLLECT-09 | BE | BUILT | Runs and run detail with `manual_runs_today`, estimated and actual cos |
| BE-COLLECT-10 | BE | NOT BUILT | `GET {P}/runs/{run_id}/ai-coverage` (per engine valid of planned) |
| BE-COLLECT-16 | BE | BUILT | Monthly partitions of `ai.observations`, `ai.citations`, `ai.entity_me |
| BE-COLLECT-17 | BE | BUILT | Raw read `GET {P}/ai/observations/{id}/raw` through `ai.observation_ra |
| BE-COLLECT-18 | BE | NOT BUILT | Probe of how the AI endpoints read `+` and `%` in a prompt |
| BE-COLLECT-19 | BE | BUILT | Dev seed of the Eventus Security project (72 prompts, 3 countries, sch |
| BE-BILLING-PLAN-LINKS-08 | BE | BUILT | Base plan constant `BASE_PLAN` (150 prompts, twice a week, standard qu |
| BE-BILLING-PLAN-LINKS-09 | BE | BUILT | Quotas `max_active_prompts`, `max_ai_observations_per_month` checked o |
| BE-BILLING-PLAN-LINKS-10 | BE | BUILT | `ai_prompt` budget check before dispatch, blocked runs visible with es |
| BE-BILLING-PLAN-LINKS-11 | BE | PARTIAL | Budgets CRUD `GET/POST/PATCH/DELETE {W}/budgets` |
| BE-BILLING-PLAN-LINKS-14 | BE | BUILT | Manual run counter shown before the click ("14 of 20 left today") |
| BE-BILLING-PLAN-LINKS-15 | BE | NOT BUILT | Cost forecast and unit costs `GET {W}/costs/forecast`, `.../unit-costs |
| BE-OPS-03 | BE | BUILT | Price book rows for AI endpoints (standard $0.0012 a task) and engine  |
| BE-OPS-04 | BE | PARTIAL | Schema hash check of provider payloads in the test suite |
| BE-OPS-05 | BE | BUILT | DataForSEO shared limiter (2,000 calls a minute), 100 tasks a post, 30 |
| BE-OPS-06 | BE | BUILT | Partial index for superseded answers |
| BE-REPORTS-10 | BE | BUILT | "Updated" header meta from the last completed AI run |
| OV-N5 | N | NOT BUILT | N5 collection health per day `GET {P}/ai/collection/daily` |
| WB-NAV-03 | WB | NOT BUILT | Sidebar collection status line "Last run 06:12" including the AI run |
| WB-OPS-01 | WB | BUILT | Runs page lists AI runs with trigger and status |
| WB-OPS-02 | WB | PARTIAL | Run inspector for an AI run (prompts, engines, valid rate) |
| WB-OPS-03 | WB | NOT BUILT | Link from an AI page "Updated" to the run |
| WB-OPS-04 | WB | NOT BUILT | Collection progress while a run answers (`CollectionProgress`) on Topi |
| WB-OPS-05 | WB | NOT BUILT | Collection degraded notice (valid rate under 90%) |
| WB-OPS-06 | WB | BUILT | Costs page: AI workload spend |
| WB-OPS-07 | WB | NOT BUILT | Unit cost per AI answer per engine |
| WB-SET-15 | WB | NOT BUILT | Workspace > Budgets and usage: AI observations per month and active pr |
