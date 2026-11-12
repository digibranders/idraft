# WP-39: Competitors page (Comparison, AI tab, inspector)

| Field | Value |
|---|---|
| Wave | W3: AI Visibility Overview, Competitors page, notes |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-39-competitors-page` in `.claude/worktrees/wp-39` (`infra/dev/wp-start WP-39 competitors-page`) |
| Depends on (merged on develop first) | [WP-32 overview-aggregates](WP-32-overview-aggregates.md), [WP-05 chart-bars](WP-05-chart-bars.md), [WP-06 chart-grids](WP-06-chart-grids.md), [WP-07 app-parts-a](WP-07-app-parts-a.md) |
| Owner decisions | none |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 11 (built already: 0, to do: 11) |

## Goal

The `/competitors` page: tabs Comparison, SEO (channel summary only, AI rows per engine), AI, Candidates (count, filled by the entity candidates package), header with Saved view and Add competitor, by topic comparison with Gap vs leader coloured only when detectable, top competitor, "Named in 35 of 192 answers", prompts we lose by importance, SOV boundaries, per engine SOV trends, the competitor inspector.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/design-system/24 9.8
- docs/20 5.10
- web.md 2.20

## Files this package owns

- `apps/web/src/features/competitors/ (new)`
- `apps/web/src/app/[workspace]/[project]/competitors/`
- `apps/web/e2e/flows/ai-competitors.spec.ts`

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

Consumes `ai/competitors` and `include=entities`.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; two Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-39 competitors-page`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-39-competitors-page.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Route, tabs, header, nav live | WB-IA-05, WB-CMP-01, WB-CMP-02 |
| 2 | Channel summary, by topic, top competitor, named in | WB-CMP-03..06 |
| 3 | Prompts we lose, boundaries, AI trends | WB-CMP-07, WB-CMP-10, WB-CMP-11 |
| 4 | Competitor inspector | WB-CMP-12 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Gap vs leader is neutral unless detectable
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

- One commit per task, message `WP-39: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-39 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-39 <status> | branch ai/wp-39-competitors-page @ <short sha> | rows done <n>/11 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-IA-05 | WB | NOT BUILT | Competitors |
| WB-CMP-01 | WB | NOT BUILT | Route, tabs Comparison, SEO, AI, Candidates (count) |
| WB-CMP-02 | WB | NOT BUILT | Header: Saved view, primary Add competitor (560 px dialog with SOV eff |
| WB-CMP-03 | WB | NOT BUILT | Channel summary table: entity columns, AI rows per engine (SOV, mentio |
| WB-CMP-04 | WB | NOT BUILT | By topic entity comparison with MetricSwitcher and Gap vs leader, colo |
| WB-CMP-05 | WB | NOT BUILT | Top competitor (DB-17) |
| WB-CMP-06 | WB | NOT BUILT | "Named in 35 of 192 answers" per entity per engine (DB-21) |
| WB-CMP-07 | WB | NOT BUILT | Prompts we lose to a named competitor, by importance (M-23) |
| WB-CMP-10 | WB | NOT BUILT | SOV charts draw a boundary when the tracked set changes |
| WB-CMP-11 | WB | NOT BUILT | AI tab: per engine SOV trends |
| WB-CMP-12 | WB | NOT BUILT | Competitor inspector (side by side, AI gap with interval, sources) |
