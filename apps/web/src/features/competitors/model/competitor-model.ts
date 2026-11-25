import type { components } from '@/lib/api/schema';
import type { EngineCode } from '@/lib/api/types';
import type { SeriesRole } from '@/lib/charts/category-chart';

/**
 * The pure shaping of the Competitors page: the rows of `GET .../ai/competitors` as one row per tracked entity with a
 * value per engine and metric, and the platform average across the engines in scope. Engine values are never pooled
 * (c8): the average is the unweighted mean of the engines that have a value, and says so on screen.
 */

export type AiCompetitor = components['schemas']['AiCompetitor'];
type AiMetricValue = components['schemas']['AiMetricValue'];

export type MetricKey = 'mention_rate' | 'citation_share' | 'share_of_voice';
export const METRIC_KEYS: readonly MetricKey[] = ['mention_rate', 'citation_share', 'share_of_voice'];

export interface Cell {
  value: number | null;
  previous: number | null;
}

export interface EntityRow {
  id: string;
  name: string;
  role: 'own' | 'competitor' | 'watch' | null;
  byEngine: Readonly<Record<string, Readonly<Record<MetricKey, Cell>>>>;
}

const cellOf = (metric: AiMetricValue): Cell => ({ value: metric.value, previous: metric.previous?.value ?? null });

/** One row per entity of the tracked set, in the API's order: the own entities, then the competitors by name. */
export function entityRows(data: readonly AiCompetitor[]): EntityRow[] {
  return data.map((row) => ({
    id: row.entity.entity_id,
    name: row.entity.canonical_name,
    role: row.entity.role,
    byEngine: Object.fromEntries(
      row.by_engine.map((engine) => [
        engine.engine_code,
        {
          mention_rate: cellOf(engine.mention_rate),
          citation_share: cellOf(engine.citation_share),
          share_of_voice: cellOf(engine.share_of_voice),
        },
      ]),
    ),
  }));
}

/** The mean of the numbers there are, or `null` when there is none: no data is never a zero. */
export function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

/**
 * The value of a metric for an entity over the engines asked: one engine's own value, or the platform average. The
 * previous period is averaged over the same engines, and only when every engine with a value has one.
 */
export function cellOver(row: EntityRow, metric: MetricKey, engines: readonly EngineCode[]): Cell {
  const cells = engines.flatMap((engine) => {
    const cell = row.byEngine[engine]?.[metric];
    return cell === undefined ? [] : [cell];
  });
  const withValue = cells.filter((cell) => cell.value !== null);
  const previous = withValue.every((cell) => cell.previous !== null)
    ? meanOf(withValue.map((cell) => cell.previous))
    : null;
  return { value: meanOf(cells.map((cell) => cell.value)), previous };
}

/** Change in ratio points, or `null` when either side is unknown. */
export function changeOf(cell: Cell): number | null {
  return cell.value === null || cell.previous === null ? null : cell.value - cell.previous;
}

/** The competitors (not the own brand, not watched) sorted by a metric, highest first; unknown values last. */
export function rankedCompetitors(
  rows: readonly EntityRow[],
  metric: MetricKey,
  engines: readonly EngineCode[],
): EntityRow[] {
  const value = (row: EntityRow): number => cellOver(row, metric, engines).value ?? -1;
  return rows.filter((row) => row.role === 'competitor').sort((a, b) => value(b) - value(a));
}

/** The colour role of an entity in a chart: the own brand is series 1, the others take `chart-2` to `chart-6` in turn. */
export function roleOf(row: EntityRow, position: number): SeriesRole {
  return row.role === 'own' ? { kind: 'brand' } : { kind: 'palette', index: ((position % 5) + 2) as 2 | 3 | 4 | 5 | 6 };
}

type AiMetricSeries = components['schemas']['AiMetricSeries'];

export interface WeeklyValues {
  /** The week starts, oldest first, as the API names them. */
  weeks: readonly string[];
  /** Per entity id, one value per week: the mean of the engines in scope that have one, `null` for a gap. */
  byEntity: ReadonlyMap<string, readonly (number | null)[]>;
}

/** Folds the per entity and engine series into one line per entity over the engines in scope. */
export function weeklyValues(series: readonly AiMetricSeries[], engines: readonly EngineCode[]): WeeklyValues {
  const weeks = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.t)))].sort();
  const wanted = series.filter(
    (entry) =>
      entry.entity_id !== null && entry.entity_id !== undefined && engines.includes(entry.engine_code as EngineCode),
  );
  const ids = [...new Set(wanted.map((entry) => entry.entity_id as string))];
  const byEntity = new Map<string, (number | null)[]>();
  for (const id of ids) {
    const own = wanted.filter((entry) => entry.entity_id === id);
    byEntity.set(
      id,
      weeks.map((week) => meanOf(own.map((entry) => entry.points.find((point) => point.t === week)?.value ?? null))),
    );
  }
  return { weeks, byEntity };
}

export interface Standing {
  /** 1 is the highest value among the brands that have one; `null` while your brand has none. */
  rank: number | null;
  /** The brands (yours and the competitors') that have a value. */
  of: number;
  /** The competitors with a higher value than yours. */
  ahead: number;
}

/** Where your brand stands among the tracked brands on a metric. Watched brands are not compared. */
export function standingOf(rows: readonly EntityRow[], metric: MetricKey, engines: readonly EngineCode[]): Standing {
  const compared = rows.filter((row) => row.role === 'own' || row.role === 'competitor');
  const valued = compared.flatMap((row) => {
    const value = cellOver(row, metric, engines).value;
    return value === null ? [] : [{ role: row.role, value }];
  });
  const own = valued.find((item) => item.role === 'own');
  if (own === undefined) return { rank: null, of: valued.length, ahead: 0 };
  const ahead = valued.filter((item) => item.role === 'competitor' && item.value > own.value).length;
  return { rank: ahead + 1, of: valued.length, ahead };
}

/** The competitor whose value moved most since the comparison period, in either direction; `null` without a comparison. */
export function biggestMover(
  rows: readonly EntityRow[],
  metric: MetricKey,
  engines: readonly EngineCode[],
): { name: string; change: number } | null {
  let best: { name: string; change: number } | null = null;
  for (const row of rows) {
    if (row.role !== 'competitor') continue;
    const change = changeOf(cellOver(row, metric, engines));
    if (change !== null && (best === null || Math.abs(change) > Math.abs(best.change)))
      best = { name: row.name, change };
  }
  return best;
}

/** The engine where an entity's value is highest, with the value; `null` when no engine has one. */
export function strongestEngine(
  row: EntityRow,
  metric: MetricKey,
  engines: readonly EngineCode[],
): { engine: EngineCode; value: number } | null {
  let best: { engine: EngineCode; value: number } | null = null;
  for (const engine of engines) {
    const value = row.byEngine[engine]?.[metric].value ?? null;
    if (value !== null && (best === null || value > best.value)) best = { engine, value };
  }
  return best;
}
