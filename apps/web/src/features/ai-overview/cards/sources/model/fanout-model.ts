import type { EngineCode, Schemas } from '@/lib/api/types';

/**
 * The rows and the standing of the fan-out card, as figures (WP-37 plan T3). Pure: numbers and text in, numbers and
 * text out. A query's share is its answers over `meta.answers`, the valid answers in scope on the engines that show
 * their queries, and nothing else is its denominator. Engines that do not show their queries are not exposed: that
 * is never drawn as 0. The query text is provider text and leaves this file untouched, for React to draw as text.
 */

type FanoutPage = Schemas['FanoutQueryPage'];
type FanoutCited = Schemas['FanoutCitedDomain'];

export interface FanoutFigures {
  /** Engine and normalized text: one query on two engines is two rows. */
  id: string;
  /** Its most common spelling. Untrusted. */
  text: string;
  engine: EngineCode;
  /** Answers that issued it, each once. */
  observations: number;
  /** `meta.answers`: valid answers in scope on the engines that show their queries. */
  answers: number;
  /** `observations` over `answers`; `null` when no answer is counted, never 0. */
  share: number | null;
  prompts: number;
  /** One of the domains of the sources in those answers is yours: an association, not a link. */
  ownCited: boolean;
  /** At most 5, the most units first, as the route gave them. */
  cited: readonly FanoutCited[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** The rows of a page in the order the route gave them (answers, descending). */
export function fanoutFigures(page: FanoutPage): FanoutFigures[] {
  const answers = page.meta.answers;
  return page.data.map((row) => ({
    id: `${row.engine_code}|${row.normalized_text}`,
    text: row.query_text,
    engine: row.engine_code,
    observations: row.observations,
    answers,
    share: answers > 0 ? row.observations / answers : null,
    prompts: row.prompts,
    ownCited: row.cited_domains.some((domain) => domain.domain_role === 'own'),
    cited: row.cited_domains,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }));
}

/**
 * Where the read stands.
 * - `not_exposed`: no engine in scope shows its queries (`without` names them): nothing can be said, not even 0.
 * - `no_answers`: the engines that show their queries have no valid answer in the window.
 * - `none_issued`: answers were counted (`answers`) and none issued a query.
 * - `none_listed`: answers issued queries and no query reaches `min` answers.
 * - `read`: queries are listed (`listed` of `total`); `withFanout` answers issued one, `truncated` have a stored
 *   list shorter than the queries they issued, `without` are the engines in scope that show none.
 */
export type FanoutStanding =
  | { kind: 'not_exposed'; without: readonly EngineCode[] }
  | { kind: 'no_answers' }
  | { kind: 'none_issued'; answers: number }
  | { kind: 'none_listed'; min: number }
  | {
      kind: 'read';
      answers: number;
      withFanout: number;
      truncated: number;
      without: readonly EngineCode[];
      listed: number;
      total: number;
    };

export function fanoutStanding({ meta, data, page }: FanoutPage): FanoutStanding {
  const without = meta.engines_without_fanout;
  if (meta.engine_codes.length === 0 && without.length > 0) return { kind: 'not_exposed', without };
  if (meta.answers === 0) return { kind: 'no_answers' };
  if (meta.answers_with_fanout === 0) return { kind: 'none_issued', answers: meta.answers };
  if (data.length === 0) return { kind: 'none_listed', min: meta.min_support };
  return {
    kind: 'read',
    answers: meta.answers,
    withFanout: meta.answers_with_fanout,
    truncated: meta.answers_truncated,
    without,
    listed: data.length,
    total: page.total,
  };
}
