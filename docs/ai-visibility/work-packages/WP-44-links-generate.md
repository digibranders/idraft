# WP-44: Keyword links and Generate from keywords (B18, N08, M-25)

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-44-links-generate` in `.claude/worktrees/wp-44` (`infra/dev/wp-start WP-44 links-generate`) |
| Depends on (merged on develop first) | [WP-13 prompts-lane](WP-13-prompts-lane.md), [WP-27 add-dialog](WP-27-add-dialog.md) |
| Owner decisions | none |
| Estimate | 9 Sonnet-agent tasks, about 7 hours with one task in flight |
| Rows | 34 (built already: 0, to do: 34) |

## Goal

One session end to end: `core.keyword_prompt_links` with routes, `PromptCreate.keyword_ids`, keyword to prompt coverage (M-25), `POST {P}/prompts/from-keywords/preview` with templates per language and dedupe; on the web the Generate from keywords dialog, the More menu item, the linked keyword filter and column, Link a keyword dialog, related keywords in the prompt inspector, keyword to prompt coverage view, Discover generate action.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- prompt-dialogs.md section 7
- docs/11 sections 5.3 and 6
- docs/19 3.8.1

## Files this package owns

- `backend/src/idraft/api/ai/link_routes.py`
- `backend/src/idraft/api/ai/from_keywords.py (new)`
- `backend/src/idraft/db/migrations/versions/<next>_keyword_prompt_links.py`
- `apps/web/src/features/prompts/generate/ (new)`
- `apps/web/src/features/prompts/links/ (new)`

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

Contract C7 links part and B18 preview, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; one Sonnet backend implementer, two Sonnet web implementers; one Sonnet reviewer; prove-it-bites on tenant scope of links.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-44 links-generate`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-44-links-generate.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Links table and routes, keyword ids at create | BE-BILLING-PLAN-LINKS-01, BE-BILLING-PLAN-LINKS-02, PD-N08 |
| 2 | From keywords preview | BE-PROMPTS-17, PD-B18 |
| 3 | Coverage read and view | BE-BILLING-PLAN-LINKS-04, WB-XCH-05 |
| 4 | Generate dialog | PD-GEN-01..16, WB-EDT-07, WB-TPH-12, PD-STATE-07, PD-STATE-08, PD-TEST-11, PD-TEST-22, WB-DSC-09 |
| 5 | Link a keyword, filter, column, related keywords | WB-EDT-08, WB-TPF-14, WB-PRM-20, WB-PICO-04 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Generated text is labelled "Generated phrasing, not an observed user prompt"
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

- One commit per task, message `WP-44: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-44 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-44 <status> | branch ai/wp-44-links-generate @ <short sha> | rows done <n>/34 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-BILLING-PLAN-LINKS-01 | BE | NOT BUILT | Table `core.keyword_prompt_links` (link types, status, primary) |
| BE-BILLING-PLAN-LINKS-02 | BE | NOT BUILT | `GET/POST/PATCH/DELETE {P}/keyword-prompt-links` |
| BE-BILLING-PLAN-LINKS-04 | BE | NOT BUILT | Keyword to prompt coverage (keywords with no prompt, prompts with no k |
| PD-N08 | N | NOT BUILT | Keyword links |
| BE-PROMPTS-17 | BE | NOT BUILT | `POST {P}/prompts/from-keywords/preview` (template generation, no LLM) |
| PD-B18 | N | NOT BUILT | From keywords preview |
| WB-XCH-05 | WB | NOT BUILT | Keyword to prompt coverage (M-25) |
| PD-GEN-01 | PD | NOT BUILT | Entry |
| PD-GEN-02 | PD | NOT BUILT | Source |
| PD-GEN-03 | PD | NOT BUILT | Keyword picker |
| PD-GEN-04 | PD | NOT BUILT | Templates |
| PD-GEN-05 | PD | NOT BUILT | Competitor names |
| PD-GEN-06 | PD | NOT BUILT | Market |
| PD-GEN-07 | PD | NOT BUILT | Generate (preview call) |
| PD-GEN-08 | PD | NOT BUILT | Review list |
| PD-GEN-09 | PD | NOT BUILT | Edit before add |
| PD-GEN-10 | PD | NOT BUILT | Dedupe |
| PD-GEN-11 | PD | NOT BUILT | Lint per suggestion |
| PD-GEN-12 | PD | NOT BUILT | Shared fields |
| PD-GEN-13 | PD | NOT BUILT | Honesty banner |
| PD-GEN-14 | PD | NOT BUILT | Plan and button |
| PD-GEN-15 | PD | NOT BUILT | Write |
| PD-GEN-16 | PD | NOT BUILT | Result |
| WB-EDT-07 | WB | NOT BUILT | Generate from keywords panel: pick tracked keywords, template sets, pr |
| WB-TPH-12 | WB | NOT BUILT | More actions menu: Generate from keywords |
| PD-STATE-07 | PD | SPEC | Generate, preview loading |
| PD-STATE-08 | PD | SPEC | Generate, nothing produced |
| PD-TEST-11 | PD | SPEC | Generate: the preview is called with the chosen keyword ids and templa |
| PD-TEST-22 | PD | SPEC | generate from 3 keywords, uncheck one, edit one, add, see the new rows |
| WB-DSC-09 | WB | NOT BUILT | Generate prompts primary action (from keywords) |
| WB-EDT-08 | WB | NOT BUILT | Link a keyword dialog (search tracked keywords, link type) (G99) |
| WB-TPF-14 | WB | NOT BUILT | Linked keyword present filter |
| WB-PRM-20 | WB | NOT BUILT | Linked keywords column (count and primary rank) |
| WB-PICO-04 | WB | NOT BUILT | Related keywords with rank and AI Overview, "Link a keyword" (G99) |
