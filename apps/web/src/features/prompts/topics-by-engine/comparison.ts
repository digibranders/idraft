import { bestWorst, type EngineValue } from './engine-values';
import type { CellMetric } from '@/lib/rates/rate-model';
import { isDetectableChange } from '@/lib/stats';

/**
 * What can be said of the gap between the engines of a topic (WB-TPE-11). The kinds say which sentence applies; the
 * words come from counts only, so no claim goes further than the answers behind it.
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
  if (values.some((entry) => entry.state === 'insufficient')) return 'too-few';
  const { successes: bestCount } = best;
  const { successes: worstCount } = worst;
  if (bestCount === null || worstCount === null) return 'too-few';
  // A count that is not whole is not a count of answers: no test is better than a test of something else
  if (!Number.isInteger(bestCount) || !Number.isInteger(worstCount)) return 'too-few';
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
  if (spread === 0 && best.value !== null) return { kind: 'equal', value: best.value, leftOut };
  return { kind: 'gap', best, worst, points: spread, test: testOf(best, worst, values, metric), leftOut };
}
