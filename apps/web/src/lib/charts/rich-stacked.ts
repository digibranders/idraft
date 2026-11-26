import { escapeHtml } from './category-chart';
import { chartMotion } from './rich-style';
import { tipRowHtml, tipTitleHtml } from './tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * One stacked 100% column per row, with rounded segments that fade toward their base and no glow
 * (15-data-visualization.md section 1a). The exact shares of every segment belong in a table beside the chart, because a
 * colour never carries a number alone.
 */

export interface StackedSegment {
  id: string;
  name: string;
  /** The colour token without the dashes: "seq-6", "chart-positive". */
  token: string;
}

export interface StackedRow {
  id: string;
  /** "ChatGPT". */
  label: string;
  /** Under the name, small: "mean 1.7", "too few mentions". */
  note: string;
  /** One share (0 to 1) per segment, in the order of the segments; `null` is a row with nothing to show: no column. */
  shares: readonly number[] | null;
  /** The hover of each segment in the order of the segments. */
  tips: readonly string[];
}

export interface StackedInput {
  rows: readonly StackedRow[];
  segments: readonly StackedSegment[];
  tokens: ChartTokens;
}

export function stackedColumnsOption({ rows, segments, tokens }: StackedInput): Record<string, unknown> {
  const colorOf = (token: string): string => tokens.named?.(token) ?? tokens.other;
  const label = { color: tokens.label, fontSize: 12, fontFamily: tokens.fontFamily };
  return {
    ...chartMotion(),
    textStyle: label,
    grid: { left: 44, right: 16, top: 12, bottom: 44, outerBoundsMode: 'none' },
    xAxis: {
      type: 'category',
      data: rows.map((row) => (row.note === '' ? row.label : `${row.label}\n${row.note}`)),
      axisLine: { show: true, lineStyle: { color: tokens.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { ...label, interval: 0, hideOverlap: false, lineHeight: 16 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      interval: 0.25,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...label, formatter: (value: number) => `${String(Math.round(value * 100))}%` },
      splitLine: { show: true, lineStyle: { color: tokens.grid, type: 'dashed', width: 1 } },
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      appendToBody: true,
      borderRadius: 8,
      extraCssText: 'box-shadow: var(--shadow-popover);',
      backgroundColor: tokens.surfaceElevated,
      borderColor: tokens.border,
      borderWidth: 1,
      padding: [6, 8],
      textStyle: { color: tokens.foreground, fontSize: 13, fontFamily: tokens.fontFamily },
      formatter: (param: { dataIndex?: number; seriesIndex?: number }) => {
        const row = rows[param.dataIndex ?? -1];
        const segment = segments[param.seriesIndex ?? -1];
        if (row === undefined || segment === undefined) return '';
        return `${tipTitleHtml(row.label)}${tipRowHtml(colorOf(segment.token), segment.name, '', tokens)}<div style="max-width:320px;white-space:normal;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(row.tips[param.seriesIndex ?? 0] ?? '')}</div>`;
      },
    },
    series: segments.map((segment, at) => {
      const color = colorOf(segment.token);
      return {
        name: segment.name,
        type: 'bar',
        stack: 'share',
        barWidth: '46%',
        barMaxWidth: 64,
        // A row with nothing to show has no datum for any segment
        data: rows.map((row) => (row.shares === null ? null : (row.shares[at] ?? 0))),
        itemStyle: {
          color,
          borderRadius: 6,
          borderColor: tokens.surfaceElevated,
          borderWidth: 1.5,
        },
        emphasis: { focus: 'series' },
      };
    }),
  };
}
