import { acrossEngines, hasRate, validAnswers } from './prompt-model';
import type { RateReading, RateReason } from './strip-model';
import type { EngineSummary, MetricCell } from '@/lib/api/types';
import { rateState } from '@/lib/stats';
import type { SortKey } from '@/lib/tables/table-state';

/**
 * Plain data and functions of the rate columns and the sorting of Topics & Prompts (parity spec G21 to G24,
 * G40 and G41, ADR-DS-022 decisions 3 and 5): the average of the engines in scope, one engine's cell as a
 * figure, the engine that does best, and the order of rows. The tables put words and cells to it.
 */

/** The cells of an engine a column can show. */
export type CellMetric = 'mentioned' | 'cited' | 'share_of_voice';

/** The answers of a cell that count, when they are whole: a topic's in `pooled`, a prompt's in its numerator. */
const successesOf = (cell: MetricCell): number | null => {
  if (cell.pooled != null) return cell.pooled.successes;
  return Number.isInteger(cell.numerator) ? cell.numerator : null;
};

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

const none = (reason: RateReason): RateReading => ({
  state: 'none',
  value: null,
  answers: 0,
  successes: null,
  reason,
});

/** An average over engines: the figure, how many engines took part in it (the label "avg of N"), and every answer the cells hold. */
export interface AverageRate extends RateReading {
  engines: number;
  /** The answers of all the cells, valid or not: what a cell without a rate says there were. */
  observations: number;
}

/**
 * The equal weight average of the engines' rates (ADR-DS-022 decision 3), over the engines that show a rate of
 * their own (`hasRate`: at least `MIN_OBSERVATIONS` valid answers), so `engines`, the "N" of "avg of N", is the
 * number of percents in the engines' columns, and the top engine is one of them. An engine without a rate is left
 * out, not counted as 0. When none shows one but some has a value, the average is insufficient (parity spec D-1)
 * and `answers` are those of the engine with most, which is what the pill says; when none has a value there is
 * no rate, for no answer or none valid. A cell that is not there (`undefined`) is an engine without an answer.
 */
export function averageRate(cells: readonly (MetricCell | undefined)[]): AverageRate {
  const present = cells.filter((cell): cell is MetricCell => cell !== undefined);
  const observations = sum(present.map((cell) => cell.n_observations));
  const average = acrossEngines(present);
  if (average === null) {
    const valued = present.filter((cell) => cell.value !== null);
    if (valued.length === 0) {
      return { ...none(observations === 0 ? 'noAnswers' : 'noneValid'), engines: 0, observations };
    }
    const answers = Math.max(...valued.map(validAnswers));
    return { state: 'insufficient', value: null, answers, successes: null, reason: null, engines: 0, observations };
  }
  const rated = present.filter(hasRate);
  // One cell whose count is not whole leaves the pooled count unknown rather than rounded
  const successes = rated
    .map(successesOf)
    .reduce<number | null>((total, count) => (total === null || count === null ? null : total + count), 0);
  return {
    state: 'ok',
    value: average.value,
    answers: sum(rated.map(validAnswers)),
    successes,
    reason: null,
    engines: average.engines,
    observations,
  };
}

/**
 * One engine's cell as a figure, as the strip reads the engine over its prompts: Mentioned and Cited count the
 * valid answers, share of voice the valid answers that name a tracked brand (it has no count of successes: its
 * numerator is a sum of shares). Fewer than `MIN_OBSERVATIONS` of them and the figure is insufficient. Without
 * any the reason is the first that applies: no answer, none valid, or (share of voice) no brand named.
 */
export function cellFigure(engine: EngineSummary | undefined, metric: CellMetric): RateReading {
  const cell = engine?.[metric];
  if (engine === undefined || cell === undefined) return none('noAnswers');
  const answers = validAnswers(cell);
  const state = rateState(answers);
  if (state === 'none') {
    if (engine.mentioned.n_observations === 0) return none('noAnswers');
    return none(validAnswers(engine.mentioned) === 0 ? 'noneValid' : 'noBrandNamed');
  }
  return {
    state,
    value: state === 'ok' ? cell.value : null,
    answers,
    successes: metric === 'share_of_voice' ? null : successesOf(cell),
    reason: null,
  };
}

/** An engine and its mention rate; `null` where it has none to show. */
export interface EngineRate {
  code: string;
  rate: number | null;
}

/** The mention rate of each engine in scope, in the order of `codes`: one with too few valid answers has none. */
export function engineRatesOf(codes: readonly string[], cells: readonly EngineSummary[]): EngineRate[] {
  return codes.map((code) => ({
    code,
    rate: cellFigure(
      cells.find((cell) => cell.engine_code === code),
      'mentioned',
    ).value,
  }));
}

/**
 * The engine with the highest mention rate (ADR-DS-022 decision 5: a pointer, not a ranking). A tie goes to the
 * engine that comes first; `null` when no engine has a rate.
 */
export function topEngine(rates: readonly EngineRate[]): { code: string; rate: number } | null {
  let best: { code: string; rate: number } | null = null;
  for (const { code, rate } of rates) {
    if (rate !== null && (best === null || rate > best.rate)) best = { code, rate };
  }
  // A best rate of 0 means no engine names the brand: there is no engine to point to
  return best === null || best.rate === 0 ? null : best;
}

/** What a column sorts by: a rate or a count, or text. `null` is no value, which sorts after every row that has one. */
export type SortValue = number | string | null;

/** The order of two values; one without a value comes last whichever way the sort runs (12-tables.md section 7). */
function compareValues(a: SortValue, b: SortValue, desc: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
  return desc ? -order : order;
}

/**
 * The rows in the order of the sort keys (at most two), a value that is not there last, rows that tie on every key
 * by `nameOf` A to Z, and rows that tie on that in the order given (the sort is stable). `rows` is left as it is.
 */
export function sortByKeys<T>(
  rows: readonly T[],
  keys: readonly SortKey[],
  valueOf: (row: T, id: string) => SortValue,
  nameOf: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const order = compareValues(valueOf(a, key.id), valueOf(b, key.id), key.desc);
      if (order !== 0) return order;
    }
    return nameOf(a).localeCompare(nameOf(b));
  });
}
