import type { EngineSummary } from '@/lib/api/types';
import { cellFigure, type CellMetric } from '@/lib/rates/rate-model';
import type { RateReason } from '@/lib/rates/strip-model';
import { equalWeightAverage, type RateState } from '@/lib/stats';

/**
 * One engine of one topic or prompt as a rate with the counts behind it (WB-TPE-05, 06 and 18), and what two or more
 * engines make together: the best and the weakest, the gap between them, the average. Plain data: the views put words
 * to it. An unknown rate is `null`, never 0, and engines are never pooled: an average says how many took part.
 */
export interface EngineValue {
  code: string;
  /** `ok` from `MIN_OBSERVATIONS` valid answers, `insufficient` under, `none` with no valid answer. */
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  /** The valid answers behind the value; share of voice, the valid answers that name a brand. */
  answers: number;
  /** The answers that count ("3" of 8); `null` for share of voice and where the count is not whole. */
  successes: number | null;
  /** The prompts a topic's cell weights; `null` for a prompt's cell, which has none, and for no cell. */
  prompts: number | null;
  /** Every answer of the cell, valid or not. */
  observations: number;
  /** Only when `state` is `none`. */
  reason: RateReason | null;
}

/** The engine `code` of a row's cells as a value of `metric`. An engine the row has no cells for has no answer. */
export function engineValue(
  cells: readonly EngineSummary[] | undefined,
  code: string,
  metric: CellMetric,
): EngineValue {
  const engine = cells?.find((cell) => cell.engine_code === code);
  const figure = cellFigure(engine, metric);
  const cell = engine?.[metric];
  return {
    code,
    state: figure.state,
    value: figure.value,
    answers: figure.answers,
    successes: figure.successes,
    // A topic's cell is prompt weighted: its denominator is the prompts it weights, its `pooled` the answers
    prompts: cell?.pooled != null ? cell.denominator : null,
    observations: cell?.n_observations ?? 0,
    reason: figure.reason,
  };
}

export interface BestWorst {
  /** `null` when the best rate is 0: no engine names the brand, so there is no engine to point to. */
  best: EngineValue | null;
  worst: EngineValue;
  /** Best minus weakest, in percentage points, exact (not the difference of two rounded percents). */
  spread: number;
  /** The engines that have a rate. */
  counted: number;
  /** The codes of the engines without a rate (too few answers, or none), in the order given. */
  leftOut: string[];
}

/**
 * The best and the weakest of the engines that have a rate, a tie going to the engine that comes first in `values`
 * for both. `null` under 2 engines with a rate: there is nothing to compare.
 */
export function bestWorst(values: readonly EngineValue[]): BestWorst | null {
  const rated = values.filter((entry) => entry.state === 'ok' && entry.value !== null);
  const [first] = rated;
  if (rated.length < 2 || first === undefined) return null;
  const valueOf = (entry: EngineValue): number => entry.value ?? 0;
  let best = first;
  let worst = first;
  for (const entry of rated) {
    if (valueOf(entry) > valueOf(best)) best = entry;
    if (valueOf(entry) < valueOf(worst)) worst = entry;
  }
  return {
    best: valueOf(best) === 0 ? null : best,
    worst,
    spread: (valueOf(best) - valueOf(worst)) * 100,
    counted: rated.length,
    leftOut: values.filter((entry) => !rated.includes(entry)).map((entry) => entry.code),
  };
}

/** What the engine gap column sorts by: the spread in points, `null` (last in both directions) under 2 engines with a rate. */
export const engineGapOf = (values: readonly EngineValue[]): number | null => bestWorst(values)?.spread ?? null;

/** The equal weight average of the engines that have a rate, and how many took part ("avg of N"); a missing engine is not a 0. */
export function averageOf(values: readonly EngineValue[]): { value: number | null; engines: number } {
  const { value, used } = equalWeightAverage(values.map((entry) => (entry.state === 'ok' ? entry.value : null)));
  return { value, engines: used };
}
