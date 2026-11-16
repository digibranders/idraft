import { engineOf } from './engine-rows';
import type { FactsRow, PositionCounts } from './types';
import { equalWeightAverage, MIN_OBSERVATIONS } from '@/lib/stats';

/** An engine needs this many ordered answers before its mean position is shown. */
export const POSITION_MIN_LISTS = 2;

/** Why a position is not there; the words belong to the column. */
export type PositionUnknown =
  /** No engine in scope carries position counts: the backend has not built them. */
  | 'not_collected'
  /** No valid answer on the engines in scope. */
  | 'unobserved'
  /** The brand was never named, over fewer than `MIN_OBSERVATIONS` answers: too few to say it has no position. */
  | 'too_few_answers'
  /** The brand was never named in enough answers to say so. */
  | 'never_named'
  /** Named, but in fewer than `POSITION_MIN_LISTS` ordered answers on every engine. */
  | 'too_few_lists';

export interface PositionCountsOf {
  mentions: number;
  /** Ordered answers: the ones with a position. */
  ordered_answers: number;
  /** Valid answers. */
  answers: number;
}

export type PositionReading =
  | ({ state: 'ok'; value: number; used: number; codes: string[] } & PositionCountsOf)
  | ({ state: 'unknown'; reason: PositionUnknown } & PositionCountsOf);

const ZERO: PositionCounts = { rank_sum: 0, ordered_answers: 0, mentions: 0, answers: 0 };

/**
 * The position over the rows and engines given: each engine's own mean (the counts of the rows added up, then
 * `rank_sum / ordered_answers`, only with at least `POSITION_MIN_LISTS` ordered answers), then the equal-weight
 * average of the engines that have one (`used` of them, by `codes`), never one pooled mean. The counts say what the
 * engines in scope rest on. 1 is named first, lower is better.
 */
export function positionOf(rows: readonly FactsRow[], scope: readonly string[]): PositionReading {
  const engines = scope.map((code) => {
    const parts = rows.flatMap((row) => engineOf(row, code)?.position ?? []);
    const counts = parts.reduce<PositionCounts>(
      (total, part) => ({
        rank_sum: total.rank_sum + part.rank_sum,
        ordered_answers: total.ordered_answers + part.ordered_answers,
        mentions: total.mentions + part.mentions,
        answers: total.answers + part.answers,
      }),
      ZERO,
    );
    const mean = counts.ordered_answers >= POSITION_MIN_LISTS ? counts.rank_sum / counts.ordered_answers : null;
    return { code, collected: parts.length > 0, counts, mean };
  });
  const total = (key: 'mentions' | 'ordered_answers' | 'answers'): number =>
    engines.reduce((sum, engine) => sum + engine.counts[key], 0);
  const shared: PositionCountsOf = {
    mentions: total('mentions'),
    ordered_answers: total('ordered_answers'),
    answers: total('answers'),
  };
  if (!engines.some((engine) => engine.collected)) return { state: 'unknown', reason: 'not_collected', ...shared };
  if (shared.answers === 0) return { state: 'unknown', reason: 'unobserved', ...shared };
  const average = equalWeightAverage(engines.map((engine) => engine.mean));
  if (average.value !== null) {
    return {
      state: 'ok',
      value: average.value,
      used: average.used,
      codes: engines.filter((engine) => engine.mean !== null).map((engine) => engine.code),
      ...shared,
    };
  }
  if (shared.mentions === 0) {
    return {
      state: 'unknown',
      reason: shared.answers < MIN_OBSERVATIONS ? 'too_few_answers' : 'never_named',
      ...shared,
    };
  }
  return { state: 'unknown', reason: 'too_few_lists', ...shared };
}
