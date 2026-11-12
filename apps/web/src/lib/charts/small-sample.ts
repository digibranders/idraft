import type { ChartTokens } from '@/lib/design/read-tokens';

/** Rule R2 as a point on a canvas (15-data-visualization.md section 4): hollow, 5 px, ringed in the series colour. */
export const SMALL_SAMPLE_SIZE = 5;

export interface SmallSamplePoint {
  value: number;
  symbol: string;
  symbolSize: number;
  itemStyle: { color: string; borderColor: string; borderWidth: number };
}

/**
 * A point over fewer answers than a rate needs. It keeps the marker shape of its series, so the shapes still tell
 * the series apart without colour; it is filled with the tooltip surface, and the caller draws no band for it.
 */
export function smallSamplePoint(value: number, symbol: string, color: string, tokens: ChartTokens): SmallSamplePoint {
  return {
    value,
    symbol,
    symbolSize: SMALL_SAMPLE_SIZE,
    itemStyle: { color: tokens.surfaceElevated, borderColor: color, borderWidth: 2 },
  };
}
