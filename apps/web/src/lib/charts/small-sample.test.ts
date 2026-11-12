import { describe, expect, it } from 'vitest';

import { SMALL_SAMPLE_SIZE, smallSamplePoint } from './small-sample';
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

describe('smallSamplePoint', () => {
  it('is a hollow 5 px point in the marker shape of its series', () => {
    expect(SMALL_SAMPLE_SIZE).toBe(5);
    expect(smallSamplePoint(0.5, 'rect', '#c2', tokens)).toEqual({
      value: 0.5,
      symbol: 'rect',
      symbolSize: 5,
      itemStyle: { color: '#elevated', borderColor: '#c2', borderWidth: 2 },
    });
  });
});
