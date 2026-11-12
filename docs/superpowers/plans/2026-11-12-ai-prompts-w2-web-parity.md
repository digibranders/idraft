# AI prompts, plan W2: web parity of Topics & Prompts with the approved preview, and the competitor study's web items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the web gaps of [the parity spec](../specs/2026-11-12-topics-prompts-preview-parity.md) that slice 1 data allows (tasks W1 to W5), then wire the pages that wait for backend items (W6 to W13), and list the tasks that wait for slice 4, for a backend item or for a product decision (W14 to W17; W14 and W17 no longer wait on a decision). Each task is independent and is committed on its own.

**Architecture:** Everything stays in `apps/web/src/features/prompts` (queries, pure models, screens). Pure logic goes in model files with tests first; screens only render. Shared pieces used by more than one feature go in `apps/web/src/components/app`. Data comes from the generated client through `apiQuery`; for every route the backend has not built, the mocks in `apps/web/src/mocks` are the contract until it lands, and the mock is written to the proposed contract of [the backend handoff](2026-11-12-ai-prompts-d-backend-handoff.md) or [D1](2026-11-12-ai-prompts-d1-summary-additions.md).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, TanStack Query 5, nuqs, next-intl, Base UI primitives in `src/components/ui`, ECharts through `ChartFrame`, MSW 2, Vitest with Testing Library and vitest-axe, Playwright with axe.

Specs: [competitor study](../specs/2026-11-12-ai-visibility-competitor-study.md) (IDs AP, PR, DB, FO, CI, OP, GA, GD, GF, M, U), [parity spec](../specs/2026-11-12-topics-prompts-preview-parity.md) (gap ids G, decisions D-1 to D-10), [slice 1 spec](../specs/2026-11-11-ai-prompt-tracking-slice-1-design.md). Earlier plan in the same feature: [plan C](2026-11-11-ai-prompts-c-web.md) (read its "Rules every task follows" and "Names"; they still apply). Sequencing: [roadmap](2026-11-12-ai-visibility-roadmap.md).

Work in your own worktree under `.claude/worktrees/<name>` cut from `origin/develop` (AGENTS.md: never in the main checkout, never in `.claude/worktrees/release`). Paths below are relative to the worktree. Every web command runs in `apps/web`. Before the first task: `git fetch origin && git rebase origin/develop`, then `pnpm install --frozen-lockfile` at the root and `pnpm gen:api` in `apps/web` (B1 `last_observed_at` and `last_valid_at` are on develop as `6d681a5`; the generated client has them only after this step).

**The gate at the end of every task** (fix and run again until each passes; run `pnpm format` first so Prettier settles the wrapping):

```bash
pnpm format
pnpm lint            # no output after the command line, exit code 0
pnpm typecheck       # no output after "tsc --noEmit", exit code 0
pnpm test            # "Test Files  N passed (N)"
pnpm format:check    # "All matched files use Prettier code style!"
pnpm build           # tasks that add a route or navigation entry, and the last task of a stage
```

If the API changed, `pnpm gen:api` runs in a web commit of its own, right after the backend commit (backend commits update only `backend/openapi/v1.json`; decided 2026-11-12), and the CI-free checks stay green on both sides. Other sessions' files may be uncommitted in a shared tree: every commit names its files with `git add <paths>`. Never push `main`; work lands in `develop` (AGENTS.md).

---

## Rules every task follows

- **UI rules.** Read `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md` before the first UI task. Components from `src/components/ui` and `src/components/app`, token classes, `type-*` utilities, `@/lib/format` for every number and date (no `Intl.*`, no `toFixed`, no hex, no arbitrary values). No em dashes or en dashes in code, tests, messages or commits.
- **Messages.** Every visible string goes through `apps/web/messages/en.json` under the existing top level `prompts` key (never a second `prompts` key). `src/i18n/messages.test.ts` enforces the style (no dash as punctuation, no `!`, curly quotes instead of straight double quotes, "cannot" instead of a contraction, and a typographic apostrophe where ICU needs one).
- **Features never import each other** (eslint `boundaries`). A piece two features need moves to `src/components/app` or `src/lib`.
- **State in the URL** with `nuqs` (`history: 'replace'`), as `prompts-screen.tsx` does.
- **Colour only for a detectable change** (rule 6). A rate with fewer than `MIN_OBSERVATIONS` (4) valid answers shows the insufficient pill, never a bare percent (D-1).
- **Nothing is invented.** A number the API does not give is not shown. A tab that waits for a backend item shows an empty state that names the item's effect in words ("Citations appear here once the sources view is available"), never fixture numbers in production code. Mock data lives only in `src/mocks`.
- **Counts stay.** Every rate keeps its count ("5 of 6") next to the percent (D-1). A topic cell is prompt weighted: read its answers from `pooled` (`countText` in `prompt-model.ts`); never call `countText` for share of voice.
- **Test first.** Each task lists the failing tests to write before the code. Run them and see them fail for the stated reason, then implement.
- **A task that needs a backend item** builds against the mock of the contract first, with the mock handler and its test in the same commit, and switches nothing else when the backend lands except `pnpm gen:api`.

## Facts this plan relies on (grepped 2026-11-12)

| Fact                                                                                                                                                                                         | Where                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The Prompts feature has no `MetricStrip` yet; `MetricStrip` takes `groups`, `size`, `label`, `status` and items with `unknown: { kind: 'insufficient' }`                                     | `apps/web/src/components/app/metric/metric-strip.tsx`                                                                        |
| `MIN_OBSERVATIONS = 4`, `rateState`, `equalWeightAverage`, `promptWeightedRate`; `isDetectableChange(current: Counts, previous: Counts)` with `Counts = { k, n }`; `wilsonInterval(k, n, z)` | `apps/web/src/lib/stats/rates.ts`, `change.ts`, `wilson.ts`                                                                  |
| `formatMetricDelta({ value, unit, polarity, isDetectable })` exists; **no `Delta` component exists** (grep finds none)                                                                       | `apps/web/src/lib/format/delta.ts`                                                                                           |
| `acrossEngines(cells)`, `countText(cell)`, `topicSummaryRow`, `hasAnswers`, `NO_TOPIC`, `TOPIC_TOP_PROMPTS`                                                                                  | `apps/web/src/features/prompts/prompt-model.ts`                                                                              |
| `summaryQuery`, `observationsQuery`, `observationQuery`, `RUN_NOW`, `ARCHIVE_PROMPT`, `UPDATE_PROMPT`, `BULK_CREATE_PROMPTS`                                                                 | `apps/web/src/features/prompts/prompt-queries.ts`                                                                            |
| `ObservationFacts` has `own_mentioned: boolean` and `competitor_mentions: string[]`; `ObservationSummary` has `fanout_count`                                                                 | `apps/web/src/lib/api/schema.ts`                                                                                             |
| Topics table uses `NO_SORT`; Prompts table has a `DEFAULT_SORT`                                                                                                                              | `topics-table.tsx`, `prompts-screen.tsx`                                                                                     |
| Topic drawer has tabs Overview and Prompts; the Competitors tab is a documented shortcut                                                                                                     | `topic-inspector.tsx`                                                                                                        |
| Client export pattern                                                                                                                                                                        | `apps/web/src/features/rankings/export` (`export-file.ts`, `export-model.ts`)                                                |
| Mocks                                                                                                                                                                                        | `apps/web/src/mocks/handlers/prompts.ts`, `prompt-answers.ts`, `prompt-run-now.ts`, `prompts-state.ts`, `prompt-fixtures.ts` |
| `DataTable` has bulk actions (`bulk-action-bar.tsx`), column chooser, tree rows                                                                                                              | `apps/web/src/components/app/data-table`                                                                                     |

## Names (the contract between tasks)

```text
apps/web/src/components/app/metric/insufficient-pill.tsx      InsufficientPill({ n })            (W1)
apps/web/src/components/app/metric/delta.tsx                  Delta({ value, unit, polarity, isDetectable })  (W3)
apps/web/src/features/prompts/rate-model.ts                   RateView, rateView(cell), engineRate(rows, engine), shareOfVoice(rows, engine)  (W1)
apps/web/src/features/prompts/strip-model.ts                  stripGroups(summary, engines, previous?) -> MetricStripGroup[]  (W1, W3)
apps/web/src/features/prompts/prompts-strip.tsx               PromptsStrip  (W1)
apps/web/src/features/prompts/sort-model.ts                   TopicSort, PromptSort, sortTopics, sortPrompts  (W2)
apps/web/src/features/prompts/compare-model.ts                previousWindow(range), changeOf(current, previous) -> { delta, detectable }  (W3)
apps/web/src/features/prompts/history-model.ts                rollingSeries(observations, windowDays) -> Point[] with Wilson band  (W4)
apps/web/src/features/prompts/competitor-counts.ts            competitorCounts(observations, entities) -> Row[]  (W4)
apps/web/src/features/prompts/inspector-{latest,history,citations,competitors,stats}.tsx  (W4, W7)
apps/web/src/features/prompts/row-menu.tsx, bulk-bar.tsx, export-rows.ts, views-model.ts, edit-details-dialog.tsx  (W5)
apps/web/messages/en.json                                     prompts.strip.*, prompts.rate.*, prompts.sort.*, prompts.compare.*, prompts.inspector.tabs.*, prompts.menu.*, prompts.bulk.*, prompts.views.*
```

## File map

| File                                                                                                                                                                        | Task |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `components/app/metric/insufficient-pill.tsx` (+ test), `features/prompts/rate-model.ts`, `strip-model.ts`, `prompts-strip.tsx`, `prompt-columns.tsx`, `prompts-screen.tsx` | W1   |
| `features/prompts/sort-model.ts`, `topics-table.tsx`, `prompt-columns.tsx`, `prompts-screen.tsx`                                                                            | W2   |
| `components/app/metric/delta.tsx`, `features/prompts/compare-model.ts`, `prompt-queries.ts`, `strip-model.ts`, tables, drawers, `mocks/handlers/prompts.ts`                 | W3   |
| `features/prompts/prompt-inspector.tsx` (split), `inspector-*.tsx`, `history-model.ts`, `competitor-counts.ts`                                                              | W4   |
| `features/prompts/row-menu.tsx`, `bulk-bar.tsx`, `export-rows.ts`, `views-model.ts`, `edit-details-dialog.tsx`, `add-prompts-dialog.tsx`, `topic-inspector.tsx`             | W5   |
| `prompts-screen.tsx`, `topics-table.tsx`, `prompt-queries.ts`, mocks                                                                                                        | W6   |
| `inspector-citations.tsx`, `features/citations/*` (new feature), navigation registry, mocks                                                                                 | W7   |
| `topic-inspector.tsx`, `prompt-columns.tsx`, `competitors` views, mocks                                                                                                     | W8   |
| `features/prompts/fanout-*.tsx`, mocks                                                                                                                                      | W9   |
| bulk bar, mocks                                                                                                                                                             | W10  |
| `sparkline` columns, drawer trend chart, mocks                                                                                                                              | W11  |
| `features/discover/*` (new), mocks                                                                                                                                          | W12  |
| `features/ai-overview/*` (new)                                                                                                                                              | W13  |
| panels and versions                                                                                                                                                         | W14  |

---

## Stage 1: slice 1 data only (no backend change)

### Task W1: Metric strip and the shared insufficient-data pill (G12, G13; PR-06, DB-01; D-1)

**Needs from the backend:** none. **Mocks first:** the existing summary mock; add a fixture project with one engine on and one prompt with 2 answers to cover the insufficient state.

**Read first:** `components/app/metric/metric-strip.tsx` and its test; `AI_DEVELOPMENT_UI_RULES.md` rules 6, 10, 11; `docs/design-system/23-application-patterns.md` sections 2 and 8.5; `lib/stats/rates.ts`; `prompt-model.ts` (`countText`, `acrossEngines`); `prompt-columns.tsx`; the summary section of `docs/superpowers/plans/2026-11-11-ai-prompts-b-collection-and-extraction.md` (cell shapes).

**Files:**

- Create: `components/app/metric/insufficient-pill.tsx`, `insufficient-pill.test.tsx`, `features/prompts/rate-model.ts`, `rate-model.test.ts`, `strip-model.ts`, `strip-model.test.ts`, `prompts-strip.tsx`, `prompts-strip.test.tsx`
- Modify: `features/prompts/prompt-columns.tsx`, `prompts-screen.tsx`, `apps/web/messages/en.json`

**Failing tests first:**

- `rate-model.test.ts`: `rateView` of a prompt cell `{ numerator: 5, denominator: 6, value: 0.83 }` gives `{ state: 'ok', percent: '83%', count: '5 of 6' }`; of a cell with `n_observations: 3` gives `state: 'insufficient'` and no percent; of `value: null` gives `state: 'none'`; a topic cell (fractional numerator, `pooled`) reads its count from `pooled`; share of voice gives a percent and no count text.
- `strip-model.test.ts`: per engine value is the mean of the prompt rows' mention rates (prompt weighted); sum of denominators below 4 gives `unknown: { kind: 'insufficient' }`; the Prompts item counts the prompt rows in scope and says "N topics" in `context`; one enabled engine gives Mentioned, Cited, Share of voice and Valid answers (no Recommendation until S2); an engine with no answers gives "Not collected yet" (`unknown.kind: 'pending'`).
- `prompts-strip.test.tsx`: renders the group list with `MetricStrip size="md"`; `status="loading"` shows skeletons with the labels; hidden (renders nothing) when `hasAnswers(summary)` is false or no prompt exists; axe clean.
- `insufficient-pill.test.tsx`: renders hatching and "N obs"; has an accessible name "Insufficient data, N answers"; axe clean.

**Steps:**

- [ ] Write `InsufficientPill({ n })` in `components/app/metric` (hatched background token from DS 23 8.5, `type-caption`), used by the strip's `unknown` path and by table cells.
- [ ] Write `rate-model.ts` (pure): `rateView(cell)`, `engineRate(rows, engine)` (mean of row values over rows with a value, plus summed denominators), `shareOfVoice(rows, engine)` (sum of numerators over sum of denominators: one answer, one weight; check `summary.py` `_topic_engine` first and note any difference in the commit).
- [ ] Write `strip-model.ts`: Prompts card, then one `MetricStripGroup` per enabled engine in fixed engine order (DS 14 section 4), items Mentioned (value percent, context "k of n answers"), Cited, Share of voice; counts also in the tooltip text.
- [ ] Add `prompts-strip.tsx` above the tabs in `prompts-screen.tsx`, fed by the same summary query the tables use (no second read).
- [ ] Change the existing Mentioned and Cited cells in `prompt-columns.tsx` and `topics-table.tsx` to render percent beside the count and `InsufficientPill` under 4 answers, tooltips keep "N valid of M answers".
- [ ] Messages: `prompts.strip.*`, `prompts.rate.*`.
- [ ] Gate (with `pnpm build`).

**Status (2026-11-12): the strip is done**, in `37ff14f` and its review fixes. It lives in `features/prompts` (`strip-model.ts`, `rate-view.tsx`, `prompts-strip.tsx`), not in the files listed above: `rate-view.tsx` holds `InsufficientPill` and `useRateWords`, `strip-model.ts` holds `engineRates`, `shareOfVoiceTotals` and `topicsSpanned`, and `MetricStrip` gained an optional `tip`. **The cell wiring moves to W2:** the step that changes the Mentioned and Cited cells of `prompt-columns.tsx` and `topics-table.tsx` to a percent beside the count, with `InsufficientPill` under 4 answers, is not done. `InsufficientPill` is unused until then.

**Commit:** `Topics & Prompts: metric strip, percent beside counts and the insufficient data pill`

### Task W2: Rate columns, sorting, subtitle, indented topic tree and footer counts (G20 to G25, G32, G33, G40, G41, G45, G113)

**Needs from the backend:** none. **Mocks first:** existing. The owner decided on 2026-11-12 that the Topics tab is an indented tree (parent row rolls up its children, children indent under it, a note says rows do not add up to the parent): D-3 is decided and nothing in W2 waits on a decision.

**Read first:** `topics-table.tsx`, `prompt-columns.tsx`, `prompts-screen.tsx` (`DEFAULT_SORT`), `DataTable` sort props and tree rows (`components/app/data-table`), `useVocabularies`, the topic tree helpers in `prompt-model.ts`, parity spec sections 5.2 and 5.3.

**Files:**

- Create: `features/prompts/sort-model.ts`, `sort-model.test.ts`
- Modify: `topics-table.tsx`, `prompt-columns.tsx`, `prompts-screen.tsx`, `topic-inspector.tsx` (engine bars, G113), `messages/en.json`; tests `prompts.test.tsx`, `topic-drawer.test.tsx`

**Failing tests first:**

- `sort-model.test.ts`: `sortTopics` by Mention rate descending puts the highest average first and rows with no rate last; ties break by name; `sortPrompts` default is Mention rate descending; Top engine column value is the engine with the highest mention rate (ties by engine order); SOV sorts by value.
- `prompts.test.tsx`: Topics tab shows "Mention rate" with "avg of 3" note and counts in the tooltip, "Citation rate", "Top engine" (logo and name); default order is Mention desc; the header sorts on click and the sort is in the URL; "Expand all" and "Collapse all" toggle every topic; each topic row shows "Category, N prompts" (parent name, or "Topic" when top level) and a footer "13 topics, 250 prompts" using the formatted counts; Prompts tab has the metric switcher (Mention, Citation, Share of voice) and a path badge with the full path in the tooltip.
- `topic-drawer.test.tsx`: the By engine section shows a bar, percent and "k of n" per engine.
- **Sub-task W2-T, the indented topic tree (G32, D-3).** Decided 2026-11-12, and the table depth stays at two: the Topics table shows at most two levels (a top topic and its children). Topics deeper than level 2 get no row of their own. `topic-tree.test.ts` (pure model, no DOM) and `prompts.test.tsx`:
  - **Indent:** a level 2 topic row is drawn one level under its level 1 parent in tree order (parent, then its children, then the next parent); the identity cell is indented with token spacing (no arbitrary values) and carries `aria-level` (1 or 2, as `RowTree` already sets it); a topic with no children is an ordinary row without a disclosure button.
  - **Rollup:** a parent row's counts and rates equal the roll up of its children and its own prompts, each prompt counted once in the parent (the API already returns a row for every topic and every ancestor with counts rolled up: read the parent row as given, never add the children in the web); a prompt in a level 2 topic counts in that row and again in its level 1 row. A three level fixture (level 1, level 2 and a level 3 topic with prompts) rolls up into the level 2 row and the level 1 row, and a test pins that no level 3 row is rendered.
  - **Rollup note:** a note under the table header, from `messages/en.json`, says rows do not add up to the parent ("A parent row counts every prompt under it, so rows do not add up to the parent."); it is shown only when at least one parent row is visible; the drawer and the footer counts count each topic and prompt once (footer "13 topics, 250 prompts" is never a sum of the rows).
  - **Expand and collapse:** a disclosure button on every parent row, with the whole accessible name ("Expand Security group, 4 topics") from `RowTree.label`; click toggles one parent; "Expand all" and "Collapse all" toggle every parent; the expanded set is in the URL (`nuqs`, `history: 'replace'`) so a shared link restores it; collapsed children are not rendered; sorting reorders the siblings under each parent, never moves a child out of its parent; a filter that matches only a level 2 topic keeps its level 1 row visible and expanded; a filter that matches only a level 3 topic keeps its level 2 and level 1 rows visible and expanded.
  - **Keyboard:** Right Arrow on a collapsed parent row expands it and Left Arrow on an expanded parent collapses it (the `DataTable` treegrid keys); Left Arrow on a child row moves focus to its parent row; Enter and Space toggle a parent row from its first cell; focus stays on the row that was toggled; the tab stop is single (roving) as in the rest of the table; the screen reader hears level, position and set size and the expanded state.

**Steps:**

- [ ] Add `sort-model.ts`; wire `DataTable` sort for both tables (replace `NO_SORT`), default Mention rate descending, keep URL state keys of the existing filters.
- [ ] Mention rate and Citation rate columns use `acrossEngines` and `InsufficientPill`; label "avg of N" from `engines`.
- [ ] Top engine column with the engine logo (ADR-DS-020) and all rates in the tooltip.
- [ ] Prompts tab: grouped two row header with the metric switcher (Mention, Citation, Share of voice; Recommendation appears in S2).
- [ ] Topic subtitle and path badge from the topic tree; footer counts.
- [ ] W2-T: add `topic-tree.ts` and `topic-tree.test.ts` (order the rows parent first with children after, depth, parent lookup, ancestors of a match) from the API rows and `useVocabularies`; render the Topics tab through the `DataTable` treegrid (`rowTree`, `onToggleGroup`). Show at most two levels: skip topics deeper than level 2 as rows (the API rows already roll their counts into level 2 and level 1) and show the deeper name as a path in the drawer. `RowTree.level` stays `1 | 2`; no change to `RowTree`, `DataTable` or `aria-level`. Add the rollup note and the expanded set in the URL.
- [ ] Gate.

**Status (2026-11-12): W2a is done** (commit "Topics & Prompts: Mention rate and Citation rate columns, Top engine, a metric switcher on the Prompts tab and sorting by rate"). It lives in `rate-model.ts` (`averageRate`, `cellFigure`, `topEngine`, `sortByKeys`; the plan's `sort-model.ts` is folded into it), `rate-columns.tsx` (the columns), `prompt-model.ts` (`SORT_ID`, the defaults and `parseMetric`), `prompt-columns.tsx`, `topics-table.tsx` and `prompts-screen.tsx`. Not built in W2a, on purpose: the engine logo beside Top engine (ADR-DS-020 describes `EngineLogo`, but no such component exists in `apps/web/src`, and the table names engines in words as the strip does), and the grouped two row header of the Prompts tab (`DataTable` has no column groups, so the engine columns are headed "ChatGPT mention", "ChatGPT citation" or "ChatGPT SOV" and the switcher sits in the toolbar). A review fix changed the average: "avg of N" counts only the engines that show a percent of their own (at least 4 valid answers), the same rule as Top engine and the topic drawer, so N always equals the percents in the engine columns. The tree, Expand all, path badge and footer counts are W2b, below.

**Status (2026-11-12): W2b is done** (commit "Topics & Prompts: topics as an indented two level tree with Expand all, a rollup note and the topic path"): `topic-tree.ts` (`buildTopicTree`, `sortTopicTree`, `countTopicRows`), `topics-table.tsx`, `prompt-columns.tsx` (the topic badge and its path tooltip) and `prompts-screen.tsx`. Decided on the way: `RowTree.level` is 1 or 2 and only a level 1 row opens, so a parent opens onto its child topics (each a row of its own that opens the drawer, no prompts under it) plus a "Show all N prompts of X" row, and a topic without children opens onto its prompts as before; a child whose parent a topic filter does not keep is shown at the top level; the expanded set is in memory, not in the URL (the owner's brief overrides the line above); the footer reads "N topics, M prompts" with the prompts in scope (the topic filter narrows them, a search does not); the subtitle is the count of child topics ("3 topics") beside the name on the same line, which the compact row fits. Not done: the drawer's engine bars (G113) and a "Show in Prompts" shortcut from a child topic (its drawer's Prompts tab lists its prompts).

**Commit:** `Topics & Prompts: rate columns, sorting, topic subtitle and path, indented topic tree, expand all`

### Task W3: Previous period compare and deltas (G05, G06, G111, G115; PR-41, DB-02)

**Needs from the backend:** none (two reads). When D1 Task 3 (B4 `compare=previous_period`) is on develop, switch the second read to it (a change inside `prompt-queries.ts` only). **Mocks first:** the summary mock already takes `from` and `to`; add a fixture where the previous window differs.

**Read first:** `lib/stats/change.ts`, `lib/format/delta.ts`, `docs/design-system/23-application-patterns.md` sections 8.4 and 8.5, `docs/17-statistical-methodology.md` section 6, parity spec decision D-2, `AI_DEVELOPMENT_UI_RULES.md` rule 6.

**Files:**

- Create: `components/app/metric/delta.tsx` (+ test), `features/prompts/compare-model.ts` (+ test)
- Modify: `prompt-queries.ts` (`previousSummaryQuery`), `strip-model.ts`, `topics-table.tsx`, `prompt-columns.tsx`, `topic-inspector.tsx`, `prompt-inspector.tsx`, `prompts-screen.tsx`, `messages/en.json`, `mocks/handlers/prompts.ts`

**Failing tests first:**

- `delta.test.tsx`: renders `formatMetricDelta` text; coloured only when `isDetectable` is true; when false shows the neutral tone with the "Within normal variation" note in the tooltip; when null shows nothing (never a zero); axe clean.
- `compare-model.test.ts`: `previousWindow` of 28 days ending on a date is the 28 days before it; `changeOf` uses `isDetectableChange({k, n}, {k, n})` with pooled counts and returns `detectable: null` when either side is insufficient; the delta is in points of the displayed (prompt weighted) value.
- `prompts.test.tsx`: Compare control (Previous period, No comparison; Same period last year is not offered because there is no data); with comparison on, two summary reads happen (the mock sees both windows); the strip, the Mention rate column and the topic drawer rate cards show a `Delta`; "Detectable changes only" chip hides rows without a detectable change and is in the URL; the tooltip says "interim test" until slice 3.

**Steps:**

- [ ] `Delta` component on `formatMetricDelta` (no component exists yet; spec in DS 23 8.4).
- [ ] `previousSummaryQuery` in `prompt-queries.ts`, enabled only while the Compare control is on; the previous read follows the same engine, branded and (when W6 lands) scope filters.
- [ ] `compare-model.ts` and deltas on strip items, Mention and Citation columns, drawer rate cards (G111) and top prompts (G115).
- [ ] "Detectable changes only" chip in the filter bar.
- [ ] Copy the interim wording from D-2 into `prompts.compare.interim`.
- [ ] Gate.

**Commit:** `Topics & Prompts: compare with the previous period, deltas coloured only when detectable`

### Task W4: Prompt inspector tabs (G48, G90 to G96, G98, G100; PR-25, PR-41, PR-42, CI-16)

**Needs from the backend:** none (tabs 1, 2, 4, 5 read slice 1 routes). The Citations tab is a prepared empty state until W7 (B6). **Mocks first:** the observation list mock must return 90 days of answers for one prompt (about 80 rows) with `facts.competitor_mentions`; extend `prompt-answers.ts`.

**Read first:** `prompt-inspector.tsx` (one scroll today), `answer-inspector.tsx`, `components/app/inspector/inspector-tabs.tsx`, `topic-inspector.tsx` (tabs pattern), `components/app/chart` (`ChartFrame`), `lib/stats/wilson.ts`, `docs/design-system/15-data-visualization.md` (bands), parity spec section 5.6.

**Files:**

- Create: `history-model.ts` (+ test), `competitor-counts.ts` (+ test), `inspector-latest.tsx`, `inspector-history.tsx`, `inspector-citations.tsx`, `inspector-competitors.tsx`, `inspector-stats.tsx` (each with a test)
- Modify: `prompt-inspector.tsx`, `prompt-queries.ts` (an `observationsQuery` call with `filter[prompt_id]`, 90 days, limit 200), `messages/en.json`, `mocks/handlers/prompt-answers.ts`

**Failing tests first:**

- `history-model.test.ts`: `rollingSeries` over 90 days of answers gives one point per day with the trailing 28 day mentions k of n, the Wilson band from `wilsonInterval(k, n)`, and no band when n is under 4; answers with `status` not valid are left out and counted.
- `competitor-counts.test.ts`: counts `facts.competitor_mentions` ids per engine over the valid answers, names from `summary.entities`, the own brand listed first; an answer with no competitor counts toward n only; 200 rows is the page limit and a `has_more` page is fetched until the window is covered.
- `prompt-inspector.test.tsx`: tabs Latest, History, Citations, Competitors, Stats in the URL (`?inspect=prompt:<id>&tab=`); Latest shows the latest valid answer per engine (one `GET ai/observations/{id}` each) with marked mentions, the facts Mentioned, Cited, and no Rank or Recommended (D-9); History shows the chart, a last 10 table with outcome words and an event list (added, stale, model change from `model_reported`); Competitors shows counts for this prompt only; Stats shows estimate, interval bar and sample per engine for Mention and Citation with the method note; Citations shows the empty state; keyboard J and K still step; header badges show topic path, Branded, Archived and no Type.

**Steps:**

- [ ] Split `prompt-inspector.tsx` into the five tab panels without changing its Run now, Archive and Undo behaviour (existing tests must stay green).
- [ ] History and Stats read one observation list; no per-tab refetch.
- [ ] Interval text also in rate tooltips (G48).
- [ ] Gate (with `pnpm build`).

**Commit:** `Prompt inspector: tabs for latest answers, history with intervals, competitors and stats`

### Task W5: Menus, bulk actions, export, views and details (G02 to G04, G07, G08, G26 to G28, G46, G47, G82, G110, G118, G123 to G125)

**Needs from the backend:** none. Bulk Run now is capped at 20 manual runs a day until B7 (decision D-5). **Mocks first:** existing run-now, archive and patch mocks.

**Read first:** `components/app/data-table/bulk-action-bar.tsx`, `components/ui/menu.tsx`, `features/rankings/export/*`, `add-prompts-dialog.tsx` (defaults), `docs/design-system/23-application-patterns.md` (menus, bulk), `RUN_NOW` errors in `prompt-run-now.ts` (`manual_run_limit`).

**Files:**

- Create: `row-menu.tsx`, `bulk-bar.tsx`, `export-rows.ts`, `views-model.ts`, `edit-details-dialog.tsx` (each with a test)
- Modify: `prompts-screen.tsx`, `topics-table.tsx`, `prompt-columns.tsx`, `add-prompts-dialog.tsx`, `topic-inspector.tsx`, `prompt-queries.ts`, `messages/en.json`

**Failing tests first:**

- `export-rows.test.ts`: CSV of loaded rows with percent, counts and window in the header, formula injection guarded (leading `=`, `+`, `-`, `@` prefixed), UTF-8 with BOM only if the rankings export does the same.
- `views-model.test.ts`: presets Default and Branded prompts map to URL states (Branded prompts is `branded=only`) and round trip; no persistence.
- `row-menu.test.tsx`: Prompt row menu: Open, Run now, Copy prompt, Archive (Edit details opens the dialog); topic menu: Open, Show in Prompts (switches tab, keeps the topic filter), Add prompt (dialog with the topic preselected), Export; right click opens it; Run now on a refused prompt shows the named reason.
- `bulk-bar.test.tsx`: "N selected", "Select all N matching" with a hidden-by-filter note; Run now sends one run per prompt and stops with the named message at the 20 a day limit (`manual_run_limit`), Archive runs one `DELETE` per id with Undo, Export of the selection; topics bulk bar "N topics selected, M prompts".
- `edit-details-dialog.test.tsx`: `PATCH prompts/{id}` with `term_ids`, `importance`, `intent`, `is_branded`; no text field (text is immutable in slice 1); API errors map to fields.
- screen tests: custom date range up to 92 days (a longer range is refused with the reason), Branded three way (Excluded, Included, Only) on the Prompts tab, Copy link copies the current URL, topic J and K steps and "3 of 13".

**Steps:**

- [ ] Build each piece against existing mutations; Archive per id until B7 adds `bulk-archive`.
- [ ] Add prompt buttons: topic menu, drawer header, bulk bar; the dialog takes the topic as a default term.
- [ ] Client CSV export reusing the rankings export file helper through `@/lib` (move the helper there if needed, features do not import each other).
- [ ] Messages, then gate (with `pnpm build`).

**Commit:** `Topics & Prompts: row and topic menus, bulk actions, CSV export, view presets, details dialog`

---

## Stage 2: wiring to backend items

### Task W6: Header meta, stale badges, country scope and the Branded Only scope on Topics (G01, G08, G11, G30, G33, G44; PR-13, PR-38)

**Needs from the backend:** B1 (BUILT, `6d681a5`: `last_observed_at`, `last_valid_at` on rows) and B2 (D1 Task 2: `filter[country_iso]=^[A-Z]{2}$`, `filter[term]`, `branded_only`; response echoes `branded_only`). **Mocks first:** add the two time fields to prompt and topic rows and the three params to the summary mock, with `422 validation_failed` for a lower case country.

**Read first:** D1 Decisions 1, 4 and 7; `prompts-screen.tsx` `meta`; `summaryQuery`.

**Files:** Modify `prompt-queries.ts` (scope params into `summaryQuery`), `prompts-screen.tsx`, `topics-table.tsx`, `prompt-columns.tsx`, `strip-model.ts`, `messages/en.json`, `mocks/handlers/prompts.ts`; tests.

**Failing tests first:** header meta "Updated Nov 12, 02:10, 13 topics, 250 prompts" from the newest `last_observed_at` of the rows; a row whose `last_valid_at` is older than twice the schedule interval shows a Stale badge with the date in its tooltip (null reads as "no answer in this window", D1 open point 5); Country filter applies to the Topics tab and the strip and the request carries `filter[country_iso]`; Branded Only sends `branded_only=true` and the strip follows; with a scope the topic rows hold only in-scope prompts.

**Steps:** [ ] switch the filter code to server scope on the Topics tab and strip; [ ] Updated column; [ ] gate.

**Commit:** `Topics & Prompts: last answer time, stale badge, country and branded only scope`

### Task W7: Citations tab and the Citations page (G97; CI-01 to CI-16, PR-23, PR-51, M-02; adopt U-08, U-15)

**Needs from the backend:** B6 (handoff: `GET {P}/ai/citations`, `ai/sources/domains`, `ai/sources/pages`, with `filter[prompt_id]`). **Mocks first:** write the mock to the handoff contract, with own, competitor and third party rows.

**Read first:** `docs/14-citation-intelligence.md`, DS 24 section 9.7, doc 19 lines 1245 to 1247, competitor study U-08 and U-15, `answer-inspector.tsx` (`answer.sourceRoles`).

**Files:** Create `features/citations/*` (queries, model, `citations-screen.tsx`, tabs Domains, Pages, New and lost), a route `.../ai/citations`, a navigation entry; modify `inspector-citations.tsx`, `lib/navigation/registry.ts` (+ test), mocks.

**Failing tests first:** prompt Citations tab: a `Banner` "Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13 pages cited", a `DataTable` (not cards) of top domains and pages per engine with own rows tinted `primary-subtle`, a count cell popover listing up to 5 `DomainCell` rows (U-15); Citations page: strip (own citation share with units and observations), Domains tab with source share and role, Pages tab with role filter and "Cited with" column, New and lost markers with the engine note; a prompt cited by no own page says so in words (M-02); no composite score anywhere.

**Steps:** [ ] feature folder and queries; [ ] prompt tab; [ ] page; [ ] navigation entry (`pnpm build`); [ ] gate.

**Commit:** `AI visibility: citations tab on the prompt inspector and a Citations page`

### Task W8: Competitor views (G43, G116, G112 partly, G98; DB-12, DB-17, DB-21, DB-28, M-04, M-23; adopt U-16)

**Needs from the backend:** B5 (D1 Task 5): `include=entities` on `GET {P}/ai/prompts-summary` gives per engine `entities: [{entity_id, mentioned, share_of_voice}]`, at most 20 tracked entities (own first). Ask for it only with `filter[term]` (the topic drawer) or a small page: D1 estimates about 1.5 MB at full capacity with `series,entities`. **Mocks first:** to D1 Decision 8 (one answer, one weight: an answer's entity shares sum to 1; own entities' shares sum to the row's share of voice cell).

**Read first:** D1 Decisions 6 and 8; `topic-inspector.tsx` shortcut comment; `components/app/entity`; competitor study DB-12, U-16.

**Files:** Modify `topic-inspector.tsx` (Competitors tab), `prompt-columns.tsx` (Top competitor column), `inspector-competitors.tsx` (switch from counts to cells), `prompt-queries.ts`, mocks; create `competitor-model.ts`.

**Failing tests first:** topic drawer Competitors tab lists entities by engine with own brand first and the `chart-1` swatch, a `BarList` of share of voice with the tracked set and the date each competitor was added in the footnote; Top competitor column shows the entity with the highest share of voice and its value, "none named" in words when no competitor is named; per engine change cell shows "New" and "Lost" neutral badges with k of n (U-16); an entity cut by the 20 cap is stated; no value is shown for a cell with `value: null`.

**Steps:** [ ] model; [ ] drawer tab; [ ] column; [ ] gate.

**Commit:** `Competitors: topic drawer tab, top competitor column and per entity share of voice`

### Task W9: Fan-out view (FO-01 to FO-17, M-20; adopt U-07)

**Needs from the backend:** B19 `GET {P}/ai/fanout-queries` (slice 2 pre-work; handoff). **Mocks first:** to the handoff contract. Interim without the route: FO-14 and FO-16 from `fanout_count` (ChatGPT only), already on `ObservationSummary`.

**Files:** Create `features/prompts/fanout-tab.tsx`, `fanout-model.ts`; modify `prompt-inspector.tsx` (tab appears only when an enabled engine exposes fan-out), mocks.

**Failing tests first:** `DataTable` of queries with times used ("In 6 of 12 ChatGPT answers"), last seen, "New in window" badge, an expandable row with the domains cited in those answers (an association, worded as such), `min_support` control default 2, an engine note "Gemini and AI Mode do not expose fan-out" (never zero), no priority score; a possibly truncated list shows the truncated note.

**Commit:** `Prompt fan-out tab: queries by frequency and who is cited`

### Task W10: Bulk run (G26, G47, G66; U-21)

**Needs from the backend:** B7 (`POST {P}/ai/runs` with `prompt_ids` and `engine_codes`, one manual run). **Mocks first:** to the handoff.

**Files:** Modify `bulk-bar.tsx`, `row-menu.tsx`, `prompt-queries.ts`, mocks.

**Failing tests first:** Run now for N selected sends one request, shows the estimate and the named refusals (`quota_exceeded`, `manual_run_limit`, `check_pending`); the 20 a day cap message of W5 disappears; Archive uses `bulk-archive` once and offers Undo.

**Commit:** `Bulk run and bulk archive for prompts`

### Task W11: Weekly trend sparklines and the topic visibility trend (G29, G44, G112; DB-01)

**Needs from the backend:** B3 (D1 Task 4: `include=series`, weeks start Monday in the project timezone, at most 14 points, empty weeks as zero counts with `value` null). Entity lines in the drawer also need B5, and the API gzip task B0 should be on develop first (decided 2026-11-12; `include=series,entities` is about 1.5 MB at full capacity). **Mocks first:** to D1 Decision 9.

**Files:** Modify `topics-table.tsx`, `prompt-columns.tsx` (Trend column on `SparklineCell`), `topic-inspector.tsx` (trend chart on `ChartFrame`), `prompt-queries.ts` (a second read with `from` 55 days back when an 8 week sparkline sits beside a 28 day table, D1 open point 1), mocks.

**Failing tests first:** gaps for empty weeks, not zeros; the series starts at the week boundary in the project timezone; a point with fewer than 4 answers is drawn hollow and has no band; competitor lines come from entity cells only.

**Commit:** `Topics & Prompts: weekly trend sparklines and the topic visibility trend`

### Task W12: Discover prompts inbox with recommended prompts (AP-01, AP-03, AP-09; U-06; needs slice 4 candidates)

**Needs from the backend:** `{P}/prompt-candidates` (S4, doc 11 5.2, doc 20 5.13). Blocked until then; write the mock first and the screen, ship behind the missing backend only when the route exists.

**Failing tests first:** inbox `DataTable` with stage and intent `FilterChip`s, per row Add and a `BulkActionBar`, "Already tracked" state, source badge, banner "Generated phrasing, not an observed user prompt", no buyer intent colours, no "Add all" without a preview.

**Commit:** `Discover: prompts inbox with recommended prompts`

### Task W13: AI Visibility Overview page (DB-01, DB-09, DB-12, CI-01; DS 24 section 9.2)

**Needs from the backend:** `GET {P}/ai/metrics/overview` (Ph 9, no slice), or computed from the summary plus B6 and B5 (the study's stage B item 11). Per engine strip, citation share as a 100% bar (`OutcomeMixBar`), a `BarList` of share of voice, key changes (W3 deltas). No donut, no score.

**Commit:** `AI visibility: overview page`

---

## Stage 3: slice 4 and decisions

### Task W14: Panels and Versions tabs (G09, G60 to G70, G81, G99, G102)

**Needs:** slice 4 (B10, B11, B12). Blocked on the backend routes only; tabs stay hidden (D-4). The cadence (twice a week, Monday and Thursday, decided 2026-11-12) and the restore rule (a restore is not a `change_kind`, decided 2026-11-12) no longer wait on a decision; set the mocks back to twice a week. Do not start before the backend routes exist; build the mocks to the doc 19 contracts then. Never ship the preview's constants (flip rates, authors, reasons).

### Task W15: Page-level AI readiness checks (NEW; GA-01, GD-15, GD-16, M-09, M-10)

**Needs:** a product decision (competitor study Q5) and an SSRF-safe fetch service (`docs/24-security.md` section 7.3), none of which exists. Scope when approved: robots.txt rules per AI bot (GPTBot, Google-Extended, PerplexityBot and the rest of a maintained list), `llms.txt` presence, sitemap and meta robots, JSON-LD found vs expected for the page type; shown as a checklist per page in SEO > Pages with the HTML fact behind each check, no score, no credits, no generated fixes. Not startable by the web alone.

### Task W16: Topic SEO columns, drawer In search and Related, mobile list rows (G14, G31, G114, G117)

**Needs:** B9 split: counts and Top 10 are web only from `GET {P}/tracked-keywords` (`filter[term]`, `filter[rank_lte]=10`, `page.total`); volume weighted visibility needs `seo/metrics/breakdown?dimension=term`. Verify first that keyword topics and prompt topics use one vocabulary. Mobile rows below 768 px follow DS 19 section 6.7.

### Task W17: Prompt type on create and the Type filter (G10; D-8; needs B16)

**Needs from the backend:** B16: the server rule at create (" vs " or "versus" gives comparison, "how to" gives how_to, a leading interrogative gives question; no LLM) and `filter[prompt_type_in]` on `GET {P}/prompts`. Decided 2026-11-12, so nothing waits on a decision. **Mocks first:** the same rule in the create mock and the filter in the list mock, with their tests.

**Failing tests first:** the Add dialog shows the type the rule would pick and lets the person change it before saving, and sends the person's choice in `prompt_type`; the Prompts tab has a Type `FilterChip` (`filter[prompt_type_in]`, in the URL) and a Type badge on the row and in the inspector header; the filter and badge stay hidden until B16 is on develop; `PATCH` changes the type from Edit details.

**Commit:** `Topics & Prompts: prompt type on create, Type filter and badge`

---

## Each task: what it needs and what it can be built against

| Task | Backend need                                        | Build against mocks first | Can start now                                 |
| ---- | --------------------------------------------------- | ------------------------- | --------------------------------------------- |
| W1   | none                                                | not needed                | yes                                           |
| W2   | none (D-3 decided: indented tree)                   | not needed                | yes                                           |
| W3   | none; later D1 Task 3 (B4) replaces the second read | yes, two windows          | yes                                           |
| W4   | none (Citations tab empty until W7)                 | yes, 90 days of answers   | yes                                           |
| W5   | none; B7 later lifts the 20 a day cap               | existing mocks            | yes                                           |
| W6   | B1 built; B2 (D1 Task 2)                            | yes, to D1                | B1 part yes, scope part after mocks           |
| W7   | B6                                                  | yes, to the handoff       | yes (mock first)                              |
| W8   | B5 (D1 Task 5)                                      | yes, to D1                | yes (mock first)                              |
| W9   | B19                                                 | yes, to the handoff       | yes (mock first); interim from `fanout_count` |
| W10  | B7                                                  | yes                       | yes (mock first)                              |
| W11  | B3 (D1 Task 4); entity lines B5                     | yes, to D1                | yes (mock first)                              |
| W12  | S4 candidates                                       | yes                       | no (wait for slice 4 contract)                |
| W13  | Ph 9 overview or B6 plus B5                         | partly                    | after W7, W8                                  |
| W14  | S4 B10 to B12 (decisions made 2026-11-12)           | no                        | no                                            |
| W15  | product decision, fetch service                     | no                        | no                                            |
| W16  | B9 visibility only                                  | partly                    | counts and Top 10 yes                         |
| W17  | B16 (decided 2026-11-12)                            | yes                       | after the mock                                |

## Self-review checklist

- Each task's tests were seen failing first and the gate output was read, not assumed.
- No task invents a number; every empty state names its cause.
- Colour appears only on a detectable change; every percent has its count; every rate under 4 answers shows the pill.
- English strings only in `en.json`; no dash used as punctuation.
- `pnpm gen:api` was run in any commit that depends on a backend change, and the mock and the generated client agree.
