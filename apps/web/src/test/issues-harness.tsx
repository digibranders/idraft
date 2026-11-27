import { HttpResponse, http } from 'msw';
import { Suspense, type ReactElement } from 'react';

import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import { IssuesScreen, type InternalLinksProject } from '@/features/internal-links';
import type { Role } from '@/lib/api/types';
import type { CrawlRun } from '@/lib/internal-links/types';
import type { IssueCheck, IssueListResponse } from '@/lib/issues/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS, MOCK_RUN_ID } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';

/** The Issues page as a member of the fixture workspace with `role`, inside the shell's slots. */
export function issuesAs(role: Role, current: InternalLinksProject = EVENTUS_LINKS): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <TopBarSlotTarget />
      <PermissionProvider membership={membershipFactory(role)}>
        <Suspense fallback={null}>
          <IssuesScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={current}
          />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}

const CRAWLS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls');

/** A crawl of Eventus Security: finished, with 40 pages, unless `over` says otherwise. */
export const crawlRun = (over: Partial<CrawlRun>): CrawlRun => ({
  pages_blocked: null,
  pages: over.pages_crawled ?? 40,
  pages_variant: null,
  run_id: MOCK_RUN_ID,
  trigger: 'schedule',
  state: 'ready',
  ceiling: 2000,
  pages_found: 40,
  pages_crawled: 40,
  sitemap_pages: 30,
  render_javascript: false,
  estimated_cost_usd: '0.300000',
  cost_usd: '0.300000',
  stop_reason: null,
  error_code: null,
  error_message: null,
  hints: [],
  is_latest: false,
  created_at: '2026-11-14T03:00:00Z',
  submitted_at: '2026-11-14T03:00:05Z',
  finished_at: '2026-11-14T03:12:00Z',
  requested_by: null,
  links_available: true,
  previous_run_id: null,
  enrich_state: 'done',
  ...over,
});

/** A handler that answers the crawl list with `runs`, newest first, for `server.use`. */
export const answerCrawls = (runs: readonly CrawlRun[]): ReturnType<typeof http.get> =>
  http.get(CRAWLS, () => HttpResponse.json({ data: runs, page: { has_more: false, limit: 50, next_cursor: null } }));

const check = (
  id: IssueCheck['id'],
  over: Pick<IssueCheck, 'tab' | 'category' | 'severity' | 'found_by'> & Partial<IssueCheck>,
): IssueCheck => ({
  id,
  state: 'ran',
  reason: null,
  pages: 0,
  clicks: 0,
  example_path: null,
  ...over,
});

/**
 * Nine checks across both tabs, in catalogue order: found, passed, and every reason a check does not run.
 * The Technical tab holds seven, the On-page tab two.
 */
export const ISSUE_CHECKS: readonly IssueCheck[] = [
  check('status-4xx', {
    tab: 'technical',
    category: 'status',
    severity: 'error',
    found_by: 'crawl',
    pages: 3,
    clicks: 340,
    example_path: '/old-pricing',
  }),
  check('status-5xx', { tab: 'technical', category: 'status', severity: 'error', found_by: 'crawl' }),
  check('clicks-page-broken', {
    tab: 'technical',
    category: 'earning_pages',
    severity: 'error',
    found_by: 'gsc',
    state: 'not_run',
    reason: 'source_not_connected',
    pages: null,
    clicks: null,
  }),
  check('cited-page-broken', {
    tab: 'technical',
    category: 'earning_pages',
    severity: 'error',
    found_by: 'ai',
    state: 'not_run',
    reason: 'not_collected',
    pages: null,
    clicks: null,
  }),
  check('redirect-chain', {
    tab: 'technical',
    category: 'redirects',
    severity: 'warning',
    found_by: 'crawl',
    pages: 5,
    clicks: 12,
    example_path: '/a',
  }),
  check('sitemap-broken', {
    tab: 'technical',
    category: 'sitemap',
    severity: 'warning',
    found_by: 'crawl',
    state: 'not_run',
    reason: 'no_sitemap',
    pages: null,
    clicks: null,
  }),
  check('nofollow-internal', {
    tab: 'technical',
    category: 'links',
    severity: 'notice',
    found_by: 'crawl',
    state: 'not_run',
    reason: 'links_dropped',
    pages: null,
    clicks: null,
  }),
  check('title-long', {
    tab: 'on_page',
    category: 'titles',
    severity: 'notice',
    found_by: 'crawl',
    pages: 9,
    clicks: 4,
    example_path: '/blog/a-very-long-title',
  }),
  check('title-missing', { tab: 'on_page', category: 'titles', severity: 'error', found_by: 'crawl' }),
];

/** The answer of the list of checks for `checks`, with the totals of the strip as the screens read them. */
export function issueList(
  checks: readonly IssueCheck[] = ISSUE_CHECKS,
  gsc: IssueListResponse['meta']['gsc'] = { state: 'ok', window_start: '2026-10-28', window_end: '2026-11-24' },
): IssueListResponse {
  return {
    data: [...checks],
    summary: {
      pages_crawled: 1840,
      pages_with_issue: 412,
      pages_with_error: 37,
      pages_with_warning: 180,
      pages_with_notice: 301,
      checks_ran: 27,
      checks_passed: 9,
    },
    meta: { run_id: MOCK_RUN_ID, crawled_at: '2026-11-25T09:12:00Z', links_available: true, gsc },
  };
}

const ISSUES = mswPath(`/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/issues`);

/** A handler that answers the list of checks with `body`, for `server.use`. */
export const answerIssues = (body: IssueListResponse = issueList()): ReturnType<typeof http.get> =>
  http.get(ISSUES, () => HttpResponse.json(body));

export { ISSUES };
