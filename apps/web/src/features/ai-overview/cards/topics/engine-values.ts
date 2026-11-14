import type { EngineSummary } from '@/lib/api/types';
import { cellFigure, type CellMetric } from '@/lib/rates/rate-model';
import type { RateReason } from '@/lib/rates/strip-model';
import { isDetectableChange, type RateState } from '@/lib/stats';

// shortcut: copy of features/prompts/topics-by-engine/engine-values.ts (without `engineChange`, which the Overview
// reads through lib/compare/change-model) and of `compareEngines` in comparison.ts; a feature may not import another
// one. Move to lib/rates (lease L-A). parity.test.ts imports the originals, so a drift fails there.

/** Two rates on the 0 to 1 scale are one when they differ by no more than the float noise of the sums that made them. */
export const SAME_RATE = 1e-9;

/**
 * One engine of one topic or prompt as a rate with the counts behind it, and what two or more engines make together:
 * the best and the weakest, the gap between them. Plain data: the cards put words to it. An unknown rate is `null`,
 * never 0, and engines are never pooled.
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
 * the best rate is 0: no engine names the brand, so there is none to point to.
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

/** What a gap column sorts by: the spread in points, `null` (last in both directions) under 2 engines with a rate. */
export const engineGapOf = (values: readonly EngineValue[]): number | null => bestWorst(values)?.spread ?? null;

/**
 * What can be said of the gap between the engines of a topic. The kinds say which sentence applies; the words come
 * from counts only, so no claim goes further than the answers behind it.
 */
export type Comparison =
  /** Fewer than 2 engines have a rate. */
  | { kind: 'none'; leftOut: string[] }
  /** At least 2 engines have a rate and the best is 0: no engine names the brand. */
  | { kind: 'zero'; leftOut: string[] }
  /** Every engine with a rate is at the same value. */
  | { kind: 'equal'; value: number; leftOut: string[] }
  | {
      kind: 'gap';
      best: EngineValue;
      worst: EngineValue;
      /** The gap in percentage points. */
      points: number;
      /**
       * `within` and `detectable`: the unpaired test on the pooled answers of the two engines (Newcombe, as
       * `isDetectableChange`). `share`: share of voice has no test, its numerator is not a count. `too-few`: an engine
       * has too few answers, or the counts cannot be tested.
       */
      test: 'within' | 'detectable' | 'too-few' | 'share';
      leftOut: string[];
    };

type GapTest = Extract<Comparison, { kind: 'gap' }>['test'];

/** Whether the best engine's rate differs from the weakest's by more than the answers behind them allow. */
function testOf(best: EngineValue, worst: EngineValue, values: readonly EngineValue[], metric: CellMetric): GapTest {
  if (metric === 'share_of_voice') return 'share';
  // A row with any engine under the minimum is too thin to claim a difference in words
  if (values.some((entry) => entry.state === 'insufficient')) return 'too-few';
  const { successes: bestCount } = best;
  const { successes: worstCount } = worst;
  if (bestCount === null || worstCount === null) return 'too-few';
  // The words say the gap is of the weighted rates, the test reads the pooled answers: when those point the other
  // way, or not at all, the test would answer another question than the gap states
  if (best.answers <= 0 || worst.answers <= 0) return 'too-few';
  if (bestCount / best.answers - worstCount / worst.answers <= SAME_RATE) return 'too-few';
  const detectable = isDetectableChange({ k: bestCount, n: best.answers }, { k: worstCount, n: worst.answers });
  if (detectable === null) return 'too-few';
  return detectable ? 'detectable' : 'within';
}

/** The comparison of the engines' values of one metric, in the order the engines are shown. */
export function compareEngines(values: readonly EngineValue[], metric: CellMetric): Comparison {
  const leftOut = values.filter((entry) => entry.state !== 'ok').map((entry) => entry.code);
  const result = bestWorst(values);
  if (result === null) return { kind: 'none', leftOut };
  const { best, worst, spread } = result;
  if (best === null) return { kind: 'zero', leftOut };
  // `spread` is in points and `SAME_RATE` on the 0 to 1 scale
  if (best.value !== null && spread <= SAME_RATE * 100) return { kind: 'equal', value: best.value, leftOut };
  return { kind: 'gap', best, worst, points: spread, test: testOf(best, worst, values, metric), leftOut };
}
