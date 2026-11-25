import type { components } from '@/lib/api/schema';

/**
 * The SEO Ranking tab's shaping: tracked keywords with the own rank and each competitor's rank from the latest check
 * (`include=competitor_ranks`), the rank distribution per entity, and the competitor with the most keywords in the top 10.
 */

type KeywordRowApi = components['schemas']['TrackedKeywordRow'];
type KeywordPage = components['schemas']['TrackedKeywordPage'];

export interface RankedEntity {
  id: string;
  name: string;
}

export interface KeywordRow {
  id: string;
  text: string;
  /** Entity id to its rank at the latest check; `null` is not in the results checked. */
  ranks: ReadonlyMap<string, number | null>;
  /** The competitors ranked above the own brand on this keyword. */
  competitorsAhead: number;
}

export interface KeywordTable {
  own: RankedEntity;
  competitors: readonly RankedEntity[];
  rows: readonly KeywordRow[];
  /** The tracked keywords of the project, which may be more than the page read. */
  total: number;
  truncated: boolean;
  leader: { name: string; topTen: number } | undefined;
  /** The mean rank of your brand over the keywords it ranks for; `null` when it ranks for none. */
  ownAverage: number | null;
}

export type Bucket = 'top3' | 'top10' | 'top20' | 'beyond' | 'none';

const OWN: RankedEntity = { id: 'own', name: 'You' };

/** Where a rank falls: 1 to 3, 4 to 10, 11 to 20, 21 and below, or not ranked in the results checked. */
export function bucketOf(rank: number | null): Bucket {
  if (rank === null) return 'none';
  if (rank <= 3) return 'top3';
  if (rank <= 10) return 'top10';
  if (rank <= 20) return 'top20';
  return 'beyond';
}

export function bucketCounts(rows: readonly KeywordRow[], entityId: string): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { top3: 0, top10: 0, top20: 0, beyond: 0, none: 0 };
  for (const row of rows) counts[bucketOf(row.ranks.get(entityId) ?? null)] += 1;
  return counts;
}

const rankOf = (cell: { rank: number | null } | undefined): number | null => cell?.rank ?? null;

export function keywordTable(page: KeywordPage): KeywordTable {
  const competitors = new Map<string, RankedEntity>();
  for (const row of page.data) {
    for (const entry of row.competitor_ranks ?? []) {
      competitors.set(entry.entity.entity_id, { id: entry.entity.entity_id, name: entry.entity.canonical_name });
    }
  }
  const rows = page.data.map((row: KeywordRowApi): KeywordRow => {
    const own = rankOf(row.state.current);
    const ranks = new Map<string, number | null>([[OWN.id, own]]);
    let ahead = 0;
    for (const entry of row.competitor_ranks ?? []) {
      const rank = rankOf(entry.current);
      ranks.set(entry.entity.entity_id, rank);
      if (rank !== null && (own === null || rank < own)) ahead += 1;
    }
    return { id: row.tracked_keyword_id, text: row.keyword.normalized_text, ranks, competitorsAhead: ahead };
  });
  const list = [...competitors.values()].sort((a, b) => a.name.localeCompare(b.name));
  const tops = list.map((entity) => {
    const counts = bucketCounts(rows, entity.id);
    return { name: entity.name, topTen: counts.top3 + counts.top10 };
  });
  const leader = tops.sort((a, b) => b.topTen - a.topTen)[0];
  const ownRanks = rows.flatMap((row) => {
    const rank = row.ranks.get(OWN.id) ?? null;
    return rank === null ? [] : [rank];
  });
  return {
    own: OWN,
    competitors: list,
    rows,
    total: page.page.total,
    truncated: page.page.has_more,
    leader: leader === undefined || leader.topTen === 0 ? undefined : leader,
    ownAverage: ownRanks.length === 0 ? null : ownRanks.reduce((sum, rank) => sum + rank, 0) / ownRanks.length,
  };
}
