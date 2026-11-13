import type { EngineSummary } from '@/lib/api/types';
import { cellFigure, type CellMetric } from '@/lib/rates/rate-model';
import type { RateReason } from '@/lib/rates/strip-model';
import { isDetectableChange, type RateState } from '@/lib/stats';

/** Two rates on the 0 to 1 scale are one when they differ by no more than the float noise of the sums that made them. */
export const SAME_RATE = 1e-9;

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
  // Share of voice is one answer one weight and has no `pooled`: the prompts are those of the same engine's Mentioned
  const weighting = metric === 'share_of_voice' ? engine?.mentioned : cell;
  return {
    code,
    state: figure.state,
    value: figure.value,
    answers: figure.answers,
    successes: figure.successes,
    // A topic's cell is prompt weighted: its denominator is the prompts it weights, its `pooled` the answers
    prompts: weighting?.pooled != null ? weighting.denominator : null,
    observations: cell?.n_observations ?? 0,
    reason: figure.reason,
  };
}

/**
 * The engine a row points to: the one with the highest rate among those that have a rate, also when it is the only one.
 * A tie (within `SAME_RATE`) goes to the engine that comes first in `values`. `null` when no engine has a rate, and when
 * the best rate is 0: no engine names the brand, so there is none to point to. The phone line and the export read this.
 */
export function bestEngine(values: readonly EngineValue[]): EngineValue | null {
  let best: EngineValue | null = null;
  for (const entry of values) {
    if (entry.state !== 'ok' || entry.value === null) continue;
    if (best === null || entry.value > (best.value ?? 0) + SAME_RATE) best = entry;
  }
  return best === null || (best.value ?? 0) <= SAME_RATE ? null : best;
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
    // Float noise is not a difference: a tie within `SAME_RATE` stays with the engine shown first
    if (valueOf(entry) > valueOf(best) + SAME_RATE) best = entry;
    if (valueOf(entry) < valueOf(worst) - SAME_RATE) worst = entry;
  }
  return {
    best: valueOf(best) <= SAME_RATE ? null : best,
    worst,
    spread: (valueOf(best) - valueOf(worst)) * 100,
    counted: rated.length,
    leftOut: values.filter((entry) => !rated.includes(entry)).map((entry) => entry.code),
  };
}

/** What the engine gap column sorts by: the spread in points, `null` (last in both directions) under 2 engines with a rate. */
export const engineGapOf = (values: readonly EngineValue[]): number | null => bestWorst(values)?.spread ?? null;

export interface EngineChange {
  /** The rate now minus the rate over the compared window, on the 0 to 1 scale (`formatMetricDelta` writes it in points). */
  points: number;
  /** The unpaired test on the pooled answers of both windows; `null` for share of voice (no count) and for counts that cannot be tested. */
  detectable: boolean | null;
}

/**
 * How an engine moved since the compared window (a cell's `previous`), or `null` when there is nothing to compare: the
 * window was not compared, the engine had no answer there, or either side has too few answers for a rate. A rate that is
 * not there is never read as 0, so a move from or to it is not drawn.
 */
export function engineChange(
  cells: readonly EngineSummary[] | undefined,
  code: string,
  metric: CellMetric,
): EngineChange | null {
  const previous = cells?.find((cell) => cell.engine_code === code)?.previous;
  if (previous == null) return null;
  const now = engineValue(cells, code, metric);
  const before = engineValue([{ ...previous, engine_code: code }], code, metric);
  if (now.value === null || before.value === null) return null;
  const points = now.value - before.value;
  if (metric === 'share_of_voice' || now.successes === null || before.successes === null) {
    return { points, detectable: null };
  }
  const current = { k: now.successes, n: now.answers };
  const earlier = { k: before.successes, n: before.answers };
  if (current.n <= 0 || earlier.n <= 0) return { points, detectable: null };
  // The points are the move of the prompt weighted rates, the test reads the pooled answers: when the two do not move the
  // same way the test would answer another question than the points state, so no claim is made and the change is uncoloured
  const pooled = current.k / current.n - earlier.k / earlier.n;
  const agree = Math.abs(pooled) > SAME_RATE ? points * pooled > 0 : Math.abs(points) <= SAME_RATE;
  return { points, detectable: agree ? isDetectableChange(current, earlier) : null };
}
