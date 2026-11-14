# WP-20: Topics by engine and the topic drawer (R-09, R-11 topic part)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-20-topics-by-engine` in `.claude/worktrees/wp-20` (`infra/dev/wp-start WP-20 topics-by-engine`) |
| Depends on (merged on develop first) | [WP-05 chart-bars](WP-05-chart-bars.md), [WP-06 chart-grids](WP-06-chart-grids.md), [WP-07 app-parts-a](WP-07-app-parts-a.md), [WP-12 summary-lane](WP-12-summary-lane.md) |
| Owner decisions | D-04 Pooling threshold POOL_BELOW_PROMPTS for topic and project weekly points (default: 10 prompts); D-16 New screen key inspector.topic (customizable topic drawer) (default: Yes; the prompt inspector later) |
| Estimate | 9 Sonnet-agent tasks, about 7 hours with one task in flight |
| Rows | 37 (built already: 9, to do: 28) |

## Goal

Make topic performance by engine first class on the Topics tab and in the topic drawer: engine metric switcher, By engine and Heat-map views (CH-40), sort by any engine, spread column, cell drill-down, winning competitor per engine, child prompt rows with engine values, export, mobile rows; in the drawer the header actions (Add prompt, Run now, J and K), all four tabs (Overview, Prompts, Competitors, Related), the per engine performance panel (SC-26), the per engine trend, the engine comparison sentence, drill-down to the prompts, competitors per engine, own vs top 3 trend (N3), related sibling topics, the In search card.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- overview-and-charts.md section 10
- web.md 2.13, 2.29
- docs/design-system/24 9.5 topic inspector

## Files this package owns

- `apps/web/src/features/prompts/topic-inspector.tsx (sole owner in wave 2)`
- `apps/web/src/features/prompts/topic-drawer/ (new)`
- `apps/web/src/features/prompts/topics-by-engine/ (new)`
- `apps/web/src/components/app/chart/topic-engine-panel.tsx`

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

Consumes the summary with `include=series,entities` and `filter[term]` (CF-31), N3 from the summary lane.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; three Sonnet implementers (Topics tab views; drawer Overview cards; drawer tabs); one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-20 topics-by-engine`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-20-topics-by-engine.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Topics tab: switcher, By engine view, heat-map view, sort, spread, drill-down, winning competitor, child prompt rows, export, mobile | WB-TPE-02..08, WB-TPE-15..18 |
| 2 | Drawer header: Add prompt, Run now, J and K, category badges, level 3 path | WB-TI-01..05, WB-TI-23 |
| 3 | Drawer tabs Competitors and Related; related sibling topics; In search card | WB-TI-06, WB-TI-07, WB-TI-13, WB-TI-17, WB-TI-19, WB-TI-21, WB-TI-22 |
| 4 | Per engine panel and trend, engine comparison, drill-down, competitors per engine, own vs top 3 | SC-26, WB-TPE-09..14, WB-TI-08, WB-TI-10..12, WB-TI-15, CF-31 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- From any topic you reach the prompts behind one engine cell in two clicks
- Every engine value shows its counts; averages say "avg of N"
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

- One commit per task, message `WP-20: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-20 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-20 <status> | branch ai/wp-20-topics-by-engine @ <short sha> | rows done <n>/37 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-TPE-02 | WB | NOT BUILT | Topics tab: engine metric switcher like the Prompts tab (Mention, Cita |
| WB-TPE-03 | WB | NOT BUILT | Topics tab: "By engine" view toggle that shows one column per engine f |
| WB-TPE-04 | WB | NOT BUILT | Topics tab: per engine trend (sparkline per engine cell, or a Trend co |
| WB-TPE-05 | WB | NOT BUILT | Topics tab: engine spread or gap column (best engine minus worst, in p |
| WB-TPE-06 | WB | PARTIAL | Topics tab: sort by any engine's rate |
| WB-TPE-07 | WB | NOT BUILT | Topics tab: cell drill-down, clicking an engine cell opens the drawer  |
| WB-TPE-08 | WB | NOT BUILT | Topics tab: winning competitor per engine (the entity with the highest |
| WB-TPE-09 | WB | PARTIAL | Topic drawer: per engine performance panel, one row per engine with Me |
| WB-TPE-10 | WB | NOT BUILT | Topic drawer: per engine trend chart (one line per engine, 8 to 14 wee |
| WB-TPE-11 | WB | NOT BUILT | Topic drawer: engine comparison sentence or table ("Best on AI Mode, 4 |
| WB-TPE-12 | WB | NOT BUILT | Topic drawer: drill-down from an engine row to the prompts behind it ( |
| WB-TPE-13 | WB | NOT BUILT | Topic drawer: competitors winning the topic per engine (entity by engi |
| WB-TPE-14 | WB | NOT BUILT | Topic drawer: own vs top 3 competitors trend per engine |
| WB-TPE-15 | WB | NOT BUILT | Prompt rows under a topic (Topics tab child rows) show per engine valu |
| WB-TPE-16 | WB | PARTIAL | Export of the topic by engine table (CSV with per engine rate, count,  |
| WB-TPE-17 | WB | NOT BUILT | Mobile: topic list row shows the best engine and the engine count; the |
| WB-TPE-18 | WB | BUILT | Comparison across engines never pooled silently: the average says "avg |
| WB-TI-01 | WB | BUILT | Header: topic name, type "Topic", prompt count, back |
| WB-TI-02 | WB | PARTIAL | Header: category and scope badges |
| WB-TI-03 | WB | NOT BUILT | Header "Add prompt" button (G110) |
| WB-TI-04 | WB | NOT BUILT | Header "Run now" for the topic's prompts |
| WB-TI-05 | WB | NOT BUILT | J and K between topics, "3 of 13" (G118) |
| WB-TI-06 | WB | BUILT | Tabs Overview and Prompts in `itab` |
| WB-TI-07 | WB | NOT BUILT | Tabs Competitors and Related |
| WB-TI-08 | WB | BUILT | Three rate cards: Mentioned, Cited, SOV, avg of N |
| WB-TI-10 | WB | BUILT | By engine rates with k of n |
| WB-TI-11 | WB | NOT BUILT | By engine bars (G113) |
| WB-TI-12 | WB | NOT BUILT | Visibility trend: own brand vs 3 most mentioned competitors, 8 weeks ( |
| WB-TI-13 | WB | NOT BUILT | "In search" card: keyword count, Top 10, link to Rankings (G114) |
| WB-TI-15 | WB | BUILT | Top 5 prompts with mention and citation |
| WB-TI-17 | WB | BUILT | Prompts tab: every prompt of the topic and below, opens the prompt ins |
| WB-TI-19 | WB | NOT BUILT | Related tab: sibling topics with prompts and mention (G117) |
| WB-TI-21 | WB | BUILT | Empty, unknown topic, load failed states |
| WB-TI-22 | WB | BUILT | Prompt opened from the drawer keeps the topic list; badge returns to t |
| WB-TI-23 | WB | PARTIAL | Deeper (level 3) topic name shown as a path |
| SC-26 | SC | SPEC | Per engine topic panel (rows per engine with bar, percent, k of n, cha |
| CF-31 | CF | SPEC | Per engine topic trend in one read for the drawer: `include=series` wi |
