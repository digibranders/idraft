import type { EngineValue } from './engine-values';
import type { ScatterPoint } from './scatter-model';
import { escapeHtml } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';

/** The words of the chart, already translated, so the option stays a pure function. */
export interface ScatterWords {
  /** The name of the one series: what a point is. */
  series: string;
  /** The names of the rates: the axes and the rows of the tooltip. */
  mention: string;
  citation: string;
  /** The name of the diagonal. */
  reference: string;
  /** A rate on the axis. */
  rate: (ratio: number) => string;
  /** A rate with its answers: "47%, 64 of 136 answers". */
  value: (value: EngineValue) => string;
  prompts: (count: number) => string;
}

export interface ScatterInput {
  points: readonly ScatterPoint[];
  /** The top of both axes, a ratio. */
  ceiling: number;
}

const POINT_OPACITY = 0.6;

/**
 * The option of the scatter (CH-15): mention rate across, citation rate up, both on one 0 to `ceiling` axis, so the
 * dashed diagonal from corner to corner is "cited as often as named". One series, a neutral colour with a surface
 * outline, `chart-1` on hover and no colour for a quadrant. The tooltip is the topic, both rates with their counts
 * and the prompts, every string escaped.
 */
export function scatterOption(
  { points, ceiling }: ScatterInput,
  tokens: ChartTokens,
  words: ScatterWords,
): Record<string, unknown> {
  const label = { color: tokens.label, fontSize: 12, fontFamily: tokens.fontFamily };
  const axis = (name: string): Record<string, unknown> => ({
    type: 'value',
    min: 0,
    max: ceiling,
    name,
    nameLocation: 'middle',
    nameGap: 28,
    nameTextStyle: label,
    axisLine: { show: true, lineStyle: { color: tokens.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { ...label, formatter: (value: number) => words.rate(value) },
    splitLine: { show: true, lineStyle: { color: tokens.grid, type: 'dashed', width: 1 } },
  });
  return {
    animation: false,
    // The frame names and describes the chart, so ECharts writes no label of its own
    aria: { enabled: true, label: { enabled: false } },
    grid: { left: 4, right: 16, top: 8, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    textStyle: label,
    xAxis: axis(words.mention),
    yAxis: { ...axis(words.citation), nameGap: 40 },
    tooltip: {
      trigger: 'item',
      // Kept inside the chart, so a card that clips its content does not cut it off
      confine: true,
      borderRadius: 8,
      extraCssText: 'box-shadow: var(--shadow-popover);',
      backgroundColor: tokens.surfaceElevated,
      borderColor: tokens.border,
      borderWidth: 1,
      padding: [6, 8],
      textStyle: { color: tokens.foreground, fontSize: 13, fontFamily: tokens.fontFamily },
      formatter: (params: { dataIndex: number }): string => {
        const point = points[params.dataIndex];
        if (point === undefined) return '';
        const { row } = point;
        return [
          tipTitleHtml(row.node.name),
          tipRowHtml(tokens.reference, words.mention, words.value(row.mention), tokens),
          tipRowHtml(tokens.reference, words.citation, words.value(row.citation), tokens),
          `<div style="color:${escapeHtml(tokens.foregroundSecondary)};margin-top:4px">${escapeHtml(words.prompts(row.node.promptCount))}</div>`,
        ].join('');
      },
    },
    series: [
      {
        type: 'scatter',
        name: words.series,
        data: points.map((point) => ({ name: point.row.node.name, value: [point.x, point.y], symbolSize: point.size })),
        itemStyle: {
          color: tokens.reference,
          borderColor: tokens.surfaceElevated,
          borderWidth: 1,
          opacity: POINT_OPACITY,
        },
        emphasis: { focus: 'none', itemStyle: { color: tokens.palette[0] ?? tokens.foreground, opacity: 1 } },
        markLine: {
          silent: true,
          symbol: 'none',
          animation: false,
          label: { show: false },
          lineStyle: { color: tokens.reference, type: 'dashed', width: 1 },
          data: [[{ coord: [0, 0] }, { coord: [ceiling, ceiling] }]],
        },
      },
    ],
  };
}
