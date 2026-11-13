import { inCatalogOrder } from '../../engines/engine-role';
import type { EngineCode, SourceDiversity } from '@/lib/citations/types';

/**
 * The weekly source diversity of each engine as figures (WP-37 plan T4, row CH-26). Pure. Engines are never added
 * together: every engine has its own points, and the average is the one the API states. A week with no citation
 * unit has no value (a gap), because diversity of nothing is not 0.
 */

export type DiversityView = 'distinct' | 'effective';

export interface DiversityPoint {
  /** The Monday the week starts on, `YYYY-MM-DD`. */
  weekStart: string;
  /** Citation units in the week; `null` when the read has no point of this engine for the week. */
  units: number | null;
  /** Registrable domains cited in the week. */
  domains: number | null;
  /** The effective number of sources of the week, as the API states it; `null` without a unit. */
  effective: number | null;
}

export interface DiversityEngine {
  code: EngineCode;
  points: readonly DiversityPoint[];
}

export interface DiversityModel {
  /** The weeks of the window, oldest first, the union over the engines. */
  weeks: readonly string[];
  engines: readonly DiversityEngine[];
  /** The read carried a weekly series for at least one engine. */
  hasWeeks: boolean;
  /** At least one week of one engine holds a citation unit. */
  hasUnits: boolean;
  /** The equal-weight mean of the engines with units, from the API only; `null` when it sends none. */
  average: number | null;
  /** Registrable domains cited over every engine in scope (a count of the API). */
  distinctDomains: number;
}

/** What a view plots for a point: `null` (a gap) for a week without a unit, never 0. */
export function valueOf(point: DiversityPoint, view: DiversityView): number | null {
  if (point.units === null || point.units === 0) return null;
  return view === 'distinct' ? point.domains : point.effective;
}

export function diversityModel(read: SourceDiversity): DiversityModel {
  const weeks = [
    ...new Set(read.data.flatMap((engine) => (engine.series ?? []).map((week) => week.week_start))),
  ].sort();
  const order = inCatalogOrder(read.data.map((engine) => engine.engine_code));
  const engines = order.flatMap((code): DiversityEngine[] => {
    const engine = read.data.find((candidate) => candidate.engine_code === code);
    if (engine === undefined) return [];
    const own = new Map((engine.series ?? []).map((week) => [week.week_start, week]));
    return [
      {
        code,
        points: weeks.map((weekStart): DiversityPoint => {
          const week = own.get(weekStart);
          return {
            weekStart,
            units: week?.citation_units ?? null,
            domains: week?.distinct_domains ?? null,
            effective: week?.effective_sources ?? null,
          };
        }),
      },
    ];
  });
  return {
    weeks,
    engines,
    hasWeeks: weeks.length > 0,
    hasUnits: engines.some((engine) => engine.points.some((point) => (point.units ?? 0) > 0)),
    average: read.meta.effective_sources_engine_average,
    distinctDomains: read.meta.distinct_domains,
  };
}
