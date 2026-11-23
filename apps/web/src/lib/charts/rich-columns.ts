import { escapeHtml } from './category-chart';
import { chartMotion, fadeDown, shade } from './rich-style';
import { tipRowHtml, tipTitleHtml } from './tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * Columns with a front, a side and a top face (15-data-visualization.md section 1a): a pseudo 3D look drawn in 2D, so the
 * height of the front face is still the value and nothing is distorted. The value is written above each column. A
 * column that opens something shows the hand and brightens under the pointer.
 */

export interface ColumnItem {
  id: string;
  /** "Northwind (you)", "HubSpot". */
  name: string;
  /** 0 to 1; `null` is a brand with no share, drawn as a flat slab and no number (never a zero). */
  value: number | null;
  /** The colour token of the column without the dashes: "chart-1", "chart-3". */
  token: string;
  /** The value as the card says it: "26%". */
  valueText: string;
  /** Your own column: its value is written in the strong colour and it opens nothing. */
  own: boolean;
  /** The sentence of the tooltip: the figure and what it is of. */
  tip: string;
}

export interface ColumnsInput {
  items: readonly ColumnItem[];
  tokens: ChartTokens;
  /** The canvas width in px, for the width a name may take under its column; 0 until it is known. */
  width: number;
}

/** The part of the custom series' `api` that the renderer uses. */
interface RenderApi {
  value: (dimension: number) => number;
  coord: (point: readonly [number, number]) => [number, number];
  size: (point: readonly [number, number]) => [number, number];
}
interface RenderParams {
  dataIndex: number;
}

type Point = readonly [number, number];

function polygon(points: readonly Point[], fill: unknown, lit: unknown): Record<string, unknown> {
  return { type: 'polygon', shape: { points }, style: { fill }, emphasis: { style: { fill: lit } } };
}

/** The ratio axis tops out at the next quarter above the tallest column, never above 100%. */
export function columnsCeiling(items: readonly ColumnItem[]): number {
  const top = Math.max(0.25, ...items.map((item) => item.value ?? 0));
  return Math.min(1, Math.ceil(top * 4) / 4);
}

/** A long name breaks at its first space, so the label of a column stays inside the column's width. */
/** The plot's side margins in px, which the names under the columns are measured against. */
const GRID = { left: 44, right: 24 } as const;

const wrapName = (name: string): string => (name.length > 11 && name.includes(' ') ? name.replace(' ', '\n') : name);

/** The width a name may take under its column: the plot's width over the columns, less a gap; the full name is in the tooltip. */
export function labelWidth(count: number, width: number): number | undefined {
  return width > 0 ? Math.max(32, (width - GRID.left - GRID.right) / Math.max(1, count) - 4) : undefined;
}

export function columns3dOption({ items, tokens, width }: ColumnsInput): Record<string, unknown> {
  const colorOf = (token: string): string => tokens.named?.(token) ?? tokens.other;
  const label = { color: tokens.label, fontSize: 12, fontFamily: tokens.fontFamily };
  return {
    ...chartMotion(),
    textStyle: label,
    grid: { ...GRID, top: 38, bottom: 46, outerBoundsMode: 'none' },
    xAxis: {
      type: 'category',
      data: items.map((item) => wrapName(item.name)),
      axisLine: { show: true, lineStyle: { color: tokens.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { ...label, interval: 0, hideOverlap: false, lineHeight: 15, width: labelWidth(items.length, width), overflow: 'truncate' },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: columnsCeiling(items),
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
      formatter: (param: { dataIndex: number }) => {
        const item = items[param.dataIndex];
        if (item === undefined) return '';
        return `${tipTitleHtml(item.name)}${tipRowHtml(colorOf(item.token), item.valueText, '', tokens)}<div style="max-width:320px;white-space:normal;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(item.tip)}</div>`;
      },
    },
    series: [
      {
        type: 'custom',
        data: items.map((item, index) => [index, item.value ?? 0]),
        encode: { x: 0, y: 1 },
        renderItem: (params: RenderParams, api: RenderApi) => {
          const item = items[params.dataIndex];
          if (item === undefined) return { type: 'group', children: [] };
          const [x, y] = api.coord([api.value(0), api.value(1)]);
          const [, base] = api.coord([api.value(0), 0]);
          const width = Math.min(api.size([1, 0])[0] * 0.5, 64);
          const depth = Math.min(width * 0.4, 16);
          const left = x - width / 2;
          const right = x + width / 2;
          // A brand with no share is a flat slab, so its place in the order stays visible
          const top = item.value === null ? base - 3 : Math.min(y, base - 3);
          const color = colorOf(item.token);
          return {
            type: 'group',
            children: [
              polygon([[right, top], [right + depth, top - depth], [right + depth, base - depth], [right, base]], shade(color, -0.28), shade(color, -0.12)),
              polygon([[left, top], [right, top], [right, base], [left, base]], fadeDown(color, 1, 0.78), fadeDown(color, 1, 1)),
              polygon([[left, top], [left + depth, top - depth], [right + depth, top - depth], [right, top]], shade(color, 0.34), shade(color, 0.5)),
              {
                type: 'text',
                silent: true,
                style: {
                  x: x + depth / 2,
                  y: top - depth - 8,
                  text: item.value === null ? '' : item.valueText,
                  textAlign: 'center',
                  textVerticalAlign: 'bottom',
                  fill: item.own ? tokens.foreground : tokens.label,
                  font: `${item.own ? '600' : '400'} 12px ${tokens.fontFamily}`,
                },
              },
            ],
          };
        },
      },
    ],
  };
}
