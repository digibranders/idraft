# WP-36: Overview cards: topics by engine and prompts

| Field | Value |
|---|---|
| Wave | W3: AI Visibility Overview, Competitors page, notes |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-36-overview-cards-topics` in `.claude/worktrees/wp-36` (`infra/dev/wp-start WP-36 overview-cards-topics`) |
| Depends on (merged on develop first) | [WP-33 overview-shell](WP-33-overview-shell.md), [WP-06 chart-grids](WP-06-chart-grids.md), [WP-20 topics-by-engine](WP-20-topics-by-engine.md) |
| Owner decisions | D-04 Pooling threshold POOL_BELOW_PROMPTS for topic and project weekly points (default: 10 prompts); D-05 Heat-map bins shared by every rate heat-map (default: The 7 fixed bins of CH-04, mirrored in dark) |
| Estimate | 7 Sonnet-agent tasks, about 5 hours with one task in flight |
| Rows | 13 (built already: 0, to do: 13) |

## Goal

Card components and catalog entries for topics and prompts: CH-04 and CH-40 topic heat-map, CH-41 extremes, CH-42 movers, CH-43 engine gap, CH-44 named by one engine not another, CH-45 trellis, CH-33 small multiples, CH-46 contribution, CH-11 prompt heat-map, CH-12 prompt by week, CH-15 citation vs mention scatter, prompts to look at.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- overview-and-charts.md section 10 and 4.3

## Files this package owns

- `apps/web/src/features/ai-overview/cards/topics/`

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

Consumes topic rows and series of the summary (`rows=topics`).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Three Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-36 overview-cards-topics`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-36-overview-cards-topics.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | CH-04 and CH-40, CH-41, CH-43, CH-44 | CH-04, CH-40, CH-41, CH-43, CH-44, WB-TPE-01 |
| 2 | CH-42, CH-45, CH-33, CH-46 | CH-42, CH-45, CH-33, CH-46 |
| 3 | CH-11, CH-12, CH-15, prompts to look at | CH-11, CH-12, CH-15 |
| 4 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Topic overlap footnotes on every topic card
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

- One commit per task, message `WP-36: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-36 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-36 <status> | branch ai/wp-36-overview-cards-topics @ <short sha> | rows done <n>/13 | steps <n>/5 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CH-04 | CH | NOT BUILT | Mention rate by topic and engine |
| CH-11 | CH | NOT BUILT | Prompt by engine heat-map |
| CH-12 | CH | NOT BUILT | Prompt by week heat-map |
| CH-15 | CH | NOT BUILT | Citation rate vs mention rate, by topic |
| CH-33 | CH | NOT BUILT | Mention rate per topic, small multiples |
| CH-40 | CH | NOT BUILT | Topic performance by engine (full matrix) |
| CH-41 | CH | NOT BUILT | Strongest and weakest topics per engine |
| CH-42 | CH | NOT BUILT | Topics gaining or losing, by engine |
| CH-43 | CH | NOT BUILT | Where engines disagree, by topic |
| CH-44 | CH | NOT BUILT | Named by one engine, not another |
| CH-45 | CH | NOT BUILT | Topic trends by engine (trellis) |
| CH-46 | CH | NOT BUILT | What each topic adds to the overall rate |
| WB-TPE-01 | WB | NOT BUILT | Overview: topic by engine heatmap card (rows topics, columns engines p |
