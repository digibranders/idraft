import { isValidAnswer } from './latest-model';
import type { ObservationSummary, SummaryEntity } from '@/lib/api/types';

/**
 * The Competitors tab of the prompt inspector (parity spec G98): how many of the valid answers to ONE prompt name
 * each tracked brand. Counted in the browser from the list of the prompt's answers (`facts.competitor_mentions`
 * and `facts.own_mentioned`), with the names and roles of the summary's entity set. A mention is a name in the
 * answer: it says nothing about whether the brand was recommended.
 */

/** The switch's value for the answers of every engine together. */
export const ALL_ENGINES = 'all';

export interface CompetitorRow {
  entityId: string;
  name: string;
  own: boolean;
  /** The valid answers that name the brand. */
  mentions: number;
  /** The valid answers in scope: the "n" of "k of n". */
  answers: number;
  /** `mentions / answers`; `null` when there is no valid answer. */
  share: number | null;
}

export interface CompetitorCounts {
  /** The valid answers of the engine chosen (or of all). */
  answers: number;
  /** The own brand first, then the competitors by mentions (most first) and name. */
  rows: CompetitorRow[];
  /** Any competitor is named in these answers. */
  named: boolean;
  /** How many competitors the project tracks. */
  tracked: number;
}

/** The tracked entities counted over the valid answers of `engine` (an engine code, or `ALL_ENGINES`). */
export function competitorCounts(
  observations: readonly ObservationSummary[],
  entities: readonly SummaryEntity[],
  engine: string,
  /** The engines in scope (the enabled ones); the answers of another are left out. Every engine when not given. */
  inScope?: readonly string[],
): CompetitorCounts {
  const valid = observations.filter(
    (answer) =>
      isValidAnswer(answer) &&
      (inScope === undefined || inScope.includes(answer.engine_code)) &&
      (engine === ALL_ENGINES || answer.engine_code === engine),
  );
  const rows = entities.map((entity): CompetitorRow => {
    const own = entity.role === 'own';
    const mentions = valid.filter((answer) =>
      own
        ? answer.facts?.own_mentioned === true
        : answer.facts?.competitor_mentions.includes(entity.entity_id) === true,
    ).length;
    return {
      entityId: entity.entity_id,
      name: entity.name,
      own,
      mentions,
      answers: valid.length,
      share: valid.length === 0 ? null : mentions / valid.length,
    };
  });
  const ordered = [
    ...rows.filter((row) => row.own),
    ...rows.filter((row) => !row.own).sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)),
  ];
  return {
    answers: valid.length,
    rows: ordered,
    named: rows.some((row) => !row.own && row.mentions > 0),
    tracked: rows.filter((row) => !row.own).length,
  };
}
