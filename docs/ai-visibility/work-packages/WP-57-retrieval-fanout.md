# WP-57: Retrieved but not cited, fan-out table and keyword match (C8, FO-07, F3)

| Field | Value |
|---|---|
| Wave | W5: Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-57-retrieval-fanout` in `.claude/worktrees/wp-57` (`infra/dev/wp-start WP-57 retrieval-fanout`) |
| Depends on (merged on develop first) | [WP-14 sources-lane](WP-14-sources-lane.md), [WP-24 fanout-views](WP-24-fanout-views.md) |
| Owner decisions | none |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 10 (built already: 0, to do: 10) |

## Goal

One session end to end: keep the ChatGPT retrieval list in `ai.retrieval_results` (normalizer change), `ai/sources/retrieved-not-cited`, the optional `ai.fanout_queries` table, fan-out keyword coverage (F3, N11), own retrieved vs cited per query (FO-07); on the web the Retrieved not cited chip on Citations Pages, own retrieved and cited per query, matched keywords with "Add to keyword inbox", CH-27 and CH-28.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/16 C8, F3
- docs/04 8.4
- docs/07 section 2

## Files this package owns

- `backend/src/idraft/providers/dataforseo/ai_parse.py (retrieval only)`
- `backend/src/idraft/api/ai/retrieval_routes.py`
- `backend/src/idraft/db/migrations/versions/<next>_retrieval.py`
- `apps/web/src/features/citations/retrieved/`
- `apps/web/src/features/prompts/inspector/fanout/ (retrieval columns)`

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

C6, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; one Sonnet backend implementer per part, one Sonnet web implementer; one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-57 retrieval-fanout`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-57-retrieval-fanout.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Retrieval table and read | BE-SOURCES-13 |
| 2 | Fan-out table and keyword coverage | BE-FANOUT-02, BE-FANOUT-04, OV-N11 |
| 3 | Own retrieved vs cited | BE-FANOUT-06 |
| 4 | Web views and charts | WB-CIT-12, WB-PIF-08, WB-PIF-09, CH-27, CH-28 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Storage growth per month measured and written in the As built note
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

- One commit per task, message `WP-57: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-57 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-57 <status> | branch ai/wp-57-retrieval-fanout @ <short sha> | rows done <n>/10 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-SOURCES-13 | BE | NOT BUILT | Retrieved but not cited (C8, ChatGPT), table `ai.retrieval_results`, ` |
| BE-FANOUT-02 | BE | NOT BUILT | Table `ai.fanout_queries` (normalized text, sequence) filled at ingest |
| BE-FANOUT-04 | BE | NOT BUILT | Fan-out keyword coverage (F3: queries matching a tracked keyword) |
| BE-FANOUT-06 | BE | NOT BUILT | Own domain retrieved vs cited per query (FO-07) |
| OV-N11 | N | NOT BUILT | N11 fan-out keyword match on `FanoutQueryRow` |
| WB-CIT-12 | WB | NOT BUILT | Pages tab: "Retrieved, not cited (ChatGPT)" scope chip (C8) |
| WB-PIF-08 | WB | NOT BUILT | Own retrieved and cited rate per query (FO-07) |
| WB-PIF-09 | WB | NOT BUILT | Matched keywords with rank, "Add to keyword inbox" (M-20) |
| CH-27 | CH | NOT BUILT | Retrieved but not cited (ChatGPT) |
| CH-28 | CH | NOT BUILT | Fan-out queries we track |
