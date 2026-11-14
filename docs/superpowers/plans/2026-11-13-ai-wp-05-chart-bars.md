# WP-05 chart bars: task plan

Package brief: `docs/ai-visibility/work-packages/WP-05-chart-bars.md`. Branch `ai/wp-05-chart-bars` in
`.claude/worktrees/wp-05`, cut from `origin/develop` at `ace40c99` (WP-04 merged). Row: SC-13
(`docs/ai-visibility/inventory/web.md`). This plan is step 0 of the brief.

Sources read for it: the brief; MASTER-PLAN 3.6 to 6; `overview-and-charts.md` sections 1 (R1 to R12), 4.2, 6,
12 and the catalogue rows CH-02, CH-03, CH-05, CH-07, CH-08, CH-09, CH-10, CH-16, CH-17, CH-18, CH-25, CH-27,
CH-28, CH-30, CH-36, CH-41, CH-42, CH-46 and the card `ai.sample_coverage` (9.4); `web.md` SC-13 and its consumer
rows WB-TI-11, WB-TI-18, WB-OV-07, WB-OV-08, WB-PD-05, WB-SRCS-02, WB-TPE-09; DS 15 (rule 6, 5.1, 5.2, 11); DS 25
10.6, 10.10, 10.11, 10.12; AGENTS.md, CLAUDE.md, AI_DEVELOPMENT_UI_RULES.md, DESIGN_SYSTEM.md; the preview cards
`ai.citation_share_by_domain_type` and `competitors.share_of_voice` (`design-preview/index.html` lines 512 to 530,
`design-preview/customize.js` lines 239 to 257); the WP-04 As built note (`docs/20-frontend-specification.md`
line 375) and the WP-04 code listed in 1.4.

## 1. Header

### 1.1 Goal

Four HTML chart parts that most AI cards use, each a real accessible structure (list semantics, accessible text per
row, keyboard reachable links), each with its own table alternative and CSV for `ChartFrame` kind `html`:

- `BarList`: comparison mode (own `chart-1`, others `chart-bar-neutral`) and distribution mode (scale colours)
- `StackedShareBar`: the inventory's `OutcomeMixBar` made generic (CH-03, CH-16, CH-25, CH-28, WB-OV-07,
  WB-SRCS-02), patterns on, legend table, plus the 96 x 12 px `ShareBarCell` for rate tables (WB-PD-05)
- `StepBars`: step bars of counts in order (CH-30, CH-36)
- `IntervalBar`: diverging (CH-09, CH-42) and dumbbell (CH-10) forms, colour only for a detectable change

### 1.2 Scope (owned, all new files)

| File | Task |
|---|---|
| `apps/web/src/components/app/chart/bar-list.tsx`, `bar-list.test.tsx` | T1 |
| `apps/web/src/components/app/chart/stacked-share-bar.tsx`, `stacked-share-bar.test.tsx` | T2 |
| `apps/web/src/components/app/chart/step-bars.tsx`, `step-bars.test.tsx` | T3a |
| `apps/web/src/components/app/chart/interval-bar.tsx`, `interval-bar.test.tsx` | T3b |
| `apps/web/src/components/design-system/chart-parts-section.tsx` (stub in T0, filled in T4) | T0, T4 |
| `apps/web/e2e/flows/ai-chart-bars.spec.ts` | T4 |
| One line each in `apps/web/src/components/design-system/registry.ts` (plus its import line), `section-slugs.ts`, `registry.test.tsx` | T0 |
| New sub-objects `chart.barList`, `chart.shareBar`, `chart.stepBars`, `chart.intervalBar` in `apps/web/messages/en.json` | T0 |
| The WP-05 As built paragraph in `docs/20-frontend-specification.md` section 4.6 | T5 |

Message namespace decision: no namespace was pre-created for WP-05. The package adds four new sub-objects inside the
existing `chart` object of `messages/en.json` and edits nothing else there. `en.json` is shared: WP-06 is likely to add
its own sub-objects to `chart` at the same time. On a rebase conflict keep both sides (each package's sub-objects are
disjoint keys), then run `pnpm exec vitest run src/i18n/messages.test.ts`. All keys of the package land in T0, so the
two parallel implementers of T1 and T2 (and of T3a and T3b) never edit `en.json`.

### 1.3 Not touched

- WP-04 files (merged; no edit): `chart-frame.tsx`, `chart-legend.tsx`, `chart-menu.tsx`, `chart-png.ts`,
  `small-sample-marker.tsx`, `use-rate-tip-words.ts`, `echart.tsx` and their tests; `lib/charts/*`;
  `components/design-system/charts-section.tsx` (its hand-built "Citations by domain" list stays as WP-04's
  specimen of the frame; real consumers use `BarList`).
- WP-06 files: `heatmap-grid.tsx`, `small-multiples.tsx`, `echart.tsx` registration.
- `apps/web/src/styles/tokens.css` and `globals.css` (no new tokens or utilities; see C12 and C13).
- `components/app/metric/*`, `components/app/table/plain-table.tsx`, `components/ui/*`: used, never edited.
- No backend, no OpenAPI, no MSW handler: the parts take props only (the brief's "web against mocks" line has nothing
  to wire here).
- `docs/ai-visibility/tracker.json`, `TRACKER.md`, the main checkout, `.claude/worktrees/release`, Colima.

### 1.4 What WP-04 gives, verified in the code

| Thing | Where | What the parts use |
|---|---|---|
| `ChartFrame` kind `html` | `components/app/chart/chart-frame.tsx` (`HtmlFrameProps`) | `body: ReactNode \| ((view: HtmlBodyView) => ReactNode)` with `HtmlBodyView = { patterns: boolean }`; `table: ReactNode`; `patterns?: boolean` shows the Patterns toggle; `legend?`, `onLegendToggle?`; `menu?: HtmlChartMenu = { fileName, link?, png?: ChartPngBody, csv?: CsvTable }`; `status` with `empty: ChartEmpty` or `error: ChartError`; `notice?: ChartNotice`; `height: 140 \| 180 \| 240 \| 280` (the body's min height) |
| Small sample text | `small-sample-marker.tsx` | `<SmallSampleMarker answers={n} form="text" />` gives "3 answers" in `type-meta text-foreground-tertiary` |
| Insufficient cell | `components/app/metric/insufficient-pill.tsx` | Not used by the parts (they draw text in place of the bar); the tables show the text form too |
| Rate words | `use-rate-tip-words.ts`, `lib/charts/rate-tip.ts` | Consumers build `tip` strings with `rateTipText`; the parts take the finished string |
| Delta | `components/app/metric/delta.tsx` | `<Delta input={MetricDeltaInput} size="sm" test="interim" tip={false} />`; the only tone map (`formatMetricDelta`) |
| Plain table | `components/app/table/plain-table.tsx` | `PlainTable<TRow>` with `caption`, `columns: PlainColumn<TRow>[]`, `rows`, `rowKey`, `status: 'ready'`, `errorState: null`, `emptyText` |
| CSV | `lib/csv/csv-write.ts` | `CsvTable { header: readonly string[]; rows: readonly (readonly CsvCell[])[] }`, `safeText` |
| Tooltip | `components/ui/tooltip.tsx` | `content`, `detail`, `purpose: 'description' \| 'label'` |
| Formats | `@/lib/format` | `formatPercent`, `formatSampleCount`, `formatPointsDelta`, `formatInterval`, `formatInteger`, `formatList`, `formatMetricDelta` (callers format; the parts call none except `formatList` for a join and `formatMetricDelta` for a tone) |
| Stats | `@/lib/stats` | `MIN_OBSERVATIONS = 4`, `wilsonInterval`, `differenceInterval`, `isDetectableChange` (callers) |
| Density | `lib/tables/table-state.ts` | `type Density = 'default' \| 'compact'` |
| Tokens with utilities | `styles/globals.css` | `bg-chart-1` to `bg-chart-6`, `bg-chart-other`, `bg-chart-reference`, `bg-chart-bar-neutral`, `bg-rank-band-1` to `5`, `bg-rank-band-none`, `bg-insufficient`, `bg-positive-solid`, `bg-negative-solid`, `border-border-strong`, `text-foreground-inverse`, `text-surface`, `rounded-2xs` (2 px). There is no `seq-*` utility |
| Contrast helpers | `lib/design/contrast.ts` | `parseColor`, `contrastRatio` (the T2 label colour test reads `tokens.css` as `contrast.test.ts` does) |
| Lint | `eslint.config.mjs` | No arbitrary values and no font weight classes outside `components/ui` (use `type-body-strong`), no colour or dash literals, visible text through next-intl (the design-system folder is exempt from the literal rule) |

### 1.5 Contradictions and decisions

| # | Contradiction | Decision |
|---|---|---|
| C1 | Names: inventory section 6 says `BarList`, `StackedShareBar` ("the inventory's OutcomeMixBar"), `StepBars`, `IntervalBar`; DS 25 has `OutcomeMixBar` (10.6) on top of `StackedBar100` (10.11); SC-13 names `BarList`, `OutcomeMixBar`, `StackedBar100`; the brief owns `stacked-share-bar.tsx` | Export `BarList`, `StackedShareBar`, `StepBars`, `IntervalBar`, the brief's and the owned files' names. One generic `StackedShareBar` replaces both DS 25 components: the four-outcome mix is data a consumer passes (fixed segment list), not a component. DS 25 10.6 cell size is `ShareBarCell` in the same file. SC-13 is closed by these names; the DS 25 entries are renamed by WP-72 (DS reconciliation), named in the As built note |
| C2 | Inventory `BarListRow.emphasis: 'own' \| 'neutral' \| 'scale'` with `scaleToken?: string`; DS 25 `own: boolean` and `scaleColor` union | A union on `mode`: comparison rows carry `own: boolean`, distribution rows carry `scale: BarScaleColor`. No free colour string anywhere, so the type admits only colours with utilities |
| C3 | Inventory rows have `value: number` only; R2 (thin) and R6 (unknown) need other states | Every row value is a tagged union `{ kind: 'value' } \| { kind: 'thin'; answers } \| { kind: 'none'; text? }`. A thin row draws "3 answers" and no bar; an unknown row draws its reason ("No data" by default) and no bar, never a 0 length bar with "0%" |
| C4 | Inventory `IntervalRow.tone` is passed in | The row takes `change: MetricDeltaInput` and the part derives tone only through `formatMetricDelta` (via `Delta` and one direct call for the bar fill). A caller cannot colour an undetectable change (R5, UI rule 6) |
| C5 | Inventory `IntervalBarProps.domain` is one pair, but a dumbbell has a rate axis and a change axis | Props are a union on `form`: diverging has `domain`; dumbbell has `rateDomain` and `changeDomain`. `changeDomain(rows)` is exported (symmetric around 0, DS 15 section 6) |
| C6 | Inventory `StepBarsProps.footnote` and a single `scaleMax`; CH-30 needs its last step on its own scale and unit | Footnote belongs to `ChartFrame` (dropped). `scaleMax` is top level; a group may set its own `scaleMax` (CH-30 sessions), drawn as its own group with its own label, never as a rate of the step before (R11) |
| C7 | Inventory labels are `ReactNode` (engine logos); the accessible name, the table and the CSV need text | `label: string` plus optional decorative `icon?: ReactNode` (an `EngineLogo` later, `aria-hidden`) |
| C8 | DS 25 10.11 legend table numbers right aligned; DS 15 5.2 and `PlainTable` left align every column | Left aligned (DS 15 and the built table), recorded for WP-72 |
| C9 | The preview SOV card is a `table`; DS 15 5.1 and DS 25 10.10 say `ul` | `ul` with accessible text per item |
| C10 | DS 15 bars 24 px; WP-04's specimen draws 8 px (`h-2`) | 24 px (`h-6`) at Default, 16 px (`h-4`) at Compact; StackedShareBar 32 px (`h-8`) and 24 px (`h-6`) |
| C11 | PNG of an html chart: the frame takes `menu.png: ChartPngBody`, WP-04 ships only `echartBody`, and `ChartTokens`/`readLightChartColors` (WP-04 files) lack `chart-bar-neutral`, `positive-solid`, `negative-solid` and the rank bands | No PNG in this package: each part offers `table` and `csv`, and the menu shows CSV and Copy link (the menu hides PNG when none is given; WP-04's own html specimen does the same). One generic `barsPngBody` is a follow-up once a lease on `lib/charts/light-tokens.ts` and `read-tokens.ts` adds those tokens; written in the As built note as open. Not one helper per part: all four draw rectangles and text, so one drawer would serve them |
| C12 | CH-18 asks for `seq-3` to `seq-6` bars; `globals.css` has no `bg-seq-*` utility (WP-06's heat-map needs them too) | `BarScaleColor` leaves `seq-*` out. Registering `--color-seq-*` is a lease on `globals.css` (raise with the coordinator, likely WP-06); adding them to the union is then one line |
| C13 | DS 25 says `rank-band-none` is hatched; no hatched utility for it exists | `rank-band-none` is a flat `bg-rank-band-none` bar, its label carries the meaning; `insufficient` (the hatched `bg-insufficient`) is a scale colour for a "fewer than 4 answers" category (`ai.sample_coverage`) |
| C14 | DS 25 says BarList loading is "skeleton bars"; brief asks for loading, empty, error, partial and stale on every surface | The frame owns them (`status`, `empty`, `error`, `notice`); the parts have no status prop. The DS 17 chart skeleton is not built (WP-04 note). T4 shows the parts in loading and empty frames |
| C15 | DS 25 10.12 `ChartTooltip` React component is not built | Row hover and focus use the `Tooltip` primitive: `content` = the label, `detail` = the row's `tip` (built by the caller with `rateTipText`) |
| C16 | DS 15 5.1: comparison rows "sorted by value, largest first"; CH-41 shows the weakest topics, which read lowest first | The part keeps the order it is given in both modes; the caller sorts. The reviewer checks it at each consumer |
| C17 | MASTER-PLAN 4 gives web dev servers ports 3101 to 3105; the coordinator gave this package port 3004 | Port 3004, never 3000 or 3002 |
| C18 | WP-04 review nits (a) a throwing caller `csv()` crashes the frame's menu, (b) the frame does not pass an html `CsvTable` through `safeText`, (c) the 30 s per-section timeout in `registry.test.tsx` is tight | No edit to WP-04 files. (b): every part's CSV builder passes each text cell and the header through `safeText` itself, and builds the table eagerly (no throw at click time, which also sidesteps (a) for these parts). (a) and (c) are written as open in the As built note |
| C19 | Brief "Every percent shows its count"; a part cannot know which value is a percent | Every value row has `contextText: string \| null` (required key): "466 of 1,412 answers" for a percent, `null` only for a bare count ("23 prompts"). The CSV and the table carry it in its own column |
| C20 | Accessible text: inventory and DS 25 give `accessibleText` per row; the visual row would read twice | The visual row is `aria-hidden`; the row's only accessible content is an `sr-only` span with `accessibleText`. A linked row is a `Link` around both, so its name is `accessibleText` (which must start with the visible label, WCAG 2.5.3; asserted in the tests and the reviewer checklist) |

## 2. Interfaces

All four files are `'use client'`. Every prop is `readonly` where it is a list. No `any`, explicit return types,
`?: T | undefined` for optional props, as WP-04's files do. No part formats a number: every text is a string from the
caller, made with `@/lib/format` (inventory section 6). The only words a part writes are message keys of 2.6.

### 2.1 Shared shape (repeated per file, no shared module)

Each file declares its own copy of this row value, so the parallel tasks share no file (four lines; a shared module
would be a fifth owned file for one union):

```ts
/** What a row shows: a value with its words, too few answers for a rate (R2), or nothing known (R6). */
export type BarValue =
  | { kind: 'value'; value: number; valueText: string; contextText: string | null }
  | { kind: 'thin'; answers: number }
  | { kind: 'none'; text?: string | undefined };
```

- `value`: on the part's scale (a ratio for rates, a count for counts); never negative in BarList and StepBars.
- `valueText`: "27%", "612 units", "23 prompts"; `contextText`: "466 of 1,412 answers", "in 88 prompts", or `null`.
- `thin`: drawn as `<SmallSampleMarker answers={answers} form="text" />`, no bar, no percent.
- `none`: `text` or `t('chart.noValue')` ("No data") in `text-foreground-tertiary`, no bar. Callers pass the reason
  where they know it ("Fan-out not exposed by this engine", "No answers in 28 days").

### 2.2 BarList (`components/app/chart/bar-list.tsx`)

```ts
import type { ReactElement, ReactNode } from 'react';
import type { DeltaTest } from '@/components/app/metric/delta';
import type { CsvTable } from '@/lib/csv/csv-write';
import type { MetricDeltaInput } from '@/lib/format';
import type { Density } from '@/lib/tables/table-state';

/** Distribution mode colours: each has a utility; `seq-*` joins when it is registered (C12). */
export type BarScaleColor =
  | `rank-band-${1 | 2 | 3 | 4 | 5}`
  | 'rank-band-none'
  | 'chart-other'
  | 'insufficient';

interface BarListRowBase {
  id: string;
  /** Domain, entity, query or category: the visible label and the first words of `accessibleText`. */
  label: string;
  value: BarValue;
  /** "HubSpot: 33% share of voice, 466 of 1,412 answers". Starts with `label`. The row's only accessible content. */
  accessibleText: string;
  /** The hover and focus tooltip's second line (from `rateTipText`); left out: the tooltip shows the label only. */
  tip?: string | undefined;
  /** A Badge (role Own, Competitor, Third party; "own domain cited"). Text, so meaning is never colour only; also in `accessibleText`. */
  badge?: ReactNode;
  /** Change since the previous window, drawn by `Delta` (coloured only when detectable). */
  delta?: { input: MetricDeltaInput; test: DeltaTest; text: string } | undefined;
  /** Opens the entity, domain or filtered list (`?inspect=domain:g2.com`, `?opp=lost_to:<id>`). */
  href?: string | undefined;
}
export interface ComparisonRow extends BarListRowBase {
  /** Own brand or owned domain: `chart-1` bar and `type-body-strong` label; every other row `chart-bar-neutral`. */
  own: boolean;
}
export interface DistributionRow extends BarListRowBase {
  scale: BarScaleColor;
}

interface BarListCommon {
  /** Names the list and the table: "Share of voice on ChatGPT". */
  caption: string;
  /** Table and CSV headers: "Brand", "Share of voice", "Answers" (from the feature's messages). */
  labelHeader: string;
  valueHeader: string;
  contextHeader: string;
  /** Header of the change column of the table and CSV, needed when a row has a `delta`. */
  changeHeader?: string | undefined;
  /** The value at full width; default the largest `value` of the rows (shared scale from 0). */
  max?: number | undefined;
  /** At most this many rows inline (default and ceiling 15, DS 15 5.1); more needs `showAllHref`. */
  limit?: number | undefined;
  /** "Show all 23" link under the list when rows are cut. */
  showAllHref?: string | undefined;
  density?: Density | undefined; // default 'default'
}
export type BarListProps =
  | (BarListCommon & { mode: 'comparison'; rows: readonly ComparisonRow[] })
  | (BarListCommon & { mode: 'distribution'; rows: readonly DistributionRow[] });

export function BarList(props: BarListProps): ReactElement;
/** The Table view: one row per bar row (every row, also those past `limit`): label, value, context, change. */
export function BarListTable(props: BarListProps): ReactElement;
/** Every row, every text cell and the header through `safeText`; a thin row writes "3 answers", an unknown row an empty cell. */
export function barListCsv(props: BarListProps, thin: (answers: number) => string): CsvTable;
```

`delta.text` is the caller's `formatMetricDelta(input).text` for the table and CSV (the visible delta is `Delta`'s own).
The `thin` words come from `useTranslations('common.insufficient')`: `(count) => t('answers', { count })`.

Rendering:

- Root: `<div className="@container flex flex-col gap-2">`; `<ul aria-label={caption} className="flex flex-col">`.
- Row `li` (min height `h-row` at Default, `h-row-compact` at Compact; at least 8 px between bars):
  `sr-only` span with `accessibleText`; visual part in `<div aria-hidden="true">`.
- Visual layout by container width: below `@md` (448 px) label and value on one line with the bar below at full
  width (CH-02 and CH-07 at 390 px); from `@md` one line: label column `w-40 truncate` (the full label is in the
  tooltip, the accessible text and the table), the bar track `flex-1`, then value `type-meta num` right after the bar
  end (DS 15 5.1), then `contextText` in `type-meta`, badge and delta.
- Bar: `h-6` (Default) or `h-4` (Compact), `rounded-2xs`, `style={{ width: \`${pct}%\` }}` with
  `pct = value / max * 100` clamped to 0 to 100 (a style width, as WP-04's specimen does; no arbitrary class).
  Comparison: `own ? 'bg-chart-1' : 'bg-chart-bar-neutral'`; label `own ? 'type-body-strong' : 'type-body'`.
  Distribution: `SCALE_FILL: Record<BarScaleColor, string>` (`bg-rank-band-1` ... `bg-chart-other`,
  `bg-insufficient`), `chart-1` never used.
- Link: when `href` is set the `li` holds `<Link href={href} className="flex flex-col rounded-sm outline-none focus-visible:focus-ring hover:bg-surface-hover">`
  around the `sr-only` span and the visual part. Rows without `href` hold no focusable element. Focus order is the
  row order.
- Tooltip: the link (or, without a link, the visual row) is the `Tooltip` trigger with `content={label}`,
  `detail={tip}`, `purpose="label"` (the accessible text already says it).
- `Delta` inside the visual part with `tip={false}` (no tab stop inside `aria-hidden`).
- Cut rows: rows after `limit` are not drawn; `LinkButton` "Show all {count}" (`chart.barList.showAll`) to
  `showAllHref` when given. The CSV and the table keep every row.

ChartFrame wiring (a consumer, CH-02):

```tsx
const t = useTranslations('common.insufficient');
const bars: BarListProps = { mode: 'comparison', caption, labelHeader, valueHeader, contextHeader, rows };
<ChartFrame
  kind="html" variant="panel" title="Share of voice vs competitors" meta={meta} footnote={trackedSetNote}
  height={180} summary={summary} status="ready"
  body={<BarList {...bars} />}
  table={<BarListTable {...bars} />}
  menu={{ fileName: 'share-of-voice', link, csv: barListCsv(bars, (count) => t('answers', { count })) }}
/>
```

### 2.3 StackedShareBar and ShareBarCell (`components/app/chart/stacked-share-bar.tsx`)

```ts
/** Palette order; `chart-1` only for an own-brand segment (Own in CH-16), never for a category (DS 15 5.2). */
export type ShareColor =
  | `chart-${1 | 2 | 3 | 4 | 5 | 6}`
  | 'chart-other'
  | `rank-band-${1 | 2 | 3 | 4 | 5}`
  | 'rank-band-none';

/** The segments, in their fixed order (CH-03: Named and cited, Named only, Cited only, Neither). */
export interface ShareSegment { id: string; name: string; color: ShareColor }

/** One segment's part of one row: a known share (0 is a real zero of a known total). */
export interface ShareCell { segmentId: string; share: number; shareText: string; countText: string }

export type ShareRowValue =
  | { kind: 'shares'; cells: readonly ShareCell[] }
  | { kind: 'thin'; answers: number }
  | { kind: 'none'; text?: string | undefined };

export interface ShareRow {
  id: string;
  /** Engine or category: "Gemini". */
  label: string;
  icon?: ReactNode; // decorative (EngineLogo later), aria-hidden
  /** "of 1,296 answers", "of 2,842 citation units" (R1, R12). */
  denominatorText: string;
  value: ShareRowValue;
  /** The prompt list filtered by outcome or engine (CH-03 rows are focusable, segments are not). */
  href?: string | undefined;
}

export interface StackedShareBarProps {
  /** "Named and cited, by engine": names the list and the legend table. */
  caption: string;
  segments: readonly ShareSegment[];
  rows: readonly ShareRow[];
  /** First column header of the legend table: "Outcome". */
  segmentHeader: string;
  /** The frame's Patterns state (`body={({ patterns }) => ...}`); false in the Table view and the CSV. */
  patterns: boolean;
  density?: Density | undefined;
}

export function StackedShareBar(props: StackedShareBarProps): ReactElement; // bars, then the legend table
/** Rows are segments, columns are bar rows: "21%, 270 of 1,296"; a thin column says "3 answers"; an unknown cell "No data". */
export function StackedShareTable(props: StackedShareBarProps): ReactElement;
export function stackedShareCsv(props: StackedShareBarProps, thin: (answers: number) => string): CsvTable;

/** DS 25 10.6 `cell` size: one 96 x 12 px bar in a rate table cell (WB-PD-05), no labels. */
export interface ShareBarCellProps {
  label: string;
  segments: readonly ShareSegment[];
  cells: readonly ShareCell[];
  denominatorText: string;
}
export function ShareBarCell(props: ShareBarCellProps): ReactElement;
```

Rendering:

- `<ul aria-label={caption}>`; each `li`: the label row (a `Link` with `focus-visible:focus-ring` when `href`, else
  text), then the bar `<div role="img" aria-label={imageName}>` where `imageName` =
  `t('chart.shareBar.image', { label, segments: formatList(parts), denominator })` and each part is
  `${name} ${shareText}, ${countText}` ("Gemini: Named and cited 33%, 432 of 1,296, Named only 21%, 270 of 1,296,
  ... of 1,296 answers").
- Bar: `h-8` (Default) or `h-6` (Compact), `flex gap-px overflow-hidden rounded-md` (6 px outer radius only, the
  `gap-px` shows the panel surface), each segment `relative basis-0 min-w-0` with `style={{ flexGrow: share }}` (the
  preview's method), segments `aria-hidden`. A segment with no cell (R6) is not drawn; one with share 0 is not drawn
  either but its table cell says "0%, 0 of 1,296".
- Inside labels: `shareText` in `type-micro num`, only when `share >= 0.06`; colour from
  `LABEL_ON: Record<ShareColor, string | null>` holding the class that meets 4.5:1 in both themes (for example
  `'text-foreground-inverse'`, `'text-foreground'`, or a pair with a `dark:` variant), `null` to omit. The map is
  pinned by a test that reads `tokens.css` (T2 test 4); the legend table carries every value either way.
- Patterns: when `patterns` is true each segment gets an `aria-hidden` inline `<svg className="absolute inset-0 size-full text-surface">`
  with one `<pattern>` per segment index (6 kinds in fixed order: diagonal 45, diagonal 135, vertical, horizontal,
  dots, cross; `stroke="currentColor"`, ids from `useId()` so two charts on a page do not collide). The legend
  table swatch grows from `size-2` to `size-4` with the same pattern, so a segment and its legend row match without
  colour.
- Thin row: `SmallSampleMarker` text in place of the bar; none row: its text. The legend table is always drawn below
  the bars (DS 15 5.2: it is the alternative), and `StackedShareTable` is also the frame's `table`.
- `ShareBarCell`: `h-3 w-24 flex gap-px overflow-hidden rounded-xs`, `role="img"` with the same image name, no
  labels, no patterns, nothing focusable.

ChartFrame wiring (CH-03):

```tsx
const share = { caption, segments: OUTCOME_SEGMENTS, rows, segmentHeader: 'Outcome', patterns: false };
<ChartFrame kind="html" patterns ...
  body={({ patterns }) => <StackedShareBar {...share} patterns={patterns} />}
  table={<StackedShareTable {...share} />}
  menu={{ fileName, link, csv: stackedShareCsv(share, thin) }} />
```

### 2.4 StepBars (`components/app/chart/step-bars.tsx`)

```ts
export type StepShare =
  | { kind: 'share'; text: string } // "34% of valid answers"
  | { kind: 'thin'; answers: number } // the step before has fewer than 4 (R2)
  | null; // the first step of a group

export interface Step {
  id: string;
  label: string; // "Answers naming you"
  /** A count, or null when unknown (R6: "GA4 not connected"). */
  count: number | null;
  countText: string | null; // "612"; null with count null
  share: StepShare;
  /** Own-brand steps (named, named and cited) are `chart-1`; the others `chart-reference` (CH-36). */
  own: boolean;
  /** Reason for a null count; default `chart.noValue`. */
  noneText?: string | undefined;
  accessibleText: string; // "Answers naming you: 612, 34% of valid answers"
  href?: string | undefined;
}

export interface StepGroup {
  id: string;
  label: string; // "ChatGPT", or "AI referral sessions (GA4)"
  icon?: ReactNode;
  steps: readonly Step[];
  /** Own scale for a group in another unit or source (CH-30 sessions); default the props' `scaleMax`. */
  scaleMax?: number | undefined;
}

export interface StepBarsProps {
  caption: string;
  groups: readonly StepGroup[];
  /** Shared by every group without its own: lengths compare across engines. */
  scaleMax: number;
  /** First table and CSV header: "Engine". */
  groupHeader: string;
  density?: Density | undefined;
}

export function StepBars(props: StepBarsProps): ReactElement;
/** Group, step, count, share of the step before (headers `chart.stepBars.*`). */
export function StepBarsTable(props: StepBarsProps): ReactElement;
export function stepBarsCsv(props: StepBarsProps, words: StepCsvWords): CsvTable;
export interface StepCsvWords { thin: (answers: number) => string; step: string; count: string; share: string }
```

Rendering: a group is a `<div>` with a visible group label `<p id>` (`type-subsection-title`, with `icon`), then
`<ul aria-labelledby={labelId}>` of steps, built like a BarList row (sr-only `accessibleText`, `aria-hidden` visual:
label, bar `h-6`/`h-4` `rounded-2xs` at `count / scaleMax`, `countText`, share text or "3 answers"). Groups are
separated by `gap-4`; a group with its own `scaleMax` gets a top border so it reads as a separate panel row (CH-30).
Horizontal bars on a shared scale, never a trapezoid.

### 2.5 IntervalBar (`components/app/chart/interval-bar.tsx`)

```ts
import type { DeltaTest } from '@/components/app/metric/delta';
import type { MetricDeltaInput } from '@/lib/format';

/** Ratio points, `low <= estimate <= high`, in the same unit as `change.value`. */
export interface ChangeInterval { estimate: number; low: number; high: number }

export type IntervalValue =
  | {
      kind: 'compare';
      interval: ChangeInterval;
      /** `unit: 'points'`; `isDetectable` from the test (API `is_detectable` or `isDetectableChange`). The only tone source. */
      change: MetricDeltaInput;
      test: DeltaTest; // 'interim' while the test is unpaired (footnote "unpaired, pooled counts")
      /** The change text for the table and CSV ("+50.0 pts"): `formatMetricDelta(change).text`. */
      changeText: string;
      /** "+9 to +77 pts", made by the caller (no points interval formatter exists, see `DeltaTip`). */
      intervalText: string;
    }
  | { kind: 'thin'; text?: string | undefined } // default `chart.intervalBar.thin`: "Too few answers to compare"
  | { kind: 'none'; text?: string | undefined }; // default `chart.noValue`

interface IntervalRowBase {
  id: string;
  label: string; // "best crm for startups, ChatGPT"
  icon?: ReactNode;
  accessibleText: string; // "best crm for startups, ChatGPT: +50 pts, 95% interval +9 to +77 pts, detectable"
  tip?: string | undefined; // "25% to 75% (+50 pts), 2 of 8 then 6 of 8 answers"
  href?: string | undefined;
  value: IntervalValue;
}
export type DivergingRow = IntervalRowBase;
export interface DumbbellRow extends IntervalRowBase {
  /** The rates of the two windows, on the rate axis; null when that window has no rate (R2, R6). */
  previous: number | null;
  current: number | null;
  previousText: string; // "31.9%, 612 of 1,920"
  currentText: string;
  /** Engine or entity colour of the current dot (`chart-1` own brand or ChatGPT). */
  color: `chart-${1 | 2 | 3 | 4 | 5 | 6}` | 'chart-other';
}

export type ChangeDomain = readonly [low: number, high: number];

interface IntervalBarCommon {
  caption: string;
  labelHeader: string; // table and CSV
  density?: Density | undefined;
}
export type IntervalBarProps =
  | (IntervalBarCommon & { form: 'diverging'; rows: readonly DivergingRow[]; domain: ChangeDomain })
  | (IntervalBarCommon & {
      form: 'dumbbell';
      rows: readonly DumbbellRow[];
      /** `[0, ceiling]`, the ceiling of DS 15 section 6 (next tenth above the highest value, at least 0.1). */
      rateDomain: ChangeDomain;
      changeDomain: ChangeDomain;
    });

export function IntervalBar(props: IntervalBarProps): ReactElement;
export function IntervalBarTable(props: IntervalBarProps): ReactElement;
export function intervalBarCsv(props: IntervalBarProps, words: IntervalCsvWords): CsvTable;
export interface IntervalCsvWords { change: string; interval: string; previous: string; current: string; thin: string; noValue: string }

/** Symmetric around 0: the largest |low| or |high|, up to the next 0.1, at least 0.1. */
export function changeDomain(intervals: readonly ChangeInterval[]): ChangeDomain;
/** Where a value sits on a domain, in percent of the track, clamped to 0 to 100. */
export function trackPercent(value: number, domain: ChangeDomain): number;
```

What each form shows and the honesty rules:

- **Diverging** (CH-09 prompt movers, CH-42 topics gaining or losing): per row a bar from 0 to `estimate`
  (`left = trackPercent(min(0, estimate))`, `width = |trackPercent(estimate) - trackPercent(0)|`), a 1 px whisker
  `bg-foreground-tertiary` from `low` to `high` with 1 px end caps, and one 1 px zero line `bg-border-strong` at
  `trackPercent(0)` running the full height of the list (DS 15 section 6: symmetric, 0 line `border-strong`). Fill:
  `formatMetricDelta(change).tone` maps to `bg-chart-reference` (neutral), `bg-positive-solid`, `bg-negative-solid`;
  an undetectable or untested change (`isDetectable` false or null) is always `chart-reference` (R5). After the
  track: `<Delta input={change} size="sm" test={test} tip={false} />`. "Within normal variation" is in the caller's
  `accessibleText` and `tip` (from `formatMetricDelta(change).note`); the interval text is in the table and CSV.
  Thin and none rows: their text in place of the track.
- **Dumbbell** (CH-10 period comparison by engine or entity): column 1, the rate track on `rateDomain`: previous dot
  hollow (`size-2.5 rounded-full border-2 border-chart-reference bg-surface`), current dot filled
  (`size-2.5 rounded-full bg-chart-N`), a 2 px line `bg-border-strong` between them; column 2, aligned, the
  difference on `changeDomain`: the estimate as a dot in the tone colour above (neutral `bg-chart-reference`) with the
  whisker and the zero line, then `Delta`. Two bars are never drawn (they would invite reading the gap as precise). A
  row whose `previous` or `current` is null, or whose value is thin, shows "Too few answers to compare" (CH-10) and
  no dots. Below `@md` the change column moves under the rate track.

Structure for both: `<ul aria-label={caption}>`, `li` rows built like BarList (sr-only `accessibleText`, `aria-hidden`
visual, `Link` with focus ring when `href`, `Tooltip` with `purpose="label"`).

### 2.6 Message keys (T0, inside `"chart"` of `apps/web/messages/en.json`, after `"sparkline"`)

```json
"barList": {
  "showAll": "Show all {count, number}"
},
"shareBar": {
  "image": "{label}: {segments}, {denominator}"
},
"stepBars": {
  "step": "Step",
  "count": "Count",
  "share": "Of the step before"
},
"intervalBar": {
  "thin": "Too few answers to compare",
  "change": "Change",
  "interval": "95% interval",
  "previous": "Previous",
  "current": "Current"
}
```

Reused, not added: `chart.noValue` ("No data"), `common.insufficient.answers` ("3 answers"), `chart.table`,
`chart.patterns`, `chart.menu.*`. ASCII, no dashes, no straight quotes, camelCase keys (`messages.test.ts`).

### 2.7 Accessibility structure (all four)

| Concern | Rule |
|---|---|
| Semantics | A list (`ul` of `li`) per part or per group; the frame's `section` with `h2` above it. StackedShareBar's bar is `role="img"` with every segment and the denominator in its name; its legend table is a real `table` with caption and `th` |
| Accessible names | `accessibleText` (caller) carries label, value and count; the visual row is `aria-hidden`. Link names start with the visible label (2.5.3) |
| Focus | Only rows with `href` are focusable, in row order; `focus-visible:focus-ring` on the link; no focusable element inside an `aria-hidden` subtree (`Delta tip={false}`) |
| Colour | Never the only meaning: own rows also in `type-body-strong` and named; neutral bars always carry their value text (DS 15 5.1 exemption); changes carry their signed text and "Within normal variation"; segments carry a legend row and patterns on demand; small samples say "3 answers"; unknown says its reason |
| Targets | A linked row is at least `h-row-compact` (32 px) tall, above the 24 px minimum |
| Tooltips | Hover and focus (the trigger is the link), Escape closes (Tooltip primitive, WCAG 1.4.13) |
| Motion | None: widths are style values, no transitions on data (DS 21); hover colour only (`hover:bg-surface-hover`) |

## 3. Tasks

### 3.1 Schedule and models

| Round | Subagent 1 (Sonnet) | Subagent 2 (Sonnet) | Files, disjoint |
|---|---|---|---|
| 0 | T0 by the session (Opus): registry lines, stub section, all message keys; commit and push early | | `registry.ts`, `section-slugs.ts`, `registry.test.tsx`, `chart-parts-section.tsx`, `messages/en.json` |
| 1 | T1 implementer: BarList | T2 implementer: StackedShareBar | T1: `bar-list.tsx`, `bar-list.test.tsx`. T2: `stacked-share-bar.tsx`, `stacked-share-bar.test.tsx` |
| 1r | T1 reviewer, then commit T1 | T2 reviewer, then commit T2 | read only |
| 2 | T3a implementer: StepBars | T3b implementer: IntervalBar | T3a: `step-bars.tsx`, `step-bars.test.tsx`. T3b: `interval-bar.tsx`, `interval-bar.test.tsx` |
| 2r | T3 reviewer (both files), then one commit T3 | | read only |
| 3 | T4 implementer: section fixtures and e2e spec | | `chart-parts-section.tsx`, `e2e/flows/ai-chart-bars.spec.ts` |
| 3r | T4 reviewer; the session browser-checks; commit T4 | | |
| 4 | T5 by the session (Opus); final Sonnet reviewer over the whole package diff | | `docs/20-frontend-specification.md` |

At most two subagents of this session at once (implementers and reviewers count). Implementers write the tests
first, edit only with the file tools (never shell heredocs, `sed` or replace scripts), and stage only their files
(`git add <paths>`, never `git add -A`). The session commits after the reviewer's PASS. The four part files never
import each other, so T3a and T3b are independent and a T3a PASS waits for T3b only for the shared commit.

Targeted commands (from `apps/web`; light lane except typecheck):

```bash
pnpm exec vitest run <the task's test files>
pnpm exec eslint <changed files>
pnpm exec prettier --check <changed files>
# regression set, after each task (light):
pnpm exec vitest run src/i18n/messages.test.ts src/test/source-text.test.ts src/components/app/chart/chart-frame.test.tsx
# typecheck by the session, not the subagent (medium lane):
../../infra/dev/heavy --lane medium --label wp05-typecheck -- pnpm typecheck
```

Test conventions (as WP-04's): Vitest with `renderWithProviders` from `@/test/render`, `axe` from `@/test/axe`
(`expect(await axe(container)).toHaveNoViolations()`), `screen` and `userEvent` from Testing Library, axe run once
more with `document.documentElement.className = 'dark'` (structure only; contrast is the token tests' and the e2e's).

### T0. Design-system registry lines, stub section, message keys (early push)

Goal: the small commit the coordinator wants on develop first, so other W1 packages rebase onto it.

Files:

- modify `apps/web/src/components/design-system/section-slugs.ts`: add `'chart-parts',` after `'charts',`
- modify `apps/web/src/components/design-system/registry.ts`: `import { ChartPartsSection } from './chart-parts-section';`
  and `{ slug: 'chart-parts', title: 'Chart parts', render: ChartPartsSection },` after the charts entry
- modify `apps/web/src/components/design-system/registry.test.tsx`: add `'chart-parts',` after `'charts',` in the
  expected list
- create `apps/web/src/components/design-system/chart-parts-section.tsx`: `'use client'`, exports
  `ChartPartsSection(): ReactNode` with one `SpecimenGroup` titled "Chart parts" whose note names the four parts and
  their DS sections (15 5.1, 5.2, section 6 of the inventory). Real copy, no "to do" text; T4 replaces the body
- modify `apps/web/messages/en.json`: the keys of 2.6

Tests first: `registry.test.tsx` with `'chart-parts'` fails before the slug and the section exist; its
`describe.each` renders the stub in light and dark with axe.

Commands:

```bash
cd apps/web
pnpm exec vitest run src/components/design-system/registry.test.tsx src/i18n/messages.test.ts src/test/source-text.test.ts
pnpm exec eslint src/components/design-system
pnpm exec prettier --check src/components/design-system messages/en.json
../../infra/dev/heavy --lane medium --label wp05-typecheck -- pnpm typecheck
```

Then `git fetch origin && git rebase origin/develop`, re-run the first command, `git push origin HEAD:develop`, and
report (section 5). Rows: none closed (process).

Reviewer: the session itself (mechanical lines and keys): the three registry edits are one line each plus the import,
and the registry test passes.

Commit: `WP-05: design-system registry entry and message keys for the chart parts`.

### T1. BarList (step 1, SC-13)

Goal: `BarList`, `BarListTable`, `barListCsv` of 2.2.

Files: create `apps/web/src/components/app/chart/bar-list.tsx` and `apps/web/src/components/app/chart/bar-list.test.tsx`.

Tests first (each fails before because the module does not exist):

1. Comparison: renders a list named by `caption` with one item per row; each item's accessible text is its
   `accessibleText`; bars are inside `aria-hidden`; the own row's bar has `bg-chart-1` and its label
   `type-body-strong`, the others `bg-chart-bar-neutral` and `type-body`.
2. Shared scale: with values 0.33, 0.27, 0.11 the bar widths are 100%, about 81.8%, about 33.3%; with `max` 0.5 they
   are 66%, 54%, 22%; a value above `max` clamps to 100%.
3. Value text: every value row shows `valueText` and `contextText`; a `contextText: null` row shows the value only.
4. R2: a `thin` row with 3 answers shows "3 answers" in `text-foreground-tertiary`, draws no bar element and no `%`
   anywhere in the row.
5. R6: a `none` row shows "No data" (or its `text`), no bar, and no "0" or "0%" text; the table cell says the same and
   the CSV cell is empty (`null`), never `0`.
6. Distribution: rows keep their order; `scale` maps to `bg-rank-band-2`, `bg-chart-other`, `bg-insufficient`; no
   element has `bg-chart-1`.
7. Links and keyboard: two rows with `href` are links named by their `accessibleText` (which starts with the label);
   `userEvent.tab()` focuses the first link, then the second, in row order; a row without `href` is skipped; links
   carry `focus-visible:focus-ring`.
8. Tooltip: focusing a linked row opens a tooltip with the label and the `tip`.
9. Delta: a row with a detectable positive delta shows "+1.1 pts" in `text-positive-text`; an undetectable one is
   neutral (`text-foreground-secondary`); neither adds a tab stop.
10. Limit: 18 rows with the default limit draw 15 items and a "Show all 18" link to `showAllHref`; table and CSV keep 18.
11. Density: Compact bars are `h-4`, Default `h-6`.
12. CSV: header is `[labelHeader, valueHeader, contextHeader]` (plus `changeHeader` when a row has a delta); a label
    `=HYPERLINK("x")` is written `'=HYPERLINK("x")` (safeText); a thin row writes "3 answers".
13. Table: `BarListTable` renders a table with the caption and the headers, one row per bar row.
14. Inside `ChartFrame` kind `html`: pressing Table swaps the list for the table; the menu has Download CSV and no
    Download PNG.
15. axe: no violation for comparison with links and for distribution, in light and dark class.

Implementation notes: tokens and type utilities of 2.2 only; `Link` from `next/link`; `LinkButton` for Show all;
`Tooltip` from `@/components/ui/tooltip`; `Delta` from `@/components/app/metric/delta`; `SmallSampleMarker` for thin;
`PlainTable` for the table; `useTranslations('chart')` for the words; no number formatting in the part; `cn` from
`@/lib/utils`; maps of classes as `const` records written with `cn(...)` so lint reads them (the `EntitySwatch`
pattern).

Commands:

```bash
cd apps/web
pnpm exec vitest run src/components/app/chart/bar-list.test.tsx
pnpm exec eslint src/components/app/chart/bar-list.tsx src/components/app/chart/bar-list.test.tsx
pnpm exec prettier --check src/components/app/chart/bar-list.tsx src/components/app/chart/bar-list.test.tsx
```

Row: SC-13 (BarList part); the row closes at T4.

Reviewer checklist: interfaces match 2.2; no `any`, explicit return types; no colour, hex, arbitrary or font weight
class; every text is a prop or a message key; R1, R2, R6 tests present and they fail when the guard is removed
(weaken the `thin` branch to draw a bar in a scratch edit, run, restore; record the failing test name); links reach by
Tab in order and the name starts with the label; nothing focusable inside `aria-hidden`; CSV cells through
`safeText`; no PNG; regression set green.

Model: Sonnet implementer, Sonnet reviewer. Parallel with T2.

Commit: `WP-05: BarList`.

### T2. StackedShareBar with legend table (step 2, SC-13)

Goal: `StackedShareBar`, `StackedShareTable`, `stackedShareCsv`, `ShareBarCell` of 2.3.

Files: create `apps/web/src/components/app/chart/stacked-share-bar.tsx` and
`apps/web/src/components/app/chart/stacked-share-bar.test.tsx`.

Tests first (fail before: no module):

1. Segments in the order of `segments`, each with `flex-grow` equal to its share; `gap-px`; segments `aria-hidden`.
2. The bar is an image named with the row label, every segment's share and count, and the denominator.
3. Inside labels: drawn for shares of 0.06 and more, absent below (0.05).
4. Label colour map: a test reads `src/styles/tokens.css` (as `lib/design/contrast.test.ts` does), resolves each
   `ShareColor` and the label tokens in light and dark with `parseColor` and `contrastRatio`, and asserts every
   non-null `LABEL_ON` entry meets 4.5:1 in both themes and that a `null` entry is one where neither text token
   passes. Fails before: the map does not exist.
5. Patterns: with `patterns` true every segment and every legend swatch holds an `svg` pattern overlay, the pattern
   ids differ between two bars on one page, and segment i and legend row i use the same pattern kind; with `false`
   there is none.
6. R2: a `thin` row shows "3 answers" and no image; its legend column says "3 answers".
7. R6: a row without a cell for "Cited only" draws three segments; the legend cell for it says "No data", not "0%";
   the CSV cell is empty; a real 0 share (a cell with share 0) says "0%, 0 of 1,296" in the table.
8. Links and keyboard: rows with `href` are links in row order by Tab, with the focus ring; segments are not focusable.
9. Legend table: `StackedShareTable` has a caption, `segmentHeader` then one column per row label, the swatch in each
   segment row.
10. CSV: header `[segmentHeader, ...row labels]` through `safeText`; cells `${shareText}, ${countText}`.
11. `ShareBarCell`: an image named with every segment and the denominator, `h-3 w-24`, nothing focusable.
12. Density: `h-8` Default, `h-6` Compact.
13. Inside `ChartFrame` kind `html` with `patterns`: the Patterns toggle turns the overlays on; Table shows the table.
14. axe: no violation, light and dark class, with patterns on and off.

Implementation notes: `chart-1` is allowed only for an own-brand segment (CH-16 Own); the type cannot tell, so the
JSDoc says so and the reviewer checks every fixture and consumer. Patterns are drawn with `stroke="currentColor"` on
`text-surface`, so no colour literal is needed; the six pattern kinds are a `const` array in the file. Inside label
text is `type-micro num`. `formatList` from `@/lib/format` joins the image name parts (a list join, not a number
format).

Commands:

```bash
cd apps/web
pnpm exec vitest run src/components/app/chart/stacked-share-bar.test.tsx
pnpm exec eslint src/components/app/chart/stacked-share-bar.tsx src/components/app/chart/stacked-share-bar.test.tsx
pnpm exec prettier --check src/components/app/chart/stacked-share-bar.tsx src/components/app/chart/stacked-share-bar.test.tsx
```

Row: SC-13 (OutcomeMixBar and StackedBar100 as StackedShareBar).

Reviewer checklist: as T1, plus the contrast test really reads `tokens.css` (change a token value in a scratch edit:
the test fails; restore); no donut or pie; the legend table is always rendered under the bars; patterns map one to
one between segments and legend; `ShareBarCell` has no focusable element.

Model: Sonnet implementer, Sonnet reviewer. Parallel with T1.

Commit: `WP-05: StackedShareBar with legend table`.

### T3. StepBars and IntervalBar (step 3, SC-13)

Two implementers in parallel on disjoint files (T3a, T3b), one reviewer for both, one commit.

#### T3a. StepBars

Files: create `apps/web/src/components/app/chart/step-bars.tsx`, `apps/web/src/components/app/chart/step-bars.test.tsx`.

Tests first (fail before: no module):

1. One list per group, named by the group label (`aria-labelledby`); steps in order; accessible text per step.
2. Shared scale: counts 1,800, 612, 201 with `scaleMax` 1,800 give 100%, 34%, about 11.2%; two groups compare on the
   same scale; a group with its own `scaleMax` (sessions 90 of 120) uses it and has the separating top border.
3. Own steps `bg-chart-1`, others `bg-chart-reference`.
4. Share text: shown after the count; the first step has none.
5. R2: a step whose `share` is `thin` with 3 answers says "3 answers", no percent.
6. R6: a step with `count: null` says "GA4 not connected" (its `noneText`) or "No data", draws no bar, never "0".
7. Links in order by Tab with the focus ring.
8. Table: group, step, count, share columns; CSV through `safeText`, a null count writes an empty cell.
9. Density `h-6` and `h-4`; axe light and dark.

#### T3b. IntervalBar

Files: create `apps/web/src/components/app/chart/interval-bar.tsx`,
`apps/web/src/components/app/chart/interval-bar.test.tsx`.

Tests first (fail before: no module):

1. `trackPercent`: on `[-0.6, 0.6]`, 0 is 50, 0.3 is 75, -0.6 is 0, 0.9 clamps to 100.
2. `changeDomain`: intervals with high 0.77 and low -0.31 give `[-0.8, 0.8]`; all within 0.02 give `[-0.1, 0.1]`; an
   empty list gives `[-0.1, 0.1]`.
3. Diverging geometry: estimate +0.5 on `[-0.8, 0.8]` gives a bar from 50% with width 31.25%; estimate -0.31 gives a
   bar ending at 50%; the whisker spans `trackPercent(low)` to `trackPercent(high)`; one zero line at 50%.
4. R5 colour: `isDetectable: true`, `higher_is_better`, +0.5 is `bg-positive-solid`; -0.31 detectable is
   `bg-negative-solid`; +0.5 with `isDetectable: false` and with `null` is `bg-chart-reference`. Prove it bites: in a
   scratch edit derive the fill from the sign of `estimate`; the false and null cases fail; restore.
5. Delta text "+50.0 pts" from `Delta` (no tab stop); undetectable rows keep neutral text.
6. Dumbbell: previous dot hollow `border-chart-reference`, current dot `bg-chart-2` for a `chart-2` row, both at
   `trackPercent` of the rate on `rateDomain`; the change column on `changeDomain`; no bar element in the rate track.
7. R2: a `thin` row says "Too few answers to compare", no dots and no bar; a dumbbell row with `previous: null` says
   the same.
8. R6: a `none` row says "No data" or its text; never "0 pts".
9. Links in order by Tab with the focus ring; the tooltip shows label and tip.
10. Table: label, previous, current (dumbbell only), change, 95% interval columns; CSV through `safeText` (the "+50.0
    pts" change cell is written as `'+50.0 pts`, the house rule; the test pins it so a reader is not surprised).
11. Density; axe light and dark, both forms.

Implementation notes (both): the row anatomy and link and tooltip handling of BarList are written again in each
file, not imported (no import between part files, so T3a and T3b never wait on T1's internals; the shared part is a
dozen lines of JSX). Tone only through `formatMetricDelta` and `Delta`; the class map `TONE_FILL` is a `const` record
keyed by `ChangeTone`. Positions are `style` values (`left`, `width`), never arbitrary classes. CSV words come from
`useTranslations('chart.stepBars')`, `useTranslations('chart.intervalBar')` and `common.insufficient` at the caller.

Commands:

```bash
cd apps/web
pnpm exec vitest run src/components/app/chart/step-bars.test.tsx src/components/app/chart/interval-bar.test.tsx
pnpm exec eslint src/components/app/chart/step-bars.tsx src/components/app/chart/step-bars.test.tsx src/components/app/chart/interval-bar.tsx src/components/app/chart/interval-bar.test.tsx
pnpm exec prettier --check src/components/app/chart/step-bars.tsx src/components/app/chart/step-bars.test.tsx src/components/app/chart/interval-bar.tsx src/components/app/chart/interval-bar.test.tsx
```

Row: SC-13 (the parts of section 6 beyond the row's three names).

Reviewer checklist: as T1; the R5 bite test recorded with the failing test name; no change colour unless detectable;
changes in points only (`unit: 'points'`); the dumbbell never draws bars; CH-30 sessions are their own group and never
a share of answers; no import between part files.

Model: two Sonnet implementers in parallel, one Sonnet reviewer.

Commit: `WP-05: StepBars and IntervalBar`.

### T4. Design-system entries, axe on each (step 4, closes SC-13)

Goal: `/design-system/chart-parts` shows every part, mapped to its real consumers, in both themes (the page's theme
control) and both densities, plus the package's e2e flow.

Files: modify `apps/web/src/components/design-system/chart-parts-section.tsx`; create
`apps/web/e2e/flows/ai-chart-bars.spec.ts`.

Fixtures (fixed values, no clock, no random; every percent with its count; plain English ASCII copy without dashes;
each a `SpecimenGroup` with an `h2` and a note naming the consumer rows; a Density `SegmentedControl` at the top as in
`charts-section.tsx`, `semantics="view"`, Default and Compact, passed as `density` to every part):

| # | Specimen | Part and mode | Consumers | What it proves |
|---|---|---|---|---|
| 1 | "Share of voice vs competitors" (ChatGPT, of 1,412 answers naming a tracked brand) | BarList comparison in ChartFrame html, 6 entities, own `idraft.ai` `chart-1`, links `#sov-<id>` | CH-02, WB-OV-08, WB-TI-18 | own emphasis, shared scale, counts, keyboard links, tooltip, Table, CSV, tracked set footnote (R9) |
| 2 | "Top cited domains by role" | BarList comparison with role badges and deltas (+1.1 pts detectable, +0.4 pts within normal variation) | CH-07 | badge text, Delta tone only when detectable |
| 3 | "Mention rate by engine" (the topic inspector's panel, shown in a panel frame) | BarList comparison, no own row: ChatGPT 47%, Gemini 39%, AI Mode thin (3 answers), AI Overview none ("No answers in 28 days") | WB-TI-11, WB-TPE-09 | R2 and R6 rows |
| 4 | "Answers behind the numbers" | BarList distribution: prompts with 4 or more answers (`chart-other`), fewer than 4 (`insufficient`), none (`rank-band-none`) | `ai.sample_coverage` (9.4) | fixed order, scale colours, no `chart-1` |
| 5 | "Named and cited, by engine" | StackedShareBar: Named and cited `chart-3`, Named only `chart-4`, Cited only `chart-5`, Neither `chart-other`; ChatGPT, Gemini, AI Mode, AI Overview thin (3 answers); Patterns toggle | CH-03 | legend table, patterns, inside labels, R2 |
| 6 | "Citation units by source role" | StackedShareBar: Own `chart-1`, Competitor `chart-2`, Third party `chart-other`, one engine without a Competitor cell (R6) | CH-16, WB-OV-07, WB-SRCS-02 | own segment, unknown segment |
| 7 | "Outcome mix in a rate table" | `ShareBarCell` in a two-row `PlainTable` | WB-PD-05, DS 25 10.6 cell | cell form |
| 8 | "Answer funnel by engine" plus an "AI referral sessions (GA4)" group with its own scale and a "GA4 not connected" step | StepBars | CH-36, CH-30 | shared scale, own steps, separate unit, R2 share, R6 count |
| 9 | "Prompt movers" | IntervalBar diverging, 6 rows, two detectable (+50 pts, -31 pts), four within normal variation, footnote "unpaired, pooled counts" | CH-09, CH-42 | R5 colour, whiskers, zero line |
| 10 | "Period comparison by engine" | IntervalBar dumbbell: ChatGPT 31.9% then 34.0% (+2.1 pts, within normal variation), Gemini detectable, AI Mode too few answers, AI Overview no data | CH-10 | hollow previous, filled current, change column |
| 11 | "Your pages AI engines cite", empty and loading | ChartFrame html with a BarList body: one frame `status="empty"` ("No answer cited your pages in these 28 days", a reason, an action link), one `status="loading"` | CH-08 | states in the frame around a part |

Every frame uses `variant="panel"` (an inspector frame has an `h3`, and `registry.test.tsx` requires an `h2` in every
`section`); `menu` with `fileName`, `link` (`https://app.idraft.test/design-system/chart-parts#<id>`) and `csv`; a
`summary`; heights 180 or 240.

E2e flow `apps/web/e2e/flows/ai-chart-bars.spec.ts` (the `ai-chart-platform.spec.ts` pattern: `setTheme` through
`idraft.theme` in localStorage, `waitForContent`, `expectAccessible` from `../support`):

- For each theme (light, dark) and width (390, 768, 1024, 1280, height 900): `/design-system/chart-parts`, axe clean
  (no serious or critical), and `document.documentElement.scrollWidth <= window.innerWidth`.
- Keyboard on links: focus the first link of specimen 1 by its accessible name, `Tab` moves to the next row's link (by
  name), the focused link shows its ring (computed `outline-style` or `box-shadow` not `none`), `Enter` changes
  `location.hash` to `#sov-<id>`.
- Table toggle: press "Table" of "Share of voice vs competitors" (`aria-pressed` true): the table with its caption is
  visible and the list is gone; press again: the list returns.
- Patterns: press "Patterns" of "Named and cited, by engine": every segment of the first bar holds an `svg pattern`.
- CSV by keyboard: "More actions for Share of voice vs competitors", Download CSV: the file has the headers and "466
  of 1,412" (the menu helpers of the WP-04 spec copied into this file, since that spec does not export them).

Tests first: the e2e spec is written before the section is filled (it fails on the missing specimens);
`registry.test.tsx` already renders the section with axe in both themes.

Commands:

```bash
cd apps/web
pnpm exec vitest run src/components/design-system/registry.test.tsx
pnpm exec eslint src/components/design-system/chart-parts-section.tsx e2e/flows/ai-chart-bars.spec.ts
pnpm exec prettier --check src/components/design-system/chart-parts-section.tsx e2e/flows/ai-chart-bars.spec.ts
```

The e2e runs in T5 through the heavy lane.

Browser check by the session (after the reviewer's PASS):

1. Read `/tmp/idraft-health/state`; do not start a server while `level=CRIT` or `/tmp/idraft-health/pause` exists.
2. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'`: reuse a server of this worktree on 3004 if one runs (match the
   process cwd); never stop ports 3000 or 3002 (other sessions); at most 3 dev servers on the machine.
3. Otherwise start in the background: `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev --port 3004`, and take the
   URL from its output.
4. Open `http://localhost:3004/design-system/chart-parts` in the Browser pane; for each width 390, 768, 1024, 1280
   (`resize_window`), Light and Dark (the page's theme control), Default and Compact (the section's control):
   screenshot; no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`); labels sit above the bars
   below 448 px of container width; the own row stands out and neutral bars are visible in dark; inside labels are
   readable; patterns differ per segment; whiskers and the zero line align; the dumbbell's change column moves under
   the track below `@md`; tooltips show label and tip on hover and on Tab; Show all appears where rows are cut.
5. Reset the viewport (`preset: 'desktop'`) and stop the server this session started (only that one).

Row: closes SC-13 (`BarList`, `OutcomeMixBar` and `StackedBar100` as `StackedShareBar`, plus StepBars and
IntervalBar of section 6), shown in both themes and densities.

Reviewer checklist: fixtures obey R1 to R12 (counts beside every percent, unknown never 0, one engine at a time, changes
in points, colour only when detectable, tracked set footnote on SOV); no inspector variant; each fixture names its
consumer row in the note; ASCII without dashes; the density control changes only density.

Model: Sonnet implementer (fixtures and e2e), Sonnet reviewer. Haiku may draft the fixture data on request.

Commit: `WP-05: design-system entries for the chart parts`.

### T5. As built notes, rebase, final checks, push, report (step 5)

1. As built note (the session writes it; a Haiku draft is optional): one blockquote right after the WP-04 paragraph
   in `docs/20-frontend-specification.md` section 4.6 (the paragraph starting "As built (AI visibility chart
   platform, WP-04", line 375 at `ace40c99`): `> As built (AI visibility chart parts, WP-05, 2026-11-13, plan
   docs/superpowers/plans/2026-11-13-ai-wp-05-chart-bars.md): ...`. It names the four exports and their table and CSV
   helpers, the decisions C1 to C20 that change what a consumer does, and what is open: WP-04 nit (a), a throwing
   `csv()` in `chart-menu.tsx` would crash the menu's handler (the parts build their CSV eagerly and never throw); nit
   (c), the 30 s per-section timeout in `registry.test.tsx` is tight with one more section; PNG for html charts (C11,
   needs the token lease); `seq-*` utilities (C12); `rank-band-none` hatching (C13); the DS 25 renames for WP-72 (C1,
   C8); the DS 17 chart skeleton.
2. Rebase: `git fetch origin && git rebase origin/develop`. On conflicts in `en.json` keep both sides (only other
   packages' sub-objects of `chart` can collide); in `registry.ts`, `section-slugs.ts`, `registry.test.tsx` keep both
   lines in list order; then `pnpm exec vitest run src/i18n/messages.test.ts src/components/design-system/registry.test.tsx`.
   If the lock file changed: `pnpm install --frozen-lockfile` at the root.
3. Health first: read `/tmp/idraft-health/state`; while it says `level=CRIT` or `/tmp/idraft-health/pause` exists,
   wait and re-read (heavy refuses new jobs then too).
4. Full checks through the lock. From `apps/web`:

```bash
../../infra/dev/heavy --lane medium --label wp05-lint -- pnpm lint
../../infra/dev/heavy --lane medium --label wp05-typecheck -- pnpm typecheck
../../infra/dev/heavy --lane medium --label wp05-format -- pnpm format:check
```

   From the worktree root; the full suite only this way, never plain `pnpm test`:

```bash
infra/dev/heavy --label wp05-test --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'
infra/dev/heavy --label wp05-build --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm build'
E2E_PORT=<a free port, not 3000, 3002, 3004 or 3100> infra/dev/heavy --label wp05-e2e --wait 30 --max 40 -- \
  bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-chart-bars.spec.ts e2e/flows/design-system.spec.ts'
```

   `reuseExistingServer` is on outside CI, so the e2e port must have nothing listening (`lsof -nP -iTCP:<port>`). The
   e2e server is a production build (`playwright.config.ts` webServer), hence the heavy lane. The build's First Load
   JS of `/[workspace]/[project]/seo/keywords` must not change: only the design-system page imports the parts so far.
5. Final review: a fresh Sonnet reviewer reads the whole package diff against the brief's acceptance criteria and
   this plan, runs the four part tests and the regression set, and opens `/design-system/chart-parts` at the four
   widths (the T4 browser steps).
6. Commit the note: `WP-05: As built notes for the chart parts`.
7. Push: `git fetch origin && git rebase origin/develop` again, re-run the part tests and the regression set, then
   `git push origin HEAD:develop` (fast-forward only; rejected means rebase again). Never `main`, never
   `infra/ship.sh`, never a deploy.
8. Report (section 5).

## 4. Pushes

| Push | After | Why |
|---|---|---|
| 1 | T0 | The coordinator wants the registry lines on develop early; the message keys ride with it |
| 2 | T1 and T2 | Consumers (WP-35 and the overview cards) can build on BarList and StackedShareBar |
| 3 | T3 | StepBars and IntervalBar |
| 4 | T4 and T5 | Section, e2e, As built; after the full checks |

Every push: `git fetch origin && git rebase origin/develop`, the task's targeted tests and the regression set,
`pnpm typecheck` in the medium lane (MASTER-PLAN 3.7 step 6: develop stays green for what the push changed), then
`git push origin HEAD:develop`.

## 5. Status reports

```text
WP-05 <status> | branch ai/wp-05-chart-bars @ <short sha> | rows done <n>/1 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

Sent with `infra/dev/wp-status WP-05 <status> "<note>" --rows <n>/1 --tasks <n>/6 --blockers "<...>" --next "<...>"`
and the same line to the coordinator session, at: plan committed (`building`, steps 1/6), every push, review start
(`review`), blocked (`blocked`), done (`merged`, rows done 1/1, steps 6/6). Steps count the brief's steps 0 to 5.

| When | Example |
|---|---|
| After the T0 push | `WP-05 building \| branch ai/wp-05-chart-bars @ abc1234 \| rows done 0/1 \| steps 1/6 \| blockers: none \| next: BarList and StackedShareBar in parallel` |
| After T4 | `WP-05 review \| branch ai/wp-05-chart-bars @ def5678 \| rows done 1/1 \| steps 5/6 \| blockers: none \| next: final checks through the lock` |
| Done | `WP-05 merged \| branch ai/wp-05-chart-bars @ 0a1b2c3 \| rows done 1/1 \| steps 6/6 \| blockers: none \| next: PNG for html charts needs a lease on light-tokens.ts (C11)` |

Leases to raise (not blocking): `apps/web/src/lib/charts/light-tokens.ts` and `lib/design/read-tokens.ts` (WP-04) for
an html PNG (C11); `apps/web/src/styles/globals.css` for `--color-seq-1` to `--color-seq-7` (C12), shared with WP-06.

## 6. Risks

| Risk | Guard | Rollback |
|---|---|---|
| `en.json` and the registry files edited by WP-06 and others at the same time | Keys only inside new `chart` sub-objects; one line each in the registry files; T0 pushed first; a rebase keeps both sides and runs `messages.test.ts` and `registry.test.tsx` | Fix forward |
| `registry.test.tsx` 30 s per-section timeout with a new, larger section (nit c) | 11 specimens at most; T4 times the test locally; if over about 20 s, trim fixture rows, never edit the timeout (WP-04's file) | Trim fixtures |
| An inspector frame on the page breaks the registry test (`h3` in a `section`) | Panel variant only (T4) | n/a |
| Inside label contrast in dark: DS 15 5.2 states the light theme only | `LABEL_ON` pinned by a test over both themes' token values; `null` omits the label | Set an entry to `null` |
| Patterns as inline SVG add DOM per segment | Only while Patterns is on; at most 6 segments by a few rows | n/a |
| CSV text cells that start with "+" get a leading apostrophe (`safeText`) | Pinned by a test, so it is a known house behaviour; a consumer can add numeric columns later | n/a |
| A caller passes a percent without counts, or a tone for an undetectable change | `contextText` is a required key; IntervalBar takes `MetricDeltaInput`, not a tone; BarList deltas go through `Delta`; reviewers check each consumer | n/a |
| `chart-1` used for a category segment (DS 15 5.2) | Type comment and a reviewer check of every fixture and consumer | n/a |
| Long labels at 390 px | Below `@md` the label sits on its own line above the bar; above it truncates with the full label in the tooltip, the accessible text and the table | n/a |
| A link name that does not start with the visible label (WCAG 2.5.3) | Tests assert it for fixtures; JSDoc on `accessibleText` | n/a |
| Machine load during the full checks | Health file read first; the full suite only through `infra/dev/heavy --label wp05-test --wait 30 --max 30` with `--maxWorkers=3`; the dev server stopped after the browser check | Wait |
| Source text and message rules (no U+2013 or U+2014 under `apps/web`, comments included; no straight quotes or contractions in messages) | `source-text.test.ts` and `messages.test.ts` in the regression set after every task | Fix forward |
| A task commit breaks develop | One commit per task; targeted tests and typecheck before each push | `git revert <sha>` of that task on develop (T4 before T1 to T3, since the section imports them); never touch `main` |

## 7. Summary

1. Plan file: `docs/superpowers/plans/2026-11-13-ai-wp-05-chart-bars.md`.
2. T0 (session): registry lines, stub `chart-parts-section.tsx`, all message keys; pushed first.
3. T1 BarList and T2 StackedShareBar: two Sonnet implementers in parallel, disjoint files, a reviewer each.
4. T3a StepBars and T3b IntervalBar: two Sonnet implementers in parallel, one reviewer, one commit.
5. T4: section with 11 consumer-mapped specimens and `e2e/flows/ai-chart-bars.spec.ts`; closes SC-13; browser check on port 3004.
6. T5: As built note after the WP-04 paragraph in doc 20 section 4.6, rebase, full checks through the lock, push, `wp-status`.
7. Names: `BarList`, `StackedShareBar` (replaces OutcomeMixBar and StackedBar100, plus `ShareBarCell`), `StepBars`, `IntervalBar`.
8. Honesty in the types: value unions for thin (R2) and unknown (R6), required `contextText` (R1), tone only from `formatMetricDelta` (R5).
9. No PNG for html parts yet (needs a token lease on WP-04 files) and no `seq-*` colours (needs a `globals.css` lease); both open in the As built note.
10. WP-04 nits: the parts write CSV through `safeText` eagerly; nits (a) and (c) listed as open; no WP-04 file edited.
