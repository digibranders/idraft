import type { HistoryPoint } from '@/lib/api/types';

export interface RankStats {
  best: number | null;
  worst: number | null;
  median: number | null;
  /** Checks that found the site within the depth. */
  ranked: number;
  /** Checks that did not fail: ranked plus beyond depth. */
  checks: number;
  /** Local days with at least one check at rank 10 or better. */
  topTenDays: number;
  /** Local days with at least one check that did not fail. */
  daysChecked: number;
}

const TOP = 10;

function medianOf(sorted: readonly number[]): number | null {
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  if (high === undefined) return null;
  const low = sorted[middle - 1];
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
}

/**
 * What the own site's checks of a window add up to. Failed checks say nothing about the rank and are left
 * out of every number; the days are the checks' local `date`s, so a day with two checks counts once.
 */
export function rankStats(points: readonly HistoryPoint[]): RankStats {
  const checked = points.filter((point) => point.state !== 'failed');
  const ranks = checked
    .map((point) => point.rank)
    .filter((rank): rank is number => rank !== null)
    .sort((a, b) => a - b);
  const topTenDays = new Set(checked.filter((p) => p.rank !== null && p.rank <= TOP).map((p) => p.date));
  return {
    best: ranks[0] ?? null,
    worst: ranks.at(-1) ?? null,
    median: medianOf(ranks),
    ranked: ranks.length,
    checks: checked.length,
    topTenDays: topTenDays.size,
    daysChecked: new Set(checked.map((point) => point.date)).size,
  };
}
