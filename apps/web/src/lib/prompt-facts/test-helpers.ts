import type { EngineFacts, EngineSummaryWithFacts, FactsRow } from './types';
import type { EntityCells, MetricCell } from '@/lib/api/types';

/** A prompt's cell: `k` of `n` valid answers. */
export const cellOf = (k: number, n: number, observations = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: observations,
  pooled: null,
});

/** A topic's cell: `rate` over `prompts` prompts, resting on `answers` valid answers. */
export const topicCell = (rate: number, prompts: number, answers: number): MetricCell => ({
  value: rate,
  numerator: rate * prompts,
  denominator: prompts,
  n_observations: answers,
  pooled: { successes: Math.round(rate * answers), trials: answers },
});

export const entityCells = (entityId: string, mentioned: MetricCell): EntityCells => ({
  entity_id: entityId,
  mentioned,
  share_of_voice: cellOf(0, 0),
});

interface EngineInput extends EngineFacts {
  /** Valid answers of the engine (the `mentioned` cell's denominator). */
  valid?: number;
  mentioned?: MetricCell;
  entities?: EntityCells[];
}

/** An engine of a row with `valid` valid answers and the given facts. */
export function engine(
  code: string,
  { valid = 10, mentioned, entities, ...facts }: EngineInput = {},
): EngineSummaryWithFacts {
  const none = cellOf(0, valid);
  return {
    engine_code: code,
    mentioned: mentioned ?? none,
    cited: none,
    outcomes: { mentioned_and_cited: none, mentioned_only: none, cited_only: none, neither: none },
    share_of_voice: cellOf(0, 0),
    ...(entities === undefined ? {} : { entities }),
    ...facts,
  };
}

export const rowOf = (...engines: EngineSummaryWithFacts[]): FactsRow => ({ engines });
