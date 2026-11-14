# WP-06 detailed task plan: HeatmapGrid, SmallMultiples, ScatterChart chunk

Brief: [WP-06-chart-grids.md](../../ai-visibility/work-packages/WP-06-chart-grids.md). Branch `ai/wp-06-chart-grids`,
worktree `.claude/worktrees/wp-06`, cut from `origin/develop` at `bc2e21cc` (WP-04 chart platform and WP-07 app parts
merged). Row closed: SC-14 (web.md). Owner decisions taken at their defaults, not asked: D-04 `POOL_BELOW_PROMPTS` 10,
D-05 the 7 fixed bins of CH-04, mirrored in dark.

## 1. What exists, and what it decides

| Found | Consequence |
|---|---|
| `ChartFrame` kind `html` (`components/app/chart/chart-frame.tsx`): title, meta, `notice` (stale, partial), legend with `onLegendToggle`, Table toggle, menu `{fileName, png, csv, link}` (`HtmlChartMenu`), footnote, `status` loading (skeleton in the reserved height), refetching (keeps the body, says "Updating"), empty (`ChartEmpty` title, reason, action), error (`ChartError`, `InlineError` with retry) | Both parts render inside `ChartFrame` kind `html`; they add no state handling of their own. Every required state comes from the frame |
| `EChart` (`echart.tsx`) registers Line, Bar, Grid, Tooltip, Aria, MarkArea, MarkLine, MarkPoint, Canvas; the frame imports it with `next/dynamic` (`ssr: false`, skeleton) | SmallMultiples imports it the same way. Scatter goes in a separate module loaded only by `import()` |
| `rateBandOption(base, tokens, {points, ceiling, dark, titles, previousId, boundaries})` in `lib/charts/rate-band-chart.ts` draws bands, hollow 5 px thin points (`smallSamplePoint`) and boundaries (`boundaryMarkLines`) | Each multiple is `categoryChartOption` then `rateBandOption`; no new canvas code |
| `rateCeiling(history)` lives in `features/prompts/history-model.ts`, typed to that page's `History` | SmallMultiples exports its own `rateCeilingOf(panels)` with the same rule; As built names the follow-up that points the prompt history at it (not this package's file) |
| `lib/stats/rates.ts`: `MIN_OBSERVATIONS = 4`, `RateState = 'ok' \| 'insufficient' \| 'none'` | `HeatCell.state` is `RateState` |
| `bg-insufficient` utility (globals.css), `InsufficientPill`, `SmallSampleMarker` | Hatched cells use `bg-insufficient` |
| `--seq-1..7`, `--div-neg-3..div-pos-3` in tokens.css, no Tailwind colour mapping | Fill classes use the CSS variable shorthand `bg-(--seq-3)` written out in full in one map (precedent `z-(--z-dialog)`), so no arbitrary value and no globals.css edit |
| `DataTable` is a `role="grid"` table with one roving tab stop; `moveFocus(cell, key, size, {ctrl})` in `lib/tables/grid-focus.ts` is pure; tree keys follow 20-accessibility 6.7 (Right opens a closed group row or moves into it, Left closes or moves to the parent); rows `h-row` / `h-row-compact` by `Density` from `lib/tables/table-state` | HeatmapGrid reuses `moveFocus` and the same tree key rule and row heights; it is not a DataTable (cells are links, columns are bins) |
| Design preview: `design-preview/charts.js` lines 167 to 270 (overview multiples: x labels on the last row only, axis pointer shared); no heat-map in the preview | Multiples follow the preview layout but with ONE shared ceiling (inventory 6 overrides the preview's per-row scale). The heat-map follows CH-04 text only |
| No bundle budget tool: no `size-limit`, no analyzer, no script (`apps/web/package.json`); 20-frontend 9 names `size-limit` as target design only. `/ai/prompts` exists (`app/[workspace]/[project]/ai/prompts/page.tsx`) | Task 3 proves the budget by comparing two production builds (section 5, Task 3) plus a committed import guard test |
| Messages: WP-02 pre-created no namespace for WP-06; WP-04 put chart copy under `chart` | Lease L1 |
| Gallery: `registry.ts`, `section-slugs.ts` and the ordered list in `registry.test.tsx`; `e2e/flows/design-system.spec.ts` runs axe on every slug in both themes | Task 0b adds slug `chart-grids`; the existing design-system e2e then covers it |

### Contrast finding (measured from tokens.css with culori, WCAG ratio)

| Bin | Light: foreground / inverse | Dark: foreground / inverse |
|---|---|---|
| seq-1 to seq-4 | 16.5, 13.7, 10.6, 7.5 / under 2.3 | 14.0, 11.3, 8.3, 5.7 / under 2.7 |
| seq-5 | **4.85** / 3.54 | 3.71 / **4.02 (fails)** |
| seq-6, seq-7 | 3.03, 1.89 / **5.67, 9.08** | 2.39, 1.60 / **6.25, 9.34** |

CH-04 says `foreground` on seq-1 to 4 and `foreground-inverse` on 5 to 7. In light, seq-5 needs `foreground`. In dark,
no text colour passes 4.5:1 on seq-5; `oklch(0.61 0.15 262)` gives 4.55:1 with `foreground-inverse`. Question Q1.
Text colour by bin, as built: light `foreground` 1 to 5, `foreground-inverse` 6 and 7; dark `foreground` 1 to 4,
`foreground-inverse` 5 to 7 (`dark:` variant, `.dark` class on html).

## 2. Leases and questions for the lead (settle before Task 1)

| # | Path or question | Change | Needed at | Default if unsettled |
|---|---|---|---|---|
| L1 | `apps/web/messages/en.json`, object `chart` (WP-04's, merged) | New sub-objects `chart.heatmap` and `chart.multiples` only | Task 1 | none: copy must come from messages |
| L2 | New files in `components/app/chart/`: `heat-bins.ts`, `heat-bins.test.ts`, `heat-bins.contrast.test.ts`, `echart-scatter.tsx`, `echart-scatter.test.ts` | New files, no edit of WP-04 files | Tasks 1, 3 | bins inside `heatmap-grid.tsx`, scatter module named in As built |
| L3 | `components/design-system/registry.ts`, `section-slugs.ts`, `registry.test.tsx` (the order list), new `chart-grids-section.tsx` and its test | One entry each: slug `chart-grids`, title `Chart grids` | Task 0b | none |
| L4 | `apps/web/e2e/flows/ai-chart-grids.spec.ts` | New file (MASTER-PLAN 3.6 convention) | Task 4 | none |
| Q1 | `apps/web/src/styles/tokens.css` dark `--seq-5` fails 4.5:1 with both text colours | Lease to set dark `--seq-5: oklch(0.61 0.15 262)` and the 02-color-system 7.3 row, or the owner of tokens.css does it | Task 1 (the contrast test fails without it) | blocks the Task 1 commit; no shipping a failing pair |
| Q2 | `echart.tsx` is owned "registration only" | SmallMultiples needs a `group?: string` prop (sets `instance.group`, calls `connect(group)` from `echarts/core`): about 4 lines. Confirm it counts as WP-06's | Task 2 | ask before Task 2 |
| Q3 | Diverging bins: no thresholds in any spec | Change in points: under 5, 5 to 15, 15 and up per side; coloured only when `detectable === true` (R5), else `div-zero` with "within normal variation" | Task 1 | the default |
| Q4 | PNG export of both parts | Not built: html PNG needs a raster of the body and multiples need instance access. Menus carry `csv` and `link` only | Task 4 | the default, As built says so |
| Q5 | Where `POOL_BELOW_PROMPTS` lives | WP-06 does no pooling: a point arrives with its pooled tip (`rateTipText` `pooledWeeks`). The constant lands in `lib/stats/rates.ts` with the first model package (WP-12) | none | the default |

## 3. House rules every task follows

- Tests first, beside the file, Vitest with `renderWithProviders` (`src/test/render`) and `axe` (`src/test/axe`);
  canvas parts mock `@/components/app/chart/echart` as `registry.test.tsx` does. One file at a time:
  `pnpm --dir apps/web exec vitest run <file>`.
- Edits with file tools only; no heredocs, `sed` or replace scripts. Typed props, no `any`, `readonly` arrays,
  explicit return types. Tokens and type utilities only (`type-table`, `type-micro`, `num`); no arbitrary values.
- Every string from messages (L1) or from props; numbers from `@/lib/format`; ASCII only, no em-dash or en-dash.
- The parts never compute a rate, pool engines or pool weeks: features pass finished `text`, `tip` and points.
- Commit per task `WP-06: <task title>` naming only this package's files; no attribution lines, no dashes.
- After each task a fresh Sonnet reviewer reads this plan, the task and the diff, runs the task's tests, does the
  "prove it bites" weakening in a scratch commit never pushed, and returns PASS or a numbered fix list.

## Task 0: environment

1. `pnpm install` is run by the lead through the medium lane; do not run it again. Confirm
   `test -d apps/web/node_modules/echarts` and `git log -1 --format=%h` is `bc2e21cc` or later develop.
2. No backend and no Colima: this package is web only against fixtures.
3. Lanes (from the repository root; the machine is shared and has hung under load):
   - one test file, light: `pnpm --dir apps/web exec vitest run <file>`
   - full suite, only this form: `infra/dev/heavy --label wp-06-test --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'`. Never plain `pnpm test`.
   - `infra/dev/heavy --lane medium --label wp-06-lint -- pnpm --dir apps/web lint`, same for `typecheck` and `format:check`
   - build: `infra/dev/heavy --label wp-06-build -- pnpm --dir apps/web build`
   - e2e (its web server runs `pnpm build` itself): `E2E_PORT=<free port, lsof shows nothing> infra/dev/heavy --label wp-06-e2e --max 40 -- pnpm --dir apps/web exec playwright test --project=e2e e2e/flows/ai-chart-grids.spec.ts e2e/flows/design-system.spec.ts`
   - browser check: one dev server on the session's port 3101 to 3105 with `NEXT_PUBLIC_API_MOCKING=all`, after
     the Dev Server Policy check (`lsof -nP -iTCP -sTCP:LISTEN`); stop it after.
4. Report `infra/dev/wp-status WP-06 building "<note>"` once this plan is committed.

## Task 0b: gallery registration (early, small, under L3)

Files: `components/design-system/section-slugs.ts` (append `'chart-grids'` after `'metric-parts'`), `registry.ts`
(`{ slug: 'chart-grids', title: 'Chart grids', render: ChartGridsSection }`), `registry.test.tsx` (append the slug
to the expected order), new `chart-grids-section.tsx` with real content from the start: a `SpecimenGroup` titled
"Heat-map table" holding one paragraph of what the part is for (CH-04, CH-11, CH-12) and "Small multiples" likewise.
Tasks 1, 2 and 4 fill the groups.

Tests: `registry.test.tsx` (order, unique titles, slugs equal `PREVIEW_SECTION_SLUGS`, axe of the new section in
both themes, the existing `describe.each`). Run it and `section-nav.test.tsx`, light.

Commit `WP-06: gallery entry for the chart grids`. Push at once (rebase, fast-forward to develop) so the three shared
files are released early.

## Task 1: HeatmapGrid with bins, hatch and tree rows (SC-14)

Files: create `components/app/chart/heat-bins.ts` (L2), `heat-bins.test.ts`, `heat-bins.contrast.test.ts`,
`heatmap-grid.tsx`, `heatmap-grid.test.tsx`; edit `messages/en.json` `chart.heatmap` (L1).

### API

```ts
// heat-bins.ts: the one bin function of every rate heat-map (D-05); pure, no React
export type HeatScale = 'sequential' | 'diverging';
export interface HeatBin { fill: string; text: string; key: string } // full class strings, message key of the bin
/** 0 | under 10 | 10 to 20 | 20 to 35 | 35 to 50 | 50 to 70 | 70 and up, on the whole percent that is printed. */
export const RATE_BIN_EDGES: readonly number[] = [0.1, 0.2, 0.35, 0.5, 0.7];
export function sequentialBin(rate: number): HeatBin;                              // seq-1 .. seq-7
export function divergingBin(points: number, detectable: boolean | null): HeatBin; // div-zero unless detectable
export const SEQUENTIAL_BINS: readonly HeatBin[];  // the key under the table, in order
export const DIVERGING_BINS: readonly HeatBin[];
export function heatmapCsv(input: { rowHeader: string; columns: readonly HeatColumn[]; rows: readonly HeatRow[] }): CsvTable;

// heatmap-grid.tsx (inventory 6, adapted; departures below)
export interface HeatCell {
  /** Rate 0 to 1 (sequential) or change in points (diverging); read only when `state` is 'ok'. */
  value: number | null;
  answers: number;
  state: RateState;                  // 'ok' | 'insufficient' | 'none' (lib/stats)
  /** The printed value, "47%" or "+2.1 pts" (@/lib/format). */
  text: string;
  /** The cell's accessible name and tooltip, with its counts (R1): "CRM for startups on ChatGPT: 47%, prompt weighted over 17 prompts, 64 of 136 answers". */
  tip: string;
  /** Diverging only (R5): colour only when the 95% interval of the change excludes 0. */
  detectable?: boolean | null | undefined;
  href?: string | undefined;
}
export interface HeatColumn { id: string; label: ReactNode }
export interface HeatRow {
  id: string;
  label: ReactNode;
  /** Plain name for the disclosure button: "Show subtopics of CRM". */
  name: string;
  cells: readonly HeatCell[];        // one per column, same order
  /** Prompt count text for the Prompts column, "17"; the column shows when any row has it. */
  prompts?: string | undefined;
  href?: string | undefined;
  children?: readonly HeatRow[] | undefined; // subtopics or prompts, shown in place
}
export interface HeatmapGridProps {
  caption: string;
  rowHeader: string;                 // "Topic"
  promptsHeader?: string | undefined;
  columns: readonly HeatColumn[];     // engines in fixed order, then "avg of 3" (R3, built by the feature)
  rows: readonly HeatRow[];           // sorted by the feature
  scale: HeatScale;
  /** Column indexes that start after a version boundary (CH-12): a 2 px foreground-muted rule on the left. */
  boundaries?: readonly number[] | undefined;
  density: Density;
  /** `table`: the Table view of the frame; no fill, each cell prints its `tip` words after the row and column. */
  form?: 'grid' | 'table' | undefined;
}
export function HeatmapGrid(props: HeatmapGridProps): ReactElement;
```

Departures from inventory 6, for As built: no `bins` prop (bins are fixed by D-05 and come from `heat-bins.ts`, so a
page cannot pass its own); `HeatRow.children` typed as `HeatRow[]`; `name`, `prompts`, `density`, `form` added.

### Behaviour

- A real `<table>` with `role="grid"`, `<caption class="sr-only">`, column headers `<th scope="col">`, the row label
  `<th scope="row">`, `table-fixed`, data columns 88 px wide (CH-04 3.5; `w-22` if the spacing scale of
  04-spacing-density has it, else the nearest scale width, recorded in As built), row header sticky left
  on `bg-surface`. The wrapper is `overflow-x-auto`, so at 390 px only the table scrolls, never the page.
- Fill and text from the bin of the printed whole percent (`Math.round(value * 100)`), so "10%" printed from 0.0996
  is in the 10 to 20 bin. Edges: lower bound inclusive (0.35 is in 35 to 50); exactly 0 is seq-1.
- `insufficient`: `bg-insufficient`, text `chart.heatmap.insufficient` ("3 ans") in `text-foreground-tertiary`, no
  percent and no bin class whatever `value` holds. `none`: `bg-surface`, "n/a", never "0%" (R6).
- The 36 px rule (DS 15 section 5 table, inventory 6): "cell text only when the cell is at least 36 px wide". One
  `ResizeObserver` on the first data column header; when its width is above 0 and under 36 px the cell text is not
  drawn (the fill stays; the accessible name and tooltip still carry the value and counts). Width 0 (no layout,
  jsdom) draws the text.
- Each cell: an `<a>` when `href` is set, else the `<td>` is the focus target; accessible name `tip`; `Tooltip`
  (`components/ui/tooltip`) with the same `tip` on hover and focus.
- Tree rows: a row with `children` has a disclosure `IconButton` (`ChevronRight` / `ChevronDown`, label
  `chart.heatmap.expand` / `.collapse` with `name`), `aria-expanded`, `aria-level`, `aria-setsize`,
  `aria-posinset` on `<tr>` as DataTable does; children render in place with an indented label (`pl-6`), collapsed
  at first (internal state, no prop).
- Keyboard: one tab stop (the first body cell, then the last focused). `moveFocus` for arrows, Home, End, Page keys,
  Ctrl+Home/End; Enter on a linked cell follows the link; on the row header Right opens a closed row or moves to its
  first child, Left closes an open row or moves a child to its parent (20-accessibility 6.7). Focus ring
  `focus-visible` token ring.
- Key under the table: the 7 (or 7 diverging) swatches with their bounds from `chart.heatmap.bins.*`, then a hatched
  swatch "Fewer than 4 answers" and a `surface` swatch "No answers". Swatches keep their colours under forced
  colours (DS 25 10.7) with the Tailwind `forced-color-adjust-none` utility.
- Density: rows `h-row` (Default) or `h-row-compact` (Compact).
- Light and dark switch by CSS only (`dark:` text classes from the bin map).

### Tests first

`heat-bins.test.ts`
1. `sequentialBin puts each edge in the upper bin`: 0, 0.0049, 0.05, 0.0996, 0.1, 0.199, 0.35, 0.5, 0.7, 1 map to
   seq-1, seq-1 (prints 0%), seq-2, seq-3 (prints 10%), seq-3, seq-4 (prints 20%), seq-5, seq-6, seq-7, seq-7.
2. `text colour follows the measured pairs`: seq-1 to 5 `text-foreground`, 6 and 7 `text-foreground-inverse`, and
   seq-5 carries `dark:text-foreground-inverse`.
3. `divergingBin is neutral unless detectable` (guard): +20 pts with `detectable` false or null is `div-zero`; with
   true it is `div-pos-3`; -6 pts true is `div-neg-2`. Prove it bites: drop the `detectable` check, test fails.
4. `one bin function`: a source scan of `src/` finds `seq-` fill class strings only in `heat-bins.ts` (guard against a
   second bin table on a page). Prove it bites: add a `bg-(--seq-2)` literal in a scratch file.
5. `heatmapCsv writes counts, never a zero for unknown`: an insufficient cell writes its tip words, a none cell
   writes "n/a".

`heat-bins.contrast.test.ts` (reads tokens.css as `lib/design/tokens.contrast.test.ts` does): for each theme and
each bin, the bin's text token on the bin's fill is at least 4.5:1. Fails on dark seq-5 until Q1 is settled.

`heatmap-grid.test.tsx`
6. `is a table with headers`: role grid, caption, column headers, row headers, one cell per column.
7. `hatched insufficient cells never show a number or a colour bin` (guard): a cell `{state: 'insufficient', value:
   0.75, answers: 3}` renders "3 ans", has `bg-insufficient`, no "75%", no `seq-` class. Prove it bites: render
   `text` for insufficient cells.
8. `unknown is never zero` (guard): `{state: 'none', value: 0}` renders "n/a" on `bg-surface`, no "0%", no fill.
9. `every cell names its counts`: accessible name of each cell equals its `tip`, which the fixture writes with
   "k of n answers"; the tooltip shows on focus.
10. `hides text under 36 px and keeps it from 36 px`: stub `ResizeObserver` reporting 35 then 36; text gone then
    present; accessible names unchanged both times.
11. `tree rows open in place`: expand button has `aria-expanded` false, children absent; click; children present
    with `aria-level` 2; collapse hides them.
12. `keyboard path`: one element with tabIndex 0; ArrowRight and ArrowDown move it; Right on a closed row header
    opens it, Right again moves to the first child, Left returns to the parent, Left closes; Enter on a linked
    cell follows the `href` (spy on the anchor click).
13. `boundaries draw a rule`: column index 2 cells and header carry `border-l-2 border-foreground-muted`.
14. `density`: Compact rows `h-row-compact`, Default `h-row`.
15. `table form`: no fill classes, each cell prints its tip words.
16. `axe` clean in light and in dark (`.dark` on html), with a hatched, a none and an expanded row.
17. Inside `ChartFrame` kind `html` with `status` loading, empty (reason and action), error (retry calls
    `onRetry`), refetching (body kept), `notice` stale and partial: the frame's text shows and the grid is absent or
    kept as the frame says.

Gallery: fill the "Heat-map table" group of `chart-grids-section.tsx`: CH-04 (4 topics, one with subtopics,
engines plus "avg of 3", one hatched, one n/a, Prompts column) inside `ChartFrame` html with the Table view,
`menu {fileName: 'mention-rate-by-topic-and-engine', csv: heatmapCsv(...)}`, a density `SegmentedControl` as in
`charts-section.tsx`, a CH-12 specimen with 10 week columns and one boundary, a diverging specimen with one
detectable and one non detectable cell, and the frame states (loading, empty, error, stale).

Checks: the three test files and `registry.test.tsx`, light; lint, typecheck, format:check in the medium lane.
Commit `WP-06: HeatmapGrid with bins, hatch and tree rows`.

Reviewer checklist: bins only in `heat-bins.ts`; contrast test green both themes; no percent or fill on hatched or
none cells; accessible name equals tip and carries counts; one tab stop; tree keys as DataTable; table scrolls
inside its wrapper at 390 px; ASCII copy from `chart.heatmap`; no arbitrary values; guards 3, 4, 7, 8 weakened and
seen failing.

## Task 2: SmallMultiples with shared ceiling and connected crosshair (SC-14)

Files: create `components/app/chart/small-multiples.tsx`, `small-multiples.test.tsx`; edit `echart.tsx` (`group`
prop, after Q2) and add a case to an `echart` test beside it (`echart.test.tsx`, new); messages `chart.multiples`.

### API

```ts
export interface SmallMultiplePanel {
  id: string;
  name: string;                          // "ChatGPT"
  role: SeriesRole;                      // engine colour and marker by fixed order (engineRole of the feature)
  points: readonly (RateBandPoint | null)[]; // one per category; null is a gap, thin is hollow (R2)
  previous?: readonly (number | null)[] | undefined; // compare on: dashed chart-reference, same week index
  /** The Table view and CSV words per category, "34%, 81 of 238 answers"; null prints chart.noValue. */
  cellText: readonly (string | null)[];
}
type MultiplesState =
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined };
export type SmallMultiplesProps = MultiplesState & {
  title: string;
  variant: 'panel' | 'inspector';
  meta?: string | null | undefined;
  notice?: ChartNotice | undefined;
  footnote?: ReactNode;
  categories: readonly string[];          // week labels as on the x axis, "Oct 20"
  categoryHeader: string;                 // "Week"
  titles?: readonly string[] | undefined; // tooltip titles, "Week of Oct 20, 2026"
  panels: readonly SmallMultiplePanel[];
  boundaries?: readonly ChartBoundary[] | undefined;
  height: 140 | 180;
  summary: string;
  menu?: { fileName: string; link?: string | undefined } | undefined; // csv built here (Q4: no png)
};
export function SmallMultiples(props: SmallMultiplesProps): ReactElement;
/** The next tenth above the highest value or band of every panel, at least 0.1, at most 1 (inventory 4.2). */
export function rateCeilingOf(panels: readonly SmallMultiplePanel[]): number;
/** Pure: the option of one panel, for tests and for the canvas. */
export function smallMultipleOption(input: { panel: SmallMultiplePanel; categories: readonly string[];
  titles?: readonly string[]; boundaries: readonly ChartBoundary[]; ceiling: number; showXLabels: boolean;
  formatValue: (value: number) => string }, tokens: ChartTokens): Record<string, unknown>;
```

`EChart` gains `group?: string | undefined`: on init `instance.group = group` and `connect(group)` (from
`echarts/core`); no other change.

### Behaviour

- `ChartFrame` kind `html`, `height` per panel; body a stack (one column below 768 px; `md:grid-cols-2` at 768 and
  up when more than 2 panels, as 24 section 9.6 allows; each a `figure` with `figcaption` = panel name and its own
  `EChart` (dynamic, skeleton) named by the panel name and described by the summary).
- One ceiling for all panels (`rateCeilingOf`), so heights compare; y labels without decimals; x labels on the last
  visible panel only (preview). Bands from `rateBandOption`; thin points hollow 5 px with no band; null is a gap.
- Boundaries: `boundaryMarkLines` through `rateBandOption.boundaries` on every panel.
- Crosshair: one group id per instance (`useId`), every panel `group`, so hovering one shows the axis pointer in all.
- Legend: one `LegendItem` per panel, `onLegendToggle` hides a panel; at least one stays (the last toggle is ignored
  and the frame announces nothing changed).
- One Table view: `PlainTable` with `categoryHeader` then one column per visible panel, cells `cellText` or
  `chart.noValue`; never 0 for a gap (R6). CSV: `chartCsv` over the same rows (counts in, R1).
- No colour for change: lines use the engine colour (identity), nothing is red or green.

### Tests first (`small-multiples.test.tsx`, EChart mocked to a div that records its props)

1. `one shared ceiling` (guard): panels peaking at 0.31 and 0.62 (band high 0.66) both get `yAxis.max` 0.7;
   `rateCeilingOf` of all null is 0.1; of 0.3 exactly is 0.3. Prove it bites: compute per panel.
2. `thin points are hollow with no band` (guard): a point `{thin: true}` gives a `smallSamplePoint` item style and a
   null band entry at that index; a null point is a gap (null data, `connectNulls` false).
3. `boundaries on every panel`: each option has the `boundaries` series with the given `at` values; an unknown `at`
   is dropped.
4. `crosshair is connected`: every mocked `EChart` gets the same `group` string; in `echart.test.tsx`, with
   `echarts/core` mocked, `init` result gets `group` and `connect` is called with it.
5. `x labels only on the last panel`.
6. `previous period dashed` when `previous` is given (reference series, no band).
7. `one Table view for all panels`: Table toggle shows one table, one column per visible panel, a gap prints
   "No data", not "0%".
8. `legend hides a panel and never the last one`.
9. States through the frame: loading skeleton, empty with reason and action, error with retry, refetching keeps the
   panels, stale and partial notice in the meta line.
10. `axe` clean light and dark.

Gallery: fill "Small multiples" in `chart-grids-section.tsx`: CH-01 with 3 engines, 12 weeks, one thin week, one gap,
one boundary ("Extractor v4"), one pooled tooltip ("4 weeks to Oct 26" via `rateTipText` `pooledWeeks`), compare on,
plus 140 and 180 heights and the states.

Checks: `small-multiples.test.tsx`, `echart.test.tsx`, `registry.test.tsx`, the existing `chart-frame.test.tsx` (the
frame is not edited; it guards the dynamic import), light; lint, typecheck, format:check, medium lane.
Commit `WP-06: SmallMultiples with shared ceiling and connected crosshair`.

Reviewer checklist: ceiling shared; thin points hollow, no band; gaps not zero; boundaries on all panels; `group`
change in `echart.tsx` is only the prop; Table view single; guards 1 and 2 weakened and seen failing.

## Task 3: ScatterChart in its own dynamic chunk; bundle budget check (SC-14)

Files (L2): create `components/app/chart/echart-scatter.tsx`, `echart-scatter.test.ts`. `echart.tsx` is not changed.

```ts
// echart-scatter.tsx: imported only through import() or next/dynamic, so its bytes are a chunk of their own
'use client';
import { ScatterChart } from 'echarts/charts';
import { use as registerModules } from 'echarts/core';
registerModules([ScatterChart]);
export { EChart as ScatterEChart, type EChartProps } from './echart';
```

CH-15 (a later package) loads it with
`dynamic(() => import('@/components/app/chart/echart-scatter').then((m) => m.ScatterEChart), { ssr: false })`.

Tests first (`echart-scatter.test.ts`):
1. `registers ScatterChart`: with `echarts/core` partly mocked, importing the module calls `use` with an array
   holding `ScatterChart`.
2. `the base wrapper stays scatter free` (guard): the text of `echart.tsx` has no `ScatterChart` and no
   `echart-scatter`.
3. `nothing imports the scatter module statically` (guard): a scan of `src/**/*.{ts,tsx}` finds `echart-scatter`
   only inside `import(` calls (and in this test). Prove it bites: a scratch file with a static import fails it.

Bundle proof that `/ai/prompts` does not grow (no budget tool exists; this is the check):
1. Baseline: before the first Task 3 edit, build HEAD (Tasks 1 and 2 import nothing into the route, so HEAD
   equals `bc2e21cc` for `/ai/prompts`): `infra/dev/heavy --label wp-06-build -- pnpm --dir apps/web build`, then copy
   `apps/web/.next/server/app/[workspace]/[project]/ai/prompts/page_client-reference-manifest.js` and the `pnpm build`
   route table output (if Next 16 prints First Load JS) to the scratchpad.
2. A scratchpad node script (not committed) lists the `static/chunks/*.js` files that manifest names, and sums
   their gzip sizes (`zlib.gzipSync`). If the manifest file has another name in this Next version, list
   `.next/server/app/[workspace]/[project]/ai/prompts/` and use the client reference or build manifest there.
3. After Task 3: build again, run the same script. Pass: the route's chunk set holds no chunk containing the string
   `series.scatter` (grep `.next/static/chunks`; exactly one chunk has it, and it is not the line chart chunk) and
   the gzip total is at most baseline plus 256 bytes (hash and module id churn). Record both numbers in As built.
4. Also confirm the echarts chunk stays under the 170 KB gzip budget (DS 15 section 12) by the same script on the
   chunk that holds `series.line`.

Checks: `echart-scatter.test.ts`, `small-multiples.test.tsx`, light; lint, typecheck, format:check, medium lane;
the two builds, heavy lane. Commit `WP-06: ScatterChart in its own dynamic chunk`.

Reviewer checklist: `echart.tsx` untouched by this task; guard 3 weakened and seen failing; the two gzip totals and
the scatter chunk name are in the report.

## Task 4: gallery specimens, e2e, As built, rebase, final checks, push, report

1. Finish `chart-grids-section.tsx` and `chart-grids-section.test.tsx` (renders, axe both themes, every percent in
   the section has a count beside it in the tip or Table view, no "0%" for an unknown cell).
2. e2e `apps/web/e2e/flows/ai-chart-grids.spec.ts` (L4), modelled on `ai-app-parts-a.spec.ts`, on
   `/design-system/chart-grids`:
   - for light and dark and 390, 768, 1024, 1280 px: `expectAccessible(page)`, and
     `document.documentElement.scrollWidth <= clientWidth` (the heat-map scrolls inside its wrapper only; at 390 px
     the wrapper's `scrollWidth > clientWidth`)
   - keyboard: Tab reaches exactly one heat-map cell; ArrowRight moves focus; Right on the CRM row header sets
     `aria-expanded="true"` and child rows show; Enter on a linked cell navigates (`page.waitForURL`)
   - hatched cell shows "3 ans" and no "%"; an n/a cell shows "n/a"
   - Compact density: the first body row's height equals the `h-row-compact` computed height; Default `h-row`
   - SmallMultiples: Table toggle shows one table with one column per panel; hovering the first canvas changes the
     pixels of the second (`locator.screenshot()` of the second canvas before and after differ): the crosshair is
     connected
3. Browser check at the four widths, both themes, both densities on the dev server with `NEXT_PUBLIC_API_MOCKING=all`
   (the gallery is fixture data, so no backend); stop the server after.
4. As built notes, append only: `docs/design-system/25-component-inventory.md` after 10.7 and 10.8 (file paths,
   the real props, departures: no `bins` prop, `form`, `density`, own `rateCeilingOf`, no PNG per Q4, the measured
   contrast and Q1's outcome, diverging thresholds per Q3) and `docs/20-frontend-specification.md` (the scatter
   chunk and the two gzip totals of `/ai/prompts`). Follow ups named: `history-model.ts` to use `rateCeilingOf`;
   virtualising past 100 rows (CH-11) not built; the CH-04 list form below 768 px belongs to the Overview feature.
   Commit `WP-06: As built notes for the chart grids`.
5. `git fetch origin && git rebase origin/develop`; on an `en.json` conflict keep both sides and run
   `pnpm --dir apps/web exec vitest run src/i18n/messages.test.ts`; rerun the targeted tests.
6. Final checks: lint, typecheck, format:check (medium lane); the full suite in the only allowed form; build and the
   e2e line of Task 0 (heavy lane). All green before the push.
7. Final review: a second fresh Sonnet reviewer reads the whole diff against the brief's acceptance criteria and SC-14,
   and opens `/design-system/chart-grids` at the four widths in both themes.
8. `git push origin HEAD:develop` (fast-forward only; rejected means rebase again). Never `main`, never
   `infra/ship.sh`.
9. Report `infra/dev/wp-status WP-06 merged "<note>"` and the same line to the coordinator:
   `WP-06 merged | branch ai/wp-06-chart-grids @ <sha> | rows done 1/1 | steps 5/5 | blockers: none | next: release L1 to L4`.

## 5. Acceptance criteria to proof

| Criterion | Where proven |
|---|---|
| `/ai/prompts` bundle does not grow | Task 3 build comparison, guard tests 2 and 3 |
| axe clean on both parts, light and dark, four widths | unit axe (T1 16, T2 10), e2e Task 4, design-system e2e |
| Loading, empty (reason, action), error (retry), partial, stale, refetch keeps data | `ChartFrame` html; T1 17, T2 9; gallery specimens |
| Every percent shows its count | `tip` is the accessible name (T1 9); Table view and CSV carry `cellText` (T2 7); R1 |
| Unknown is never zero | T1 8, T1 5, T2 7 |
| Colour only for a detectable change | T1 3 (diverging); multiples draw no change colour |
| Engines never pooled | the parts take columns and panels as given; "avg of 3" is a caller column (R3) |
| Keyboard path | T1 12 roving tab stop and tree keys; multiples: legend buttons and the Table toggle (canvas is not navigable, inventory 4.2) |
| Compact and Default density | T1 14, e2e row height |
| 390 px | wrapper scroll only (e2e), multiples one column |
| No em-dash or en-dash | `src/test/source-text.test.ts` in the full suite |

## 6. Risks

| Risk | Guard |
|---|---|
| Dark seq-5 text contrast (Q1) | `heat-bins.contrast.test.ts` fails until fixed |
| `echarts.connect` keeps a group alive after unmount | each instance disposes; group id per component (`useId`), so a remount makes a new group |
| ResizeObserver loops on narrow tables | observe one header cell, set state only when the boolean changes |
| Shared machine hangs | one heavy job at a time, `--max` on every heavy command, targeted tests while building |
