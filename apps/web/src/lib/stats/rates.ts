/**
 * Rates from counts: k successes in n valid observations (docs/17-statistical-methodology.md section 4 and
 * docs/20-frontend-specification.md section 5.6). A rate is never shown without enough observations behind it.
 */
export interface Counts {
  k: number;
  n: number;
}

/** Below this many observations a per-prompt rate is shown as "Insufficient", with the count. */
export const MIN_OBSERVATIONS = 4;

export type RateState = 'ok' | 'insufficient' | 'none';

export function rateState(n: number): RateState {
  if (!Number.isFinite(n) || n <= 0) return 'none';
  return n < MIN_OBSERVATIONS ? 'insufficient' : 'ok';
}

/** Counts that can be real: whole, not negative, and no more successes than observations. */
const isValid = ({ k, n }: Counts): boolean => Number.isInteger(k) && Number.isInteger(n) && k >= 0 && k <= n;

/** k / n, or null when the observations are too few to show a rate or the counts cannot be real. */
export function rateOf(counts: Counts): number | null {
  return isValid(counts) && rateState(counts.n) === 'ok' ? counts.k / counts.n : null;
}

export function pooledCounts(items: ReadonlyArray<Counts>): Counts {
  return items.reduce<Counts>((sum, item) => ({ k: sum.k + item.k, n: sum.n + item.n }), { k: 0, n: 0 });
}

/**
 * The default panel rate: the mean of the prompts' own rates, so a prompt with extra replicates does not
 * dominate (17 section 4.1). Prompts without observations, or with counts that cannot be real, take no part.
 * Null when none is left.
 */
export function promptWeightedRate(items: ReadonlyArray<Counts>): number | null {
  const observed = items.filter((item) => item.n >= 1 && isValid(item));
  if (observed.length === 0) return null;
  return observed.reduce((sum, item) => sum + item.k / item.n, 0) / observed.length;
}

/**
 * The average of several engines' rates, each engine counting once. Engines without a rate are left out,
 * and `used` says how many took part, because the label names that number ("avg of 3").
 */
export function equalWeightAverage(rates: ReadonlyArray<number | null>): { value: number | null; used: number } {
  const present = rates.filter((rate): rate is number => rate !== null);
  if (present.length === 0) return { value: null, used: 0 };
  return { value: present.reduce((sum, rate) => sum + rate, 0) / present.length, used: present.length };
}
