import { describe, expect, it } from 'vitest';

import { categoryChartOption, seriesColor, seriesColorVar, type CategorySeries } from './category-chart';
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
  fontFamily: 'GeistSans',
};

const SERIES: CategorySeries[] = [
  { id: 'own', name: 'You', role: { kind: 'brand' }, values: [10, null, 30] },
  { id: 'hubspot', name: 'hubspot.com', role: { kind: 'palette', index: 3 }, values: [5, 6, 7] },
  { id: 'previous', name: 'Previous period', role: { kind: 'reference' }, values: [8, 9, 10] },
];

const option = (kind: 'line' | 'bar', hidden: ReadonlySet<string> = new Set()): Record<string, unknown> =>
  categoryChartOption({
    kind,
    categories: ['Jul', 'Aug', 'Sep'],
    series: SERIES,
    hidden,
    patterns: false,
    tokens: TOKENS,
    formatValue: (value) => String(value),
  });

describe('categoryChartOption', () => {
  it('draws without animation, inside the fixed grid padding', () => {
    expect(option('line')).toMatchObject({
      animation: false,
      grid: { right: 16, top: 8 },
    });
  });

  it('makes room for the axis labels whatever their width, so a label of five digits is not cut at the edge', () => {
    // The padding is the outer edge of the labels: the chart shrinks its plot until they fit inside it
    expect(option('line').grid).toMatchObject({ outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' });
    expect(option('bar').grid).toMatchObject({ outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' });
  });

  it('colours series by role, dashes the reference, keeps gaps, and leaves hidden series out', () => {
    const series = option('line', new Set(['hubspot'])).series as Record<string, unknown>[];
    expect(series.map((entry) => entry.id)).toEqual(['own', 'previous']);
    expect(series[0]).toMatchObject({ color: 'chart-1', data: [10, null, 30], connectNulls: false, symbol: 'circle' });
    expect(series[1]).toMatchObject({ color: 'chart-reference', lineStyle: { type: [4, 4] } });
  });

  it('caps bars at 24 px', () => {
    const [first] = option('bar').series as Record<string, unknown>[];
    expect(first).toMatchObject({ type: 'bar', barMaxWidth: 24 });
  });

  it('stacks bars into one column per category, rounding only the top of each', () => {
    const stacked = categoryChartOption({
      kind: 'bar',
      stacked: true,
      categories: ['Oct 1', 'Oct 2'],
      series: [
        { id: 'a', name: 'A', role: { kind: 'palette', index: 2 }, values: [1, 2] },
        { id: 'b', name: 'B', role: { kind: 'palette', index: 3 }, values: [3, 4] },
      ],
      hidden: new Set(),
      patterns: false,
      tokens: TOKENS,
      formatValue: String,
    });
    expect(stacked.series).toMatchObject([
      { stack: 'total', itemStyle: { borderRadius: [0, 0, 0, 0] } },
      { stack: 'total', itemStyle: { borderRadius: [2, 2, 0, 0] } },
    ]);
  });

  it('rounds the top of the last series that is shown when a stacked series is hidden', () => {
    const stacked = categoryChartOption({
      kind: 'bar',
      stacked: true,
      categories: ['Oct 1'],
      series: [
        { id: 'a', name: 'A', role: { kind: 'palette', index: 2 }, values: [1] },
        { id: 'b', name: 'B', role: { kind: 'palette', index: 3 }, values: [3] },
      ],
      hidden: new Set(['b']),
      patterns: false,
      tokens: TOKENS,
      formatValue: String,
    });
    expect(stacked.series).toMatchObject([{ id: 'a', stack: 'total', itemStyle: { borderRadius: [2, 2, 0, 0] } }]);
  });

  it('leaves bars side by side and each rounded when not stacked', () => {
    expect(option('bar').series).toMatchObject([
      { itemStyle: { borderRadius: [2, 2, 0, 0] } },
      { itemStyle: { borderRadius: [2, 2, 0, 0] } },
      { itemStyle: { borderRadius: [2, 2, 0, 0] } },
    ]);
    expect(option('bar').series).not.toContainEqual(expect.objectContaining({ stack: expect.anything() }));
  });
});

describe('series colours', () => {
  it('give the brand chart-1 and a competitor its stored index', () => {
    expect(seriesColor({ kind: 'palette', index: 3 }, TOKENS)).toBe('chart-3');
    expect(seriesColorVar({ kind: 'brand' })).toBe('var(--chart-1)');
    expect(seriesColorVar({ kind: 'other' })).toBe('var(--chart-other)');
  });
});
