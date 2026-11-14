# WP-01: Backend scaffolding: routers, permissions, problem codes, test anchors

| Field | Value |
|---|---|
| Wave | W0: Scaffolding, contracts and the lock |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-01-backend-scaffold` in `.claude/worktrees/wp-01` (`infra/dev/wp-start WP-01 backend-scaffold`) |
| Depends on (merged on develop first) | none |
| Owner decisions | D-11 Who holds layouts:manage (default: Owner and admin); D-18 notes:write permission (default: Editor and above) |
| Estimate | 5 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 4 (built already: 2, to do: 2) |

## Goal

Touch every backend conflict hot spot once, so later packages only add their own files. Register an empty `APIRouter` for every new route module of every backend package in `api/main.py`; add the new permission keys with their role grants; add the problem codes the specs name; create the empty schema modules; add one comment anchor block per package in `test_route_access.py` and `test_cross_tenant.py`.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- MASTER-PLAN section 3.3 (module list)
- docs/19-api-specification.md 2.13
- docs/24-security.md 3.2
- docs/superpowers/specs/2026-09-30-layout-customization-design.md 9.3

## Files this package owns

- `backend/src/idraft/api/main.py (registration lines only)`
- `backend/src/idraft/api/permissions.py`
- `backend/src/idraft/api/problems.py`
- `backend/src/idraft/api/resources.py (registration only)`
- backend/src/idraft/api/layouts/__init__.py, backend/src/idraft/api/layouts/routes.py (empty router)
- backend/src/idraft/api/ai/*_routes.py new empty modules listed in MASTER-PLAN section 3.3
- backend/src/idraft/api/schemas/ai_*.py new empty modules
- `backend/tests/api/test_route_access.py (anchors)`
- `backend/tests/security/test_cross_tenant.py (anchors)`

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

No route is added, so `backend/openapi/v1.json` does not change. New permission keys: `layouts:manage` (owner, admin), `notes:write` (owner, admin, editor). Problem codes: `precondition_failed` (412), `panel_locked`, `reason_required`, `core_panel_exists`, `template_language_unsupported`, `not_implemented` (501).

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

One Sonnet implementer (mechanical but on hot files), one Sonnet reviewer. Haiku writes the anchor blocks from the module list.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-01 backend-scaffold`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-01-backend-scaffold.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Create the empty router modules and register them in `main.py` in the order of MASTER-PLAN 3.3; `create_app()` still builds and `test_openapi.py` passes unchanged | BE-OPS-01, BE-OPS-02 |
| 2 | Add `layouts:manage` and `notes:write` with grants and a role matrix test | BE-OPS-09, BE-LAYOUTS-05 |
| 3 | Add the problem classes and codes with tests of status and code | process |
| 4 | Add the anchor blocks `# WP-nn <slug>` with a blank line between them in the two security test files and in `EXPECTED` of `test_route_access.py` | BE-OPS-01 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- `infra/dev/heavy -- ./check.sh` green
- `git diff origin/develop -- backend/openapi/v1.json` is empty
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

- One commit per task, message `WP-01: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-01 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-01 <status> | branch ai/wp-01-backend-scaffold @ <short sha> | rows done <n>/4 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-OPS-01 | BE | BUILT | Cross-tenant suite covers every AI route and table |
| BE-OPS-02 | BE | BUILT | Statement count tests (no N+1) for every aggregate |
| BE-OPS-09 | BE | PARTIAL | Permissions `panels:core:modify`, `views:write`, `alerts:write`, `expo |
| BE-LAYOUTS-05 | BE | NOT BUILT | Permission `layouts:manage` (owner and admin; stricter than workspace  |
