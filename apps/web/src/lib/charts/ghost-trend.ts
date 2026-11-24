import { chartMotion, fadeDown, withAlpha } from './rich-style';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * The faint curve behind the empty state of a trend chart (15-data-visualization.md section 1a): a drawing of how the line
 * will look once there is a weekly trend, not data. It says so by being grey, dashed, silent and without axes or numbers.
 */

/** The eight points of the drawing, rising a little: a shape, never a figure. */
export const GHOST_POINTS: readonly number[] = [0.32, 0.4, 0.37, 0.5, 0.46, 0.58, 0.55, 0.66];

export function ghostTrendOption(tokens: ChartTokens): Record<string, unknown> {
  return {
    ...chartMotion(),
    grid: { left: 8, right: 8, top: 12, bottom: 12 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: GHOST_POINTS.map((_, index) => String(index)) },
    yAxis: { type: 'value', show: false, min: 0, max: 1 },
    series: [
      {
        type: 'line',
        smooth: 0.4,
        silent: true,
        symbol: 'none',
        data: [...GHOST_POINTS],
        lineStyle: { width: 3, type: [6, 6], color: withAlpha(tokens.other, 0.5) },
        areaStyle: { color: fadeDown(tokens.other, 0.16, 0) },
      },
    ],
  };
}
