import { isApiProblem } from '@/lib/api/problem';
import type { ChangesSummary, PageChange } from './types';

/**
 * Behaviours of the slice 2 and 3 answers that a screen must treat apart. Each is a pure reading of what the API
 * says, so the screens do not repeat the rule.
 */

/**
 * A link level read (links, edges, neighbors, changes, opportunities, paths) of a crawl past the last four answers
 * `410 links_dropped`. The pages list stays readable (its anchors are null), so only these reads show the message.
 */
export const isLinksDropped = (error: unknown): boolean => isApiProblem(error, 'links_dropped');

/**
 * Whether the summary's counts are real. Link changes can be empty with `ready` when the previous crawl's links
 * were dropped; `pending`, `first_crawl` and `unavailable` have no counts to show.
 */
export const changesAreReady = (summary: Pick<ChangesSummary, 'state'>): boolean => summary.state === 'ready';

export type PageChangeState = 'unknown' | 'new' | 'moved' | 'unchanged';

/**
 * A page's change against the previous crawl. `extras.change` is null (or the extras are absent) until the crawl's
 * enrichment is done, and an unchanged page has an all zero change only after that, so null means "not known yet",
 * not "unchanged". A null delta is not a move. The change of equity is never read: equity is not shown, so a page
 * whose only change is in equity points reads as unchanged.
 */
export function pageChangeState(change: PageChange | null | undefined): PageChangeState {
  if (change === null || change === undefined) return 'unknown';
  if (change.is_new) return 'new';
  const moved =
    (change.depth_delta ?? 0) !== 0 || (change.editorial_in_delta ?? 0) !== 0 || change.depth_state !== null;
  return moved ? 'moved' : 'unchanged';
}
