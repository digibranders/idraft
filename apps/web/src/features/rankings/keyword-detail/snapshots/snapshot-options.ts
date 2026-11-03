import type { RankCell, SerpSnapshotSummary } from '@/lib/api/types';

export interface SnapshotOption {
  id: string;
  observedAt: string;
  /** The project local day, as the API computed it. */
  observedDate: string;
  depth: number;
  depthReturned: number;
  own: RankCell;
  /** The ranking URL differs from the next older snapshot's; false when either has none. */
  urlChanged: boolean;
  hasAio: boolean;
}

/**
 * The snapshots the picker offers, newest first as the API gives them. `urlChanged` compares each one's
 * ranking URL with the next older row's, and only when both have one: a keyword that ranked nowhere before
 * has not changed its URL by ranking now.
 */
export function snapshotOptions(rows: readonly SerpSnapshotSummary[]): SnapshotOption[] {
  return rows.map((row, index) => {
    const older = rows[index + 1]?.own.url?.canonical_url;
    const here = row.own.url?.canonical_url;
    return {
      id: row.serp_snapshot_id,
      observedAt: row.observed_at,
      observedDate: row.observed_date,
      depth: row.depth_requested,
      depthReturned: row.depth_returned,
      own: row.own,
      urlChanged: here !== undefined && older !== undefined && here !== older,
      hasAio: row.has_ai_overview,
    };
  });
}

/**
 * The value of `obs` for a chosen snapshot: none when it is the latest check, since the address then means
 * "the latest" and a link to it stays right after the next check.
 */
export function normaliseObs(chosen: string | null, latestId: string | null): string | null {
  return chosen !== null && chosen === latestId ? null : chosen;
}

/** The id next to `current` in `ids` (newest first), or null at an end or when `current` is not there. */
export function neighbour(ids: readonly string[], current: string, direction: 'newer' | 'older'): string | null {
  const at = ids.indexOf(current);
  if (at === -1) return null;
  return ids[direction === 'newer' ? at - 1 : at + 1] ?? null;
}
