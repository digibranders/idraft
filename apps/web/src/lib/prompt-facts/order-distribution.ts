import { engineOf } from './engine-rows';
import type { FactsRow } from './types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** First, second, third, and fourth or later. */
export type OrderCounts = readonly [number, number, number, number];

/**
 * `not_collected`: the backend sends no order counts for the platform, so no distribution can be drawn (a mean never
 * makes one). `too_few`: under `MIN_OBSERVATIONS` ordered answers, too few to say how the order falls. `ok`: four
 * shares that add up to 1.
 */
export type OrderReading =
  | { state: 'not_collected'; ordered: 0; counts: null; shares: null; mean: null }
  | { state: 'too_few'; ordered: number; counts: OrderCounts; shares: null; mean: null }
  | { state: 'ok'; ordered: number; counts: OrderCounts; shares: OrderCounts; mean: number };

const NOT_COLLECTED: OrderReading = { state: 'not_collected', ordered: 0, counts: null, shares: null, mean: null };

/**
 * Where the own brand falls in the order of the brands named, on one platform, over the rows given: the order counts
 * of the rows added up, then shares of the ordered answers they count (one denominator for the shares and the mean).
 * A row without order counts takes no part; when none has them the platform is `not_collected`.
 */
export function orderDistribution(rows: readonly FactsRow[], code: string): OrderReading {
  const parts = rows.flatMap((row) => {
    const position = engineOf(row, code)?.position;
    return position?.by_order === undefined ? [] : [{ counts: position.by_order, rankSum: position.rank_sum }];
  });
  if (parts.length === 0) return NOT_COLLECTED;
  const sum = (index: 0 | 1 | 2 | 3): number => parts.reduce((total, part) => total + part.counts[index], 0);
  const counts: OrderCounts = [sum(0), sum(1), sum(2), sum(3)];
  const ordered = counts.reduce((total, count) => total + count, 0);
  if (ordered < MIN_OBSERVATIONS) return { state: 'too_few', ordered, counts, shares: null, mean: null };
  const rankSum = parts.reduce((total, part) => total + part.rankSum, 0);
  const shares: OrderCounts = [counts[0] / ordered, counts[1] / ordered, counts[2] / ordered, counts[3] / ordered];
  return { state: 'ok', ordered, counts, shares, mean: rankSum / ordered };
}
