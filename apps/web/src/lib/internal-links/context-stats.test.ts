import { describe, expect, it } from 'vitest';

import { contextStats } from './context-stats';
import type { TierStat } from './types';

const row = (position: number | null, pages: number, depth: number | null): TierStat => ({
  tier:
    position === null
      ? null
      : { tier_id: `00000000-0000-4000-8000-00000000000${String(position)}`, code: `T${String(position)}`, name: 'x' },
  pages,
  equity_share: 0,
  average_depth: depth,
});

describe('contextStats', () => {
  it('counts tiered pages, T1 pages and their average depth', () => {
    const stats = contextStats({
      tiers: [row(1, 10, 1.34), row(2, 20, 2), row(3, 30, 3), row(4, 5, 4), row(null, 35, null)],
      noEditorial: 7,
      lostToTop: 3,
    });
    expect(stats.tiered).toEqual({ tiered: 65, total: 100, untiered: 35 });
    expect(stats.t1Pages).toBe(10);
    expect(stats.t1Depth).toBe(1.34);
    expect(stats.noEditorial).toBe(7);
    expect(stats.lost).toBe(3);
  });

  it('leaves the lost figure out when there is none, and the depth when T1 has no pages', () => {
    const stats = contextStats({ tiers: [row(1, 0, null), row(2, 4, 2)], noEditorial: 0, lostToTop: 0 });
    expect(stats.lost).toBeNull();
    expect(stats.t1Depth).toBeNull();
    expect(stats.t1Pages).toBe(0);
  });

  it('reads no T1 row as no T1 pages', () => {
    const stats = contextStats({ tiers: [row(null, 3, null)], noEditorial: 1, lostToTop: 0 });
    expect(stats.t1Pages).toBe(0);
    expect(stats.t1Depth).toBeNull();
    expect(stats.tiered).toEqual({ tiered: 0, total: 3, untiered: 3 });
  });
});
