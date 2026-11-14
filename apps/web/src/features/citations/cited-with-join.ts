import type { CitedWith, SourceDomainRow, SourcePageRow } from '@/lib/citations/types';

/**
 * "Cited with" of a page (WB-CIT-11, plan Q6). The pages route has no such block (it answers 422 for it), so a
 * page shows its domain's, joined from the domains read by registrable domain and role entity.
 */

/** The domain's entity; the domain is not among the rows read (`outside`); or the domain names none. */
export type CitedWithJoin = { state: 'found'; citedWith: CitedWith } | { state: 'outside' } | { state: 'none' };

export function joinCitedWith(
  page: Pick<SourcePageRow, 'registrable_domain' | 'role_entity_id'>,
  domains: readonly SourceDomainRow[],
): CitedWithJoin {
  const domain = domains.find(
    (row) => row.registrable_domain === page.registrable_domain && row.role_entity_id === page.role_entity_id,
  );
  if (domain === undefined) return { state: 'outside' };
  return domain.cited_with === undefined || domain.cited_with === null
    ? { state: 'none' }
    : { state: 'found', citedWith: domain.cited_with };
}
