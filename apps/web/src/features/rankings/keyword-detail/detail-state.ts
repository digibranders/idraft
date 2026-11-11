import type { TrackedKeywordState } from '@/lib/api/types';

/**
 * What every section of the page says about the keyword itself (Decision 9 of the plan): one model, so a
 * stale keyword is stale in the header, the strip and each panel, and a pending one gives the same reason
 * everywhere. `archived` wins over the rest; `failed` (every check failed, no good one yet) over `stale`.
 */
export type DetailKind = 'archived' | 'pending' | 'failed' | 'stale' | 'live';

export interface DetailState {
  kind: DetailKind;
  /** The latest checks failed while an older good one exists. A `failed` keyword is not also `failing`. */
  failing: boolean;
}

export type StatusBadge = 'archived' | 'pending' | 'failed' | 'stale' | 'failing';

export function detailStateOf(state: TrackedKeywordState, isActive: boolean): DetailState {
  const failing = state.current.state !== 'failed' && state.consecutive_failures > 0;
  if (!isActive) return { kind: 'archived', failing };
  if (state.current.state === 'not_checked') return { kind: 'pending', failing };
  if (state.current.state === 'failed') return { kind: 'failed', failing: false };
  if (state.is_stale) return { kind: 'stale', failing };
  return { kind: 'live', failing };
}

/** The badge codes of the header, in the order they are drawn: at most four (16 section 2.1). */
export function statusBadges(state: DetailState): StatusBadge[] {
  const badges: StatusBadge[] = [];
  if (state.kind !== 'live') badges.push(state.kind);
  if (state.failing) badges.push('failing');
  return badges;
}
