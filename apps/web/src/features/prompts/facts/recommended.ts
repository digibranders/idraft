import { averageOfEngines, engineRateOver } from './engine-rows';
import type { FactsRow } from './types';

/**
 * Why a recommendation rate is not there: `not_collected` (the backend sends none), `not_classified` (the engines in
 * scope are not classified for it), `too_few_answers` (no classified engine has `MIN_OBSERVATIONS` valid answers).
 */
export type RecommendedUnknown = 'not_collected' | 'not_classified' | 'too_few_answers';

export type RecommendedReading =
  | { state: 'ok'; value: number; codes: string[]; answers: number }
  | { state: 'unknown'; reason: RecommendedUnknown; answers: number };

/** The recommendation rate over the rows: each classified engine prompt weighted, then the equal-weight average. */
export function recommendedOf(rows: readonly FactsRow[], scope: readonly string[]): RecommendedReading {
  const sent = rows.some((row) =>
    row.engines.some((engine) => scope.includes(engine.engine_code) && engine.recommended !== undefined),
  );
  if (!sent) return { state: 'unknown', reason: 'not_collected', answers: 0 };
  const rates = scope
    .filter((code) =>
      rows.some((row) => row.engines.some((engine) => engine.engine_code === code && engine.recommended != null)),
    )
    .map((code) => engineRateOver(rows, code, (engine) => engine.recommended));
  if (rates.length === 0) return { state: 'unknown', reason: 'not_classified', answers: 0 };
  const answers = rates.reduce((sum, entry) => sum + entry.answers, 0);
  const average = averageOfEngines(rates);
  if (average.value === null) return { state: 'unknown', reason: 'too_few_answers', answers };
  return { state: 'ok', value: average.value, codes: average.used, answers };
}
