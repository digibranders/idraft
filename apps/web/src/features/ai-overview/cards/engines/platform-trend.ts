import { gapAt, hasWeeklyVisibility, projectWeeks, type TrendPoint, type WeekMetric } from './trend-model';
import type { ScopeMetric } from '../../scope/scope-model';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';
import { rateState } from '@/lib/stats';

/**
 * The lines of the trend card (OV-TREND): one line for each platform of the page scope, with their equal-weight
 * Average for All platforms. The weeks are those of the previous read and then those of the current one, so Compare
 * shows the previous period before the current one with a line where it starts; without a comparison only the current
 * window is drawn. Every point is the API's own weekly point (`projectWeeks`: pooled over the trailing 4 weeks under 10
 * answering prompts, R7, with its Wilson band, R8). Nothing is made up: a week without an answer is a gap, and AI
 * visibility is drawn only from a weekly visibility cell the API carries.
 */

/** The metric of the scope (`sov`) as a week names it. */
export const weekMetricOf = (metric: ScopeMetric): WeekMetric => (metric === 'sov' ? 'share_of_voice' : metric);

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
  /** False for AI visibility when the API carries no weekly visibility: there is nothing to draw, not a zero. */
  collected: boolean;
}

export interface PlatformTrendInput {
  current: PromptsSummary;
  /** The window before; `null` without a comparison. */
  previous: PromptsSummary | null;
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
}: PlatformTrendInput): PlatformTrend {
  const collected = metric !== 'visibility' || hasWeeklyVisibility(current);
  if (!collected) return { metric, weeks: [], boundary: null, platforms: [], average: null, collected };
  const now = new Map(codes.map((code) => [code, projectWeeks(current, code, metric, range)]));
  const before = new Map(
    codes.map((code) => [code, previous === null ? [] : projectWeeks(previous, code, metric, previousRange)]),
  );
  const currentWeeks = [...new Set([...now.values()].flatMap(weeksOf))].sort();
  // A window that starts in the middle of a week holds that Monday in both reads: the current point wins
  const previousWeeks = [...new Set([...before.values()].flatMap(weeksOf))]
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
  const rated = (point: TrendPoint | undefined): number[] =>
    point !== undefined && drawn(point) && rateState(point.n) === 'ok' && point.value !== null ? [point.value] : [];
  const averaged =
    average && platforms.length > 1
      ? weeks.map((_, index): AveragePoint => {
          const values = platforms.flatMap((entry) => rated(entry.points[index]));
          return {
            value: values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length,
            platforms: values.length,
          };
        })
      : null;
  return {
    metric,
    weeks,
    boundary: previousWeeks.length > 0 ? previousWeeks.length : null,
    platforms,
    average: averaged,
    collected,
  };
}
