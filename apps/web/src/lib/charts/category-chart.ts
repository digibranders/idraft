import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * The ECharts option of a line or bar chart over categories (months, days), styled by the rules of
 * 15-data-visualization.md sections 3 and 4: no animation, a fixed outer padding that holds the axis labels, horizontal dashed
 * gridlines, an x axis line only, 2 px lines, markers on series of 60 points or fewer, bars at most 24 px
 * wide. Colours come by role, never by position in the data.
 */

/** `brand` is `chart-1`; `palette` takes `chart-2` onward by its stored index; `reference` and `other` are dashed. */
export type SeriesRole =
  { kind: 'brand' } | { kind: 'palette'; index: 2 | 3 | 4 | 5 | 6 } | { kind: 'reference' } | { kind: 'other' };

export interface CategorySeries {
  id: string;
  name: string;
  role: SeriesRole;
  /** One value per category; `null` is a gap, never a zero. */
  values: readonly (number | null)[];
}

export interface CategoryChartInput {
  kind: 'line' | 'bar';
  categories: readonly string[];
  series: readonly CategorySeries[];
  /** Series the legend turned off; they keep their colour. */
  hidden: ReadonlySet<string>;
  /** Decal patterns on bars, for telling series apart without colour. */
  patterns: boolean;
  tokens: ChartTokens;
  /** Formats a value for the axis and the tooltip: "8,100". */
  formatValue: (value: number) => string;
  /** Bars of a category stack into one column (a total that means something, 15 section 4); lines ignore it. */
  stacked?: boolean | undefined;
}

/** Markers show on series this short or shorter (15 section 4). */
const MARKERS_UP_TO = 60;
/** Marker shapes after the brand's circle, so series differ without colour (20 section 12.2). */
const SYMBOLS = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'] as const;

/** The colour token of a role. */
export function seriesColor(role: SeriesRole, tokens: ChartTokens): string {
  if (role.kind === 'brand') return tokens.palette[0] ?? tokens.foreground;
  if (role.kind === 'palette') return tokens.palette[role.index - 1] ?? tokens.other;
  return role.kind === 'reference' ? tokens.reference : tokens.other;
}

/** The custom property of a role, for the React legend's swatches. */
export function seriesColorVar(role: SeriesRole): string {
  if (role.kind === 'brand') return 'var(--chart-1)';
  if (role.kind === 'palette') return `var(--chart-${String(role.index)})`;
  return role.kind === 'reference' ? 'var(--chart-reference)' : 'var(--chart-other)';
}

const dashOf = (role: SeriesRole): number[] | 'solid' =>
  role.kind === 'reference' ? [4, 4] : role.kind === 'other' ? [8, 4] : 'solid';

/** A plain-text tooltip line per series: no collected string reaches the tooltip as HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${String(character.codePointAt(0) ?? 0)};`);
}

export function categoryChartOption(input: CategoryChartInput): Record<string, unknown> {
  const { kind, categories, series, hidden, patterns, tokens, formatValue, stacked } = input;
  const shown = series.filter((entry) => !hidden.has(entry.id));
  // Axis labels in the page's font, 12 px, with tabular figures as type-label draws them
  const label = { color: tokens.label, fontSize: 12, fontFamily: tokens.fontFamily };
  return {
    animation: false,
    // Decal patterns only: the frame names and describes the chart, so ECharts writes no label of its own
    aria: { enabled: true, label: { enabled: false }, decal: { show: patterns } },
    // The padding bounds the axis labels too: the plot shrinks until the y labels ("30,000", "1.2M") and the
    // x labels fit inside it, so no width of label is cut at the card's edge
    grid: { left: 4, right: 16, top: 8, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    textStyle: label,
    xAxis: {
      type: 'category',
      data: [...categories],
      boundaryGap: kind === 'bar',
      axisLine: { show: true, lineStyle: { color: tokens.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: label,
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...label, formatter: (value: number) => formatValue(value) },
      splitLine: { show: true, lineStyle: { color: tokens.grid, type: 'dashed', width: 1 } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: kind === 'bar' ? 'shadow' : 'line', lineStyle: { color: tokens.borderStrong, width: 1 } },
      // Kept inside the chart, so a card that clips its content does not cut it off
      confine: true,
      borderRadius: 8,
      extraCssText: 'box-shadow: var(--shadow-popover);',
      backgroundColor: tokens.surfaceElevated,
      borderColor: tokens.border,
      borderWidth: 1,
      padding: [6, 8],
      textStyle: { color: tokens.foreground, fontSize: 13, fontFamily: tokens.fontFamily },
      formatter: (
        params: readonly { axisValueLabel?: string; seriesName?: string; value?: unknown; color?: unknown }[],
      ) => {
        const [first] = params;
        const rows = params
          .filter((param) => typeof param.value === 'number')
          .map((param) => {
            const color = typeof param.color === 'string' ? param.color : tokens.other;
            const value = typeof param.value === 'number' ? formatValue(param.value) : '';
            return `<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:${color}"></span><span style="color:${tokens.foregroundSecondary}">${escapeHtml(param.seriesName ?? '')}</span><span style="margin-left:auto;font-variant-numeric:tabular-nums">${escapeHtml(value)}</span></div>`;
          });
        return `<div style="font-size:14px;line-height:20px;font-weight:600;margin-bottom:4px">${escapeHtml(first?.axisValueLabel ?? '')}</div>${rows.join('')}`;
      },
    },
    series: shown.map((entry) => {
      const color = seriesColor(entry.role, tokens);
      const position = series.indexOf(entry);
      const base = { id: entry.id, name: entry.name, data: [...entry.values], color };
      if (kind === 'bar') {
        // In a stack only the series on top is rounded, so the column reads as one bar
        const top = stacked === true && entry === shown[shown.length - 1];
        return {
          ...base,
          type: 'bar',
          barMaxWidth: 24,
          barGap: '8%',
          ...(stacked === true ? { stack: 'total' } : {}),
          itemStyle: { borderRadius: stacked === true && !top ? [0, 0, 0, 0] : [2, 2, 0, 0] },
        };
      }
      return {
        ...base,
        type: 'line',
        connectNulls: false,
        showSymbol: entry.values.length <= MARKERS_UP_TO,
        symbol: entry.role.kind === 'brand' ? 'circle' : (SYMBOLS[position % SYMBOLS.length] ?? 'circle'),
        symbolSize: 6,
        lineStyle: { width: 2, type: dashOf(entry.role), join: 'round' },
      };
    }),
  };
}
