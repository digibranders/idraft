import { answersOn, engineOf } from './engine-rows';
import type { FactsRow, SentimentCounts, SentimentKey } from './types';
import { equalWeightAverage, MIN_OBSERVATIONS } from '@/lib/stats';

/** An engine needs this many classified mentions before its shares are shown. */
export const SENTIMENT_MIN = MIN_OBSERVATIONS;

export const SENTIMENT_KEYS: readonly SentimentKey[] = ['positive', 'neutral', 'negative', 'mixed'];

/**
 * `none`: no engine in scope classifies sentiment (the backend sent `null` for each). `not_collected`: the backend sends
 * no sentiment at all yet. `unobserved`: the engines that classify have no valid answer. `insufficient`: none of
 * them has `SENTIMENT_MIN` classified mentions. `ok`: the four shares are there.
 */
export type SentimentState = 'ok' | 'none' | 'not_collected' | 'unobserved' | 'insufficient';

export interface SentimentReading {
  state: SentimentState;
  /** Four shares that add up to 1, never one score. Only when `state` is `ok`. */
  shares: Readonly<Record<SentimentKey, number>> | null;
  /** The engines whose shares the average is over. */
  codes: string[];
  /** Classified mentions on the engines that classify. */
  mentions: number;
  /** Valid answers on the engines that classify. */
  answers: number;
}

export const mentionsOfSentiment = (counts: SentimentCounts): number =>
  SENTIMENT_KEYS.reduce((sum, key) => sum + counts[key], 0);

/**
 * The sentiment of the rows over the engines given: each classifying engine's four shares (its counts added over the
 * rows), then the equal-weight average of the engines with at least `SENTIMENT_MIN` classified mentions.
 */
export function sentimentOf(rows: readonly FactsRow[], scope: readonly string[]): SentimentReading {
  const known = scope.map((code) => ({ code, parts: rows.flatMap((row) => engineOf(row, code)?.sentiment ?? []) }));
  const reported = scope.filter((code) => rows.some((row) => engineOf(row, code)?.sentiment !== undefined));
  const none = (state: SentimentState, mentions = 0, answers = 0): SentimentReading => ({
    state,
    shares: null,
    codes: [],
    mentions,
    answers,
  });
  if (reported.length === 0) return none('not_collected');
  const classifying = known.filter((engine) => engine.parts.length > 0);
  if (classifying.length === 0) return none('none');
  const engines = classifying.map(({ code, parts }) => {
    const counts = parts.reduce<SentimentCounts>(
      (total, part) => ({
        positive: total.positive + part.positive,
        neutral: total.neutral + part.neutral,
        negative: total.negative + part.negative,
        mixed: total.mixed + part.mixed,
      }),
      { positive: 0, neutral: 0, negative: 0, mixed: 0 },
    );
    return {
      code,
      counts,
      mentions: mentionsOfSentiment(counts),
      answers: rows.reduce((sum, row) => sum + answersOn(row, code), 0),
    };
  });
  const mentions = engines.reduce((sum, engine) => sum + engine.mentions, 0);
  const answers = engines.reduce((sum, engine) => sum + engine.answers, 0);
  if (answers === 0) return none('unobserved', mentions, answers);
  const used = engines.filter((engine) => engine.mentions >= SENTIMENT_MIN);
  if (used.length === 0) return none('insufficient', mentions, answers);
  const share = (key: SentimentKey): number =>
    equalWeightAverage(used.map((engine) => engine.counts[key] / engine.mentions)).value ?? 0;
  return {
    state: 'ok',
    shares: {
      positive: share('positive'),
      neutral: share('neutral'),
      negative: share('negative'),
      mixed: share('mixed'),
    },
    codes: used.map((engine) => engine.code),
    mentions,
    answers,
  };
}

/**
 * The four shares as whole percents that add up to 100 (largest remainder; a tie goes to the key first in
 * `SENTIMENT_KEYS`), so a line that prints all four never reads 99 or 101. The counts behind them stay exact.
 */
export function wholePercents(shares: Readonly<Record<SentimentKey, number>>): Record<SentimentKey, number> {
  const parts = SENTIMENT_KEYS.map((key) => {
    const exact = shares[key] * 100;
    return { key, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  const missing = 100 - parts.reduce((sum, part) => sum + part.floor, 0);
  const bumped = new Set(
    [...parts]
      .sort((a, b) => b.rest - a.rest || SENTIMENT_KEYS.indexOf(a.key) - SENTIMENT_KEYS.indexOf(b.key))
      .slice(0, Math.max(0, missing))
      .map((part) => part.key),
  );
  const whole = (key: SentimentKey): number =>
    (parts.find((part) => part.key === key)?.floor ?? 0) + (bumped.has(key) ? 1 : 0);
  return { positive: whole('positive'), neutral: whole('neutral'), negative: whole('negative'), mixed: whole('mixed') };
}
