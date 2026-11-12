import type { EngineSummary, EntityCells, MentionOut, MetricCell, ObservationDetail, WeekCells } from '@/lib/api/types';

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
function promptWeighted(
  parts: readonly (readonly [successes: number, valid: number])[],
  observations: number,
): MetricCell {
  const rated = parts.filter(([, valid]) => valid > 0);
  const numerator = rated.reduce((sum, [successes, valid]) => sum + successes / valid, 0);
  return {
    ...cell(numerator, rated.length, observations),
    pooled: {
      successes: rated.reduce((sum, [successes]) => sum + successes, 0),
      trials: rated.reduce((sum, [, valid]) => sum + valid, 0),
    },
  };
}

const observationsOf = (members: readonly Counts[]): number =>
  members.reduce((sum, counts) => sum + counts.n_observations, 0);

function weighted(members: readonly Counts[], pick: (counts: Counts) => number): MetricCell {
  return promptWeighted(
    members.map((counts) => [pick(counts), counts.n_valid] as const),
    observationsOf(members),
  );
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
      observationsOf(members),
    ),
  };
}

// The weekly series of `include=series` (backend `summary.py` `summary_weeks` and `_week`): a week starts on Monday
// in the project's zone, and the days given here are already project days.

const WEEK_DAYS = 7;
const dayNumber = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000;
const isoOfDay = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** The Monday of the week a project day is in. */
export function mondayOf(isoDate: string): string {
  const day = dayNumber(isoDate);
  // Day 0 (1970-01-01) was a Thursday, so a Monday is day 4 modulo 7
  return isoOfDay(day - ((((day - 4) % WEEK_DAYS) + WEEK_DAYS) % WEEK_DAYS));
}

/** The Mondays of the weeks the days `first` to `last` touch, oldest first: at most 14 in 92 days. */
export function summaryWeeks(first: string, last: string): string[] {
  const weeks: string[] = [];
  for (let week = dayNumber(mondayOf(first)); week <= dayNumber(last); week += WEEK_DAYS) weeks.push(isoOfDay(week));
  return weeks;
}

/** One point of a series: the week, and the cells of the engine row over the week's answers. */
export const weekCells = (weekStart: string, cells: EngineSummary): WeekCells => ({
  week_start: weekStart,
  mentioned: cells.mentioned,
  cited: cells.cited,
  share_of_voice: cells.share_of_voice,
});

// The cells per tracked entity of `include=entities` (backend `summary.py` `_entity_cells`, `summary_repository.py`
// `entity_counts`): an answer's share of voice set is its mentions with a mention order, so an entity is named by a
// valid answer that has such a mention of it, and takes 1 / the entities the answer names.

/** Entity cells are given for at most this many tracked entities, the own ones first. */
export const ENTITY_CELLS_MAX = 20;

/** A valid answer's fact row and its mentions: what says which tracked entities it names. */
export interface NamedAnswer {
  facts: Facts;
  mentions: readonly Pick<MentionOut, 'entity_id' | 'mention_order'>[];
}

/** The valid answers of a prompt on an engine that name an entity, and the entity's shares of them. */
export interface EntityCounts {
  mentioned: number;
  sov_share: number;
}

export const NOT_NAMED: EntityCounts = { mentioned: 0, sov_share: 0 };

export function entityCountsOf(entityId: string, answers: readonly NamedAnswer[]): EntityCounts {
  const naming = answers.filter(
    ({ facts, mentions }) =>
      facts.is_valid &&
      facts.tracked_entities_mentioned >= 1 &&
      mentions.some((mention) => mention.entity_id === entityId && mention.mention_order !== null),
  );
  return {
    mentioned: naming.length,
    sov_share: naming.reduce((sum, { facts }) => sum + 1 / facts.tracked_entities_mentioned, 0),
  };
}

/** The cells of one entity on one prompt and engine: plain counts of the prompt's valid answers. */
export function promptEntityCells(entityId: string, counts: Counts, named: EntityCounts): EntityCells {
  return {
    entity_id: entityId,
    mentioned: cell(named.mentioned, counts.n_valid, counts.n_observations),
    share_of_voice: cell(named.sov_share, counts.sov_answers, counts.n_observations),
  };
}

/** The cells of one entity on a topic and engine from its prompts: Mentioned prompt weighted, Share of voice by answer. */
export function topicEntityCells(
  entityId: string,
  parts: readonly { counts: Counts; named: EntityCounts }[],
): EntityCells {
  const observations = observationsOf(parts.map(({ counts }) => counts));
  return {
    entity_id: entityId,
    mentioned: promptWeighted(
      parts.map(({ counts, named }) => [named.mentioned, counts.n_valid] as const),
      observations,
    ),
    share_of_voice: cell(
      parts.reduce((sum, { named }) => sum + named.sov_share, 0),
      parts.reduce((sum, { counts }) => sum + counts.sov_answers, 0),
      observations,
    ),
  };
}

/** The entities that get cells from the tracked ones: the own brands first, then the others as given, at most 20. */
export function cellEntityIds(tracked: readonly { entity_id: string; role: 'own' | 'competitor' }[]): string[] {
  return [...tracked]
    .sort((a, b) => Number(a.role !== 'own') - Number(b.role !== 'own'))
    .slice(0, ENTITY_CELLS_MAX)
    .map((entity) => entity.entity_id);
}
