import { useQuery } from '@tanstack/react-query';

import type { LinksScope, PageRow } from '@/lib/internal-links/types';
import { isIssueListResponse, issuesQuery } from '@/lib/issues/queries';

/**
 * The seam of the Issues session (spec 10.1). The Overview's totals are read from the Issues page's own read. The
 * Issues API has no read of the issues of one page and no `include=issues` column yet, so those parts still answer
 * `unavailable`, false or null.
 */

export type IssueSeverity = 'error' | 'warning' | 'notice';
export interface PageIssue {
  checkId: string;
  severity: IssueSeverity;
  detail: string | null;
}
export type Seam<T> =
  { state: 'unavailable' } | { state: 'loading' } | { state: 'error'; retry: () => void } | { state: 'ready'; data: T };

/** The words for a check id, or null while the Issues session has none (the drawer then shows the id as a fallback). */
export const checkLabel: (checkId: string) => string | null = () => null;

export interface IssueTotals {
  withIssue: number;
  error: number;
  warning: number;
  notice: number;
}

/** The answer as the Issues list (its generated type is `unknown`, see `isIssueListResponse`). */
function readTotals(data: unknown): IssueTotals {
  if (!isIssueListResponse(data)) throw new Error('The issues answer is not a list of checks');
  const { summary } = data;
  return {
    withIssue: summary.pages_with_issue,
    error: summary.pages_with_error,
    warning: summary.pages_with_warning,
    notice: summary.pages_with_notice,
  };
}

/** The strip and card 7 of the Overview: the `summary` of `GET …/issues`. */
export function useIssueTotals(scope: LinksScope, run: string | null): Seam<IssueTotals> {
  const read = useQuery({ ...issuesQuery(scope, run), select: readTotals });
  if (read.isError) return { state: 'error', retry: () => void read.refetch() };
  if (read.data === undefined) return { state: 'loading' };
  return { state: 'ready', data: read.data };
}

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
