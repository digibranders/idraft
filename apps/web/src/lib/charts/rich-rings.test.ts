import { describe, expect, it } from 'vitest';

import { ringCenterX, ringRadius, ringsOption, type RingRow, type RingSegment } from './rich-rings';
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

const SEGMENTS: RingSegment[] = [
  { id: 'both', name: 'Mentioned and cited', token: 'seq-6' },
  { id: 'neither', name: 'Neither', token: 'chart-bar-neutral' },
];

const ROWS: RingRow[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    shares: [0.4, 0.6],
    tips: ['Mentioned and cited: 40%, 4 of 10', 'Neither: 60%, 6 of 10'],
  },
  { id: 'gemini', label: 'Gemini', shares: null, tips: [] },
];

interface PieSeries {
  type: string;
  center: string[];
  silent?: boolean;
  padAngle?: number;
  data: { name: string; value: number; itemStyle: { color: string } }[];
}

const seriesOf = (rows: RingRow[] = ROWS): PieSeries[] =>
  (ringsOption({ rows, segments: SEGMENTS, tokens: TOKENS, width: 380, height: 176 }) as { series: PieSeries[] })
    .series;

describe('ringCenterX', () => {
  it('puts each centre in the middle of its column', () => {
    expect([0, 1, 2, 3].map((index) => ringCenterX(index, 4))).toEqual(['12.5%', '37.5%', '62.5%', '87.5%']);
  });
});

describe('ringRadius', () => {
  it('shrinks with the number of rings, so the rings of a narrow card do not run into each other', () => {
    // One ring has the 176 px of the canvas height; four have a quarter of 380 px each
    expect(ringRadius(1, 380, 176)).toBeCloseTo(73.92, 2);
    expect(ringRadius(4, 380, 176)).toBeCloseTo(39.9, 1);
  });

  it('is never wider than its column, so neighbouring rings leave a gap', () => {
    for (const count of [2, 3, 4, 5]) expect(ringRadius(count, 380, 176) * 2).toBeLessThan(380 / count);
  });

  it('goes by the height alone until the width is known, and never below 24 px', () => {
    expect(ringRadius(4, 0, 176)).toBeCloseTo(73.92, 2);
    expect(ringRadius(40, 380, 176)).toBe(24);
  });
});

describe('ringsOption', () => {
  it('draws one flat pie per row with a gap between the segments and the colour of each token', () => {
    const [first] = seriesOf();
    expect(first).toMatchObject({ type: 'pie', center: ['25%', '50%'], padAngle: 2 });
    expect(first?.data.map((datum) => [datum.name, datum.value, datum.itemStyle.color])).toEqual([
      ['Mentioned and cited', 0.4, 'seq-6'],
      ['Neither', 0.6, 'chart-bar-neutral'],
    ]);
    expect(JSON.stringify(first)).not.toContain('shadow');
    expect(JSON.stringify(first)).not.toContain('linear');
  });

  it('sets the ring size in px from the width of the canvas', () => {
    const [first] = seriesOf();
    // Four rings in 380 px would each be 95 px wide; here two share it, so each ring can be 2 x 73 px wide at most
    expect((first as unknown as { radius: number[] }).radius).toEqual([
      Math.round(ringRadius(2, 380, 176) * 0.69),
      Math.round(ringRadius(2, 380, 176)),
    ]);
  });

  it('draws a row with no rate as an empty ring that answers no pointer', () => {
    const [, none] = seriesOf();
    expect(none).toMatchObject({ silent: true, center: ['75%', '50%'], data: [{ name: 'Gemini', value: 1 }] });
    expect(none).not.toHaveProperty('padAngle');
  });

  it('says the segment under the pointer in its tooltip, escaped, and nothing for a mark it does not know', () => {
    const rows: RingRow[] = [{ id: 'x', label: '<i>Chat</i>', shares: [0.4, 0.6], tips: ['a & b', 'c'] }];
    const { tooltip } = ringsOption({ rows, segments: SEGMENTS, tokens: TOKENS, width: 380, height: 176 }) as {
      tooltip: { formatter: (param: object) => string };
    };
    const html = tooltip.formatter({ seriesIndex: 0, dataIndex: 0 });
    expect(html).toContain('&#60;i&#62;Chat&#60;/i&#62;');
    expect(html).toContain('Mentioned and cited');
    expect(html).toContain('a &#38; b');
    expect(tooltip.formatter({ seriesIndex: 5, dataIndex: 0 })).toBe('');
  });
});
