import type { EngineSummary, MetricCell, ObservationDetail } from '@/lib/api/types';

/**
 * The arithmetic of the prompts summary, as the API does it (backend `api/ai/summary.py` and
 * `summary_repository.py`, docs/16 sections 3 to 5): counts per prompt and engine from the fact rows, cells
 * of one prompt from them, and the cells of a topic from the counts of its prompts. Pure: the handler decides
 * which answers and which prompts belong to a window.
 */

type Facts = NonNullable<ObservationDetail['facts']>;

export interface Counts {
  /** Every answer with a current fact row, valid or not. */
  n_observations: number;
  n_valid: number;
  mentioned: number;
  cited: number;
  mentioned_and_cited: number;
  mentioned_only: number;
  cited_only: number;
  neither: number;
  /** Valid answers that name at least one tracked entity, and the own brands' shares of them. */
  sov_answers: number;
  sov_share: number;
}

export const NO_COUNTS: Counts = {
  n_observations: 0,
  n_valid: 0,
  mentioned: 0,
  cited: 0,
  mentioned_and_cited: 0,
  mentioned_only: 0,
  cited_only: 0,
  neither: 0,
  sov_answers: 0,
  sov_share: 0,
};

/** The counts of the fact rows of one prompt on one engine. */
export function countsOf(rows: readonly Facts[]): Counts {
  const valid = rows.filter((facts) => facts.is_valid);
  const count = (test: (facts: Facts) => boolean): number => valid.filter(test).length;
  const naming = valid.filter((facts) => facts.tracked_entities_mentioned >= 1);
  return {
    n_observations: rows.length,
    n_valid: valid.length,
    mentioned: count((facts) => facts.own_mentioned),
    cited: count((facts) => facts.own_domain_cited),
    mentioned_and_cited: count((facts) => facts.own_mentioned && facts.own_domain_cited),
    mentioned_only: count((facts) => facts.own_mentioned && !facts.own_domain_cited),
    cited_only: count((facts) => !facts.own_mentioned && facts.own_domain_cited),
    neither: count((facts) => !facts.own_mentioned && !facts.own_domain_cited),
    sov_answers: naming.length,
    // The own share of an answer: the tracked entities it names that are not competitors, over all it names
    sov_share: naming.reduce(
      (sum, facts) =>
        sum + (facts.tracked_entities_mentioned - facts.competitor_mentions.length) / facts.tracked_entities_mentioned,
      0,
    ),
  };
}

/** `numerator` of `denominator`, `value` null when there is nothing to divide by. */
const cell = (numerator: number, denominator: number, observations: number): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: observations,
  pooled: null,
});

/** The cells of one prompt on one engine: plain counts of valid answers. */
export function promptCells(engineCode: string, counts: Counts): EngineSummary {
  const { n_valid: valid, n_observations: total } = counts;
  return {
    engine_code: engineCode,
    mentioned: cell(counts.mentioned, valid, total),
    cited: cell(counts.cited, valid, total),
    outcomes: {
      mentioned_and_cited: cell(counts.mentioned_and_cited, valid, total),
      mentioned_only: cell(counts.mentioned_only, valid, total),
      cited_only: cell(counts.cited_only, valid, total),
      neither: cell(counts.neither, valid, total),
    },
    share_of_voice: cell(counts.sov_share, counts.sov_answers, total),
  };
}

/**
 * The prompt weighted cell of a topic: each prompt with a valid answer counts once, as its rate. The numerator
 * is the sum of those rates (not a count of answers), the denominator the number of such prompts, and `pooled`
 * the answers behind them.
 */
function weighted(members: readonly Counts[], pick: (counts: Counts) => number): MetricCell {
  const rated = members.filter((counts) => counts.n_valid > 0);
  const numerator = rated.reduce((sum, counts) => sum + pick(counts) / counts.n_valid, 0);
  return {
    ...cell(
      numerator,
      rated.length,
      members.reduce((sum, counts) => sum + counts.n_observations, 0),
    ),
    pooled: {
      successes: rated.reduce((sum, counts) => sum + pick(counts), 0),
      trials: rated.reduce((sum, counts) => sum + counts.n_valid, 0),
    },
  };
}

/** The cells of a topic on one engine from the counts of its prompts. Share of voice stays one answer one weight. */
export function topicCells(engineCode: string, members: readonly Counts[]): EngineSummary {
  return {
    engine_code: engineCode,
    mentioned: weighted(members, (counts) => counts.mentioned),
    cited: weighted(members, (counts) => counts.cited),
    outcomes: {
      mentioned_and_cited: weighted(members, (counts) => counts.mentioned_and_cited),
      mentioned_only: weighted(members, (counts) => counts.mentioned_only),
      cited_only: weighted(members, (counts) => counts.cited_only),
      neither: weighted(members, (counts) => counts.neither),
    },
    share_of_voice: cell(
      members.reduce((sum, counts) => sum + counts.sov_share, 0),
      members.reduce((sum, counts) => sum + counts.sov_answers, 0),
      members.reduce((sum, counts) => sum + counts.n_observations, 0),
    ),
  };
}
