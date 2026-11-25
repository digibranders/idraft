import type { DonutSlice } from './donut-model';
import { chartMotion } from '@/lib/charts/rich-style';
import { escapeHtml, seriesColor } from '@/lib/charts/category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';

export interface DonutOptionInput {
  slices: readonly DonutSlice[];
  tokens: ChartTokens;
  /** Formats a slice's value for the tooltip: "49.5%". */
  formatValue: (value: number) => string;
}

/** The ECharts option of a donut: one slice per brand, no labels on the canvas (the legend beside it names them). */
export function donutOption({ slices, tokens, formatValue }: DonutOptionInput): Record<string, unknown> {
  return {
    ...chartMotion(),
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: tokens.surfaceElevated,
      borderColor: tokens.border,
      textStyle: { color: tokens.foreground, fontFamily: tokens.fontFamily, fontSize: 12 },
      // Plain text: a collected name never reaches the tooltip as HTML
      formatter: (point: { name: string; value: number }): string =>
        `${escapeHtml(point.name)}: ${escapeHtml(formatValue(point.value))}`,
    },
    series: [
      {
        type: 'pie',
        radius: ['62%', '90%'],
        center: ['50%', '50%'],
        startAngle: 90,
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: tokens.surfaceElevated, borderWidth: 2 },
        emphasis: { scale: true, scaleSize: 4 },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: seriesColor(slice.role, tokens) },
        })),
      },
    ],
  };
}
