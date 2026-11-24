import { describe, expect, it } from 'vitest';

import { stackedColumnsOption, type StackedRow, type StackedSegment } from './rich-stacked';
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
  named: (name) => name,
};

const SEGMENTS: StackedSegment[] = [
  { id: 'first', name: 'Mentioned first', token: 'seq-6' },
  { id: 'later', name: 'Fourth or later', token: 'chart-bar-neutral' },
];
const ROWS: StackedRow[] = [
  { id: 'chatgpt', label: 'ChatGPT', note: 'mean 1.4', shares: [0.7, 0.3], tips: ['Mentioned first: 70%, 7 of 10', 'Fourth or later: 30%, 3 of 10'] },
  { id: 'gemini', label: 'Gemini', note: '', shares: null, tips: [] },
];

interface BarSeries {
  type: string;
  stack: string;
  data: (number | null)[];
  itemStyle: { color: { type: string }; borderRadius: number };
}

const optionOf = (rows: StackedRow[] = ROWS): { xAxis: { data: string[] }; series: BarSeries[]; tooltip: { formatter: (param: object) => string } } =>
  stackedColumnsOption({ rows, segments: SEGMENTS, tokens: TOKENS }) as ReturnType<typeof optionOf>;

describe('stackedColumnsOption', () => {
  it('names each column with its note under it, and a column without a note by its name alone', () => {
    expect(optionOf().xAxis.data).toEqual(['ChatGPT\nmean 1.4', 'Gemini']);
  });

  it('draws one rounded, faded segment per outcome on a shared stack, and no datum for a row with nothing to show', () => {
    const { series } = optionOf();
    expect(series).toHaveLength(2);
    expect(series.map((entry) => entry.stack)).toEqual(['share', 'share']);
    expect(series.map((entry) => entry.data)).toEqual([[0.7, null], [0.3, null]]);
    expect(series[0]?.itemStyle).toMatchObject({ borderRadius: 6, color: { type: 'linear' } });
  });

  it('says the segment under the pointer in its tooltip, escaped, and nothing for a mark it does not know', () => {
    const { tooltip } = optionOf([{ ...ROWS[0] as StackedRow, label: '<b>Chat</b>', tips: ['a & b', 'c'] }]);
    const html = tooltip.formatter({ dataIndex: 0, seriesIndex: 0 });
    expect(html).toContain('&#60;b&#62;Chat&#60;/b&#62;');
    expect(html).toContain('Mentioned first');
    expect(html).toContain('a &#38; b');
    expect(tooltip.formatter({ dataIndex: 5, seriesIndex: 0 })).toBe('');
  });
});
