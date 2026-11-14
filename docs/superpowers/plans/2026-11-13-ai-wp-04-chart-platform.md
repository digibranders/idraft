# WP-04 chart platform: task plan

Brief: [docs/ai-visibility/work-packages/WP-04-chart-frame.md](../../ai-visibility/work-packages/WP-04-chart-frame.md).
Master plan: [docs/ai-visibility/MASTER-PLAN.md](../../ai-visibility/MASTER-PLAN.md) sections 3.6, 3.7, 4, 5, 6.
Contract: [docs/ai-visibility/inventory/overview-and-charts.md](../../ai-visibility/inventory/overview-and-charts.md)
section 6 (the props this package produces), bound by sections 1 (R1 to R12), 4.2 and 12.
Design: [docs/design-system/15-data-visualization.md](../../design-system/15-data-visualization.md) sections 2, 4, 9, 10,
11; [17-empty-loading-error-states.md](../../design-system/17-empty-loading-error-states.md) sections 3, 5, 7.

Worktree `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6`, branch `ai/wp-04-chart-platform`, based on `07a9a447`
(origin/develop has moved to `bbfb3d60` since: rebase before the first push). Every symbol below was read from the
code at `07a9a447`.

## 1. Header

### Goal

Give every AI chart one frame and one set of helpers, on top of what is built: `ChartFrame` gains `kind: 'html'`,
the states empty, error and refetching, the stale and partial notices, and the overflow menu (Download PNG in the
light theme with title, meta, legend and footnote; Download CSV; Copy link). `ChartLegend` is extracted from the
frame. New helpers: `rateTipRow` (one tooltip anatomy for every rate), `SmallSampleMarker` (rule R2 in text and cell
form, plus `smallSamplePoint` for the point form), `boundaryMarkLines` (version and set boundaries on every time
chart), previous series and boundaries in `rateBandOption`, and `SparklineCell` kinds `count`, `rate`, `rank` with
tooltip rows. Each part is shown on the design-system page in light and dark, Default and Compact density. Row CH-14
(Trend sparkline, PARTIAL) is closed.

### Scope (owned)

| Area | Files |
|---|---|
| Chart components | `apps/web/src/components/app/chart/` except the files below that WP-05 and WP-06 own |
| Option builders and pure helpers | `apps/web/src/lib/charts/` |
| Sparkline | `apps/web/src/components/app/sparkline/` |
| Design-system page | new `apps/web/src/components/design-system/charts-section.tsx`; one line each in `registry.ts`, `section-slugs.ts` and `registry.test.tsx` of the same folder |
| Messages | keys under the existing `chart` object of `apps/web/messages/en.json` only |
| e2e | new `apps/web/e2e/flows/ai-chart-platform.spec.ts` |
| Docs | one As built note appended to `docs/20-frontend-specification.md` section 4.6 |

### Not touched

- `apps/web/src/components/app/chart/echart.tsx` (WP-06 owns its `registerModules` list; this package needs no change
  there: the PNG renders its own offscreen instance)
- `bar-list.tsx`, `stacked-share-bar.tsx`, `step-bars.tsx`, `interval-bar.tsx` (WP-05), `heatmap-grid.tsx`,
  `small-multiples.tsx` (WP-06), all in `components/app/chart/`
- Every feature folder: `features/costs`, `features/rankings`, `features/prompts` keep their call sites as they are;
  the one exception is the token fixture under lease L1 below
- `apps/web/src/lib/design/read-tokens.ts` except under lease L1
- `components/design-system/data-display-section.tsx` (its existing ChartFrame specimens stay as they are)
- `apps/web/package.json`, `pnpm-lock.yaml` (no new dependency), `apps/web/src/mocks/handlers/*` (this package reads
  no API, so it has no handler module and no `gen:api` step), `navigation/registry.ts`, `e2e/support.ts`, other
  packages' message namespaces, `tracker.json`, `TRACKER.md`

### Leases to ask the coordinator for

| Id | Paths | Why | When | If refused |
|---|---|---|---|---|
| L1 | `apps/web/src/lib/design/read-tokens.ts`, `apps/web/src/features/rankings/rank-history/use-rank-history-chart.test.tsx` | Add `foregroundMuted: string` to `ChartTokens` (read from `--foreground-muted`), the boundary line colour of DS 15 section 4; the feature test builds a `ChartTokens` literal and stops compiling without the field | Ask at plan commit; needed at T3 | `boundaryMarkLines` draws in `tokens.borderStrong` (also a non-text 3:1 token) and the As built note records the departure |

The three one-line edits to the design-system registry files are not a listed hot spot and have no owner; the
session announces them to the coordinator with the plan, since WP-05, WP-07, WP-08, WP-09 and WP-10 add sections in
the same files (on a rebase conflict keep both sides, then run `registry.test.tsx`).

### Contradictions and decisions

| # | Where | Contradiction | Decision |
|---|---|---|---|
| C1 | Brief header vs this worktree | The brief names branch `ai/wp-04-chart-frame` in `.claude/worktrees/wp-04` and a plan file `<date>-ai-wp-04-chart-frame.md`; the session runs on `ai/wp-04-chart-platform` in `ai-wp-02-web-scaffold-ca73e6`, and `infra/dev/wp-status` does not exist on this branch (only `heavy` and `health-watch.sh` in `infra/dev/`) | Use the real branch in every status line; report to the coordinator by message, and also through `infra/dev/wp-status` once a rebase brings it in |
| C2 | Brief "Files this package owns" vs WP-05 and WP-06 briefs | WP-04 claims all of `components/app/chart/`; WP-05 owns four files there and WP-06 two plus `echart.tsx` (registration only) | WP-04 owns the folder minus those files, and does not edit `echart.tsx` at all |
| C3 | Inventory 6 vs DS 25 section 10.1 | DS 25 gives ChartFrame controlled `view` and `patterns`, `moreActions: MenuItemDef[]`, `children`, `figure`; inventory 6 and the built code keep the frame's own state and its own data | Follow inventory 6 and the code: the frame keeps the Table and Patterns state, and the menu is a typed config the frame implements, so every chart exports the same way. DS 25 is reconciled by WP-72 (named in the As built note) |
| C4 | Inventory 6 menu shape | `menu?: { png?: () => void; csv?: () => void; link?: string }` leaves PNG and CSV to every caller, though the frame holds the data and the option for line and bar | Line and bar: `png?: boolean`, `csv?: boolean or CsvTable`, the frame draws and writes them. Html: `png?: ChartPngBody` (the caller draws its body in the light colours it is given; the frame adds title, meta, legend and footnote) and `csv?: CsvTable`. No dependency is added for DOM to image |
| C5 | Inventory 6 status | `status: 'loading' or 'ready' or 'empty' or 'error'` with loose `empty?` and `onRetry?`; DS 25 adds `refetching`; the brief adds stale and partial | `status` gains `refetching`, `empty` and `error`, with `empty` and `error` objects required by a discriminated union on `status`; stale and partial are a `notice` qualifier in the meta line (DS 17 section 7.1), not statuses. Existing call sites pass `'loading'` or `'ready'` and still type-check |
| C6 | Inventory 6 `SmallSampleProps.form: 'text' or 'cell' or 'point'` | A point on an ECharts canvas is option data, not a React element | `SmallSampleMarker` has forms `text` and `cell`; the point form is `smallSamplePoint` in `lib/charts/small-sample.ts`, which `rateBandOption` uses for its hollow points |
| C7 | Inventory 6 cell copy "3 ans" | The house component `InsufficientPill` and `common.insufficient.answers` say "3 answers"; content rules avoid abbreviations | The cell form renders `InsufficientPill` (hatched `bg-insufficient`, "3 answers") |
| C8 | Inventory 6 `rateTipRow(input, t: Translator)` | A next-intl `t` is key-typed and cannot be passed as a generic translator without a cast | `rateTipRow(input, words, tokens)` and `rateTipText(input, words)` take a typed `RateTipWords` object, made by the hook `useRateTipWords()` from `chart.tip`; tests build the object directly |
| C9 | Inventory 6 `rateBandOption` `previous?: readonly (number or null)[]` | A previous series added inside the option has no legend entry, no Table column and no CSV column | The previous period is an ordinary `CategorySeries` with `role: { kind: 'reference' }` passed to the frame (dashed `[4, 4]` `chart-reference`, legend line swatch, Table and CSV for free); `RateBandExtras.previousId` tells the band option to draw no band for it and to list its tooltip row last |
| C10 | Inventory 6 `boundaryMarkLines(boundaries, tokens)` | A boundary whose `at` is not on the axis would be drawn at a wrong place, and the dash colour token is missing from `ChartTokens` | `boundaryMarkLines(boundaries, categories, tokens)` drops a boundary whose `at` is not a category and returns a dummy line series carrying the `markLine` (or `null` when none is left); colour per lease L1 |
| C11 | Inventory 6 `SparklineCell tooltipRows` vs DS 25 8.10 (`points`, `scale`, `role`, `lastSeven`) vs the built props (`values`, `label`, `tone`, `minSpan`) | Three shapes | Keep the built props and add `kind`, `rankDepth`, `density` and tone `own`. Tooltip rows go through the table's own `cellTip` (which already opens on cell focus): `useSparklineTip()` returns a `CellTip` of the last 7 points |
| C12 | DS 25 8.10 and DS 15 section 9 height | 16 px in Compact density (the default), 20 px in Comfortable; the built cell is always 20 px | `density?: Density`: `'compact'` draws 16 px, `'default'` 20 px, and leaving it out keeps 20 px so the three feature call sites do not change; features adopt `density` in their own packages |
| C13 | DS 15 section 9 "never red or green" vs the built `SparklineTone` (`positive`, `negative`, used by `features/rankings/gsc-trend-cell.tsx`) | Built code colours a sparkline line | Out of scope (a feature call site); tones stay; the As built note flags it for the rankings owner |
| C14 | DS 15 section 2 legend swatch: marker shapes for series with markers; the built legend draws dots | Changing the frame's swatches changes existing pages | `ChartLegend` supports `swatch: { marker }`; the frame keeps deriving `dot` and `line` for line and bar as today, so existing pages look the same; html charts and later engine charts choose markers |
| C15 | Brief "message namespace" | WP-02 pre-created no namespace for WP-04; the frame already reads `chart` (`chart-frame.tsx` lines 75 and 208), which no other package uses | All new strings go under `chart` (keys listed in T1). `chart.legend` is a string already, so new keys use other names. R2 copy reuses `common.insufficient.answers` and `.tip` |
| C16 | Dev server port | MASTER-PLAN 4 gives ports 3101 to 3105; the session instruction gives 3004 | Use 3004 for the browser checks (ports 3000 and 3002 belong to other sessions, never stopped) |
| C17 | DS 17 section 3 chart skeleton (real title row, flat `chart-band` block at 40% of plot height) and DS 25 "last visible legend item aria-disabled", DS 10 pinned tooltips | Not built today | Out of scope for this package (named in the As built note as not done); the built skeleton block stays |

## 2. Interfaces

Strict TypeScript, no `any`, explicit return types, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on
(`apps/web/tsconfig.json`), so optional props are written `?: T | undefined` as the built code does. Every component
takes finished strings from `@/lib/format` through its caller or through its words hook; none formats numbers itself
except through `@/lib/format`.

### 2.1 ChartFrame (`components/app/chart/chart-frame.tsx`, modified)

```ts
import type { ReactNode } from 'react';
import type { InlineErrorProps } from '@/components/app/status/inline-error';
import type { CsvTable } from '@/lib/csv/csv-write';
import type { CategorySeries } from '@/lib/charts/category-chart';
import type { LightChartColors } from '@/lib/charts/light-tokens';
import type { ChartTokens } from '@/lib/design/read-tokens';
import type { LegendItem } from './chart-legend';

export type ChartHeight = 140 | 180 | 240 | 280; // unchanged export

export type ChartStatus = 'loading' | 'ready' | 'refetching' | 'empty' | 'error';

/** Empty (DS 17 section 2): what is missing, why, and the one action that changes it. */
export interface ChartEmpty {
  title: string;
  reason: string;
  action?: ReactNode | undefined;
}

/** Error (DS 17 section 5.2): `InlineError` in the chart's reserved height. */
export type ChartError = Omit<InlineErrorProps, 'live'>;

/** A qualifier of ready data, shown at the end of the meta line (DS 17 section 7.1). */
export interface ChartNotice {
  kind: 'stale' | 'partial';
  /** "Stale: last collected Sep 27, 18:30 CEST", "Partial data: 612 of 1,000 prompts asked". */
  text: string;
}

/** What the html kind's body draws into the PNG: an image of the body in the light colours, at `width`. */
export interface PngBodyImage {
  image: CanvasImageSource;
  height: number;
}
export type ChartPngBody = (colors: LightChartColors, width: number) => Promise<PngBodyImage>;

interface ChartMenuBase {
  /** File name without extension, chosen by the feature: "mention-rate-by-engine". */
  fileName: string;
  /** An absolute address that opens this view; Copy link copies it as given. */
  link?: string | undefined;
}
export interface CategoryChartMenu extends ChartMenuBase {
  /** Download PNG: the frame draws the chart as shown (hidden series, patterns) in the light theme. */
  png?: boolean | undefined;
  /** Download CSV: `true` writes the series (`chartCsv`), a table replaces it. */
  csv?: boolean | CsvTable | undefined;
}
export interface HtmlChartMenu extends ChartMenuBase {
  png?: ChartPngBody | undefined;
  csv?: CsvTable | undefined;
}

interface ChartFrameCommon {
  title: string;
  variant: 'panel' | 'inspector';
  meta?: string | null | undefined;
  notice?: ChartNotice | undefined;
  footnote?: ReactNode;
  controls?: ReactNode;
  /** Reserved for the skeleton, the empty and the error state; the canvas height of line and bar. */
  height: ChartHeight;
  summary: string;
}

type ChartFrameState =
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined };

/** The built props, unchanged, plus `menu`. */
export interface CategoryFrameProps extends ChartFrameCommon {
  kind: 'line' | 'bar';
  categories: readonly string[];
  categoryHeader: string;
  series: readonly CategorySeries[];
  formatValue: (value: number) => string;
  cellText?: ((seriesId: string, index: number) => string | null) | undefined;
  extendOption?: ((option: Record<string, unknown>, tokens: ChartTokens) => Record<string, unknown>) | undefined;
  stacked?: boolean | undefined;
  menu?: CategoryChartMenu | undefined;
}

export interface HtmlBodyView {
  patterns: boolean;
}

export interface HtmlFrameProps extends ChartFrameCommon {
  kind: 'html';
  legend?: readonly LegendItem[] | undefined;
  /** Given: the legend items are toggle buttons; left out: a plain key. */
  onLegendToggle?: ((id: string) => void) | undefined;
  /** The chart itself: a list, a table, bars in HTML. A function receives the Patterns state. */
  body: ReactNode | ((view: HtmlBodyView) => ReactNode);
  /** The Table view: a `SimpleTable` with value, k, n and interval columns. */
  table: ReactNode;
  /** Show the Patterns toggle (bars that use decals or hatching). */
  patterns?: boolean | undefined;
  menu?: HtmlChartMenu | undefined;
}

export type ChartFrameProps = (CategoryFrameProps | HtmlFrameProps) & ChartFrameState;

export function ChartFrame(props: ChartFrameProps): ReactElement;
```

Rendering rules (all in the one component, split into small private components):

- Title row as built (`h2` `type-section-title` in a panel, `h3` `type-subsection-title` in an inspector), meta line
  `type-meta`, and after the meta the notice: `Icon` `Clock` (stale) or `CircleDashed` (partial), 14 px, with the text,
  in `text-warning-text type-meta`.
- Views group (`role="group"`, `chart.views`): Patterns (bar, or html with `patterns`), Table, then the More button
  when `menu` gives at least one action and `status` is `ready` or `refetching`. Table and Patterns are hidden for
  `loading`, `empty` and `error`; the legend stays (configured series are real, DS 17 section 3).
- `loading`: the built `Skeleton shape="block"` at `height`. `refetching`: the chart stays at full opacity; a 2 px
  `bg-primary` bar (`h-0.5`, the DataTable refetch bar) across the top of the plot region; after 400 ms (`setTimeout`
  in an effect, the DataTable precedent at `data-table.tsx` lines 746 to 755) "Updating" (`chart.updating`) with
  `Spinner` in the title row; `aria-busy` on the section for `loading` and `refetching`.
- `empty`: `EmptyState variant="inline" headingLevel={3}` with `empty.title`, `empty.reason`, `empty.action` inside a
  box of `min-height: height` (style prop, the built pattern for the canvas height).
- `error`: `InlineError` with `error` spread, same reserved height.
- line and bar: the built `EChart` (dynamic, `ssr: false`) inside `role="img"` named by the title and described by
  the summary, and the built `ChartTable` for the Table view.
- html: `body` (called with `{ patterns }` when a function) in a plain `div` with `min-height: height`; the Table
  view renders `table`. The summary `p.sr-only` follows the title row, so it is read before the body. No `role="img"`
  (the body is real HTML, reachable by its own rows).
- Legend: `<ChartLegend>` (2.2). For line and bar the frame builds the items from `series` and its `hidden` set as
  today (`swatch` derived: `line` for reference and other roles, `dot` otherwise). For html it renders `legend` and
  calls `onLegendToggle`.

### 2.2 ChartLegend (`components/app/chart/chart-legend.tsx`, new)

```ts
import type { SeriesRole } from '@/lib/charts/category-chart';

export type LegendSymbol = 'circle' | 'rect' | 'triangle' | 'diamond';
export type LegendSwatch = 'dot' | 'line' | { marker: LegendSymbol };

export interface LegendItem {
  id: string;
  name: string;
  role: SeriesRole;
  /** Left out: `line` for reference and other roles, `dot` otherwise. */
  swatch?: LegendSwatch | undefined;
  /** Shown; `false` reads as turned off. */
  pressed: boolean;
}

export interface ChartLegendProps {
  /** The chart's title: the list is named "Series in {title}" (`chart.legend`). */
  title: string;
  items: readonly LegendItem[];
  /** Given: each item is a toggle button with `aria-pressed`, and a change is announced. */
  onToggle?: ((id: string) => void) | undefined;
}

/** Renders nothing for fewer than two items (DS 15 section 2). */
export function ChartLegend(props: ChartLegendProps): ReactElement | null;
```

Markup is the built one moved as is: `ul` named by `chart.legend`, `li` per item, a `button` with `aria-pressed`,
`rounded-xs type-label focus-visible:focus-ring aria-[pressed=false]:opacity-50`; swatch `size-2 rounded-full` dot or
`w-3 border-t-2 border-dashed` line coloured with `seriesColorVar(role)`; a marker is an 8 px inline SVG
(`aria-hidden`) filled with `seriesColorVar(role)`. Without `onToggle` the item is a `span` in the same style. On a
toggle it calls `announce(t('seriesHidden' or 'seriesShown', { name }))` from `@/lib/a11y/announcer`.

### 2.3 rateTipRow (`lib/charts/rate-tip.ts` and `lib/charts/tooltip-row.ts`, new)

```ts
// lib/charts/tooltip-row.ts: the one row anatomy of DS 15 section 4 (8 px dot, name in foregroundSecondary,
// value right-aligned with tabular figures); every collected string is escaped with `escapeHtml`.
import type { ChartTokens } from '@/lib/design/read-tokens';
export function tipRowHtml(color: string, name: string, valueText: string, tokens: ChartTokens): string;
export function tipTitleHtml(title: string): string;

// lib/charts/rate-tip.ts
import type { Interval } from '@/lib/stats';

export interface RateTipValue {
  value: number | null;
  k: number | null;
  n: number;
  /** A prompt-weighted rate also says how many prompts, each counted once (R1). */
  prompts?: number | undefined;
  band: Interval | null;
  /** Fewer than `MIN_OBSERVATIONS` valid answers (R2). */
  thin: boolean;
  /** A pooled point says over how many weeks (R7). */
  pooledWeeks?: number | undefined;
}

export interface RateTipInput extends RateTipValue {
  name: string;
  color: string;
}

/** The words, from `chart.tip` and `@/lib/format`, made by `useRateTipWords()`. */
export interface RateTipWords {
  value: (ratio: number) => string; // formatPercent: "34.0%"
  answers: (k: number, n: number) => string; // "612 of 1,800 answers"
  interval: (band: Interval) => string; // formatInterval: "28% to 41%"
  prompts: (count: number) => string; // "250 prompts, each counts once"
  thin: (n: number) => string; // "3 answers, fewer than 4"
  pooled: (weeks: number) => string; // "pooled over 4 weeks"
  noAnswers: string; // "No answers"
}

/** Plain text, not escaped: "34.0%, 612 of 1,800 answers, 28% to 41%, 250 prompts, each counts once". */
export function rateTipText(input: RateTipValue, words: RateTipWords): string;
/** One escaped tooltip row (dot, name, the text above). */
export function rateTipRow(input: RateTipInput, words: RateTipWords, tokens: ChartTokens): string;
```

Order of the parts: value, answers, interval, prompts, pooled. `n === 0` gives `noAnswers`; `thin` gives
`words.thin(n)` and no value or interval (R2); unknown is never written as 0 (R6).

```ts
// components/app/chart/use-rate-tip-words.ts
export function useRateTipWords(): RateTipWords; // useTranslations('chart.tip'), formatPercent, formatInterval, MIN_OBSERVATIONS
```

### 2.4 SmallSampleMarker (`components/app/chart/small-sample-marker.tsx` and `lib/charts/small-sample.ts`, new)

```ts
export interface SmallSampleMarkerProps {
  /** Valid answers behind the value, fewer than `MIN_OBSERVATIONS`. */
  answers: number;
  /** `text`: "3 answers" in `text-foreground-tertiary type-meta`; `cell`: `InsufficientPill` (hatched). */
  form: 'text' | 'cell';
  /** Cell only: `false` inside a DataTable cell, which carries the tip itself (the InsufficientPill rule). */
  tip?: boolean | undefined;
}
export function SmallSampleMarker(props: SmallSampleMarkerProps): ReactElement;

// lib/charts/small-sample.ts: the point form (R2, DS 15 section 4): hollow 5 px, the series' own marker shape,
// filled with the tooltip surface, ringed in the series colour; the caller draws no band for it.
export const SMALL_SAMPLE_SIZE = 5;
export interface SmallSamplePoint {
  value: number;
  symbol: string;
  symbolSize: number;
  itemStyle: { color: string; borderColor: string; borderWidth: number };
}
export function smallSamplePoint(value: number, symbol: string, color: string, tokens: ChartTokens): SmallSamplePoint;
```

The text form uses `common.insufficient.answers`; the cell form renders `InsufficientPill` with `tip`.

### 2.5 boundaryMarkLines (`lib/charts/boundaries.ts`, new)

```ts
export interface ChartBoundary {
  /** The category the boundary sits on, exactly as on the x axis ("Oct 26"). */
  at: string;
  /** Short and plain: "Extractor v4", "hubspot.com added". */
  label: string;
}

/**
 * A line series with no data that carries one dashed vertical `markLine` per boundary (DS 15 section 4,
 * 20-frontend-specification.md section 4.6 rule 1): 1 px dashed in `tokens.foregroundMuted` (lease L1), label at the
 * top in 12 px weight 500 (`type-micro`) `tokens.label`, silent, not in the tooltip. A boundary whose `at` is not in
 * `categories` is dropped; `null` when none is left. Labels go through a function formatter so `{a}` in a label is
 * never read as an ECharts template.
 */
export function boundaryMarkLines(
  boundaries: readonly ChartBoundary[],
  categories: readonly string[],
  tokens: ChartTokens,
): Record<string, unknown> | null;
```

### 2.6 rateBandOption (`lib/charts/rate-band-chart.ts`, modified)

```ts
export interface RateBandExtras {
  points: Readonly<Record<string, readonly (RateBandPoint | null)[]>>;
  ceiling: number;
  dark: boolean;
  titles?: readonly string[] | undefined;
  /** The id of the previous period's series (a `reference` CategorySeries of the frame): no band, tooltip row last. */
  previousId?: string | undefined;
  /** Drawn with `boundaryMarkLines` on the categories of `base.xAxis.data`. */
  boundaries?: readonly ChartBoundary[] | undefined;
}
export function rateBandOption(base: Record<string, unknown>, tokens: ChartTokens, extras: RateBandExtras): Record<string, unknown>; // signature unchanged
```

Inside: the hollow point object comes from `smallSamplePoint` (same output as today, so the existing test "draws a
week with too few answers as a hollow point" stays green unchanged); rows come from `tipRowHtml` and the title from
`tipTitleHtml` (same markup as today, so "never lets a name reach the tooltip as markup" stays green); the series
`previousId` gets no band pair and sorts after the others; the boundary series is appended last.

### 2.7 SparklineCell (`components/app/sparkline/sparkline-cell.tsx`, modified), geometry and tip

```ts
// components/app/sparkline/sparkline-cell.tsx
import type { Density } from '@/lib/tables/table-state';

export type SparklineTone = 'reference' | 'own' | 'positive' | 'negative'; // 'own' (--chart-1) added
/** count: the row's own range (search volume); rate: at least `minSpan` 0.2 (DS 15 section 9); rank: 1 at top, fixed 1 to `rankDepth`. */
export type SparklineKind = 'count' | 'rate' | 'rank';

export interface SparklineCellProps {
  values: readonly SparkValue[];
  label: string;
  /** Default `count`, the built behaviour. */
  kind?: SparklineKind | undefined;
  tone?: SparklineTone | undefined;
  /** Overrides the kind's least span (rate 0.2, others 0). */
  minSpan?: number | undefined;
  /** Rank only: the bottom of the fixed scale, 20 by default; a rank beyond it breaks the line. */
  rankDepth?: number | undefined;
  /** `compact` 64 x 16 px, `default` 64 x 20 px; left out: 20 px, as built. */
  density?: Density | undefined;
  className?: string | undefined;
}
export function SparklineCell(props: SparklineCellProps): ReactElement; // existing props and defaults unchanged

// lib/charts/sparkline.ts (additive)
export const SPARK_HEIGHT_COMPACT = 16;
export interface SparkScale {
  low: number;
  high: number;
  /** Ranks: the low value is drawn at the top. */
  invert: boolean;
}
export function sparklineGeometry(
  values: readonly SparkValue[],
  width?: number,
  height?: number,
  minSpan?: number,
  /** A fixed scale; a value outside it breaks the line. */
  scale?: SparkScale,
): SparklineGeometry;

// components/app/sparkline/sparkline-tip.ts
import type { CellTip } from '@/components/app/data-table/types';
export const SPARK_TIP_POINTS = 7;
export interface SparkTipPoint {
  dateText: string;
  valueText: string;
}
/** For a column's `cellTip`: the title, then the last 7 points "Oct 26: 34%" (`chart.sparkline.tipPoint`), oldest first; undefined without points. */
export function useSparklineTip(): (title: string, points: readonly SparkTipPoint[]) => CellTip | undefined;
```

### 2.8 Export helpers (T1)

```ts
// lib/charts/chart-csv.ts
import type { CsvTable } from '@/lib/csv/csv-write';
export interface ChartCsvInput {
  categoryHeader: string;
  categories: readonly string[];
  series: readonly CategorySeries[];
  /** The Table view's words for a point ("40%, 4 of 10 answers"), so the export carries the counts (R1). */
  cellText?: ((seriesId: string, index: number) => string | null) | undefined;
  /** The word for a failed point (`chart.failed`). */
  failedText: string;
}
/** A row per category, a column per series (hidden ones included); a gap is an empty cell, never 0 (R6). */
export function chartCsv(input: ChartCsvInput): CsvTable;

// lib/charts/light-tokens.ts: the light theme's colours whatever theme is on screen (the readWorkbookColors
// precedent in lib/export/export-colors.ts: lift `dark` from <html>, read, put it back before paint).
export interface LightChartColors {
  chart: ChartTokens;
  surface: string;
}
export function readLightChartColors(root?: HTMLElement): LightChartColors;

// lib/charts/png-layout.ts: pure, where each part of the PNG goes.
export const PNG_PADDING = 16;
export const PNG_SCALE = 2;
export type PngFont = 'title' | 'meta' | 'legend';
export interface PngLegendEntry {
  name: string;
  color: string;
  dash: 'solid' | 'dashed';
}
export interface PngFrameText {
  title: string;
  meta: string | null;
  legend: readonly PngLegendEntry[];
  footnote: string | null;
}
export interface PngLayoutInput extends PngFrameText {
  width: number;
  bodyHeight: number;
}
export interface PngTextRun {
  text: string;
  x: number;
  y: number;
  font: PngFont;
}
export interface PngSwatch {
  x: number;
  y: number;
  color: string;
  dash: 'solid' | 'dashed';
}
export interface PngLayout {
  width: number;
  height: number;
  texts: readonly PngTextRun[];
  swatches: readonly PngSwatch[];
  body: { x: number; y: number; width: number; height: number };
}
export type MeasureText = (text: string, font: PngFont) => number;
/** Title (16/24, 600), meta (13/20), legend (12/16, wraps), body, footnote (13/20, wraps), 16 px padding. */
export function pngLayout(input: PngLayoutInput, measure: MeasureText): PngLayout;

// components/app/chart/chart-png.ts: client only, loaded with import() when the person picks Download PNG,
// so echarts and this code stay out of the page's first chunk.
import type { ChartPngBody } from './chart-frame';
export interface RenderChartPngInput {
  frame: PngFrameText;
  /** The frame's width on screen, in CSS px. */
  width: number;
  body: ChartPngBody;
}
export function renderChartPng(input: RenderChartPngInput): Promise<Blob>;
/** The body of a line or bar chart: an offscreen ECharts instance fed the frame's own option with light tokens. */
export function echartBody(option: (tokens: ChartTokens) => Record<string, unknown>, height: number): ChartPngBody;

// components/app/chart/chart-menu.tsx
export interface ChartMenuAction {
  png?: (() => Promise<Blob>) | undefined;
  csv?: (() => CsvTable) | undefined;
  link?: string | undefined;
}
export interface ChartMenuProps {
  title: string;
  fileName: string;
  actions: ChartMenuAction;
}
export function ChartMenu(props: ChartMenuProps): ReactElement | null;
```

`ChartMenu` renders `Menu` with an `IconButton` trigger (`MoreHorizontal`, `size="icon-sm"`, label `chart.more`
"More actions for {title}", `align="end"`) and the items Download PNG (`ImageDown`), Download CSV (`Download`), Copy
link (`Link2`), each only when its action is there (every item has an icon, the Menu rule). PNG: `await png()` then
`downloadBlob(blob, `${fileName}.png`)` from `@/lib/csv/csv-write`; a rejection shows `toast({ type: 'error', title:
t('menu.pngFailed') })`. CSV: `downloadBlob(csvBlob(csv()), `${fileName}.csv`)` (`csvBlob` writes the BOM and guards
formula injection with `safeText` callers already use; strings from `cellText` go through `safeText`). Link:
`copyText(link)` from `@/lib/dom/clipboard`, then `announce(t('menu.linkCopied'))`, or the error toast
`menu.copyFailed` when it resolves `false` (the keyword inspector precedent).

### 2.9 Call sites and how they stay green

| Call site | Uses | Why it stays green |
|---|---|---|
| `features/costs/costs-screen.tsx` line 306 | `ChartFrame kind="bar" status={byDay.isPending ? 'loading' : 'ready'}` | The type `'loading' or 'ready'` matches the first state member; no `menu`, so no More button; legend markup unchanged (`costs.test.tsx`, `app/[workspace]/costs/page.test.tsx`, `app/[workspace]/[project]/costs/page.test.tsx`) |
| `features/rankings/keyword-detail/rank-history-panel.tsx` line 231 | `kind="line"`, `controls`, `extendOption` (rankAxis) | Unchanged props (`rank-history-panel.test.tsx`, which mocks `./echart` with `readChartTokens`) |
| `features/rankings/keyword-inspector/demand-section.tsx` line 146, `rank-history-section.tsx` line 63 | inspector variant, `status="ready"` | Unchanged (`keyword-inspector.test.tsx`) |
| `features/prompts/inspector-history.tsx` line 170 | `ChartFrame` with `cellText` and `extendOption` calling `rateBandOption` | `RateBandExtras` gains optional fields only; tooltip markup identical (`inspector-tabs.test.tsx`, `prompt-inspector.test.tsx`) |
| `features/rankings/rank-history/use-rank-history-chart.ts` | `ChartHeight`, `rankAxis`, `CategorySeries` types | Exports unchanged |
| `features/rankings/rank-columns.tsx` line 175, `features/rankings/gsc-trend-cell.tsx` line 62, `features/prompts/trend-column.tsx` line 76 | `SparklineCell` with `values`, `label`, `tone`, `minSpan`; `sparklineSummary` | New props optional with the built defaults; 20 px when `density` is left out (`rank-columns.test.tsx`, `trend.test.tsx`, `trend-cell.test.tsx` which mocks the module) |
| `features/costs/cost-model.ts`, `use-spend-chart.ts`, `features/prompts/history-model.ts`, `rank-history-model.ts` | `CategorySeries`, `SeriesRole`, `CategoryValue`, `EventMark` types | Untouched |
| `components/design-system/data-display-section.tsx` | two `ChartFrame` specimens | Unchanged props (`registry.test.tsx`) |
| 27 test files mocking `@/components/app/chart/echart` with `{ EChart }` only | `vi.mock` factory | The frame still loads `./echart` by `next/dynamic` and the export `EChart`; `chart-png.ts` is loaded only on a click |
| `lib/export/export-colors.ts` | `readColorToken` | Untouched (L1 adds one field to `readChartTokens` only) |

The regression set run after T1, T2 and T3 (light, one command, about 12 files):

```bash
cd apps/web && pnpm exec vitest run src/features/costs/costs.test.tsx \
  src/features/rankings/keyword-detail/rank-history-panel.test.tsx \
  src/features/rankings/keyword-inspector/keyword-inspector.test.tsx \
  src/features/rankings/rank-history/use-rank-history-chart.test.tsx \
  src/features/rankings/rank-columns.test.tsx src/features/prompts/inspector-tabs.test.tsx \
  src/features/prompts/prompt-inspector.test.tsx src/features/prompts/trend.test.tsx \
  src/features/prompts/trend-cell.test.tsx src/components/design-system/registry.test.tsx \
  src/i18n/messages.test.ts src/test/source-text.test.ts
```

## 3. Tasks

### Schedule and models

| Round | Subagent 1 (Sonnet) | Subagent 2 (Sonnet) | Files of each, disjoint |
|---|---|---|---|
| 0 | Haiku: the `chart` message keys of T1 into `en.json` (uncommitted; committed with T1) | | `messages/en.json` only |
| 1 | T1 implementer (frame and menu) | T2a implementer (new files of T2) | T1: `chart-frame.tsx`, `chart-frame.test.tsx`, `chart-menu.tsx`, `chart-menu.test.tsx`, `chart-png.ts`, `chart-png.test.ts`, `lib/charts/chart-csv.ts`, `png-layout.ts`, `light-tokens.ts` and their tests. T2a: `chart-legend.tsx`, `small-sample-marker.tsx`, `use-rate-tip-words.ts` and tests, `lib/charts/tooltip-row.ts`, `rate-tip.ts`, `small-sample.ts` and tests |
| 1r | T1 reviewer, then commit T1 | T2a reviewer (no commit yet) | read only |
| 2 | T2b implementer: the legend swap in `chart-frame.tsx` | T3 implementer (markers, tooltip and boundaries into the band chart; sparkline) | T2b: `chart-frame.tsx`, `chart-frame.test.tsx`. T3: `lib/charts/boundaries.ts`, `rate-band-chart.ts`, `sparkline.ts` and tests, `sparkline-cell.tsx`, `sparkline-tip.ts` and tests, plus L1 files |
| 2r | T2 reviewer (T2a and T2b), then commit T2 | T3 reviewer, then commit T3 (after T2, since T3 imports `tooltip-row.ts` and `small-sample.ts`) | read only |
| 3 | T4: Haiku writes the section, fixtures and registry lines; the e2e spec by a Sonnet implementer after | | `charts-section.tsx`, `registry.ts`, `section-slugs.ts`, `registry.test.tsx`, `e2e/flows/ai-chart-platform.spec.ts` |
| 3r | T4 Sonnet reviewer; the session browser-checks; commit T4 | | |
| 4 | T5 by the session (Opus) with a Haiku draft of the As built note; final Sonnet reviewer over the whole diff | | |

Never more than two subagents at once (implementers and reviewers count). Implementers edit only with the file tools,
never shell heredocs, `sed` or replace scripts. Each commit stages only the files named in its task (`git add
<paths>`), never `git add -A`.

Targeted commands, used by every task (run from `apps/web`):

```bash
pnpm exec vitest run <test files of the task>
pnpm exec eslint <changed files>
pnpm exec prettier --check <changed files>
# typecheck is run by the session, not the subagent:
../../infra/dev/heavy --lane medium --label wp04-typecheck -- pnpm typecheck
```

### T1. ChartFrame html mode, status empty and error, overflow menu with PNG, CSV, Copy link (step 1, CH-14)

Goal: the frame of 2.1 with the menu, PNG, CSV and Copy link of 2.8, and every message key of the package.

Files:

- modify `apps/web/src/components/app/chart/chart-frame.tsx`, `apps/web/src/components/app/chart/chart-frame.test.tsx`
- create `apps/web/src/components/app/chart/chart-menu.tsx`, `chart-menu.test.tsx`, `chart-png.ts`, `chart-png.test.ts`
  (all in `apps/web/src/components/app/chart/`)
- create `apps/web/src/lib/charts/chart-csv.ts`, `chart-csv.test.ts`, `png-layout.ts`, `png-layout.test.ts`,
  `light-tokens.ts`, `light-tokens.test.ts`
- modify `apps/web/messages/en.json` (round 0, Haiku), only inside `"chart": { ... }`:

```json
"more": "More actions for {title}",
"updating": "Updating",
"seriesHidden": "{name} hidden",
"seriesShown": "{name} shown",
"menu": {
  "png": "Download PNG",
  "csv": "Download CSV",
  "link": "Copy link",
  "linkCopied": "Link copied",
  "copyFailed": "Could not copy the link",
  "pngFailed": "Could not make the image of the chart"
},
"tip": {
  "answers": "{k, number} of {n, number} answers",
  "prompts": "{count, plural, one {# prompt} other {# prompts}}, each counts once",
  "thin": "{n, plural, one {# answer} other {# answers}}, fewer than {min, number}",
  "pooled": "pooled over {weeks, plural, one {# week} other {# weeks}}",
  "noAnswers": "No answers"
},
"sparkline": {
  "tipPoint": "{date}: {value}"
}
```

Tests first (each fails before because the module, the prop or the key does not exist):

- `chart-frame.test.tsx` (add; keep the nine built tests unchanged, add `vi.mock('./chart-png', ...)` returning a
  `renderChartPng` spy that resolves a `Blob`, and a partial mock of `@/lib/csv/csv-write` spying `downloadBlob`):
  1. `kind="html"` renders the title row, the legend items given, the body, and on Table the `table` node in place of
     the body; the summary is in the document.
  2. html `body` as a function receives `{ patterns: true }` after Patterns is pressed (`patterns` set).
  3. `status="empty"` shows `empty.title`, `empty.reason` and the action, keeps the title, hides Table and More, and
     reserves `height` (style `min-height`).
  4. `status="error"` shows the `InlineError` title and reason; Retry calls `error.onRetry`; `retrying` sets the
     button's loading state.
  5. `status="refetching"` keeps the canvas stand-in, sets `aria-busy`, shows "Updating" only after 400 ms
     (`vi.useFakeTimers`, advance 399 then 1).
  6. `notice={{ kind: 'stale', text }}` shows the text in the meta line.
  7. No `menu`: no "More actions for ..." button (the built call sites).
  8. `menu={{ fileName: 'volume', png: true, csv: true, link: 'https://app.test/x' }}`: the More button opens by
     keyboard (focus it, `Enter`), lists the three items in order; Download CSV calls `downloadBlob` with a blob whose
     text starts with the BOM and `Month,Search volume,Previous year` and name `volume.csv`; Download PNG calls
     `renderChartPng` with `frame.title`, `frame.meta`, the visible legend entries and the footnote's text, then
     `downloadBlob(..., 'volume.png')`; Escape closes and returns focus to the trigger.
  9. A rejected `renderChartPng` shows the `chart.menu.pngFailed` toast and downloads nothing.
  10. axe: no violation for html, empty, error and menu-open renders.
- `chart-menu.test.tsx`: renders nothing without actions; only the given items; Copy link calls `copyText` (mock
  `@/lib/dom/clipboard`) and announces "Link copied"; `false` from `copyText` shows the `copyFailed` toast.
- `chart-csv.test.ts`: header is the category header then series names; a number cell is the raw number; `null` is an
  empty cell (never 0); `'failed'` is `failedText`; `cellText` words replace the value and go through `safeText`;
  hidden series are included.
- `png-layout.test.ts` (fake measure: 7 px per character): title at padding; meta below at 20 px line height; a meta
  longer than the width wraps by words; legend entries flow left to right and wrap to a new line; body below the
  legend at full inner width; footnote below the body; `height` is the bottom of the last part plus padding; `null`
  meta and footnote take no space.
- `light-tokens.test.ts`: with `class="dark"` on `<html>`, `readChartTokens` (spied through `import * as tokens`, the
  `sparkline-cell.test.tsx` precedent) runs while `dark` is absent, and `dark` is back afterwards, also when the read
  throws.
- `chart-png.test.ts` (mock `echarts/core` `init` returning a stub with `setOption`, `getDataURL`, `dispose`; stub
  `HTMLCanvasElement.prototype.getContext` and `toBlob`): `echartBody` builds the option with the light tokens, asks
  `getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: surface })`, disposes the instance and removes its
  offscreen element even when `getDataURL` throws; `renderChartPng` sizes the canvas from `pngLayout` times
  `PNG_SCALE`, fills the light surface first, and rejects with `Error('The chart image could not be encoded')` when
  `toBlob` gives `null`.

Implementation notes:

- Tokens and type utilities only (`type-section-title`, `type-subsection-title`, `type-meta`, `type-label`,
  `text-warning-text`, `bg-primary`, `h-0.5`); no arbitrary values except the built `style={{ height }}` and
  `minHeight`.
- The PNG option is the frame's own `option` callback (the same `hidden` and `patterns` as on screen), fed
  `readLightChartColors().chart`; the frame width is the `section` element's `clientWidth` (a ref); the footnote text
  is the footnote element's `textContent` (a ref), so `footnote` stays a `ReactNode`.
- `chart-png.ts` imports `init` from `echarts/core` and `./echart` for its module registration side effect, and is
  only reached through `import('./chart-png')` inside the menu handler, so SSR and first-load bytes do not change.
  The offscreen element is `position: fixed; left: -10000px; top: 0` with the body's width and height, appended to
  `document.body` and removed in `finally`; `init(element, null, { renderer: 'canvas', width, height })`.
- Text on the PNG canvas: `ctx.font` from `tokens.fontFamily` with the sizes and weights of `pngLayout`; title in
  `chart.foreground`, meta and footnote in `chart.label`, legend names in `chart.foregroundSecondary`, swatches as in
  the legend (8 px dot, or 12 x 2 px dashed line).
- a11y: the More trigger is an `IconButton` with a name and tooltip; the Menu gives Enter, Space, Down Arrow to open,
  arrows to move, Escape to close and return focus; no single-key shortcut is added (so no `useShortcut`); the Table
  toggle stays the canvas's keyboard path; the empty heading is `h3`.
- Every visible string comes from `chart.*` (above) or the caller; nothing in English in the component.

Commands:

```bash
cd apps/web && pnpm exec vitest run src/components/app/chart src/lib/charts/chart-csv.test.ts \
  src/lib/charts/png-layout.test.ts src/lib/charts/light-tokens.test.ts
pnpm exec eslint src/components/app/chart src/lib/charts/chart-csv.ts src/lib/charts/png-layout.ts \
  src/lib/charts/light-tokens.ts
pnpm exec prettier --check src/components/app/chart src/lib/charts messages/en.json
```

then the regression set of 2.9 and the session's typecheck.

Reviewer checklist: the union in 2.1 compiles for all five feature call sites without edits; no `any`, no `as`
casts except where the built code already casts ECharts params; tokens and type utilities only; strings in `chart.*`
only, ASCII, no dashes, typographic quotes where quoting; `@/lib/format` only; empty has reason and action, error has
retry, refetch keeps data at full opacity with the 2 px bar; menu keyboard path works and Escape returns focus; PNG
uses light colours from a dark page and restores the class in `finally`; CSV writes gaps as empty cells; nothing in
`echart.tsx` changed; `chart-png.ts` is reached only by `import()`.

Commit: `WP-04: ChartFrame html mode, empty and error states, overflow menu` (stages the T1 files and
`apps/web/messages/en.json`).

### T2. ChartLegend, rateTipRow, SmallSampleMarker (step 2, CH-14)

Goal: 2.2, 2.3, 2.4; the frame renders its legend through `ChartLegend`.

Files:

- T2a create: `apps/web/src/components/app/chart/chart-legend.tsx`, `chart-legend.test.tsx`,
  `small-sample-marker.tsx`, `small-sample-marker.test.tsx`, `use-rate-tip-words.ts`, `use-rate-tip-words.test.tsx`;
  `apps/web/src/lib/charts/tooltip-row.ts`, `tooltip-row.test.ts`, `rate-tip.ts`, `rate-tip.test.ts`,
  `small-sample.ts`, `small-sample.test.ts`
- T2b modify: `apps/web/src/components/app/chart/chart-frame.tsx` (replace the inline `ul` legend with `<ChartLegend>`
  and build `LegendItem`s from `series` and `hidden`), `chart-frame.test.tsx` (one test: toggling announces)

Tests first:

- `chart-legend.test.tsx`: nothing for one item; an `ul` named "Series in {title}"; with `onToggle` each item is a
  button with `aria-pressed` that calls `onToggle(id)` and announces "{name} hidden" or "{name} shown" (spy
  `announce`); without it no button; `line` swatch for reference and other roles by default, `dot` otherwise; a
  `{ marker: 'triangle' }` swatch renders an `aria-hidden` SVG; axe clean.
- `small-sample-marker.test.tsx`: text form "3 answers" with `text-foreground-tertiary`; one answer reads "1 answer";
  cell form renders the hatched pill and, with `tip`, the tooltip "Too few valid answers for a rate: 3 of the 4 it
  needs."; `tip={false}` renders no tooltip trigger.
- `tooltip-row.test.ts`: escapes `<b>` in name and value; dot in the given colour; name in `foregroundSecondary`;
  identical string to the row the built `rateBandOption` writes (pin it with the existing fixture).
- `rate-tip.test.ts`: full row "34.0%, 612 of 1,800 answers, 28% to 41%"; with prompts and pooled weeks appended in
  that order; `thin` gives "3 answers, fewer than 4" and no percent; `n = 0` gives "No answers"; `value: null` with
  `n > 0` and not thin never prints 0%; `rateTipRow` escapes.
- `small-sample.test.ts`: size 5, the series' symbol, fill `surfaceElevated`, border the colour at 2 px.
- `use-rate-tip-words.test.tsx`: under `renderWithProviders`, the words read the catalog ("612 of 1,800 answers",
  "28% to 41%", min from `MIN_OBSERVATIONS`).
- T2b: the built test "toggles a series from the legend" passes unchanged (same roles and names), plus "announces the
  series it hides".

Implementation notes: the legend markup moves as is (same classes, same `t('legend', { title })`), so the frame's
look and its nine built tests do not change; `ChartLegend` reads `useTranslations('chart')`; marker SVG paths for
circle, rect, triangle and diamond at 8 px with `fill` from `seriesColorVar`. `rate-tip.ts` and `tooltip-row.ts` import
`escapeHtml` from `category-chart.ts` (no new escape helper). `useRateTipWords` uses `formatPercent`,
`formatInterval`, `formatInteger` through ICU number arguments, and `MIN_OBSERVATIONS` from `@/lib/stats`. Keyboard:
legend buttons are in the tab order; Space and Enter toggle (native buttons).

Commands:

```bash
cd apps/web && pnpm exec vitest run src/components/app/chart/chart-legend.test.tsx \
  src/components/app/chart/small-sample-marker.test.tsx src/components/app/chart/use-rate-tip-words.test.tsx \
  src/components/app/chart/chart-frame.test.tsx src/lib/charts/tooltip-row.test.ts src/lib/charts/rate-tip.test.ts \
  src/lib/charts/small-sample.test.ts
pnpm exec eslint src/components/app/chart src/lib/charts
pnpm exec prettier --check src/components/app/chart src/lib/charts
```

then the regression set and the session's typecheck.

Reviewer checklist: R1 (every percent with its counts), R2 (thin points say the answers, no percent, no band), R6
(no 0 for unknown) hold in `rateTipText`; every collected string escaped; no copy outside `chart.tip` and
`common.insufficient`; legend unchanged visually for line and bar; no import from `rate-band-chart.ts` into the new lib
files (no cycle: `rate-band-chart` imports `tooltip-row` and `small-sample`, never the reverse).

Commit: `WP-04: ChartLegend, rateTipRow and SmallSampleMarker`.

### T3. boundaryMarkLines, previous series in rateBandOption, SparklineCell kinds and tooltip rows (step 3, closes CH-14)

Goal: 2.5, 2.6, 2.7, and lease L1.

Files:

- create `apps/web/src/lib/charts/boundaries.ts`, `boundaries.test.ts`
- modify `apps/web/src/lib/charts/rate-band-chart.ts`, `rate-band-chart.test.ts`, `apps/web/src/lib/charts/sparkline.ts`,
  `sparkline.test.ts`
- modify `apps/web/src/components/app/sparkline/sparkline-cell.tsx`, `sparkline-cell.test.tsx`
- create `apps/web/src/components/app/sparkline/sparkline-tip.ts`, `sparkline-tip.test.tsx`
- under L1: `apps/web/src/lib/design/read-tokens.ts` (add `foregroundMuted`), the `ChartTokens` fixtures in
  `lib/charts/category-chart.test.ts`, `rank-chart.test.ts`, `rate-band-chart.test.ts` (owned) and
  `features/rankings/rank-history/use-rank-history-chart.test.tsx` (leased), one line each

Tests first:

- `boundaries.test.ts`: one `markLine` datum per boundary at `xAxis: at`; dashed, width 1, `foregroundMuted`;
  label formatter returns the label verbatim (including a `{a}` label); unknown `at` dropped; empty input and all
  unknown give `null`; the series is silent and has no tooltip.
- `rate-band-chart.test.ts` (add): `previousId` series gets no band pair even with bands in `points`; its tooltip row
  comes after the engines whatever its value; `boundaries` append one boundary series last; without the new fields the
  option equals today's (deep equal against the built output for the existing fixture).
- `sparkline.test.ts` (add): a fixed `scale` keeps two series with different ranges comparable; `invert` puts rank 1
  at the top edge and `high` at the bottom; a value outside the scale breaks the line.
- `sparkline-cell.test.tsx` (add): `kind="rate"` without `minSpan` draws a move of 0.01 nearly flat (the y spread of
  the `lineTo` calls under 2 px); `kind="rank"` draws rank 1 above rank 5; a rank of 25 with `rankDepth` 20 breaks the
  line; `tone="own"` reads `--chart-1` (spy `readColorToken`); `density="compact"` sizes 64 x 16 and `"default"`
  64 x 20; left out stays 20; the built tests unchanged.
- `sparkline-tip.test.tsx`: the last 7 of 10 points, oldest first, "Oct 26: 34%" joined by ", " in `detail`, the
  title in `content`; no points gives `undefined`.

Implementation notes: `rateBandOption` reads the categories from `base.xAxis.data` as `rankAxis` does; CH-14 asks for
gaps where a week has no usable rate (already a `null` break), own rows in `chart-1` (`tone="own"`), gray otherwise,
never red or green from this package; the rate preset is `minSpan` 0.2 (`RATE_MIN_SPAN` stays a feature constant, the
kind's own default is a constant `RATE_SPAN = 0.2` in `sparkline.ts`); the rank preset is `scale: { low: 1, high:
rankDepth, invert: true }`. Height comes from `density`; the canvas `width` and `height` attributes are times
`devicePixelRatio` as built. a11y: the cell keeps `role="img"` with the caller's `label`; tips reach the keyboard by
the DataTable's cell focus (`cellTip`), so the canvas stays out of the tab order.

Commands:

```bash
cd apps/web && pnpm exec vitest run src/lib/charts src/components/app/sparkline
pnpm exec eslint src/lib/charts src/components/app/sparkline src/lib/design/read-tokens.ts
pnpm exec prettier --check src/lib/charts src/components/app/sparkline src/lib/design/read-tokens.ts \
  src/features/rankings/rank-history/use-rank-history-chart.test.tsx
```

then the regression set and the session's typecheck.

Reviewer checklist: built `rateBandOption` output unchanged without the new fields; boundary label not templated;
the three sparkline call sites unchanged in pixels (20 px) and behaviour; no red or green added; L1 granted before
the token files were touched (or the `borderStrong` fallback used); `noUncheckedIndexedAccess` respected in the
geometry loop.

Commit: `WP-04: boundaryMarkLines, previous series and SparklineCell kinds`.

### T4. Design-system page entries, light and dark (step 4, CH-14)

Goal: one new section, `/design-system/charts`, that shows every part of this package in both themes (the page's
`ThemeControl`) and both densities, plus the package's e2e flow.

Where it lives: the internal route `apps/web/src/app/(internal)/design-system/[section]/page.tsx` renders
`previewSection(slug).render` from `apps/web/src/components/design-system/registry.ts`; the layout lists
`PREVIEW_SECTIONS` in the side nav and holds the theme control (one theme at a time by design,
`theme-control.tsx`); `section-slugs.ts` lists the slugs for the e2e and visual tests; `registry.test.tsx` pins the
order and renders every section in `light` and `dark` with axe. Product code never imports the folder (eslint
boundaries), and the i18n literal rule does not apply to it, so fixture copy is plain English that still follows the
house rules (ASCII, no dashes, sentence case, every percent with its count).

How a part is registered (three lines):

- `section-slugs.ts`: add `'charts'` after `'data-display'` in `PREVIEW_SECTION_SLUGS`
- `registry.ts`: `import { ChartsSection } from './charts-section';` and `{ slug: 'charts', title: 'Charts', render:
  ChartsSection }` after the data-display entry
- `registry.test.tsx`: add `'charts'` after `'data-display'` in the expected list

Files: create `apps/web/src/components/design-system/charts-section.tsx` (`'use client'`); modify the three files above;
create `apps/web/e2e/flows/ai-chart-platform.spec.ts`.

Fixtures (each a `SpecimenGroup` with an `h2` title and a note citing the doc section; one `SegmentedControl` at the top,
`semantics="view"`, label "Density", items Default and Compact, state `useState<Density>(DEFAULT_DENSITY)` as in
`tables-section.tsx`):

1. ChartFrame, line, rate band: "Mention rate by engine", meta "Last 12 weeks, 40 prompts, 1 version boundary",
   three engines (`chart-1` circle, `chart-2` rect, `chart-3` triangle) plus "Previous period" as a `reference`
   series, bands, two thin weeks (hollow points), one gap, `boundaries: [{ at: 'Oct 5', label: 'Extractor v4' }]`,
   `previousId`, tooltip text from `rateTipText` with fixture words, `cellText` with counts, footnote "Method:
   prompt weighted, 95% Wilson intervals. Excludes branded prompts.", `menu` with `png`, `csv`, `link`
   (`https://app.idraft.test/design-system/charts#mention-rate`), height 240.
2. ChartFrame, bar, stacked: counts by week with `menu` and Patterns.
3. ChartFrame, html: "Citations by domain" with a small plain HTML list of bars in token classes (`bg-chart-1`,
   `bg-chart-bar-neutral`, `h-2 rounded-xs`; not WP-05's `BarList`), a legend of two items without `onLegendToggle`,
   its `table` (a `table` with caption, value and "k of n" columns), `menu` with `csv` and `link`, `patterns`.
4. ChartFrame states, side by side in a responsive grid (`grid gap-4 md:grid-cols-2`): loading; refetching (a button
   "Start refetch" toggles it, so "Updating" can be seen); empty ("Trends need at least 2 weeks", reason "Prompts are
   asked on Mondays and Thursdays; the next answers arrive Thu Nov 19.", action "Open schedules" link button); error
   (`InlineError` words "Could not load the trend", "The server returned an error. Your filters are unchanged.", an
   error id, Retry toggling `retrying` for 1 s); stale notice ("Stale: last collected Nov 9, 18:30 CET"); partial
   notice ("Partial data: 31 of 40 prompts asked this week"). Inspector variant once (180 px).
5. ChartLegend alone: toggles with dot, line (reference, other) and marker swatches (circle, rect, triangle, diamond),
   one pressed false; a plain key without `onToggle`.
6. Tooltip rows: the output of `rateTipText` for a full row, a pooled prompt-weighted row, a thin row and no answers,
   shown as text in `type-table` (the HTML of `rateTipRow` is a canvas tooltip; the page shows its words).
7. SmallSampleMarker: text form in a sentence, cell form in a compact and a default height row (`h-row-compact`,
   `h-row` by the density control), with and without tip.
8. SparklineCell: a small `table` (caption "Sparkline kinds", headers Kind, Trend, Last 7 points) with rows count
   (search volume), rate (mention rate 31% to 36% with a gap), rate own (`tone="own"`), rank (8 to 3 with a beyond
   depth week), empty; `density` from the control (16 or 20 px); the third column shows the `detail` of
   `useSparklineTip()` for the row, so the tip words are visible without hover.

The e2e flow `apps/web/e2e/flows/ai-chart-platform.spec.ts` (an e2e fits: the page is the only place every state and
the menu render together):

- For each theme (`idraft.theme` in localStorage, the `design-system.spec.ts` precedent) and each width 390, 768, 1024,
  1280 (`page.setViewportSize({ width, height: 900 })`): `/design-system/charts`, `waitForContent`,
  `expectAccessible` from `../support`, and `document.documentElement.scrollWidth <= window.innerWidth` (no
  horizontal scroll).
- Keyboard: focus "More actions for Mention rate by engine", `Enter`, `ArrowDown` to Download CSV, `Enter`;
  `page.waitForEvent('download')` gives `mention-rate.csv` (fixture `fileName`) whose text has the header and "4 of 10
  answers"; the same path for Download PNG gives a `.png` larger than 1 KB; Escape returns focus to the trigger.
- PNG in the light theme from the dark page: in the dark theme, an init script wraps `URL.createObjectURL` to keep the
  last blob on `window`; after Download PNG, `createImageBitmap` of that blob drawn on a canvas reads pixel (2, 2) and
  the test expects the light `--surface` value (read in the page with `dark` lifted), not the dark one.
- Copy link: `context.grantPermissions(['clipboard-read', 'clipboard-write'])`, pick Copy link, expect
  `navigator.clipboard.readText()` to equal the fixture link and the live region to say "Link copied".
- Table toggle shows the table with its caption; Retry in the error specimen goes busy and back.

Tests first: `registry.test.tsx` expects `'charts'` (fails before the slug exists) and its `describe.each` renders the
new section in both themes with axe; the e2e spec is written before the section (it fails on a 404).

Commands:

```bash
cd apps/web && pnpm exec vitest run src/components/design-system/registry.test.tsx
pnpm exec eslint src/components/design-system e2e/flows/ai-chart-platform.spec.ts
pnpm exec prettier --check src/components/design-system e2e/flows/ai-chart-platform.spec.ts
```

The e2e itself runs in T5 through the heavy lane.

Browser check by the session (after the reviewer's PASS):

1. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'`; reuse a server of this worktree on 3004 if one runs; never
   stop ports 3000 or 3002 (other sessions); at most 3 dev servers on the machine.
2. Otherwise start in the background: `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev --port 3004`, and read
   the URL from its output.
3. Open `http://localhost:3004/design-system/charts` in the Browser pane; for each width 390, 768, 1024 and 1280
   (`resize_window`), in Light and Dark (the page's theme control) and Default and Compact (the section's control):
   screenshot, check no horizontal scroll (`javascript_tool`: `document.documentElement.scrollWidth <=
   innerWidth`), the title row wraps before the title narrows, the legend and views wrap below 768, the More menu
   opens by keyboard and stays inside the viewport, tooltips on the canvas show the rate rows with counts, the
   boundary label and dashed line show, thin points are hollow, sparklines are 16 px in Compact and 20 px in Default.
4. Download PNG once from the dark theme and open the file (Read) to see it light with title, meta, legend and
   footnote.
5. Reset the viewport (`preset: 'desktop'`) and stop the server this session started.

Reviewer checklist: fixtures obey R1 to R12 (counts beside every percent, no zero for unknown, no pooled engines,
changes in points); no hex or palette classes; ASCII copy without dashes; the density control changes what has
density and nothing else; the three registry edits are one line each.

Model: Haiku writes `charts-section.tsx` and the three registry lines; a Sonnet implementer writes the e2e spec; a
Sonnet reviewer.

Commit: `WP-04: design-system entries for the chart parts`.

### T5. As built notes, rebase, final checks, push, report (step 5)

1. As built note (Haiku drafts, the session checks against the diff): append one blockquote at the end of
   `docs/20-frontend-specification.md` section 4.6 "Chart conventions", in the format of the WP-02 notes:
   `> As built (AI visibility chart platform, WP-04, 2026-11-13, plan
   docs/superpowers/plans/2026-11-13-ai-wp-04-chart-platform.md): ...`. It names the new props and helpers, the
   decisions C3 to C14, what is not done (C17, PNG of html charts needs their own `png` body, DS 25 10.1 and 8.10
   prop drift for WP-72, the red and green sparkline tones in `gsc-trend-cell.tsx`), and whether L1 was granted.
2. Rebase: `git fetch origin && git rebase origin/develop`; on conflicts in `en.json` or the design-system registry
   files keep both sides, then `pnpm exec vitest run src/i18n/messages.test.ts src/components/design-system/registry.test.tsx`.
3. Health first: read `/tmp/idraft-health/state`; while it says `level=CRIT` or `/tmp/idraft-health/pause` exists,
   wait (`heavy` also refuses new jobs then) and re-read.
4. Full checks from `apps/web` (after `pnpm install --frozen-lockfile` at the root if the rebase changed the lock):

```bash
../../infra/dev/heavy --lane medium --label wp04-lint -- pnpm lint
../../infra/dev/heavy --lane medium --label wp04-typecheck -- pnpm typecheck
../../infra/dev/heavy --lane medium --label wp04-format -- pnpm format:check
../../infra/dev/heavy --label wp04-test -- pnpm test
../../infra/dev/heavy --label wp04-build -- pnpm build
E2E_PORT=<a port lsof shows free, not 3000, 3002, 3004 or 3100> ../../infra/dev/heavy --label wp04-e2e --max 40 -- \
  pnpm exec playwright test --project=e2e e2e/flows/ai-chart-platform.spec.ts e2e/flows/design-system.spec.ts
```

   `reuseExistingServer` is on outside CI, so the e2e port must have nothing listening on it. Compare the `pnpm
   build` route table with the one before T1 (the session records it at T1 start): First Load JS of
   `/[workspace]/[project]/seo/keywords` and the prompts route must not grow by more than the menu code (a few KB);
   the echarts chunk must not change.
5. Final review: a fresh Sonnet reviewer reads the whole package diff against the brief's acceptance criteria and
   this plan, runs the regression set and the chart tests, and opens `/design-system/charts` at the four widths.
6. Commit the note: `WP-04: As built note for the chart platform`.
7. Push: `git fetch origin && git rebase origin/develop` again, re-run the targeted chart tests and the regression
   set, then `git push origin HEAD:develop` (fast-forward only; rejected means rebase again). Never `main`, never
   `infra/ship.sh`.
8. Report with `infra/dev/wp-status WP-04 merged "<note>"` when the script exists after the rebase, and the same line
   to the coordinator:

```text
WP-04 <status> | branch ai/wp-04-chart-platform @ <short sha> | rows done <n>/1 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

   Sent at plan commit (`building`, steps 1/6), each push, review start (`review`), blocked (`blocked`), done
   (`merged`, rows done 1/1, steps 6/6).

## 4. Risks and rollback

| Risk | Guard | Rollback |
|---|---|---|
| Existing chart call sites break (five frames, three sparklines, 27 tests that mock `./echart`) | New props optional; the state union accepts `'loading' or 'ready'`; legend markup moved as is; the regression set after T1, T2, T3; `echart.tsx` untouched | Each task is one commit on develop: `git revert <sha>` of the task (T4 before T1, since the section uses T1 props); never revert `main` |
| echarts bundle size and tree shaking | No change to `registerModules`; `chart-png.ts` behind `import()`; `pnpm build` route table compared before and after (T5 step 4); budget 170 KB gzip for the chart chunk (DS 15 section 12) | Revert T1 |
| PNG in the light theme from a dark page | `readLightChartColors` lifts `dark` from `<html>` synchronously and restores it in `finally`, as `readWorkbookColors` does; the `MutationObserver` of each live `EChart` and `SparklineCell` fires after the class is back, so it redraws once in dark (no flicker); the e2e reads a pixel of the PNG | Drop the PNG item (menu config) while the cause is fixed |
| Offscreen ECharts render: zero size, fonts, leaks | Explicit `width` and `height` to `init`; element appended off view and removed, instance disposed in `finally`; fonts from `tokens.fontFamily` (Geist loaded with the page) | Same |
| Boundary `markLine` on a dataless series not drawn by ECharts 6.1 | Unit test for the structure; the browser check at T4 confirms the dashed line and label render | Attach the `markLine` to the first visible series instead (one line in `boundaryMarkLines`' caller) |
| SSR | All new components are `'use client'` under client parents; DOM is touched only in effects and handlers; `light-tokens.ts` and `chart-png.ts` run only on a click | n/a |
| Import cycles (no lint rule for cycles in `eslint.config.mjs`) | The graph is one way: `chart-frame` to `chart-legend`, `chart-menu`; `chart-menu` to `chart-png` by `import()`; `rate-band-chart`, `rate-tip` to `tooltip-row` to `category-chart`; `rate-band-chart` to `small-sample`, `boundaries`. Reviewers grep the imports of each new lib file | n/a |
| The source-text test (`src/test/source-text.test.ts`: no U+2013 or U+2014 in any `.ts`, `.tsx`, `.json`, `.md`, `.css` under `apps/web`, comments included) and `messages.test.ts` (no dashes, no straight quotes in content, no contractions of not, camelCase keys) | Every implementer writes ASCII; both tests run in the regression set after each task | Fix forward |
| Registry files edited by several W1 packages at once | One line each, rebase keeps both sides, `registry.test.tsx` after the rebase | n/a |
| Visual baselines | None are committed (`e2e/__screenshots__` is absent) and `infra/ship.sh` runs no e2e; `e2e/visual/pages.spec.ts` will pick up `charts` by slug when baselines are made | n/a |
| L1 refused or late | Fallback colour `borderStrong`, recorded in the As built note | n/a |
