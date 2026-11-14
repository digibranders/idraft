# WP-56: Re-derivation, derivations routes and entity candidates (competitor discovery)

| Field | Value |
|---|---|
| Wave | W5: Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-56-rederive-candidates` in `.claude/worktrees/wp-56` (`infra/dev/wp-start WP-56 rederive-candidates`) |
| Depends on (merged on develop first) | [WP-54 extract-recommend](WP-54-extract-recommend.md), [WP-50 exports](WP-50-exports.md) |
| Owner decisions | none |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 13 (built already: 0, to do: 13) |

## Goal

One session end to end: `rederive_range` on the job runner with `ops.derivation_log`, derivations routes, extraction preview, alias test on a stored answer, `superseded_by` use, entity set boundary markers, `ai.entity_candidates` at ingest (list leads, vendor domains, proper nouns, ChatGPT brand entities), candidate routes with accept and ignore, SOV including untracked, citation entity links; on the web the Competitors Candidates tab.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/13 sections 6 and stage 8
- docs/19 3.4, 3.7.8

## Files this package owns

- `backend/src/idraft/extraction/rederive.py (new)`
- `backend/src/idraft/api/ai/derivation_routes.py`
- `backend/src/idraft/api/entities/candidates.py (new)`
- `backend/src/idraft/db/migrations/versions/<next>_derivations_candidates.py`
- `apps/web/src/features/competitors/candidates/`

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

C4 and C5 candidate parts, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; two Sonnet backend implementers in sequence, one Sonnet web implementer; one Sonnet reviewer; prove-it-bites on `is_current` flips and tenant scope.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-56 rederive-candidates`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-56-rederive-candidates.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Log table, rederive job, routes, preview, alias test on an answer | BE-EXTRACT-10..14, BE-COLLECT-15, BE-EXTRACT-18 |
| 2 | Entity candidates and routes | BE-EXTRACT-15, BE-COMPETITORS-06, BE-COMPETITORS-11, BE-METRICS-17 |
| 3 | Citation entity links | BE-EXTRACT-16 |
| 4 | Candidates tab | WB-CMP-09 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Re-derivation never changes another project's facts (test)
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

- One commit per task, message `WP-56: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-56 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-56 <status> | branch ai/wp-56-rederive-candidates @ <short sha> | rows done <n>/13 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-EXTRACT-10 | BE | NOT BUILT | Re-derivation job `rederive_range` (last 90 days on entity change, 30  |
| BE-EXTRACT-11 | BE | NOT BUILT | `GET {P}/ai/derivations`, `GET/POST {P}/ai/rederivations`, `GET .../{d |
| BE-EXTRACT-12 | BE | NOT BUILT | `POST {P}/ai/extraction/preview` (run the extractor on given text with |
| BE-EXTRACT-13 | BE | NOT BUILT | `GET {P}/ai/observations/{id}/derivations` |
| BE-EXTRACT-14 | BE | NOT BUILT | `POST {P}/alias-test` with `observation_id` (test aliases on a stored  |
| BE-EXTRACT-15 | BE | NOT BUILT | Stage 8 untracked entity candidates into `ai.entity_candidates` (list  |
| BE-EXTRACT-16 | BE | NOT BUILT | `ai.citation_entity_links` (citation in the same block as a mention, m |
| BE-EXTRACT-18 | BE | PARTIAL | Showing which entity set a number used (version boundary on SOV when c |
| BE-COLLECT-15 | BE | PARTIAL | `superseded_by` on observations and its use (re-ingest after normalize |
| BE-COMPETITORS-06 | BE | NOT BUILT | Entity candidates read and actions: `GET {P}/entity-candidates`, `POST |
| BE-COMPETITORS-11 | BE | NOT BUILT | ChatGPT `brand_entities` (provider NER) exposed as a candidate source |
| BE-METRICS-17 | BE | NOT BUILT | SOV including untracked mentions (uses `ai.entity_candidates`) |
| WB-CMP-09 | WB | NOT BUILT | Candidates tab: brands seen and not tracked, prompts and engines, Trac |
