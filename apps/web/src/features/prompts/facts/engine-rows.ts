import type { EngineSummaryWithFacts, FactsRow } from './types';
import { validAnswers } from '@/lib/rates/rate-model';
import type { MetricCell } from '@/lib/api/types';
import { equalWeightAverage, rateState } from '@/lib/stats';

/** The engine `code` of a row, or undefined when the row has no answer on it. */
export const engineOf = (row: FactsRow, code: string): EngineSummaryWithFacts | undefined =>
  row.engines.find((engine) => engine.engine_code === code);

/** The valid answers of the row on the engine (a topic row counts them in `pooled`), 0 when the row has none. */
export const answersOn = (row: FactsRow, code: string): number => {
  const engine = engineOf(row, code);
  return engine === undefined ? 0 : validAnswers(engine.mentioned);
};

/** How an engine's rate over several rows came about: the mean of the rows' own rates, and the answers under it. */
export interface EngineRate {
  code: string;
  /** Null when the rows hold fewer valid answers than `MIN_OBSERVATIONS` on the engine. */
  rate: number | null;
  /** Valid answers of the engine over the rows. */
  answers: number;
  /** Rows with a valid answer on the engine, the ones the mean is over. */
  prompts: number;
}

/**
 * The prompt-weighted rate of one engine over the rows: each row with a valid answer counts once, as its own rate (a
 * topic row's cell is already prompt weighted and counts as one). Never pooled over answers. `cells` picks the cell
 * of a row, `undefined` for a row that has none; such a row takes no part. An engine with fewer valid answers than
 * `MIN_OBSERVATIONS` in the rows has no rate: the answers counted are those of the cells that took part.
 */
export function engineRateOver(
  rows: readonly FactsRow[],
  code: string,
  cellOf: (engine: EngineSummaryWithFacts) => MetricCell | null | undefined,
): EngineRate {
  const cells = rows.flatMap((row) => {
    const engine = engineOf(row, code);
    const cell = engine === undefined ? undefined : cellOf(engine);
    return cell === undefined || cell === null || validAnswers(cell) === 0 || cell.value === null ? [] : [cell];
  });
  const answers = cells.reduce((total, cell) => total + validAnswers(cell), 0);
  const rate =
    rateState(answers) === 'ok' ? cells.reduce((sum, cell) => sum + (cell.value ?? 0), 0) / cells.length : null;
  return { code, rate, answers, prompts: cells.length };
}

/** The equal-weight average of the engines that have a rate, and which engines took part. */
export function averageOfEngines(rates: readonly EngineRate[]): { value: number | null; used: string[] } {
  const average = equalWeightAverage(rates.map((entry) => entry.rate));
  return { value: average.value, used: rates.filter((entry) => entry.rate !== null).map((entry) => entry.code) };
}
