import { describe, expect, it } from 'vitest';

import { rankStats } from './rank-stats';
import type { HistoryPoint } from '@/lib/api/types';

function point(date: string, state: HistoryPoint['state'], rank: number | null): HistoryPoint {
  return {
    date,
    observed_at: `${date}T02:00:00Z`,
    state,
    rank,
    depth_requested: 20,
    url_id: null,
    serp_snapshot_id: null,
    absolute_rank: rank,
  };
}

describe('rankStats', () => {
  it('counts best, worst, median and the days in the top 10 over non-failed checks', () => {
    const points = [
      point('2026-10-01', 'ranked', 12),
      point('2026-10-02', 'ranked', 8),
      point('2026-10-02', 'ranked', 9),
      point('2026-10-03', 'beyond_depth', null),
      point('2026-10-04', 'failed', null),
      point('2026-10-05', 'ranked', 3),
    ];
    expect(rankStats(points)).toEqual({
      best: 3,
      worst: 12,
      median: 8.5,
      ranked: 4,
      checks: 5,
      topTenDays: 2,
      daysChecked: 4,
    });
  });

  it('is all null and zero without points', () => {
    expect(rankStats([])).toEqual({
      best: null,
      worst: null,
      median: null,
      ranked: 0,
      checks: 0,
      topTenDays: 0,
      daysChecked: 0,
    });
  });

  it('takes the middle rank of an odd count as the median', () => {
    const points = [
      point('2026-10-01', 'ranked', 30),
      point('2026-10-02', 'ranked', 4),
      point('2026-10-03', 'ranked', 7),
    ];
    expect(rankStats(points).median).toBe(7);
  });

  it('counts rank 10 in the top 10 and rank 11 not', () => {
    const points = [point('2026-10-01', 'ranked', 10), point('2026-10-02', 'ranked', 11)];
    expect(rankStats(points)).toMatchObject({ topTenDays: 1, daysChecked: 2 });
  });

  it('counts a day once however many of its checks are in the top 10', () => {
    const points = [
      point('2026-10-01', 'ranked', 2),
      point('2026-10-01', 'ranked', 3),
      point('2026-10-01', 'ranked', 40),
    ];
    expect(rankStats(points)).toMatchObject({ topTenDays: 1, daysChecked: 1, ranked: 3, checks: 3 });
  });

  it('has no best, worst or median for a keyword that never ranked, but still counts its checks', () => {
    const points = [point('2026-10-01', 'beyond_depth', null), point('2026-10-02', 'failed', null)];
    expect(rankStats(points)).toEqual({
      best: null,
      worst: null,
      median: null,
      ranked: 0,
      checks: 1,
      topTenDays: 0,
      daysChecked: 1,
    });
  });
});
