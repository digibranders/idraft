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

  it('hatches a middle run from its depth to the bottom of the axis with 0.5 category padding', () => {
    const multiBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'] },
    };
    const option = rankAxis(multiBase, tokens, {
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

  it('clamps a run at the start to 0 to prevent overshooting the left plot edge', () => {
    const multiBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'] },
    };
    const option = rankAxis(multiBase, tokens, {
      depthMax: 50,
      plotHeight: 240,
      bands: [{ from: 0, to: 2, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { xAxis: 0, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 2.5, yAxis: 50 },
      ],
    ]);
  });

  it('clamps a run at the end to categoriesCount minus 1 to prevent overshooting the right plot edge', () => {
    const multiBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'] },
    };
    const option = rankAxis(multiBase, tokens, {
      depthMax: 50,
      plotHeight: 240,
      bands: [{ from: 3, to: 5, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { xAxis: 2.5, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 5, yAxis: 50 },
      ],
    ]);
  });

  it('covers full category width for a single category run by omitting xAxis (documented ECharts behavior)', () => {
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
    expect(option.yAxis).toMatchObject({ max: 25 });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([[{ yAxis: 20, name: 'Not in top 20' }, { yAxis: 25 }]]);
  });

  it('ensures non-zero markArea height at depth 20 and depth 100 by extending effectiveDepthMax', () => {
    const base20 = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2'] },
    };
    const opt20 = rankAxis(base20, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [{ from: 0, to: 1, depth: 20 }],
      guide: () => '',
      bandLabel: (d) => `Not in top ${String(d)}`,
    });
    expect(opt20.yAxis).toMatchObject({ max: 25 });
    const area20 = (opt20.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area20).toEqual([
      [
        { xAxis: 0, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 1, yAxis: 25 },
      ],
    ]);

    const base100 = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2'] },
    };
    const opt100 = rankAxis(base100, tokens, {
      depthMax: 100,
      plotHeight: 180,
      bands: [{ from: 0, to: 1, depth: 100 }],
      guide: () => '',
      bandLabel: (d) => `Not in top ${String(d)}`,
    });
    expect(opt100.yAxis).toMatchObject({ max: 115 });
    const area100 = (opt100.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area100).toEqual([
      [
        { xAxis: 0, yAxis: 100, name: 'Not in top 100' },
        { xAxis: 1, yAxis: 115 },
      ],
    ]);
  });

  it('adds distinct markPoint for failed checks with coordinate at effectiveDepthMax', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [{ from: 0, to: 1, depth: 20 }],
      failedIndices: [1],
      failedLabel: 'Check failed',
      guide: () => '',
      bandLabel: () => '',
    });
    const markPoint = (option.series as { markPoint?: { data: unknown[] } }[])[0]?.markPoint?.data;
    expect(markPoint).toEqual([
      {
        coord: [1, 25],
        symbol: 'triangle',
        symbolSize: 8,
        itemStyle: { color: 'chart-other' },
        name: 'Check failed',
      },
    ]);
  });
});
