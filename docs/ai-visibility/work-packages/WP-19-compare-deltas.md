# WP-19: Compare with the previous period and deltas everywhere (W3)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-19-compare-deltas` in `.claude/worktrees/wp-19` (`infra/dev/wp-start WP-19 compare-deltas`) |
| Depends on (merged on develop first) | [WP-07 app-parts-a](WP-07-app-parts-a.md), [WP-12 summary-lane](WP-12-summary-lane.md) |
| Owner decisions | D-03 Compare on by default (Overview and Topics & Prompts) (default: On: vs previous period by default on both, `cmp=off` in the URL turns it off) |
| Estimate | 6 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 10 (built already: 0, to do: 10) |

## Goal

The compare select (vs previous period, No comparison) and the Detectable changes only chip, with deltas on the strip, the Topics Mention rate column, a change column per engine on Prompts, the prompt inspector strip and the topic drawer cards and top prompts, coloured only when detectable with the interim unpaired test labelled. Reads `compare=previous_period` from the summary lane (two reads only as a fallback while the lane is not merged).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- W2 plan W3
- overview-and-charts.md section 1 R5
- docs/17 section 6

## Files this package owns

- `apps/web/src/features/prompts/compare/ (new)`
- apps/web/src/features/prompts/seams/columns compare entries

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

Consumes C2 compare.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Two Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-19 compare-deltas`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-19-compare-deltas.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Compare select and Detectable only chip in the URL | WB-TPF-06, WB-TPF-07 |
| 2 | Deltas on strip, Topics, Prompts | WB-TPS-05, WB-TOP-15, WB-PRM-12 |
| 3 | Deltas in the prompt inspector and topic drawer | WB-PI-11, WB-TI-09, WB-TI-16 |
| 4 | Colour only when detectable; e2e | WB-DATA-02, WB-E2E-09 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- A delta that is not detectable is neutral with "within normal variation" (test)
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-19: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-19 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-19 <status> | branch ai/wp-19-compare-deltas @ <short sha> | rows done <n>/10 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-TPF-06 | WB | NOT BUILT | Compare select: vs previous period, No comparison (G05) |
| WB-TPF-07 | WB | NOT BUILT | "Detectable changes only" chip (G06) |
| WB-TPS-05 | WB | NOT BUILT | Change in points on each engine chip (vs previous period) |
| WB-TOP-15 | WB | NOT BUILT | Change on the Mention rate column |
| WB-PRM-12 | WB | NOT BUILT | Change column per engine, coloured only when detectable |
| WB-PI-11 | WB | NOT BUILT | Strip: change per engine |
| WB-TI-09 | WB | NOT BUILT | Change on the three cards (G111) |
| WB-TI-16 | WB | PARTIAL | Change column on top prompts, "View all" |
| WB-DATA-02 | WB | NOT BUILT | Colour only for a detectable change; interim unpaired test labelled un |
| WB-E2E-09 | WB | NOT BUILT | Compare and deltas |
