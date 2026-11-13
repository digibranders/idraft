import { topCompetitors } from './leaders';
import { STALE_AFTER_DAYS } from '@/features/prompts/history-model';
import type { EngineSummary, MetricCell, PointPool, SummaryEntity, WeekCells } from '@/lib/api/types';
import type { CellMetric } from '@/lib/rates/rate-model';
import { rateState, wilsonInterval, type Interval } from '@/lib/stats';

/**
 * The weekly points of a topic on an engine, and of the entities against it (CF-31, N3). A topic point is a prompt
 * weighted cell: its value is a mean of rates and its numerator a sum of them, so it is not whole; the answers behind it
 * are in `pooled`. `history-model.ts` reads prompt points, whose counts are whole, and drops any point that is not;
 * this file must not. Plain data: the charts put words and a canvas to it.
 */

export interface TopicPoint {
  /** The Monday the week starts on, a project day. */
  weekStart: string;
  /** The cell's prompt weighted value; `null` for a week with no valid answer, or counts that cannot be real. A gap, never 0. */
  value: number | null;
  /** The valid answers that count; `null` for share of voice, and for a gap. */
  k: number | null;
  /** The valid answers behind the value (the answers that name a brand, for share of voice); 0 for a gap. */
  n: number;
  /** The prompts of the row with a valid answer in that week alone, whether the point is pooled or not. */
  prompts: number;
  /** The API pooled the point (C-18: `is_pooled`). The first points of a window pool 1 week, which is its own. */
  pooled: boolean;
  /** The weeks the point holds: 1 when it is not pooled. */
  weeks: number;
  /** The point holds more than its own week, so its words say it is pooled: `pooled` and `weeks` over 1. */
  showsPool: boolean;
  /** The days a pooled point covers, inside the window; `null` when it is not pooled. */
  window: PointPool['window'] | null;
  /** The 95 percent Wilson interval of the pooled answers, from `MIN_OBSERVATIONS` of them. */
  band: Interval | null;
  /** Fewer valid answers than `MIN_OBSERVATIONS`: a hollow point with no band (R2). */
  thin: boolean;
}

/** The counts of a cell, or `null` when they cannot be real: `n` whole and not negative, `k` whole and no more than `n`. */
function countsOf(cell: MetricCell, metric: CellMetric): { k: number | null; n: number } | null {
  const n = cell.pooled?.trials ?? cell.denominator;
  // Share of voice counts answers that name a brand, but its numerator is a sum of shares: it has no count of successes
  const k = metric === 'share_of_voice' ? null : (cell.pooled?.successes ?? cell.numerator);
  if (!Number.isInteger(n) || n < 0) return null;
  if (k !== null && (!Number.isInteger(k) || k < 0 || k > n)) return null;
  return { k, n };
}

/** One point of `cell` in `week`: the cell's own counts, the week's pool and prompts. No cell is a gap. */
function pointOf(week: WeekCells, cell: MetricCell | undefined, metric: CellMetric): TopicPoint {
  const point: TopicPoint = {
    weekStart: week.week_start,
    value: null,
    k: null,
    n: 0,
    prompts: week.prompts,
    pooled: week.is_pooled,
    weeks: week.pool?.weeks ?? 1,
    showsPool: week.is_pooled && (week.pool?.weeks ?? 1) > 1,
    window: week.pool?.window ?? null,
    band: null,
    thin: false,
  };
  const counts = cell === undefined ? null : countsOf(cell, metric);
  if (cell === undefined || counts === null || counts.n === 0 || cell.value === null) return point;
  const state = rateState(counts.n);
  return {
    ...point,
    value: cell.value,
    k: counts.k,
    n: counts.n,
    band: state === 'ok' && counts.k !== null ? wilsonInterval(counts.k, counts.n) : null,
    thin: state === 'insufficient',
  };
}

/** The points of an engine's series for `metric`, oldest first as the API gives them; `null` when the read has no series. */
export function enginePoints(cell: EngineSummary | undefined, metric: CellMetric): TopicPoint[] | null {
  const series = cell?.series;
  if (series == null) return null;
  return series.map((week) => pointOf(week, week[metric], metric));
}

/**
 * The engines week by week as one line: the equal weight mean of the points that show a rate (a gap and a hollow point
 * take no part, and are never a 0). `n` adds their answers, `prompts` is the most any engine had in that week (the
 * same prompts answer on every engine), a week is pooled when a point that took part is, and then it says its widest
 * pool. There is no band: an average of rates has no interval of its own. A week no engine has a rate in is a gap.
 */
export function averagePoints(series: readonly TopicPoint[][]): TopicPoint[] {
  const weeks = [...new Set(series.flatMap((points) => points.map((point) => point.weekStart)))].sort();
  return weeks.map((weekStart) => {
    const present = series.flatMap((points) => points.filter((point) => point.weekStart === weekStart));
    const used = present.filter((point) => point.value !== null && !point.thin);
    const pooled = used.filter((point) => point.pooled);
    const together = used.filter((point) => point.showsPool);
    const widest = together.reduce<TopicPoint | null>(
      (most, point) => (most === null || point.weeks > most.weeks ? point : most),
      null,
    );
    return {
      weekStart,
      value: used.length === 0 ? null : used.reduce((total, point) => total + (point.value ?? 0), 0) / used.length,
      k: null,
      n: used.reduce((total, point) => total + point.n, 0),
      prompts: Math.max(0, ...present.map((point) => point.prompts)),
      pooled: pooled.length > 0,
      weeks: widest?.weeks ?? 1,
      showsPool: together.length > 0,
      window: widest?.window ?? null,
      band: null,
      thin: false,
    };
  });
}

/**
 * Whether a topic has had no valid answer for `STALE_AFTER_DAYS` days, by its row's `last_valid_at` (F20: the interim
 * stale rule of the prompt History tab, until WP-18 settles one). A topic with no last valid answer says nothing here:
 * its engines already say "No answers".
 */
export function isStale(lastValidAt: string | null, now: Date): boolean {
  if (lastValidAt === null) return false;
  const at = Date.parse(lastValidAt);
  return Number.isFinite(at) && now.getTime() - at >= STALE_AFTER_DAYS * 86_400_000;
}

/** How many of the points that show a value hold several weeks (the words of C-18 need it: "3 of 12"). */
export function poolNote(points: readonly TopicPoint[]): { pooled: number; total: number } {
  const shown = points.filter((point) => point.value !== null);
  return { pooled: shown.filter((point) => point.showsPool).length, total: shown.length };
}

export interface EntityLine {
  entityId: string;
  name: string;
  role: 'own' | 'competitor';
  /** One point for each week of the engine's series; an entity not in a week's cells is a gap there. */
  points: TopicPoint[];
}

/**
 * The lines of own against the `top` competitors (N3) on an engine: the own brand first, then the competitors with the
 * most Mentioned over the window, each week's points from the week's entity cells, over the very weeks the point holds.
 * No lines without a series or without entity cells.
 */
export function entityLines(
  cell: EngineSummary | undefined,
  tracked: readonly SummaryEntity[],
  top: number,
): EntityLine[] {
  const series = cell?.series;
  if (cell === undefined || series == null || cell.entities == null) return [];
  const competitors = topCompetitors(cell, tracked, top).flatMap((id) =>
    tracked.filter((entity) => entity.entity_id === id),
  );
  return [...tracked.filter((entity) => entity.role === 'own'), ...competitors].map((entity) => ({
    entityId: entity.entity_id,
    name: entity.name,
    role: entity.role,
    points: series.map((week) =>
      pointOf(week, week.entities?.find((cells) => cells.entity_id === entity.entity_id)?.mentioned, 'mentioned'),
    ),
  }));
}
