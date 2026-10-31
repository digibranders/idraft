import { describe, expect, it } from 'vitest';

import { rankAxis } from './rank-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tokens: ChartTokens = {
  palette: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'],
  axis: 'chart-axis',
  label: 'chart-label',
  fontFamily: 'Inter',
  other: 'chart-other',
  reference: 'chart-reference',
  grid: 'chart-grid',
  band: 'chart-band',
  rankBandNone: 'chart-rank-band-none',
  surfaceElevated: 'chart-surface-elevated',
  border: 'chart-border',
  borderStrong: 'chart-border-strong',
  foreground: 'chart-foreground',
  foregroundSecondary: 'chart-foreground-secondary',
};

const base = {
  yAxis: { type: 'value' },
  grid: { right: 16 },
  series: [{ id: 'own', type: 'line', data: [3, null] }],
};

describe('rankAxis', () => {
  it('inverts the axis from 1 to the depth shown, with labels at 1, 3, 10 and 20', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 240,
      bands: [],
      guide: (rank) => `Top ${String(rank)}`,
      bandLabel: () => 'Not in top 20',
    });
    expect(option.yAxis).toMatchObject({ inverse: true, min: 1, max: 20 });
    expect(option.grid).toMatchObject({ right: 52 });
  });

  it('drops the label at 3 below 200 px of plot but keeps the Top 3 guide', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [],
      guide: (rank) => `Top ${String(rank)}`,
      bandLabel: () => '',
    });
    const guides = (option.series as { markLine?: { data: { yAxis: number }[] } }[])[0]?.markLine?.data.map(
      (line) => line.yAxis,
    );
    expect(guides).toEqual([3, 10, 20]);
  });

  it('hatches each beyond depth run from its depth to the bottom of the axis, covering full category width', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 50,
      plotHeight: 240,
      bands: [{ from: 2, to: 4, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { xAxis: 1.5, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 4.5, yAxis: 50 },
      ],
    ]);
  });

  it('covers full category width for a single category run with min and max', () => {
    const singleBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1'] },
    };
    const option = rankAxis(singleBase, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [{ from: 0, to: 0, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { x: 'min', yAxis: 20, name: 'Not in top 20' },
        { x: 'max', yAxis: 20 },
      ],
    ]);
  });

  it('adds distinct markPoint for failed checks', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [],
      failedIndices: [1],
      failedLabel: 'Check failed',
      guide: () => '',
      bandLabel: () => '',
    });
    const markPoint = (option.series as { markPoint?: { data: unknown[] } }[])[0]?.markPoint?.data;
    expect(markPoint).toEqual([
      {
        coord: [1, 20],
        symbol: 'triangle',
        symbolSize: 8,
        itemStyle: { color: 'chart-other' },
        name: 'Check failed',
      },
    ]);
  });
});
