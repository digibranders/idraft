import { describe, expect, it } from 'vitest';

import { ghostTrendOption, GHOST_POINTS } from './ghost-trend';
import type { ChartTokens } from '@/lib/design/read-tokens';

// Stand-ins named after their tokens: the builder only passes colours through
const TOKENS: ChartTokens = {
  palette: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'],
  other: 'chart-other',
  reference: 'chart-reference',
  grid: 'chart-grid',
  axis: 'chart-axis',
  label: 'chart-label',
  band: 'chart-band',
  rankBandNone: 'chart-rank-band-none',
  surfaceElevated: 'surface-elevated',
  border: 'border',
  borderStrong: 'border-strong',
  foreground: 'foreground',
  foregroundSecondary: 'foreground-secondary',
  foregroundMuted: 'foreground-muted',
  fontFamily: 'GeistSans',
};

describe('ghostTrendOption', () => {
  const option = ghostTrendOption(TOKENS) as {
    xAxis: { show: boolean; data: string[] };
    yAxis: { show: boolean };
    series: { silent: boolean; symbol: string; data: number[]; lineStyle: { type: number[] } }[];
  };

  it('is a drawing: one silent dashed line with no markers, no axes and no tooltip', () => {
    expect(option).not.toHaveProperty('tooltip');
    expect(option.xAxis.show).toBe(false);
    expect(option.yAxis.show).toBe(false);
    expect(option.series).toHaveLength(1);
    expect(option.series[0]).toMatchObject({ silent: true, symbol: 'none', lineStyle: { type: [6, 6] } });
  });

  it('has a point for every category of its axis', () => {
    expect(option.series[0]?.data).toEqual([...GHOST_POINTS]);
    expect(option.xAxis.data).toHaveLength(GHOST_POINTS.length);
  });
});
