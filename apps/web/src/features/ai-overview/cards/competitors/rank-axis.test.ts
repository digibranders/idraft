import { describe, expect, it } from 'vitest';

import { rankAxisOption, type RankTip } from './rank-axis';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tokens: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Geist',
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

/** The base option of a line chart over three weeks, as `categoryChartOption` builds it. */
const base = (): Record<string, unknown> => ({
  xAxis: { type: 'category', data: ['Oct 26', 'Nov 2', 'Nov 9'] },
  yAxis: { type: 'value', axisLabel: { color: '#label', formatter: (value: number) => `base ${String(value)}` } },
  tooltip: { trigger: 'axis', confine: true, formatter: () => 'base' },
  series: [
    { id: 'own', name: 'Fynix', type: 'line', color: '#c1', data: [1, 2, null] },
    { id: 'hub', name: 'HubSpot', type: 'line', color: '#c2', data: [2, 2, null] },
    { id: 'zoho', name: 'Zoho', type: 'line', color: '#c3', data: [3, 1, null] },
  ],
});

const tips: RankTip[] = [
  {
    title: 'Oct 26',
    rows: [
      { seriesId: 'zoho', rank: 3, text: 'Rank 3, 10%' },
      { seriesId: 'own', rank: 1, text: 'Rank 1, 50%' },
      { seriesId: 'hub', rank: 2, text: 'Rank 2, 40%' },
    ],
    footer: '412 answers naming a tracked brand',
  },
  {
    title: 'Nov 2',
    rows: [
      { seriesId: 'hub', rank: 2, text: 'Rank 2, 30%' },
      { seriesId: 'own', rank: 2, text: 'Rank 2, 30%' },
      { seriesId: 'zoho', rank: 1, text: 'Rank 1, 40%' },
    ],
    footer: null,
  },
  { title: 'Nov 9', rows: [], footer: 'Too few answers <b>name</b> a tracked brand (2)' },
];

const text = (html: unknown): string =>
  String(html)
    .replace(/<[^>]+>/g, '|')
    .replace(/\|+/g, '|')
    .replace(/^\||\|$/g, '');
const yAxisOf = (option: Record<string, unknown>): Record<string, unknown> => option.yAxis as Record<string, unknown>;
const formatterOf = (option: Record<string, unknown>): ((params: unknown) => string) =>
  (option.tooltip as { formatter: (params: unknown) => string }).formatter;

describe('the rank axis of the share of voice rank card', () => {
  it('is inverted, whole numbers from 1 to the highest rank drawn, with no SERP guide lines', () => {
    const option = rankAxisOption(base(), tokens, { maxRank: 6, tips, boundaries: [] });
    const y = yAxisOf(option);
    expect(y).toMatchObject({ inverse: true, min: 1, max: 6, interval: 1, minInterval: 1 });
    const labelFormatter = (y.axisLabel as { formatter: (value: number) => string }).formatter;
    expect(labelFormatter(3)).toBe('3');
    const series = option.series as { markLine?: unknown; markArea?: unknown }[];
    expect(series).toHaveLength(3);
    for (const entry of series) {
      expect(entry.markLine).toBeUndefined();
      expect(entry.markArea).toBeUndefined();
    }
  });

  it('keeps at least two ranks on the axis so that a single rank has a range', () => {
    expect(yAxisOf(rankAxisOption(base(), tokens, { maxRank: 1, tips, boundaries: [] }))).toMatchObject({ max: 2 });
  });

  it('adds one dashed boundary line on a week that is on the axis and drops one that is not', () => {
    const option = rankAxisOption(base(), tokens, {
      maxRank: 3,
      tips,
      boundaries: [
        { at: 'Nov 2', label: 'Zoho added' },
        { at: 'Sep 1', label: 'Gone added' },
      ],
    });
    const series = option.series as { id?: string; markLine?: { data: { xAxis: string }[] } }[];
    expect(series).toHaveLength(4);
    expect(series[3]?.markLine?.data.map((entry) => entry.xAxis)).toEqual(['Nov 2']);
  });

  it('lists the best rank first in the tooltip, ties side by side, and ends with the footer', () => {
    const formatter = formatterOf(rankAxisOption(base(), tokens, { maxRank: 3, tips, boundaries: [] }));
    expect(text(formatter([{ dataIndex: 0 }]))).toBe(
      'Oct 26|Fynix|Rank 1, 50%|HubSpot|Rank 2, 40%|Zoho|Rank 3, 10%|412 answers naming a tracked brand',
    );
    const tied = text(formatter([{ dataIndex: 1 }]));
    expect(tied.indexOf('Zoho')).toBeLessThan(tied.indexOf('HubSpot'));
    expect(tied.indexOf('HubSpot')).toBeLessThan(tied.indexOf('Fynix'));
  });

  it('says a week with no rank in words, as a title and a footer, and never as a rank', () => {
    const formatter = formatterOf(rankAxisOption(base(), tokens, { maxRank: 3, tips, boundaries: [] }));
    const html = formatter([{ dataIndex: 2 }]);
    expect(text(html)).toContain('Too few answers');
    expect(text(html)).not.toMatch(/Rank \d/);
    // A string from the data is never markup
    expect(html).not.toContain('<b>');
  });

  it('leaves the series it was given as they were', () => {
    const input = base();
    const option = rankAxisOption(input, tokens, { maxRank: 3, tips, boundaries: [] });
    expect((option.series as { id: string }[]).map((entry) => entry.id)).toEqual(['own', 'hub', 'zoho']);
    expect(yAxisOf(input)).not.toHaveProperty('inverse');
  });
});
