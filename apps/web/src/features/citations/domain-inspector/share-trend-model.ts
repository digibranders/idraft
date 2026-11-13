import { byEngineOrder } from '@/components/app/engine/order';
import type { SeriesRole } from '@/lib/charts/category-chart';
import type { EngineCode, SourceDomainDetailData } from '@/lib/citations/types';

/**
 * The weekly share of a domain on each engine (WB-DOM-03), worked out from the `engines` block of one read of
 * `ai/sources/domains/{registrable_domain}`. Pure: numbers in, numbers out, no text. The engines are never pooled:
 * a share is the domain's units on one engine over every unit of that engine the same week.
 */

/** The counts a point is of. */
export interface TrendCell {
  units: number;
  total: number;
}

export interface TrendSeries {
  code: EngineCode;
  /**
   * One share for each of `weeks`. `null` is a gap: the engine has no unit that week (or no row for it), so there
   * is nothing to be a share of. 0 is a week in which the engine had units and none was the domain's.
   */
  values: (number | null)[];
  /** The counts of each value; `null` where the value is a gap. */
  cells: (TrendCell | null)[];
}

export interface ShareTrend {
  /** The `week_start` of every week any engine has a row for, oldest first. */
  weeks: string[];
  /** One series for each engine of the read, in the fixed engine order. */
  series: TrendSeries[];
}

/** The fixed order of the engines in a chart: an engine's colour never depends on its place in the data. */
const ENGINE_ROLES: readonly (readonly [string, SeriesRole])[] = [
  ['chatgpt_web', { kind: 'brand' }],
  ['gemini_web', { kind: 'palette', index: 2 }],
  ['google_ai_mode', { kind: 'palette', index: 3 }],
  ['google_ai_overview', { kind: 'palette', index: 4 }],
];

/**
 * The colour role of an engine's line (14-badges-status.md section 4, engine charts): ChatGPT `chart-1`, Gemini
 * `chart-2`, AI Mode `chart-3`, AI Overview `chart-4`; any other engine is the neutral `other`.
 * shortcut: the prompts and AI Overview features keep their own copies (a feature may not import another), until
 * the role moves to `lib/charts`.
 */
export const engineRole = (code: string): SeriesRole =>
  ENGINE_ROLES.find(([engine]) => engine === code)?.[1] ?? { kind: 'other' };

/** The trend of the read, or `null` when no engine has a figure in any week: there is nothing to draw. */
export function shareTrend(data: SourceDomainDetailData): ShareTrend | null {
  const weeks = [...new Set(data.engines.flatMap((engine) => engine.series.map((week) => week.week_start)))].sort();
  const series = byEngineOrder(data.engines, (engine) => engine.engine_code).map((engine): TrendSeries => {
    const cells = weeks.map((weekStart): TrendCell | null => {
      const week = engine.series.find((candidate) => candidate.week_start === weekStart);
      return week === undefined || week.all_citation_units === 0
        ? null
        : { units: week.citation_units, total: week.all_citation_units };
    });
    return {
      code: engine.engine_code,
      values: cells.map((cell) => (cell === null ? null : cell.units / cell.total)),
      cells,
    };
  });
  return series.some((entry) => entry.cells.some((cell) => cell !== null)) ? { weeks, series } : null;
}
