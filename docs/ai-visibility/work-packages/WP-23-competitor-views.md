# WP-23: Competitor views inside Topics & Prompts (W8)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-23-competitor-views` in `.claude/worktrees/wp-23` (`infra/dev/wp-start WP-23 competitor-views`) |
| Depends on (merged on develop first) | [WP-07 app-parts-a](WP-07-app-parts-a.md), [WP-05 chart-bars](WP-05-chart-bars.md), [WP-20 topics-by-engine](WP-20-topics-by-engine.md) |
| Owner decisions | none |
| Estimate | 5 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 7 (built already: 2, to do: 5) |

## Goal

Use the built `include=entities` cells: Top competitor column on Prompts, per entity Mentioned and SOV in the prompt inspector Competitors tab, New and Lost per engine with k of n.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- W2 plan W8
- docs/16 section 5

## Files this package owns

- `apps/web/src/features/prompts/inspector/competitors/`
- apps/web/src/features/prompts/seams/columns top-competitor entry

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

Consumes `include=entities` (CF-17).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

One Sonnet implementer, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-23 competitor-views`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-23-competitor-views.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Top competitor column | WB-PRM-13, CF-17 |
| 2 | Inspector Competitors tab on entity cells; New and Lost per engine | WB-PICO-01, WB-PICO-02, WB-PICO-05, WB-PICO-06 |
| 3 | Topic drawer Competitors tab: entities by engine, own first, SOV BarList | WB-TI-18 |
| 4 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- "none named" in words when no entity has a value
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

- One commit per task, message `WP-23: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-23 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-23 <status> | branch ai/wp-23-competitor-views @ <short sha> | rows done <n>/7 | steps <n>/5 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-PRM-13 | WB | NOT BUILT | Top competitor column (entity, its rate; "none named" in words) (G43) |
| CF-17 | CF | SPEC | Competitor views: per entity per engine mention and SOV cells per prom |
| WB-PICO-01 | WB | BUILT | Counts of `facts.competitor_mentions` per entity, own first, one engin |
| WB-PICO-02 | WB | NOT BUILT | Switch to per entity Mentioned and SOV cells (W8) |
| WB-PICO-05 | WB | NOT BUILT | New and Lost per engine with k of n (U-16) |
| WB-PICO-06 | WB | BUILT | No competitors tracked state with a link to Settings > Entities |
| WB-TI-18 | WB | NOT BUILT | Competitors tab: entities by engine, own first with swatch, SOV `BarLi |
