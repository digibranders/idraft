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
      grid: { left: 40, right: 16, top: 8, bottom: 24, outerBoundsMode: 'none' },
    });
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
});

describe('series colours', () => {
  it('give the brand chart-1 and a competitor its stored index', () => {
    expect(seriesColor({ kind: 'palette', index: 3 }, TOKENS)).toBe('chart-3');
    expect(seriesColorVar({ kind: 'brand' })).toBe('var(--chart-1)');
    expect(seriesColorVar({ kind: 'other' })).toBe('var(--chart-other)');
  });
});
