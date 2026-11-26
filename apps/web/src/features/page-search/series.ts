import type { MetricKey, SeriesPoint } from './types';

export interface ChartSeries {
  /** The days of the current period. */
  categories: string[];
  current: (number | null)[];
  /** The compared period by day number; `null` when the period is not compared. */
  previous: (number | null)[] | null;
}

/** A day's value of a metric; `null` is a gap in the line, never 0 (no impressions means no CTR and no position). */
function valueOf(point: SeriesPoint, metric: MetricKey): number | null {
  switch (metric) {
    case 'clicks':
    case 'impressions':
      return point[metric];
    case 'ctr':
      return point.impressions > 0 ? point.clicks / point.impressions : null;
    case 'position':
      return point.position;
  }
}

/** The lines of one metric: the compared period lines up with the current one by index and is padded or cut to its length. */
export function chartOf(
  series: readonly SeriesPoint[],
  previous: readonly SeriesPoint[] | null,
  metric: MetricKey,
): ChartSeries {
  return {
    categories: series.map((point) => point.date),
    current: series.map((point) => valueOf(point, metric)),
    previous:
      previous === null
        ? null
        : series.map((_, index) => {
            const point = previous[index];
            return point === undefined ? null : valueOf(point, metric);
          }),
  };
}
