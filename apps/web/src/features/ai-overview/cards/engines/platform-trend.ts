import {
  gapAt,
  hasWeeklyVisibility,
  projectWeeks,
  weeklyShareNotCollected,
  type TrendPoint,
  type WeekMetric,
} from './trend-model';
import { optionOfMetric } from '../../scope/metric-option';
import type { ScopeMetric } from '../../scope/scope-model';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';
import { rateState } from '@/lib/stats';

/**
 * The lines of the trend card (OV-TREND): one line for each platform of the page scope, with their equal-weight
 * Average for All platforms. The weeks are those of the previous read and then those of the current one, so Compare
 * shows the previous period before the current one with a line where it starts; without a comparison only the current
 * window is drawn. The same period last year is not put before the current weeks (a year apart is not adjacent): its
 * weeks are drawn over the current ones, week for week, as one dashed line (`lastYear`). Every point is the API's own weekly point (`projectWeeks`: pooled over the trailing 4 weeks under 10
 * answering prompts, R7, with its Wilson band, R8). Nothing is made up: a week without an answer is a gap, and AI
 * visibility is drawn only from a weekly visibility cell the API carries.
 */

const isWeekMetric = (value: string): value is WeekMetric =>
  value === 'visibility' || value === 'mention' || value === 'citation' || value === 'share_of_voice';

/** The metric of the scope (`sov`) as a week names it: the layout option value, which `metric-option.ts` spells. */
export function weekMetricOf(metric: ScopeMetric): WeekMetric {
  const option = optionOfMetric(metric);
  return isWeekMetric(option) ? option : 'visibility';
}

export interface TrendWeek {
  /** The Monday the week starts on. */
  weekStart: string;
  period: 'previous' | 'current';
}

export interface PlatformSeries {
  code: EngineCode;
  /** One point for every week of the chart. */
  points: TrendPoint[];
}

/** The Average of the platforms in one week: only platforms with a rate that week take part. */
export interface AveragePoint {
  value: number | null;
  platforms: number;
  /** x of y of each platform that has a rate that week, the counts behind the average (an average has none of its own). */
  counts: { code: EngineCode; k: number; n: number }[];
}

/** The same period last year over the current weeks: the n-th week of last year under the n-th week of the window. */
export interface LastYearLine {
  /** The Monday each point is of, one for each week of the chart; `null` where last year has no n-th week. */
  weekStarts: (string | null)[];
  /** One point for every week of the chart, for each platform that has a rate in some week of last year. */
  platforms: PlatformSeries[];
  /** `null` for one platform: an average of one is that platform. */
  average: AveragePoint[] | null;
}

export interface PlatformTrend {
  metric: WeekMetric;
  weeks: TrendWeek[];
  /** The index of the first week of the current window when the previous one is drawn before it; else `null`. */
  boundary: number | null;
  /** Only the platforms that have a rate in some week. */
  platforms: PlatformSeries[];
  /** `null` for one platform: an average of one is that platform. */
  average: AveragePoint[] | null;
  /** The same period last year over the weeks above; `null` when it is not asked, or has no rate in any week. */
  lastYear: LastYearLine | null;
  /** False for AI visibility when the API carries no weekly visibility: there is nothing to draw, not a zero. */
  collected: boolean;
}

export interface PlatformTrendInput {
  current: PromptsSummary;
  /** The window before; `null` without a comparison. */
  previous: PromptsSummary | null;
  /** `previous` is the same dates a year earlier: drawn over the current weeks, not before them. */
  lastYear?: boolean;
  /** The platforms asked, in the order to draw them. */
  codes: readonly EngineCode[];
  metric: WeekMetric;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  /** All platforms: add the Average line (when more than one platform has a line). */
  average: boolean;
}

const weeksOf = (points: readonly TrendPoint[]): string[] => points.map((point) => point.weekStart);

const drawn = (point: TrendPoint): boolean => point.n > 0 && point.value !== null;

export function buildPlatformTrend({
  current,
  previous,
  codes,
  metric,
  range,
  previousRange,
  average,
  lastYear: overlay = false,
}: PlatformTrendInput): PlatformTrend {
  const collected =
    metric === 'visibility'
      ? hasWeeklyVisibility(current)
      : metric !== 'share_of_voice' || !weeklyShareNotCollected(current);
  if (!collected) {
    return { metric, weeks: [], boundary: null, platforms: [], average: null, lastYear: null, collected };
  }
  const now = new Map(codes.map((code) => [code, projectWeeks(current, code, metric, range)]));
  const before = new Map(
    codes.map((code) => [code, previous === null ? [] : projectWeeks(previous, code, metric, previousRange)]),
  );
  const currentWeeks = [...new Set([...now.values()].flatMap(weeksOf))].sort();
  // A window that starts in the middle of a week holds that Monday in both reads: the current point wins
  const previousWeeks = overlay
    ? []
    : [...new Set([...before.values()].flatMap(weeksOf))]
        .filter((weekStart) => !currentWeeks.includes(weekStart))
        .sort();
  const weeks: TrendWeek[] = [
    ...previousWeeks.map((weekStart): TrendWeek => ({ weekStart, period: 'previous' })),
    ...currentWeeks.map((weekStart): TrendWeek => ({ weekStart, period: 'current' })),
  ];
  const series = codes.map((code): PlatformSeries => ({
    code,
    points: weeks.map(({ weekStart, period }) => {
      const source = (period === 'current' ? now : before).get(code) ?? [];
      return (
        source.find((point) => point.weekStart === weekStart) ??
        gapAt(weekStart, period === 'current' ? range : previousRange)
      );
    }),
  }));
  const platforms = series.filter((entry) => entry.points.some(drawn));
  return {
    metric,
    weeks,
    boundary: previousWeeks.length > 0 ? previousWeeks.length : null,
    platforms,
    average: averageOf(platforms, weeks.length, average),
    lastYear: overlay && previous !== null ? lastYearOf(before, codes, currentWeeks, previousRange, average) : null,
    collected,
  };
}

/** The Average of the platforms in every week: only platforms with a rate that week take part; `null` for one platform. */
function averageOf(
  platforms: readonly PlatformSeries[],
  length: number,
  average: boolean,
  atLeast = 2,
): AveragePoint[] | null {
  if (!average || platforms.length < atLeast) return null;
  return Array.from({ length }, (_, index): AveragePoint => {
    const rated = platforms.flatMap((entry) => {
      const point = entry.points[index];
      return point !== undefined && drawn(point) && rateState(point.n) === 'ok' && point.value !== null
        ? [{ code: entry.code, value: point.value, k: point.k, n: point.n }]
        : [];
    });
    return {
      value: rated.length === 0 ? null : rated.reduce((total, part) => total + part.value, 0) / rated.length,
      platforms: rated.length,
      counts: rated.flatMap(({ code, k, n }) => (k === null ? [] : [{ code, k, n }])),
    };
  });
}

/**
 * The weeks of the same period last year laid under the current weeks by their order: the first week of the window
 * under the first week of last year's, and so on, since a year earlier a Monday falls on another date. A current week
 * with no week of last year under it is a gap. Nothing is drawn when last year has no rate in any week.
 */
function lastYearOf(
  before: ReadonlyMap<EngineCode, readonly TrendPoint[]>,
  codes: readonly EngineCode[],
  currentWeeks: readonly string[],
  previousRange: { from: string; to: string },
  average: boolean,
): LastYearLine | null {
  const lastWeeks = [...new Set([...before.values()].flatMap(weeksOf))].sort();
  const weekStarts = currentWeeks.map((_, index) => lastWeeks[index] ?? null);
  const series = codes.map((code): PlatformSeries => ({
    code,
    points: weekStarts.map((weekStart, index) => {
      const found = weekStart === null ? undefined : before.get(code)?.find((point) => point.weekStart === weekStart);
      return found ?? gapAt(weekStart ?? currentWeeks[index] ?? previousRange.from, previousRange);
    }),
  }));
  const platforms = series.filter((entry) => entry.points.some(drawn));
  if (platforms.length === 0) return null;
  // All platforms: last year is one Average line, even from one platform (the Average of the platforms that have a rate)
  return { weekStarts, platforms, average: averageOf(platforms, currentWeeks.length, average, 1) };
}
