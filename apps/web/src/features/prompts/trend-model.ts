import type { EngineSummary } from '@/lib/api/types';
import { validAnswers } from '@/lib/rates/rate-model';
import { equalWeightAverage, MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The weekly Trend of Topics & Prompts (parity spec G29, task W11): a row's mention rate for each week of the
 * window, from the summary read with `include=series`. Plain data; the column puts the sparkline and the words to it.
 */

/** One week of the trend: its Monday (a project day), and the mention rate, or `null` for a week without one. */
export interface TrendPoint {
  weekStart: string;
  value: number | null;
  /** An engine has a rate this week over at least `MIN_OBSERVATIONS` valid answers: the week may say which way things went. */
  enough: boolean;
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
  const starts = [...new Set(series.flatMap((weeks) => weeks.map((entry) => entry.week_start)))].sort();
  return starts.map((weekStart) => {
    const ofWeek = series.flatMap((weeks) => weeks.find((entry) => entry.week_start === weekStart)?.mentioned ?? []);
    return {
      weekStart,
      value: equalWeightAverage(ofWeek.map((cell) => cell.value)).value,
      // A topic's weekly cell counts its answers in `pooled`, a prompt's in its denominator
      enough: ofWeek.some((cell) => cell.value !== null && validAnswers(cell) >= MIN_OBSERVATIONS),
    };
  });
}

/** A move of less than this many points (as a share, so 0.05 is 5 points) between two weeks is no move. */
export const TREND_FLAT_BAND = 0.05;

/** `none`: there are not two weeks to compare, so nothing is said about a direction. */
export type TrendDirection = 'up' | 'down' | 'flat' | 'none';

/**
 * Which way the rate went: the last week against the first one that have a rate over enough valid answers, leaving
 * out the first and the last week of the series, which the window cuts short. `none` without two such weeks (a
 * rate over one answer against another over one is no direction), else flat within `TREND_FLAT_BAND`.
 */
export function trendDirection(points: readonly TrendPoint[]): TrendDirection {
  const known = points.slice(1, -1).flatMap((point) => (point.enough && point.value !== null ? [point.value] : []));
  const first = known[0];
  const last = known.at(-1);
  if (known.length < 2 || first === undefined || last === undefined) return 'none';
  const change = last - first;
  return Math.abs(change) < TREND_FLAT_BAND ? 'flat' : change > 0 ? 'up' : 'down';
}
