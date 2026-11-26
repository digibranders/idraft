import { describe, expect, it } from 'vitest';

import { chartOf } from './series';
import type { SeriesPoint } from './types';

const point = (date: string, clicks: number, impressions: number, position: number | null): SeriesPoint => ({
  date,
  clicks,
  impressions,
  position,
});

const now = [point('2026-10-01', 5, 100, 4.2), point('2026-10-02', 0, 0, null), point('2026-10-03', 3, 60, 5)];
const before = [point('2026-09-01', 2, 50, 6), point('2026-09-02', 1, 20, 7)];

describe('chartOf', () => {
  it('takes the categories from the current period', () => {
    expect(chartOf(now, before, 'clicks').categories).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('keeps clicks and impressions as plain numbers, zero included', () => {
    expect(chartOf(now, before, 'clicks').current).toEqual([5, 0, 3]);
    expect(chartOf(now, before, 'impressions').current).toEqual([100, 0, 60]);
  });

  it('draws a day without impressions as a gap in CTR, never as 0', () => {
    expect(chartOf(now, null, 'ctr').current).toEqual([0.05, null, 0.05]);
  });

  it('passes the position through and leaves a missing one as a gap', () => {
    expect(chartOf(now, null, 'position').current).toEqual([4.2, null, 5]);
  });

  it('aligns the compared period by index and pads it with gaps when it is shorter', () => {
    expect(chartOf(now, before, 'clicks').previous).toEqual([2, 1, null]);
  });

  it('cuts a compared period that is longer than the current one', () => {
    const long = [...before, point('2026-09-03', 9, 90, 3), point('2026-09-04', 8, 80, 3)];
    expect(chartOf(now, long, 'clicks').previous).toEqual([2, 1, 9]);
  });

  it('has no compared series without a comparison', () => {
    expect(chartOf(now, null, 'clicks').previous).toBeNull();
  });

  it('is empty for an empty period', () => {
    expect(chartOf([], null, 'clicks')).toEqual({ categories: [], current: [], previous: null });
  });
});
