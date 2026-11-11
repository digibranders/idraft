import { describe, expect, it } from 'vitest';

import { gscTrendOf, sumBuckets, trendDirection } from './gsc-trend';

describe('trendDirection', () => {
  it('compares the first three buckets with the last three, leaving the middle one out', () => {
    expect(trendDirection([2, 2, 1, 99, 3, 3, 1], 'clicks')).toEqual({
      direction: 'up',
      earlier: 5,
      later: 7,
      percent: 40,
    });
  });

  it('calls a fall of 20 percent or more down', () => {
    expect(trendDirection([4, 3, 3, 0, 3, 3, 2], 'clicks')).toMatchObject({ direction: 'down', percent: 20 });
  });

  it('calls a move under 20 percent either way flat', () => {
    expect(trendDirection([4, 3, 3, 0, 4, 3, 4], 'clicks')).toMatchObject({ direction: 'flat', percent: 10 });
  });

  it('calls a rise of exactly 20 percent up', () => {
    expect(trendDirection([5, 5, 10, 0, 8, 8, 8], 'impressions')).toMatchObject({ direction: 'up', percent: 20 });
  });

  it('has too few clicks under 5 in the two halves, and too few impressions under 20', () => {
    expect(trendDirection([0, 1, 0, 9, 2, 1, 0], 'clicks')).toMatchObject({ direction: 'insufficient', percent: null });
    expect(trendDirection([1, 1, 1, 0, 1, 1, 1], 'clicks').direction).toBe('flat');
    expect(trendDirection([3, 3, 3, 0, 3, 3, 4], 'impressions').direction).toBe('insufficient');
    expect(trendDirection([0, 0, 0, 0, 0, 0, 0], 'clicks').direction).toBe('insufficient');
  });

  it('calls a rise from nothing up, with no percent', () => {
    expect(trendDirection([0, 0, 0, 0, 2, 2, 2], 'clicks')).toEqual({
      direction: 'up',
      earlier: 0,
      later: 6,
      percent: null,
    });
  });
});

describe('gscTrendOf', () => {
  const trend = { bucket_days: 4, clicks: [1, 2, 3, 4, 5, 6, 7], impressions: [7, 6, 5, 4, 3, 2, 1] };
  const window = { start: '2026-10-07', end: '2026-11-03' };
  const counts = { desktop: 28, mobile: 0 };

  it('reads the buckets of an ok block, and none while pending or not connected', () => {
    const ok = { gsc: { state: 'ok' as const, clicks: counts, impressions: counts, window, trend } };
    expect(gscTrendOf(ok, 'clicks')).toEqual(trend.clicks);
    expect(gscTrendOf(ok, 'impressions')).toEqual(trend.impressions);
    expect(gscTrendOf({ gsc: { state: 'pending' } }, 'clicks')).toBeNull();
    expect(gscTrendOf({ gsc: { state: 'not_connected' } }, 'clicks')).toBeNull();
    expect(gscTrendOf({ gsc: null }, 'clicks')).toBeNull();
  });
});

describe('sumBuckets', () => {
  it('adds series bucket by bucket', () => {
    expect(
      sumBuckets([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([5, 7, 9]);
    expect(sumBuckets([])).toBeNull();
  });
});
