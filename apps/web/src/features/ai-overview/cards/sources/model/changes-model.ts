import type { DomainRole, SourceChangePage } from '@/lib/citations/types';

/**
 * The new and lost sources as figures (WP-37 plan T4, rows CH-22 and WB-OV-12). Pure: numbers in, numbers out, no
 * text. The route decides which domains are new or lost (docs/16 C5 and C6, `min_support`); nothing here filters,
 * adds or recounts them.
 */

export type ChangeKind = 'new' | 'lost';

export interface ChangeFigures {
  /** One per row: a domain that matched two roles or two entities is two rows with two ids. */
  id: string;
  domain: string;
  role: DomainRole;
  /** The row is the project's own domain. */
  own: boolean;
  /** Citation units in the window. */
  unitsNow: number;
  /** Citation units in the window it is compared with. */
  unitsBefore: number;
  /** What the bar draws: the units now of a new domain, the units before of a lost one. */
  units: number;
}

/** The rows of a page in the order the route gave them (most units first). */
export function changeRows(page: SourceChangePage, kind: ChangeKind): ChangeFigures[] {
  return page.data.map((row) => ({
    id: `${row.registrable_domain}|${row.domain_role}|${row.role_entity_id ?? ''}`,
    domain: row.registrable_domain,
    role: row.domain_role,
    own: row.domain_role === 'own',
    unitsNow: row.current_units,
    unitsBefore: row.previous_units,
    units: kind === 'new' ? row.current_units : row.previous_units,
  }));
}

/**
 * How many domains are new in the window (WB-OV-12): `page.total` of the new list, the rows the route holds and not
 * the rows it sent. `null`, never 0, when it cannot be told: the page is not read, or the window before has no
 * answers (or they are not known), because then every domain would look new. Also what the key changes feed reuses.
 */
export function newSourcesCount(
  page: Pick<SourceChangePage, 'page'> | undefined,
  previousAnswers: number | null | undefined,
): number | null {
  if (page === undefined || previousAnswers === null || previousAnswers === undefined || previousAnswers <= 0) {
    return null;
  }
  return page.page.total;
}
