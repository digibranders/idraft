import type { LinksScope, PageRow } from '@/lib/internal-links/types';

/**
 * The seam of the Issues session (spec 10.1). On this branch every part answers `unavailable`.
 * Owner: the Issues session. Replace the bodies, keep the signatures.
 */

export type IssueSeverity = 'error' | 'warning' | 'notice';
export interface PageIssue {
  checkId: string;
  severity: IssueSeverity;
  detail: string | null;
}
export type Seam<T> =
  { state: 'unavailable' } | { state: 'loading' } | { state: 'error'; retry: () => void } | { state: 'ready'; data: T };

/** The strip and card 7 of the Overview: the `summary` of `GET …/issues`. */
export const useIssueTotals: (
  scope: LinksScope,
  run: string | null,
) => Seam<{ withIssue: number; error: number; warning: number; notice: number }> = () => ({ state: 'unavailable' });

/** The drawer's Issues tab and tile: every issue of one page. */
export const usePageIssues: (
  scope: LinksScope,
  run: string | null,
  urlId: string,
) => Seam<readonly PageIssue[]> = () => ({ state: 'unavailable' });

/** Whether the pages list offers `include=issues`, the sort `issues` and `filter[view]=with_issues`. */
export const ISSUE_COLUMNS_AVAILABLE = false;

/** The Issues column's numbers of one row, read from its `extras`; null on this branch. */
export const issueCountsOf: (row: PageRow) => { error: number; warning: number; notice: number } | null = () => null;
