import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { DownloadQuery } from '@/lib/api/download';
import { issueGscStateValues, type paths } from '@/lib/api/schema';
import { csvOf, isRecord, pagesPath, withRun } from '@/lib/internal-links/queries';
import type { LinksScope, PageSort } from '@/lib/internal-links/types';
import type { CheckId, IssueListResponse } from './types';

export { issueKeys } from '@/lib/internal-links/queries';

/**
 * The reads of the Issues page (the backend OpenAPI), as `apiQuery` options. The list of checks has its own
 * route; the pages of one check are the internal links pages list with `filter[issue]`, so they share its key
 * prefix and are made stale with it (`crawlFinishedKeys`).
 */

// Literal strings, so each path keeps its literal type for the typed client
const ISSUES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/issues' as const;
const PAGES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages' as const;

type PagesParams = NonNullable<paths[typeof PAGES]['get']['parameters']['query']>;

/** Rows a page of the pages of a check asks for. */
export const ISSUE_PAGE_LIMIT = 50;

const pathOf = (scope: LinksScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

/** The Issues list path with its ids filled in, for the CSV download. */
export const issuesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/issues`;

/** The checks of a crawl (the latest unless `run` names one), with the pages each found and the totals of the strip. */
export const issuesQuery = (scope: LinksScope, run: string | null = null): ApiQueryOptions<typeof ISSUES> =>
  apiQuery(ISSUES, { params: { path: pathOf(scope), query: withRun({}, run) } });

const SUMMARY_COUNTS = [
  'pages_crawled',
  'pages_with_issue',
  'pages_with_error',
  'pages_with_warning',
  'pages_with_notice',
  'checks_ran',
  'checks_passed',
] as const;
const GSC_STATES: readonly unknown[] = issueGscStateValues;

/**
 * The list answers JSON or CSV in the OpenAPI, so its typed answer is `unknown`, as the pages list's is. The JSON
 * read (never `format=csv`, which goes through `downloadApiFile`) is checked here, at the boundary: the parts the
 * screens read, not each check.
 */
export function isIssueListResponse(value: unknown): value is IssueListResponse {
  if (!isRecord(value)) return false;
  const { data, summary, meta } = value;
  return (
    Array.isArray(data) &&
    isRecord(summary) &&
    SUMMARY_COUNTS.every((count) => typeof summary[count] === 'number') &&
    isRecord(meta) &&
    typeof meta.run_id === 'string' &&
    typeof meta.links_available === 'boolean' &&
    isRecord(meta.gsc) &&
    GSC_STATES.includes(meta.gsc.state)
  );
}

/** What picks the pages of one check: the check, the search as typed, the sort and the cursor of the next page. */
export interface IssuePagesQuery {
  check: CheckId;
  q: string;
  sort: PageSort;
  cursor: string | null;
}

/** The query values both the read and the CSV of a check's pages send: the check, the sort and the search. */
const selectionOf = ({ check, q, sort }: IssuePagesQuery): PagesParams => ({
  scope: 'all',
  sort,
  'filter[issue]': check,
  ...(q.trim() === '' ? {} : { q: q.trim() }),
});

/** One page of the pages a check found: the detail of what was found and the Search Console clicks with each. */
export const issuePagesQuery = (
  scope: LinksScope,
  query: IssuePagesQuery,
  run: string | null = null,
): ApiQueryOptions<typeof PAGES> =>
  apiQuery(PAGES, {
    params: {
      path: pathOf(scope),
      query: withRun(
        {
          ...selectionOf(query),
          include: ['issue', 'gsc'],
          limit: ISSUE_PAGE_LIMIT,
          ...(query.cursor === null ? {} : { cursor: query.cursor }),
        },
        run,
      ),
    },
  });

/** The CSV of the checks: the path and the query `downloadApiFile` takes. */
export const issuesCsv = (
  scope: LinksScope,
  run: string | null,
): { path: `/api/v1/${string}`; query: DownloadQuery } => ({
  path: issuesPath(scope),
  query: csvOf(withRun({}, run)),
});

/** The CSV of every page a check found that matches the search, in the sort: no paging. */
export const issuePagesCsv = (
  scope: LinksScope,
  query: IssuePagesQuery,
  run: string | null,
): { path: `/api/v1/${string}`; query: DownloadQuery } => ({
  path: pagesPath(scope),
  query: csvOf(withRun(selectionOf(query), run)),
});
