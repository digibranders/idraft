# WP-26: Evidence viewer completion: citation markers, entity toggles, views, answer diff

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-26-evidence-viewer` in `.claude/worktrees/wp-26` (`infra/dev/wp-start WP-26 evidence-viewer`) |
| Depends on (merged on develop first) | [WP-08 app-parts-b](WP-08-app-parts-b.md) |
| Owner decisions | none |
| Estimate | 7 Sonnet-agent tasks, about 5 hours with one task in flight |
| Rows | 23 (built already: 9, to do: 14) |

## Goal

One session end to end: confirm the observation detail carries citation offsets and hashes (CF-25, CF-26) and fill `answer_block_index` and `first_char_offset` if they are missing, check one raw payload for quotes (CI-11), add the answer diff read (latest vs last that named you, M-03), and build `CitationMarker`, `CitationList`, `EntityToggleList`, `AnswerViewMode`, `SafeMarkdown`, `QuoteBox`, `ResponsePreview`, the provider link, the facts footer, the quoted passage where the payload has it.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/design-system/23 section 5 and 6.3
- docs/20 section 8.2 (XSS)
- docs/13 stage 3

## Files this package owns

- `backend/src/idraft/api/ai/observation_routes.py`
- `backend/src/idraft/api/ai/observations.py`
- `backend/src/idraft/api/ai/answer_diff.py (new)`
- `apps/web/src/components/app/evidence/`
- `apps/web/src/features/prompts/answer-inspector.tsx`
- `apps/web/src/features/prompts/marked-answer.tsx`

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

Changes `ObservationDetail` only if fields are missing; new `GET {P}/ai/observations/{id}/compare`.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; one Sonnet backend implementer, two Sonnet web implementers; one Sonnet reviewer with XSS fixtures and prove-it-bites on the tenant scope of the new read.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-26 evidence-viewer`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-26-evidence-viewer.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Check offsets, hashes and quotes in the API and one raw payload; fill what is missing | CF-25, CF-26, BE-SOURCES-21 |
| 2 | Answer diff read | BE-REPORTS-04 |
| 3 | `SafeMarkdown`, citation markers and list, entity toggles, view modes | SC-11, WB-ANS-10..12 |
| 4 | `QuoteBox`, `ResponsePreview`, facts footer, provider link, answer compare, quoted passage | SC-23, WB-ANS-13..16, WB-SRC-04 |
| 5 | Built rows confirmed | WB-ANS-01..09 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- XSS fixtures (script, event handler, javascript: link, markdown image) render inert
- pnpm gen:api in the same push when the API changes
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

- One commit per task, message `WP-26: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-26 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-26 <status> | branch ai/wp-26-evidence-viewer @ <short sha> | rows done <n>/23 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-25 | CF | SPEC | Answer citation offsets for inline markers (`first_char_offset`, `answ |
| CF-26 | CF | SPEC | Answer and raw SHA-256 on the observation detail |
| BE-SOURCES-21 | BE | NOT BUILT | Quote or claim per citation (CI-11) |
| BE-REPORTS-04 | BE | NOT BUILT | Answer diff over time (latest vs last that named you; entities and sou |
| SC-11 | SC | SPEC | `CitationMarker`, `CitationList`, `EntityToggleList`, `AnswerViewMode` |
| SC-23 | SC | SPEC | `QuoteBox` and `ResponsePreview` as shared parts |
| WB-ANS-01 | WB | BUILT | Answer text with own and competitor marks at UTF-16 spans |
| WB-ANS-02 | WB | BUILT | Mark accessible names (brand, how matched, how sure) |
| WB-ANS-03 | WB | BUILT | Mentions list with counts, order, uncertain flag, via product |
| WB-ANS-04 | WB | BUILT | Sources with role (own, competitor, third party) and host (PR-31) |
| WB-ANS-05 | WB | BUILT | Ads note |
| WB-ANS-06 | WB | BUILT | Status: complete, partial, empty, refused, error, with reasons |
| WB-ANS-07 | WB | BUILT | Details: engine, observed, model, outcome, check |
| WB-ANS-08 | WB | BUILT | Download raw answer (button), past retention 410, unavailable 503 |
| WB-ANS-09 | WB | BUILT | Back to the prompt |
| WB-ANS-10 | WB | NOT BUILT | Inline citation markers [n] jumping to the source list item (PR-29) |
| WB-ANS-11 | WB | NOT BUILT | Entity toggle list (show or hide marks per entity) |
| WB-ANS-12 | WB | NOT BUILT | Formatted and Raw view modes (`AnswerViewMode`) |
| WB-ANS-13 | WB | PARTIAL | FactsFooter |
| WB-ANS-14 | WB | NOT VERIFIED | "Open at the provider" link |
| WB-ANS-15 | WB | NOT BUILT | Answer compare (latest vs last that named you) (M-03) |
| WB-ANS-16 | WB | NOT BUILT | Quoted passage per source (CI-11) |
| WB-SRC-04 | WB | NOT BUILT | Quoted passage section (CI-11) |
