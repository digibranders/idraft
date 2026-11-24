import { escapeHtml } from './category-chart';
import { chartMotion } from './rich-style';
import { tipRowHtml, tipTitleHtml } from './tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * One plain ring per row (15-data-visualization.md section 1a): solid token colours, a thin gap between the segments, no
 * gradient, shadow or depth. The number in the middle and the name below each ring are drawn by the React component
 * around the canvas, in equal columns that match the ring centres, so the page's font and text rules apply to them.
 */

export interface RingSegment {
  id: string;
  name: string;
  /** The colour token without the dashes: "seq-6", "chart-bar-neutral". */
  token: string;
}

export interface RingRow {
  id: string;
  /** "ChatGPT". */
  label: string;
  /** One share (0 to 1) per segment, in the order of the segments; `null` is a row with no rate, drawn as an empty ring. */
  shares: readonly number[] | null;
  /** The hover of each segment in the order of the segments: "Mentioned only: 10%, 4 of 44 answers". */
  tips: readonly string[];
}

export interface RingsInput {
  rows: readonly RingRow[];
  segments: readonly RingSegment[];
  tokens: ChartTokens;
  /** The canvas size in px. ECharts takes a percent radius from the smaller side of the whole canvas, not of a ring's column. */
  width: number;
  height: number;
}

/** The inner radius as a share of the outer one, and the outer one as a share of the room a ring has. */
const INNER = 0.69;
const FILL = 0.84;

/**
 * The outer radius in px: half of the room of one ring, which is its column's width or the canvas height, whichever is
 * smaller. Before the width is known (0) the height alone decides.
 */
export function ringRadius(count: number, width: number, height: number): number {
  const room = width > 0 ? Math.min(height, width / Math.max(1, count)) : height;
  return Math.max(24, (room / 2) * FILL);
}

/** The centre of ring `index` of `count`, in the middle of its column: the columns of the React component under it. */
export const ringCenterX = (index: number, count: number): string => `${String(((index + 0.5) / count) * 100)}%`;

export function ringsOption({ rows, segments, tokens, width, height }: RingsInput): Record<string, unknown> {
  const outer = ringRadius(rows.length, width, height);
  const colorOf = (token: string): string => tokens.named?.(token) ?? tokens.other;
  const neutral = colorOf('chart-bar-neutral');
  return {
    ...chartMotion(),
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
      formatter: (param: { seriesName?: string; name?: string; dataIndex?: number; seriesIndex?: number }) => {
        const row = rows[param.seriesIndex ?? -1];
        const segment = segments[param.dataIndex ?? -1];
        if (row === undefined || segment === undefined) return '';
        return `${tipTitleHtml(row.label)}${tipRowHtml(colorOf(segment.token), segment.name, '', tokens)}<div style="max-width:320px;white-space:normal;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(row.tips[param.dataIndex ?? 0] ?? '')}</div>`;
      },
    },
    series: rows.map((row, index) => ({
      type: 'pie',
      name: row.label,
      center: [ringCenterX(index, rows.length), '50%'],
      radius: [Math.round(outer * INNER), Math.round(outer)],
      startAngle: 90,
      label: { show: false },
      labelLine: { show: false },
      // A row with no rate is an empty ring that answers no pointer
      ...(row.shares === null
        ? { silent: true, itemStyle: { color: neutral, opacity: 0.55 }, data: [{ name: row.label, value: 1 }] }
        : {
            padAngle: 2,
            itemStyle: { borderRadius: 3 },
            emphasis: { scale: true, scaleSize: 3 },
            // A segment with no share keeps its place in the data (its index is the segment's), drawn as nothing
            data: segments.map((segment, at) => ({
              name: segment.name,
              value: row.shares?.[at] ?? 0,
              itemStyle: { color: colorOf(segment.token) },
            })),
          }),
    })),
  };
}
