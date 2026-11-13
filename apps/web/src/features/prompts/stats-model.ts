import type { StatisticsContent } from '@/components/app/metric/statistics-panel';
import type { MetricCell } from '@/lib/api/types';
import { MIN_OBSERVATIONS, rateState, wilsonInterval, type Interval, type RateState } from '@/lib/stats';

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

/** The words of one panel, made by the caller: this file holds no copy. */
export interface StatisticsWords {
  /** "Mention rate". */
  metricName: string;
  engine: { code: string; name: string };
  /** The window, as `formatDateRange` writes it. */
  scopeText: string;
  /** One sentence: what the metric means. */
  definition: string;
  /** The interval's method, in a sentence. */
  methodText: string;
}

/**
 * The statistics panel's content for one rate of one engine of one prompt, from the same row the Stats line shows,
 * so the panel and the line never disagree. A prompt is one prompt, there is no period comparison and no version
 * boundary here, and nothing is pooled across engines.
 */
export function statisticsContent(row: StatsRow, words: StatisticsWords): StatisticsContent {
  const { state, k, n, value, interval } = row;
  const known = state !== 'none';
  return {
    metricName: words.metricName,
    engine: words.engine,
    scopeText: words.scopeText,
    definition: words.definition,
    estimate: {
      value,
      numerator: known ? k : null,
      denominator: known ? n : null,
      noun: 'answers',
      prompts: 1,
      observationWeighted: null,
      insufficient: state === 'insufficient' ? { valid: n, required: MIN_OBSERVATIONS } : null,
    },
    interval: interval === null ? null : { low: interval.low, high: interval.high, methodText: words.methodText },
    comparison: null,
    boundaries: [],
  };
}
