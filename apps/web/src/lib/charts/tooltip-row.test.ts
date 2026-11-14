import { describe, expect, it } from 'vitest';

import { rateBandOption, type RateBandPoint } from './rate-band-chart';
import { tipRowHtml, tipTitleHtml } from './tooltip-row';
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

describe('tipRowHtml', () => {
  it('draws an 8 px dot in the given colour, the name in the secondary colour and the value right-aligned', () => {
    const html = tipRowHtml('#c1', 'ChatGPT', '34.0%', tokens);
    expect(html).toContain('width:8px;height:8px;border-radius:50%;background:#c1');
    expect(html).toContain('<span style="color:#fg2">ChatGPT</span>');
    expect(html).toContain('<span style="margin-left:auto;font-variant-numeric:tabular-nums">34.0%</span>');
  });

  it('escapes the name, the value and the colour', () => {
    const html = tipRowHtml('red"><i>', '<b>Name</b>', '<b>9</b>', tokens);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&#60;b&#62;Name&#60;/b&#62;');
    expect(html).toContain('&#60;b&#62;9&#60;/b&#62;');
  });

  it('is the row the rate band tooltip already writes', () => {
    const points: Record<string, readonly (RateBandPoint | null)[]> = {
      a: [{ value: 0.5, band: null, tip: '50%, 5 of 10 answers', thin: false }],
    };
    const option = rateBandOption(
      {
        xAxis: { type: 'category', data: ['Oct 12'] },
        yAxis: { type: 'value' },
        tooltip: { trigger: 'axis' },
        series: [{ id: 'a', name: 'ChatGPT', type: 'line', data: [0.5], color: '#c1' }],
      },
      tokens,
      { points, ceiling: 0.9, dark: false },
    );
    const formatter = (option.tooltip as { formatter: (params: unknown[]) => string }).formatter;
    expect(formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }])).toContain(
      tipRowHtml('#c1', 'ChatGPT', '50%, 5 of 10 answers', tokens),
    );
  });
});

describe('tipTitleHtml', () => {
  it('writes the title in 14 px semibold and escapes it', () => {
    expect(tipTitleHtml('Oct <12>')).toBe(
      '<div style="font-size:14px;line-height:20px;font-weight:600;margin-bottom:4px">Oct &#60;12&#62;</div>',
    );
  });
});
