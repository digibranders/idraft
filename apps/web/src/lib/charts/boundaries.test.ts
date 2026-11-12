import { describe, expect, it } from 'vitest';

import { boundaryMarkLines } from './boundaries';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tokens: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

const categories = ['Oct 12', 'Oct 19', 'Oct 26'];

interface MarkLineDatum {
  xAxis: string;
  lineStyle: { type: string; width: number; color: string };
  label: { formatter: (params: unknown) => string; color: string; fontSize: number; fontWeight: number };
}
interface BoundarySeries {
  type: string;
  data: unknown[];
  silent: boolean;
  tooltip: { show: boolean };
  markLine: { silent: boolean; symbol: string; animation: boolean; data: MarkLineDatum[] };
}

const build = (boundaries: Parameters<typeof boundaryMarkLines>[0]): BoundarySeries | null =>
  boundaryMarkLines(boundaries, categories, tokens) as BoundarySeries | null;

describe('boundaryMarkLines', () => {
  it('draws one dashed vertical line for each boundary, on its category', () => {
    const series = build([
      { at: 'Oct 19', label: 'Extractor v4' },
      { at: 'Oct 26', label: 'hubspot.com added' },
    ]);
    expect(series?.markLine.data.map((datum) => datum.xAxis)).toEqual(['Oct 19', 'Oct 26']);
    for (const datum of series?.markLine.data ?? []) {
      expect(datum.lineStyle).toEqual({ type: 'dashed', width: 1, color: '#muted' });
    }
  });

  it('labels the line at the top in 12 px weight 500 in the label colour', () => {
    const [datum] = build([{ at: 'Oct 19', label: 'Extractor v4' }])?.markLine.data ?? [];
    expect(datum?.label).toMatchObject({ show: true, position: 'end', color: '#label', fontSize: 12, fontWeight: 500 });
    expect(datum?.label.formatter({})).toBe('Extractor v4');
  });

  it('never reads a label as an ECharts template', () => {
    const [datum] = build([{ at: 'Oct 19', label: '{a} and {b}: {c}' }])?.markLine.data ?? [];
    expect(datum?.label.formatter({ seriesName: 'x', value: 1 })).toBe('{a} and {b}: {c}');
  });

  it('is a line series with no data that takes no hover and is not in the tooltip', () => {
    const series = build([{ at: 'Oct 19', label: 'Extractor v4' }]);
    expect(series).toMatchObject({
      type: 'line',
      data: [],
      silent: true,
      tooltip: { show: false },
      markLine: { silent: true, symbol: 'none', animation: false },
    });
  });

  it('drops a boundary that is not a category of the axis, so it is never drawn in the wrong place', () => {
    const series = build([
      { at: 'Sep 01', label: 'Before the window' },
      { at: 'Oct 26', label: 'Extractor v4' },
    ]);
    expect(series?.markLine.data.map((datum) => datum.xAxis)).toEqual(['Oct 26']);
  });

  it('gives null for no boundary, and for none that is on the axis', () => {
    expect(build([])).toBeNull();
    expect(build([{ at: 'Sep 01', label: 'Before the window' }])).toBeNull();
  });
});
