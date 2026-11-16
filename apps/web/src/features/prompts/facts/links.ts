import { answersOn, engineOf } from './engine-rows';
import { LIST_SIZE } from './brands';
import type { DomainRole, FactsRow, TopLink } from './types';

export type LinksUnknown =
  /** The backend sends no cited links yet. */
  | 'not_collected'
  /** No valid answer on the engine in these rows. */
  | 'unobserved';

export interface LinkRow {
  place: number;
  url: string;
  domain: string;
  domainRole: DomainRole;
  /** The page is the own brand's. */
  own: boolean;
  /** Answers of the engine that cited it. */
  answers: number;
}

export interface LinksReading {
  state: 'ok' | 'unknown';
  reason: LinksUnknown | null;
  /** The top `LIST_SIZE`, most cited first, then by address. */
  shown: LinkRow[];
  /** Distinct pages cited, before the cut. */
  total: number;
  /** Valid answers of the engine over the rows: what each link's count is out of. */
  answers: number;
}

/**
 * The pages one engine cited in the answers of the rows, most cited first. Answers of different prompts are different
 * answers, so a page's counts add up over the rows. A page cited in no answer is not listed; an engine with answers and
 * no link gives an empty list, not an unknown.
 */
export function citedLinksOf(rows: readonly FactsRow[], code: string): LinksReading {
  const answers = rows.reduce((sum, row) => sum + answersOn(row, code), 0);
  const lists = rows.flatMap((row) => engineOf(row, code)?.top_links ?? []);
  const collected = rows.some((row) => engineOf(row, code)?.top_links != null);
  if (!collected) return { state: 'unknown', reason: 'not_collected', shown: [], total: 0, answers };
  if (answers === 0) return { state: 'unknown', reason: 'unobserved', shown: [], total: 0, answers };
  const byUrl = new Map<string, TopLink>();
  for (const link of lists) {
    const known = byUrl.get(link.url);
    byUrl.set(link.url, known === undefined ? { ...link } : { ...known, answers: known.answers + link.answers });
  }
  const ranked = [...byUrl.values()]
    .filter((link) => link.answers > 0)
    .sort((a, b) => b.answers - a.answers || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .map((link, index): LinkRow => ({
      place: index + 1,
      url: link.url,
      domain: link.domain,
      domainRole: link.domain_role,
      own: link.domain_role === 'own',
      answers: link.answers,
    }));
  return { state: 'ok', reason: null, shown: ranked.slice(0, LIST_SIZE), total: ranked.length, answers };
}
