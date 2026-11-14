# WP-45: Prompt candidates inbox backend (B18 inbox, N10)

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-45-candidates-api` in `.claude/worktrees/wp-45` (`infra/dev/wp-start WP-45 candidates-api`) |
| Depends on (merged on develop first) | [WP-44 links-generate](WP-44-links-generate.md) |
| Owner decisions | D-27 LLM use (adjudication, category classification, candidate variants, onboarding suggestions) (default: No until a provider and a budget are chosen; rules and templates first) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 8 (built already: 0, to do: 8) |

## Goal

`ai.prompt_candidates` with RLS, `GET {P}/prompt-candidates` with counts per status and `tracked`, PATCH, `decide` (accept, reject, snooze, add to panel, edit and add), `generate` from templates (LLM variants only after D-27 yes), CSV uploads with 30 day retention through a generic upload store, near duplicate detection (trigram 0.8).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/11 section 5
- docs/19 3.7.3
- prompt-dialogs.md section 8

## Files this package owns

- `backend/src/idraft/api/ai/candidate_routes.py`
- `backend/src/idraft/api/ai/candidates.py (new)`
- `backend/src/idraft/api/uploads/ (new)`
- `backend/src/idraft/db/migrations/versions/<next>_prompt_candidates.py`

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

Contract C10, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; two Sonnet implementers; one Sonnet reviewer; prove-it-bites on the upload store tenant scope and retention.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-45 candidates-api`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-45-candidates-api.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Contract, table, list and PATCH | CF-22, BE-PROMPTS-18, PD-N10 |
| 2 | Decide with edits | BE-PROMPTS-19 |
| 3 | Generate from templates | BE-PROMPTS-20 |
| 4 | Uploads and the upload store | BE-PROMPTS-21, BE-EXPORT-05 |
| 5 | Near duplicates | BE-PROMPTS-23 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- No LLM call exists unless D-27 is yes and a budget is set
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

- One commit per task, message `WP-45: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-45 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-45 <status> | branch ai/wp-45-candidates-api @ <short sha> | rows done <n>/8 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-22 | CF | SPEC | Prompt candidates (list, triage PATCH bulk, accept, generate preview) |
| BE-PROMPTS-18 | BE | NOT BUILT | Table `ai.prompt_candidates` (inbox) with RLS |
| BE-PROMPTS-19 | BE | NOT BUILT | `GET {P}/prompt-candidates`, `PATCH .../{id}`, `POST .../decide` (acce |
| BE-PROMPTS-20 | BE | NOT BUILT | `POST {P}/prompt-candidates/generate` (templates, then budgeted LLM va |
| BE-PROMPTS-21 | BE | NOT BUILT | `POST {P}/prompt-candidates/uploads` (CSV of questions, 30 day file re |
| BE-PROMPTS-23 | BE | NOT BUILT | Near-duplicate detection (trigram >= 0.8) for candidates and add |
| PD-N10 | N | NOT BUILT | Candidates inbox |
| BE-EXPORT-05 | BE | PARTIAL | Upload store for CSV imports (prompt candidates, first-party files) |
