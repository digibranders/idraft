# WP-18: Topics & Prompts: table polish, stale, mobile rows, grouped header, In search counts

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-18-tp-tables` in `.claude/worktrees/wp-18` (`infra/dev/wp-start WP-18 tp-tables`) |
| Depends on (merged on develop first) | [WP-09 table-extensions](WP-09-table-extensions.md), [WP-10 controls](WP-10-controls.md), [WP-07 app-parts-a](WP-07-app-parts-a.md), [WP-13 prompts-lane](WP-13-prompts-lane.md) |
| Owner decisions | D-36 Prompt type facet and badge before panels (default: Yes, as soon as the prompts lane lands B16); D-37 Topic subtitle: one line or a category line (default: Keep the one-line form); D-38 Trend: an 8 week line beside a 28 day table (second read) (default: Yes, now that gzip is on develop) |
| Estimate | 7 Sonnet-agent tasks, about 5 hours with one task in flight |
| Rows | 72 (built already: 46, to do: 26) |

## Goal

Finish both tables: topic subtitle decision, level 3 topics, Top engine with `EngineLogo`, hollow trend points and the 8 week line, Updated and Stale columns, pinned row menu, mobile list rows, grouped two row header on Prompts, branded chip, interval tooltips, responsive priorities, the Top 10 keywords per topic count after the vocabulary check, and the honest response-size rule now that gzip is on develop.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- web.md 2.5, 2.6, 3.3
- docs/design-system/24-page-templates.md 9.5

## Files this package owns

- `apps/web/src/features/prompts/topics-table.tsx`
- `apps/web/src/features/prompts/prompt-columns.tsx`
- `apps/web/src/features/prompts/rate-columns.tsx`
- `apps/web/src/features/prompts/trend-*.ts*`
- `apps/web/src/features/prompts/topic-tree.ts`

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

Consumes the summary and `tracked-keywords` with `filter[term]`, `filter[rank_lte]`.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Two Sonnet implementers (Topics table; Prompts table), one Sonnet reviewer. The vocabulary check is one Sonnet task with a SQL query on the dev database (read only).

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-18 tp-tables`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-18-tp-tables.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Vocabulary check: keyword topics and prompt topics are one vocabulary (a grep and one query) | BE-TOPICS-07, BE-TOPICS-08 |
| 2 | Topics table: subtitle, level 3, Top engine logo, trend points and 8 weeks, Updated, Stale, pin, Top 10 keywords count | WB-TOP-01..03, WB-TOP-05..14, WB-TOP-16..21, WB-TOP-23..38, CF-15, CF-27 |
| 3 | Prompts table: branded chip, grouped header, Updated and Stale, interval tooltips, priorities, under 1280, mobile rows, type badge | WB-PRM-01..03, WB-PRM-05..09, WB-PRM-11, WB-PRM-14..17, WB-PRM-23, WB-PRM-25..33 |
| 4 | Stale state, responsive table rows, include rule with gzip | WB-STATE-11, WB-RSP-01..06, WB-RSP-09, WB-DATA-06, CF-28 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- 390 px shows list rows that open the drawer
- Stale badge shows from twice the schedule interval
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

- One commit per task, message `WP-18: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-18 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-18 <status> | branch ai/wp-18-tp-tables @ <short sha> | rows done <n>/72 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-TOPICS-07 | BE | NOT BUILT | One vocabulary shared by keyword topics and prompt topics (check) |
| BE-TOPICS-08 | BE | BUILT | SEO per topic, counts and Top 10 (B9a) |
| WB-TOP-01 | WB | BUILT | Indented two level topic tree, parent rolls up, children indented (G32 |
| WB-TOP-02 | WB | BUILT | Rollup note "A parent row counts every prompt under it..." |
| WB-TOP-03 | WB | BUILT | Expand all, Collapse all (G25) |
| WB-TOP-05 | WB | BUILT | Disclosure with accessible name "Expand Security group, 4 topics" |
| WB-TOP-06 | WB | BUILT | Treegrid keys: Right expands, Left collapses or moves to parent, Enter |
| WB-TOP-07 | WB | BUILT | Topic row: name plus muted count ("3 topics" or "10 prompts") |
| WB-TOP-08 | WB | PARTIAL | Topic subtitle "Category, N prompts" under the name (G20) |
| WB-TOP-09 | WB | BUILT | Child rows: topics (open the drawer) and "Show all N prompts of X" |
| WB-TOP-10 | WB | BUILT | A topic without children opens onto its prompts, eight most mentioned, |
| WB-TOP-11 | WB | NOT BUILT | A level 2 topic opens onto its prompts (needs RowTree level 3) |
| WB-TOP-12 | WB | BUILT | "No topic" row |
| WB-TOP-13 | WB | BUILT | Prompts count column |
| WB-TOP-14 | WB | BUILT | Mention rate column, avg of N, counts in tooltip, pill under 4 (G21) |
| WB-TOP-16 | WB | BUILT | Citation rate column (G22) |
| WB-TOP-17 | WB | PARTIAL | Top engine column (G24) |
| WB-TOP-18 | WB | BUILT | Per engine Mentioned and Cited count columns (column chooser) |
| WB-TOP-19 | WB | BUILT | Trend sparkline column, weekly mention rate (G29) |
| WB-TOP-20 | WB | NOT BUILT | Trend: hollow points under 4 answers |
| WB-TOP-21 | WB | NOT BUILT | Trend: an 8 week line beside a 28 day table (second read 55 days back) |
| WB-TOP-23 | WB | NOT BUILT | Top 10 keywords column, "of 77 checked" (G31) |
| WB-TOP-24 | WB | NOT BUILT | Updated column, latest observation in the topic (G30) |
| WB-TOP-25 | WB | NOT BUILT | Stale badge on a topic whose last valid answer is older than twice the |
| WB-TOP-26 | WB | BUILT | Sorting on every column, default Mention desc, rows without a rate las |
| WB-TOP-27 | WB | BUILT | Topic search in the toolbar (finds child topics) |
| WB-TOP-28 | WB | BUILT | Column chooser; Topic and Mention rate always on |
| WB-TOP-29 | WB | BUILT | Density toggle |
| WB-TOP-30 | WB | BUILT | Footer "N topics, M prompts" counted once (G33) |
| WB-TOP-31 | WB | BUILT | Row checkbox, select a topic selects its prompts |
| WB-TOP-32 | WB | BUILT | Row opens the topic drawer; a modified click opens a new tab |
| WB-TOP-33 | WB | BUILT | Topic row menu (see WB-MNU) |
| WB-TOP-34 | WB | NOT BUILT | Mobile list rows under 768 px, two lines, open the drawer (G14) |
| WB-TOP-35 | WB | PARTIAL | Row menu column scrolls out at 1280 px (only identity is pinned) |
| WB-TOP-36 | WB | BUILT | Empty states: no engine on (link to Settings > Engines), no prompts, n |
| WB-TOP-37 | WB | BUILT | Loading skeleton rows, no flash of the empty state |
| WB-TOP-38 | WB | BUILT | Refresh failure told without losing rows (`topics.refreshFailed`) |
| CF-15 | CF | SPEC | Tracked keywords per topic: counts and Top 10 via `tracked-keywords` ` |
| CF-27 | CF | SPEC | Stale rule input: schedule interval per project for "twice the interva |
| WB-PRM-01 | WB | BUILT | Prompt column (text, pinned, two lines then tooltip) |
| WB-PRM-02 | WB | PARTIAL | Branded chip on the prompt cell |
| WB-PRM-03 | WB | NOT BUILT | `PromptTypeBadge` on the prompt cell (hidden in compact density and na |
| WB-PRM-05 | WB | BUILT | Topic badge with path tooltip (G45) |
| WB-PRM-06 | WB | BUILT | Country column |
| WB-PRM-07 | WB | BUILT | Engine columns, one per engine for the metric chosen (G41) |
| WB-PRM-08 | WB | BUILT | Metric switcher select (Mention, Citation, SOV) in the toolbar, `metri |
| WB-PRM-09 | WB | NOT BUILT | Grouped two row header ("Mention rate by engine" over engine columns) |
| WB-PRM-11 | WB | BUILT | Mention rate (avg of N) and Citation rate columns, default sort Mentio |
| WB-PRM-14 | WB | NOT BUILT | Updated column with Stale badge (G44) |
| WB-PRM-15 | WB | BUILT | Trend column (G44) |
| WB-PRM-16 | WB | BUILT | Per engine Mentioned and Cited counts in the column chooser |
| WB-PRM-17 | WB | NOT BUILT | Interval (95% Wilson) in the rate tooltips (G48) |
| WB-PRM-23 | WB | NOT BUILT | Intent, Funnel stage, Importance columns |
| WB-PRM-25 | WB | BUILT | Sorting on every column, default Mention desc, tie by name |
| WB-PRM-26 | WB | BUILT | Table search `/` |
| WB-PRM-27 | WB | BUILT | Pagination 25 per page with counter (G49) |
| WB-PRM-28 | WB | BUILT | Row checkbox and bulk bar (see WB-BLK) |
| WB-PRM-29 | WB | BUILT | Row opens the prompt inspector, J and K step |
| WB-PRM-30 | WB | PARTIAL | Responsive priorities: 1280 Prompt, engines, Mention, Citation; 1440 T |
| WB-PRM-31 | WB | NOT BUILT | Below 1280 the engine values move under the prompt |
| WB-PRM-32 | WB | NOT BUILT | Mobile list rows (G14) |
| WB-PRM-33 | WB | BUILT | Empty, filtered empty, partial page, error states |
| WB-STATE-11 | WB | NOT BUILT | Stale (no valid answer for twice the interval) |
| WB-RSP-01 | WB | BUILT | Shell |
| WB-RSP-02 | WB | BUILT | Topics & Prompts header |
| WB-RSP-03 | WB | PARTIAL | Topics and Prompts tables |
| WB-RSP-04 | WB | BUILT | Inspectors (prompt, topic, answer) |
| WB-RSP-05 | WB | BUILT | Strip |
| WB-RSP-06 | WB | BUILT | Bulk bar |
| WB-RSP-09 | WB | BUILT | Dialogs |
| WB-DATA-06 | WB | PARTIAL | `include=series` and `include=entities` asked only with `filter[term]` |
| CF-28 | CF | SPEC | Response size: API gzip before `include=series,entities` on full pages |
