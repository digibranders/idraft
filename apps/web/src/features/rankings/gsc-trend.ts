import type { GscMetric } from './gsc-counts';
import type { TrackedKeywordRow } from '@/lib/api/types';

/**
 * Whether a keyword's Search Console clicks or impressions rise or fall over the 28-day window (docs/18 section
 * 4.9). The API sends the window as seven 4-day buckets, oldest first. The first three buckets (12 days) are
 * compared with the last three (12 days); the middle bucket is left out so the two halves are equal and apart.
 * A move of 20 percent or more either way is a rise or a fall; fewer than 5 clicks (20 impressions) in the two
 * halves together is too few to call.
 */

export type TrendDirection = 'up' | 'down' | 'flat' | 'insufficient';

export interface TrendReading {
  direction: TrendDirection;
  /** The totals of the earlier and the later halves. */
  earlier: number;
  later: number;
  /** The change from the earlier half to the later, in whole percent; null when there is too little or nothing to compare with. */
  percent: number | null;
}

const MIN_TOTAL: Readonly<Record<GscMetric, number>> = { clicks: 5, impressions: 20 };
const CHANGE = 0.2;
const HALF = 3;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

export function trendDirection(buckets: readonly number[], metric: GscMetric): TrendReading {
  const earlier = sum(buckets.slice(0, HALF));
  const later = sum(buckets.slice(-HALF));
  if (buckets.length < HALF * 2 || earlier + later < MIN_TOTAL[metric]) {
    return { direction: 'insufficient', earlier, later, percent: null };
  }
  // Nothing before and something now is a rise with no percent to give
  if (earlier === 0) return { direction: 'up', earlier, later, percent: null };
  const change = (later - earlier) / earlier;
  const direction = change >= CHANGE ? 'up' : change <= -CHANGE ? 'down' : 'flat';
  return { direction, earlier, later, percent: Math.round(Math.abs(change) * 100) };
}

/** A row's buckets for one metric, on its own device; null while the project's numbers are not `ok`. */
export function gscTrendOf(row: Pick<TrackedKeywordRow, 'gsc'>, metric: GscMetric): readonly number[] | null {
  return row.gsc?.state === 'ok' ? (row.gsc.trend?.[metric] ?? null) : null;
}

/** Bucket-by-bucket sums of several series of the same length; null when there are none. */
export function sumBuckets(series: readonly (readonly number[])[]): number[] | null {
  const first = series[0];
  if (first === undefined) return null;
  return first.map((_, index) => sum(series.map((values) => values[index] ?? 0)));
}
