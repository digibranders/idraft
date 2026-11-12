import type { MetricCell } from '@/lib/api/types';
import { rateState, wilsonInterval, type Interval, type RateState } from '@/lib/stats';

/**
 * The Stats tab of the prompt inspector (parity spec G100): one rate of one engine over the window, with the 95
 * percent Wilson interval computed in the browser from its counts until the server sends one. Plain data.
 */
export interface StatsRow {
  /** `insufficient`: fewer valid answers than `MIN_OBSERVATIONS`, so the sample is shown and no rate or interval. */
  state: RateState;
  /** The valid answers that count. */
  k: number;
  /** The valid answers. */
  n: number;
  /** Only when `state` is `ok`. */
  value: number | null;
  interval: Interval | null;
}

const NONE: StatsRow = { state: 'none', k: 0, n: 0, value: null, interval: null };

/** A prompt's cell (its numerator and denominator count answers) as a statistic; no cell is no answer. */
export function statsRow(cell: MetricCell | undefined): StatsRow {
  if (cell === undefined) return NONE;
  const { numerator: k, denominator: n } = cell;
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) return NONE;
  const state = rateState(n);
  if (state === 'none') return NONE;
  if (state === 'insufficient') return { state, k, n, value: null, interval: null };
  return { state, k, n, value: k / n, interval: wilsonInterval(k, n) };
}
