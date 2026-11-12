# WP-42: Panels backend: tables, core seed, routes, memberships, planner (B10)

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-42-panels-api` in `.claude/worktrees/wp-42` (`infra/dev/wp-start WP-42 panels-api`) |
| Depends on (merged on develop first) | [WP-41 versions](WP-41-versions.md) |
| Owner decisions | D-49 Discovery panel engines (default: ChatGPT and AI Mode only) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 14 (built already: 0, to do: 14) |

## Goal

Panels as doc 19 3.7.2 and doc 11 section 3: `ai.prompt_panels` and `ai.panel_memberships` with history and an exclusion constraint, a locked core panel seeded per project, panel routes, memberships with reason on locked, churn and the dry run (N14), the panel aware planner with dedupe, discovery panel engines (D-49), panel scoped rates, promotion candidates, `filter[panel]` and `panel_ids`, core protection for versions, the prompt timeline with memberships.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/11 section 3
- docs/19 3.7.2
- docs/04 8.2
- docs/21 section 3

## Files this package owns

- `backend/src/idraft/api/ai/panel_routes.py`
- `backend/src/idraft/api/ai/panel_service.py (new)`
- `backend/src/idraft/collectors/ai_prompt.py (planner)`
- `backend/src/idraft/db/migrations/versions/<next>_panels.py`
- `backend/tests/api/ai/test_panels*.py`

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

Contract C9 panels part, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; two Sonnet implementers (tables, seed and routes; planner and scoped rates) in sequence where files overlap; one Sonnet reviewer; prove-it-bites on lock rules, tenant scope and the planner dedupe (money).

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-42 panels-api`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-42-panels-api.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Contract, migration, seed | CF-20, BE-PANELS-01, BE-PANELS-02 |
| 2 | Panel routes and memberships, dry run | BE-PANELS-03, BE-PANELS-04, PD-N14, PD-B10 |
| 3 | Planner, discovery engines, cadence option, scoped rates | BE-PANELS-05..07, BE-PANELS-10 |
| 4 | Promotion candidates, panel filter, core version protection, timeline | BE-PANELS-09, BE-PROMPTS-13, BE-VERSIONS-05 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- No test or check makes a provider call; planner tests prove each prompt is asked once per window
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

- One commit per task, message `WP-42: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-42 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-42 <status> | branch ai/wp-42-panels-api @ <short sha> | rows done <n>/14 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-20 | CF | SPEC | Panels, memberships, sizing, promotion candidates; `filter[panel]` on  |
| BE-PANELS-01 | BE | NOT BUILT | Tables `ai.prompt_panels`, `ai.panel_memberships` (history `valid_from |
| BE-PANELS-02 | BE | NOT BUILT | Seed a locked core panel per project with every active prompt from its |
| BE-PANELS-03 | BE | NOT BUILT | `GET/POST/PATCH/DELETE {P}/panels` (lock change needs `panels:core:mod |
| BE-PANELS-04 | BE | NOT BUILT | `GET/POST {P}/panels/{id}/memberships`, `.../memberships/remove` with  |
| BE-PANELS-05 | BE | NOT BUILT | Panel aware planner: selector `panels: ["core"]`, dedupe by version, e |
| BE-PANELS-06 | BE | NOT BUILT | Discovery panel engines ChatGPT and AI Mode only; experiment configura |
| BE-PANELS-07 | BE | NOT BUILT | Window metrics use membership history (panel scoped rates) |
| BE-PANELS-09 | BE | NOT BUILT | `GET {P}/panels/{id}/promotion-candidates` (3 valid per engine in 90 d |
| BE-PANELS-10 | BE | NOT BUILT | Per panel cadence option (weekly) |
| PD-N14 | N | NOT BUILT | Membership dry run |
| PD-B10 | N | NOT BUILT | Panels |
| BE-PROMPTS-13 | BE | NOT BUILT | `filter[panel]`, `panel_ids` on prompts |
| BE-VERSIONS-05 | BE | NOT BUILT | `GET {P}/prompts/{id}/timeline` (versions and panel membership history |
