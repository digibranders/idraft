import type { ObservationSummary } from '@/lib/api/types';
import { positionOf, type AnswerCitations } from '@/lib/citations/group-answers';
import type { CitationRow, DomainRole } from '@/lib/citations/types';

/** The answers the section lists, the newest valid ones. */
export const ANSWERS_LISTED = 10;

/** A domain an answer cites beside the own one: how many pages of it the answer names. */
export interface AnswerDomain {
  key: string;
  domain: string;
  role: DomainRole;
  /** Distinct pages of the domain in the answer. */
  units: number;
}

export interface AnswerCitedRow {
  observation: ObservationSummary;
  /**
   * `cited`: an own page is among the sources. `notCited`: it cites sources and none is own. `noSource`: it cites
   * none, which is not the same as Not cited. `unknown`: its citations are not in hand (not read, failed, or past
   * the rows the first page holds); never told as 0.
   */
  state: 'cited' | 'notCited' | 'noSource' | 'unknown';
  /** The first own page in the answer and its place in the sources the answer lists. */
  ownPage: { row: CitationRow; position: { index: number; count: number } } | null;
  /** Own pages beyond the first. */
  moreOwn: number;
  /** The other domains cited, the one with most pages first. */
  others: AnswerDomain[];
}

const distinct = <T>(values: readonly T[]): T[] => [...new Set(values)];

function othersOf(rows: readonly CitationRow[]): AnswerDomain[] {
  const byDomain = new Map<string, { domain: string; role: DomainRole; pages: number[] }>();
  for (const row of rows) {
    if (row.domain_role === 'own') continue;
    const key = `${row.registrable_domain}:${row.domain_role}:${row.role_entity_id ?? ''}`;
    const entry = byDomain.get(key);
    if (entry === undefined)
      byDomain.set(key, { domain: row.registrable_domain, role: row.domain_role, pages: [row.url_id] });
    else entry.pages.push(row.url_id);
  }
  // `sort` is stable, so domains with as many pages stay in the order the answer first names them
  return [...byDomain]
    .map(([key, entry]) => ({ key, domain: entry.domain, role: entry.role, units: distinct(entry.pages).length }))
    .sort((a, b) => b.units - a.units);
}

/**
 * The valid answers of the window (newest first, as the read gives them), each told from its own rows of the
 * citation list: which own page is cited and where, and which other domains are. `groups` is `null` when the list
 * is not in hand.
 */
export function answerRows(
  observations: readonly ObservationSummary[],
  groups: readonly AnswerCitations[] | null,
): AnswerCitedRow[] {
  const byAnswer = new Map((groups ?? []).map((group) => [group.observationId, group]));
  return observations
    .filter((observation) => observation.facts?.is_valid === true)
    .slice(0, ANSWERS_LISTED)
    .map((observation): AnswerCitedRow => {
      const group = byAnswer.get(observation.observation_id);
      if (group === undefined) {
        const none = observation.facts?.total_citation_count === 0;
        return { observation, state: none ? 'noSource' : 'unknown', ownPage: null, moreOwn: 0, others: [] };
      }
      const own = group.rows
        .filter((row) => row.domain_role === 'own')
        .sort((a, b) => a.citation_index - b.citation_index);
      const [first] = own;
      return {
        observation,
        state: first === undefined ? 'notCited' : 'cited',
        ownPage: first === undefined ? null : { row: first, position: positionOf(first, group.rows) },
        moreOwn: Math.max(0, distinct(own.map((row) => row.url_id)).length - 1),
        others: othersOf(group.rows),
      };
    });
}
