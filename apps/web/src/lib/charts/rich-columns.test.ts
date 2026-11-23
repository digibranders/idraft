import { describe, expect, it, vi } from 'vitest';

import { columns3dOption, columnsCeiling, labelWidth, type ColumnItem } from './rich-columns';
import type { ChartTokens } from '@/lib/design/read-tokens';

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
  // A stand-in named after its token: the builder only passes colours through
  named: (name) => name,
};

const own: ColumnItem = { id: 'own', name: 'Northwind (you)', value: 0.26, token: 'chart-1', valueText: '26%', own: true, tip: '26%, 29 of 65' };
const hubspot: ColumnItem = { id: 'hub', name: 'HubSpot', value: 0.25, token: 'chart-2', valueText: '25%', own: false, tip: '25%, 28 of 65' };
const zoho: ColumnItem = { id: 'none', name: 'Zoho', value: null, token: 'chart-3', valueText: 'n/a', own: false, tip: 'No share' };
const ITEMS: ColumnItem[] = [own, hubspot, zoho];

interface Child {
  type: string;
  style?: { text?: string };
  shape?: { points: number[][] };
}

/** Runs the renderer of the custom series for one datum against a plain coordinate system. */
function render(index: number): Child[] {
  const option = columns3dOption({ items: ITEMS, tokens: TOKENS, width: 400 }) as { series: { renderItem: (...args: unknown[]) => { children: Child[] } }[] };
  const value = ITEMS[index]?.value ?? 0;
  const api = {
    value: (dimension: number) => (dimension === 0 ? index : value),
    coord: ([column, ratio]: [number, number]) => [50 + column * 100, 200 - ratio * 200],
    size: () => [100, 0],
  };
  return option.series[0]?.renderItem({ dataIndex: index }, api).children ?? [];
}

describe('columnsCeiling', () => {
  it('tops out at the next quarter above the tallest column, never above 100%', () => {
    expect(columnsCeiling(ITEMS)).toBe(0.5);
    expect(columnsCeiling([{ ...own, value: 0.97 }])).toBe(1);
    expect(columnsCeiling([{ ...own, value: null }])).toBe(0.25);
  });
});

describe('labelWidth', () => {
  it('gives each name the width of its column less a gap, so a long name is cut instead of running into the next', () => {
    // (400 - 44 - 24) / 3 columns - 4
    expect(labelWidth(3, 400)).toBeCloseTo(106.67, 1);
    expect(labelWidth(40, 400)).toBe(32);
  });

  it('leaves the width open until the chart has been measured', () => {
    expect(labelWidth(3, 0)).toBeUndefined();
  });
});

describe('columns3dOption', () => {
  it('draws one column per item as a custom series on a ratio axis', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const option = columns3dOption({ items: ITEMS, tokens: TOKENS, width: 400 }) as Record<string, unknown>;
    vi.unstubAllGlobals();
    expect(option).toMatchObject({
      animation: true,
      xAxis: { data: ['Northwind\n(you)', 'HubSpot', 'Zoho'] },
      yAxis: { min: 0, max: 0.5 },
      series: [{ type: 'custom', data: [[0, 0.26], [1, 0.25], [2, 0]] }],
    });
  });

  it('draws three faces and the value above the column', () => {
    const drawn = render(0);
    expect(drawn.filter((child) => child.type === 'polygon')).toHaveLength(3);
    expect(drawn.find((child) => child.type === 'text')?.style?.text).toBe('26%');
  });

  it('draws a brand with no share as a flat slab with no number', () => {
    const slab = render(2);
    expect(slab.find((child) => child.type === 'text')?.style?.text).toBe('');
    // The front face (its third corner is the right end of the baseline) is 3 px tall: from the baseline at 200 up to 197
    const front = slab.find((child) => child.type === 'polygon' && child.shape?.points[2]?.[1] === 200 && child.shape.points[2][0] === 275);
    expect(front?.shape?.points[0]?.[1]).toBe(197);
  });

  it('says the figure of a column in its tooltip, escaped', () => {
    const option = columns3dOption({ items: [{ ...hubspot, name: '<b>Hub</b>', tip: 'a & b' }], tokens: TOKENS, width: 400 }) as { tooltip: { formatter: (param: { dataIndex: number }) => string } };
    const html = option.tooltip.formatter({ dataIndex: 0 });
    expect(html).toContain('&#60;b&#62;Hub&#60;/b&#62;');
    expect(html).toContain('a &#38; b');
    expect(option.tooltip.formatter({ dataIndex: 9 })).toBe('');
  });
});
