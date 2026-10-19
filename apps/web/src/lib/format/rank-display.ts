import type { RankCell, RankChange, UrlRef } from '@/lib/api/types';

/**
 * What the API's rank facts show in a cell (12-tables.md sections 6 and 7.3, 14-badges-status.md section 5).
 * The functions return codes and numbers, never words: the components put the words in through the message
 * catalog, so nothing here depends on the language. The API's facts are trusted only as far as they are
 * complete: a cell that claims a rank without the rank, the depth or the check time shows "pending" rather
 * than a number it cannot stand behind.
 */

/** A move of more than this many places is colored; the API sends no figure for the keyword's normal movement. */
export const EMPHASIS_ABOVE = 2;

/**
 * `stale` is the API's `is_stale` (no good check for 36 hours). `failing` is true when checks after the one
 * shown have failed: the API keeps `current` from the last good check and only counts the failures after it,
 * so a number or `>20` on screen may be older than the latest attempt. `failed` is the keyword that never had a
 * good check at all.
 */
export type RankDisplay =
  | { kind: 'ranked'; rank: number; depth: number; observedAt: string; stale: boolean; failing: boolean }
  | { kind: 'beyond'; depth: number; observedAt: string | null; stale: boolean; failing: boolean }
  | { kind: 'pending' }
  | { kind: 'failed'; observedAt: string | null; stale: boolean };

export type ChangeDisplay =
  | { kind: 'arrow'; direction: 'up' | 'down'; amount: number; tone: 'positive' | 'negative' | 'neutral' }
  | { kind: 'flat' }
  | { kind: 'new' }
  | { kind: 'lost' }
  /** Nothing visible, and words only where they are true: `withinDepth` is `consistent_beyond`, where a rank may exist. */
  | { kind: 'empty'; reason: 'firstCheck' | 'stillBeyond' | 'withinDepth' }
  /** Nothing visible and nothing said: no check has produced a rank to compare. */
  | { kind: 'blank' };

export type UrlDisplay =
  | { kind: 'url'; path: string; full: string; extra: number }
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'failed' };

/** A place in the results: a whole number from 1 up. */
const isPlace = (value: number | null): value is number => value !== null && Number.isInteger(value) && value >= 1;

/**
 * `current` as a cell shows it. `stale` is the API's own `is_stale`, never worked out here; `consecutiveFailures`
 * is the API's count of failed checks since the last good one.
 */
export function rankDisplay(current: RankCell, stale: boolean, consecutiveFailures: number = 0): RankDisplay {
  const failing = Number.isInteger(consecutiveFailures) && consecutiveFailures > 0;
  switch (current.state) {
    case 'ranked':
      return isPlace(current.rank) && isPlace(current.depth_requested) && current.observed_at !== null
        ? {
            kind: 'ranked',
            rank: current.rank,
            depth: current.depth_requested,
            observedAt: current.observed_at,
            stale,
            failing,
          }
        : { kind: 'pending' };
    case 'beyond_depth':
      return isPlace(current.depth_requested)
        ? { kind: 'beyond', depth: current.depth_requested, observedAt: current.observed_at, stale, failing }
        : { kind: 'pending' };
    case 'failed':
      return { kind: 'failed', observedAt: current.observed_at, stale };
    case 'not_checked':
      return { kind: 'pending' };
  }
}

/** How the rank moved since the previous check: an arrow with the places, or New and Lost, or nothing visible. */
export function changeDisplay(change: RankChange): ChangeDisplay {
  switch (change.label) {
    case 'numeric': {
      const value = change.value;
      if (value === null || value === 0) return { kind: 'flat' };
      const amount = Math.abs(value);
      const emphasised = amount > EMPHASIS_ABOVE;
      return value > 0
        ? { kind: 'arrow', direction: 'up', amount, tone: emphasised ? 'positive' : 'neutral' }
        : { kind: 'arrow', direction: 'down', amount, tone: emphasised ? 'negative' : 'neutral' };
    }
    case 'new':
      return { kind: 'new' };
    case 'lost':
      return { kind: 'lost' };
    case 'first_check':
      return { kind: 'empty', reason: 'firstCheck' };
    case 'unchanged_beyond':
      return { kind: 'empty', reason: 'stillBeyond' };
    case 'consistent_beyond':
      return { kind: 'empty', reason: 'withinDepth' };
  }
}

/**
 * The change of a row. Before any good check there is nothing to compare, whatever label the API carries
 * (`first_check`): the Rank cell already says "pending" or "failed", so the Change cell says nothing at all.
 */
export function rowChangeDisplay(current: RankCell, change: RankChange): ChangeDisplay {
  return current.state === 'not_checked' || current.state === 'failed' ? { kind: 'blank' } : changeDisplay(change);
}

/** The own URL that ranks, with how many more of the project's URLs rank; "none" when nothing ranks. */
export function urlDisplay(current: RankCell, rankingUrlCount: number): UrlDisplay {
  if (current.state === 'not_checked') return { kind: 'pending' };
  if (current.state === 'failed') return { kind: 'failed' };
  const url: UrlRef | null = current.state === 'ranked' ? current.url : null;
  if (url === null) return { kind: 'none' };
  const extra = Number.isInteger(rankingUrlCount) ? Math.max(0, rankingUrlCount - 1) : 0;
  return { kind: 'url', path: url.path, full: url.canonical_url, extra };
}
