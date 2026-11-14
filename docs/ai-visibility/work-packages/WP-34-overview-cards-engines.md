# WP-34: Overview cards: rates by engine, outcomes, funnel, change summary, movers

| Field | Value |
|---|---|
| Wave | W3: AI Visibility Overview, Competitors page, notes |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-34-overview-cards-engines` in `.claude/worktrees/wp-34` (`infra/dev/wp-start WP-34 overview-cards-engines`) |
| Depends on (merged on develop first) | [WP-33 overview-shell](WP-33-overview-shell.md), [WP-05 chart-bars](WP-05-chart-bars.md), [WP-06 chart-grids](WP-06-chart-grids.md), [WP-19 compare-deltas](WP-19-compare-deltas.md) |
| Owner decisions | D-04 Pooling threshold POOL_BELOW_PROMPTS for topic and project weekly points (default: 10 prompts) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 11 (built already: 0, to do: 11) |

## Goal

Card components and catalog entries for the engine family: CH-01 rates by engine (and the single engine mention trend), CH-03 named and cited, CH-36 answer funnel, CH-37 what changed (pure fact model with tests), CH-09 prompt movers, CH-10 period comparison, CH-13 waterfall, CH-18 engine agreement, CH-23 by country, the AI by engine table, sample coverage, and the strip delta items.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- overview-and-charts.md 4.3 (each CH), 9.4

## Files this package owns

- `apps/web/src/features/ai-overview/cards/engines/`

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

Consumes the summary (compare, total, group_by country).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Three Sonnet implementers on separate card files; one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-34 overview-cards-engines`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-34-overview-cards-engines.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | CH-01 and mention trend card, AI by engine table | CH-01, WB-OV-05, WB-OV-06 |
| 2 | CH-03, CH-36, sample coverage | CH-03, CH-36 |
| 3 | CH-37 fact model and card | CH-37 |
| 4 | CH-09, CH-10, CH-13 | CH-09, CH-10, CH-13 |
| 5 | CH-18, CH-23 | CH-18, CH-23 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Each card has its empty state that teaches (section 12) and a Table view
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

- One commit per task, message `WP-34: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-34 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-34 <status> | branch ai/wp-34-overview-cards-engines @ <short sha> | rows done <n>/11 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CH-01 | CH | NOT BUILT | Mention rate by engine over time |
| CH-03 | CH | NOT BUILT | Named and cited, by engine (outcome mix) |
| CH-09 | CH | NOT BUILT | Prompt movers |
| CH-10 | CH | NOT BUILT | Period comparison by engine |
| CH-13 | CH | NOT BUILT | What moved the mention rate |
| CH-18 | CH | NOT BUILT | Engine agreement |
| CH-23 | CH | NOT BUILT | Mention rate by country |
| CH-36 | CH | NOT BUILT | Answer funnel: valid, named, named and cited |
| CH-37 | CH | NOT BUILT | What changed (counted-facts summary) |
| WB-OV-05 | WB | NOT BUILT | Mention rate trend per engine with CI band (small multiples or one cha |
| WB-OV-06 | WB | NOT BUILT | AI by engine table: Mention, Citation, Recommendation, SOV, Own citati |
