import type { EntityRef, SerpOrganicItem, SerpResult } from '@/lib/api/types';

/** What a result is to the project, from the entity role the API gave it (never guessed from a domain). */
export type SerpRowKind = 'own' | 'competitor' | 'watch' | 'other';

export interface SerpRow {
  /** The organic rank as text: unique within one SERP, and what the table keys its rows by. */
  key: string;
  rank: number;
  /** The rank counting the features above it; null when the provider gave none. */
  absolute: number | null;
  kind: SerpRowKind;
  entity: EntityRef | null;
  title: string | null;
  snippet: string | null;
  /** The address as the API canonicalised it: what a link opens. */
  address: string;
  host: string;
  path: string;
}

/** The kind of a result, from its entity's role in the project; a result of no tracked entity is `other`. */
function kindOf(entity: EntityRef | null): SerpRowKind {
  switch (entity?.role) {
    case 'own':
      return 'own';
    case 'competitor':
      return 'competitor';
    case 'watch':
      return 'watch';
    default:
      return 'other';
  }
}

/**
 * The rows of a SERP table, by organic rank. The latest check (`serp-current`) and a dated snapshot
 * (`serp-snapshots/{id}`) give the same result shape, so one model serves both. Two results of one domain
 * stay two rows: the rank is the key.
 */
export function serpRows(items: readonly (SerpResult | SerpOrganicItem)[]): SerpRow[] {
  return [...items]
    .sort((a, b) => a.organic_rank - b.organic_rank)
    .map((item) => ({
      key: String(item.organic_rank),
      rank: item.organic_rank,
      absolute: item.absolute_rank,
      kind: kindOf(item.entity),
      entity: item.entity,
      title: item.title,
      snippet: item.snippet,
      address: item.url.canonical_url,
      host: item.domain.host,
      path: item.url.path,
    }));
}
