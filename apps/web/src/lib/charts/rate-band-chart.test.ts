import { describe, expect, it } from 'vitest';

import { rateBandOption, type RateBandPoint } from './rate-band-chart';
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

interface SeriesOut {
  id: string;
  type: string;
  data: unknown[];
  stack?: string;
  areaStyle?: { color: string; opacity: number };
  silent?: boolean;
  lineStyle?: { opacity?: number };
}

/** The base option of a line chart over three weeks with two engines, as `categoryChartOption` builds it. */
const base = (ids: readonly string[] = ['a', 'b']): Record<string, unknown> => ({
  yAxis: { type: 'value', axisLabel: { formatter: String } },
  tooltip: { trigger: 'axis', formatter: () => 'base' },
  series: ids.map((id, index) => ({
    id,
    name: `Engine ${id}`,
    type: 'line',
    // The marker shape of the engine, which tells the series apart without colour
    symbol: id === 'b' ? 'rect' : 'circle',
    color: tokens.palette[index],
    data: id === 'b' ? [0.5, null, null] : [0.5, 0.75, null],
  })),
});

const point = (value: number | null, band: [number, number] | null, thin = false, tip = ''): RateBandPoint => ({
  value,
  band: band === null ? null : { low: band[0], high: band[1] },
  thin,
  tip,
});

const seriesOf = (option: Record<string, unknown>): SeriesOut[] => option.series as SeriesOut[];

describe('the rate chart with its Wilson bands', () => {
  const points = {
    a: [point(0.5, [0.25, 0.75], false, '50% (4 of 8)'), point(0.75, [0.5, 0.9]), null],
    b: [point(0.5, null, true, '50% (1 of 2)'), point(null, null), null],
  };

  it('fixes the rate axis from 0 to its ceiling', () => {
    const option = rateBandOption(base(), tokens, { points, ceiling: 0.9, dark: false });
    expect(option.yAxis).toMatchObject({ min: 0, max: 0.9 });
  });

  it('adds a stacked pair of series for each engine that has a band, in the colour of the engine', () => {
    const series = seriesOf(rateBandOption(base(), tokens, { points, ceiling: 0.9, dark: false }));
    const band = series.filter((entry) => entry.id.includes(':band'));
    expect(band.map((entry) => entry.id)).toEqual(['a:band-low', 'a:band']);
    const [low, span] = band;
    expect(low?.stack).toBe('a:band');
    expect(span?.stack).toBe('a:band');
    expect(low?.data).toEqual([0.25, 0.5, null]);
    expect(span?.data).toEqual([0.5, 0.4, null]);
    expect(span?.areaStyle).toEqual({ color: '#c1', opacity: 0.12 });
    // Only the band's fill is seen: its edges are not lines, and it takes no hover
    expect(span?.lineStyle).toEqual({ opacity: 0 });
    expect(span?.silent).toBe(true);
  });

  it('draws the band at 18 percent in the dark theme', () => {
    const series = seriesOf(rateBandOption(base(), tokens, { points, ceiling: 0.9, dark: true }));
    expect(series.find((entry) => entry.id === 'a:band')?.areaStyle?.opacity).toBe(0.18);
  });

  it('draws a week with too few answers as a hollow point, and leaves the others plain', () => {
    const series = seriesOf(rateBandOption(base(), tokens, { points, ceiling: 0.9, dark: false }));
    const [first] = series.filter((entry) => entry.id === 'b');
    expect(first?.data[0]).toMatchObject({
      value: 0.5,
      // Hollow, and still the marker shape of its engine
      symbol: 'rect',
      symbolSize: 5,
      itemStyle: { color: '#elevated', borderColor: '#c2', borderWidth: 2 },
    });
    expect(first?.data[1]).toBeNull();
    expect(series.find((entry) => entry.id === 'a')?.data).toEqual([0.5, 0.75, null]);
  });

  it('adds no band for an engine the legend has turned off', () => {
    const series = seriesOf(rateBandOption(base(['b']), tokens, { points, ceiling: 0.9, dark: false }));
    expect(series.map((entry) => entry.id)).toEqual(['b']);
  });

  it('says in the tooltip, for each shown engine, the counts of the week', () => {
    const option = rateBandOption(base(), tokens, { points, ceiling: 0.9, dark: false });
    const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
    const html = formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }]);
    expect(html).toContain('Oct 12');
    expect(html).toContain('Engine a');
    expect(html).toContain('50% (4 of 8)');
    expect(html).toContain('Engine b');
    expect(html).toContain('50% (1 of 2)');
    // A week an engine has no point for names no value for it
    const gap = formatter([{ dataIndex: 2, axisValueLabel: 'Oct 26' }]);
    expect(gap).toContain('Oct 26');
    expect(gap).not.toContain('Engine a');
  });

  it('titles the tooltip with the words a caller gives for the point, else with the category', () => {
    const option = rateBandOption(base(), tokens, {
      points,
      ceiling: 0.9,
      dark: false,
      titles: ['4 weeks to Oct 12'],
    });
    const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
    expect(formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }])).toContain('4 weeks to Oct 12');
    expect(formatter([{ dataIndex: 1, axisValueLabel: 'Oct 19' }])).toContain('Oct 19');
  });

  it('lists the engines of the week by value, the highest first', () => {
    const option = rateBandOption(base(), tokens, {
      points: { a: [point(0.25, null, false, 'LOW')], b: [point(0.75, null, false, 'HIGH')] },
      ceiling: 0.9,
      dark: false,
    });
    const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
    const html = formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }]);
    expect(html.indexOf('HIGH')).toBeGreaterThan(-1);
    expect(html.indexOf('HIGH')).toBeLessThan(html.indexOf('LOW'));
  });

  it('keeps the option as it was without a previous series or boundaries: the same series and the same tooltip markup', () => {
    const option = rateBandOption(base(), tokens, { points, ceiling: 0.9, dark: false });
    expect(seriesOf(option).map((entry) => entry.id)).toEqual(['a', 'b', 'a:band-low', 'a:band']);
    const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
    const dot = (color: string): string =>
      `<span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>`;
    expect(formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }])).toBe(
      '<div style="font-size:14px;line-height:20px;font-weight:600;margin-bottom:4px">Oct 12</div>' +
        `<div style="display:flex;gap:8px;align-items:center">${dot('#c1')}<span style="color:#fg2">Engine a</span><span style="margin-left:auto;font-variant-numeric:tabular-nums">50% (4 of 8)</span></div>` +
        `<div style="display:flex;gap:8px;align-items:center">${dot('#c2')}<span style="color:#fg2">Engine b</span><span style="margin-left:auto;font-variant-numeric:tabular-nums">50% (1 of 2)</span></div>`,
    );
  });

  describe('with a previous period', () => {
    const withPrevious = (ids: readonly string[] = ['a', 'prev']): Record<string, unknown> => ({
      ...base(ids),
      series: ids.map((id, index) => ({
        id,
        name: id === 'prev' ? 'Previous period' : `Engine ${id}`,
        type: 'line',
        color: id === 'prev' ? tokens.reference : tokens.palette[index],
        lineStyle: id === 'prev' ? { type: [4, 4] } : undefined,
        data: [0.5, 0.75, null],
      })),
    });
    const previousPoints = {
      a: [point(0.5, [0.25, 0.75], false, 'A0'), point(0.75, [0.5, 0.9], false, 'A1'), null],
      // A band is in the points of the previous period, and is not to be drawn
      prev: [point(0.9, [0.8, 1], false, 'PREV0'), point(0.1, [0, 0.2], false, 'PREV1'), null],
    };

    it('draws no band for it, however much of a band its points have', () => {
      const series = seriesOf(
        rateBandOption(withPrevious(), tokens, { points: previousPoints, ceiling: 1, dark: false, previousId: 'prev' }),
      );
      expect(series.map((entry) => entry.id)).toEqual(['a', 'prev', 'a:band-low', 'a:band']);
    });

    it('lists it last in the tooltip, whatever its value', () => {
      const option = rateBandOption(withPrevious(), tokens, {
        points: previousPoints,
        ceiling: 1,
        dark: false,
        previousId: 'prev',
      });
      const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
      const high = formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }]);
      expect(high.indexOf('A0')).toBeLessThan(high.indexOf('PREV0'));
      // Its value is lower than the engine's here, and still it comes last
      const low = formatter([{ dataIndex: 1, axisValueLabel: 'Oct 19' }]);
      expect(low.indexOf('A1')).toBeLessThan(low.indexOf('PREV1'));
      expect(low).toContain('Previous period');
    });
  });

  describe('with boundaries', () => {
    const dated = (ids: readonly string[] = ['a', 'b']): Record<string, unknown> => ({
      ...base(ids),
      xAxis: { type: 'category', data: ['Oct 12', 'Oct 19', 'Oct 26'] },
    });

    it('appends one boundary series, last, for the boundaries that are on the axis', () => {
      const series = seriesOf(
        rateBandOption(dated(), tokens, {
          points,
          ceiling: 0.9,
          dark: false,
          boundaries: [
            { at: 'Oct 19', label: 'Extractor v4' },
            { at: 'Sep 01', label: 'Before the window' },
          ],
        }),
      );
      expect(series.map((entry) => entry.id)).toEqual(['a', 'b', 'a:band-low', 'a:band', 'boundaries']);
      expect(series.at(-1)).toMatchObject({
        silent: true,
        markLine: { data: [{ xAxis: 'Oct 19', lineStyle: { color: '#muted' } }] },
      });
    });

    it('adds nothing when no boundary is on the axis, or the option has no categories', () => {
      const none = rateBandOption(dated(), tokens, {
        points,
        ceiling: 0.9,
        dark: false,
        boundaries: [{ at: 'Sep 01', label: 'Before the window' }],
      });
      expect(seriesOf(none).map((entry) => entry.id)).toEqual(['a', 'b', 'a:band-low', 'a:band']);
      const bare = rateBandOption(base(), tokens, {
        points,
        ceiling: 0.9,
        dark: false,
        boundaries: [{ at: 'Oct 19', label: 'Extractor v4' }],
      });
      expect(seriesOf(bare).map((entry) => entry.id)).toEqual(['a', 'b', 'a:band-low', 'a:band']);
    });
  });

  it('never lets a name reach the tooltip as markup', () => {
    const option = rateBandOption(
      { ...base(['a']), series: [{ id: 'a', name: '<b>x</b>', type: 'line', color: '#c1', data: [0.5] }] },
      tokens,
      { points: { a: [point(0.5, null, false, '<i>50%</i>')] }, ceiling: 0.9, dark: false },
    );
    const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
    const html = formatter([{ dataIndex: 0, axisValueLabel: '<u>Oct</u>' }]);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).not.toContain('<u>');
  });
});
