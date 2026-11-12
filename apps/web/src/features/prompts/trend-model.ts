import type { EngineSummary } from '@/lib/api/types';
import { equalWeightAverage } from '@/lib/stats';

/**
 * The weekly Trend of Topics & Prompts (parity spec G29, task W11): a row's mention rate for each week of the
 * window, from the summary read with `include=series`. Plain data; the column puts the sparkline and the words to it.
 */

/** One week of the trend: its Monday (a project day), and the mention rate, or `null` for a week without one. */
export interface TrendPoint {
  weekStart: string;
  value: number | null;
}

/**
 * The weekly mention rate over the engines in `engineCodes`: for each week, the equal weight average of the
 * engines that have a rate that week (a topic row's `mentioned` is prompt weighted per week, a prompt row's its
 * own counts, so each is the figure its engine column shows). An engine without a rate in a week is left out of
 * that week, and a week no engine has one in is a gap (`null`), never 0: a rate of 0 is a week with answers and no
 * mention. A week that an engine's series does not list is that engine's gap. `null` when no engine asked for has
 * a series (not loaded, an older API, or a read made without it): the cell then says nothing.
 */
export function trendPoints(
  engineCodes: readonly string[],
  cells: readonly EngineSummary[] | undefined,
): TrendPoint[] | null {
  const series = (cells ?? []).flatMap((cell) =>
    engineCodes.includes(cell.engine_code) && cell.series != null ? [cell.series] : [],
  );
  if (series.length === 0) return null;
  const weeks = [...new Set(series.flatMap((weeks) => weeks.map((entry) => entry.week_start)))].sort();
  return weeks.map((weekStart) => ({
    weekStart,
    value: equalWeightAverage(
      series.map((weeks) => weeks.find((entry) => entry.week_start === weekStart)?.mentioned.value ?? null),
    ).value,
  }));
}

/** A move of less than this many points (as a share, so 0.05 is 5 points) between the first and last week is no move. */
export const TREND_FLAT_BAND = 0.05;

export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Which way the rate went: the last week with a rate against the first one. Flat without two such weeks, and
 * within `TREND_FLAT_BAND`. The sparkline's color and its words follow this.
 */
export function trendDirection(points: readonly TrendPoint[]): TrendDirection {
  const known = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const first = known[0];
  const last = known.at(-1);
  if (known.length < 2 || first === undefined || last === undefined) return 'flat';
  const change = last - first;
  return Math.abs(change) < TREND_FLAT_BAND ? 'flat' : change > 0 ? 'up' : 'down';
}
