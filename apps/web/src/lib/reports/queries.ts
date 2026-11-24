import type { QueryClient } from '@tanstack/react-query';

import { apiMutation, apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { ReportsScope } from './types';

/**
 * The reads and writes of Reports (the backend OpenAPI): a project's report links and scheduled emails, and the
 * public report a link opens. A link's token is returned once, by `createReportShareMutation`.
 */

// Literal strings, so each path keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/reports';
const SHARES = `${P}/shares` as const;
const SCHEDULES = `${P}/schedules` as const;
const PUBLIC_REPORT = '/api/v1/public/reports/{token}' as const;

const pathOf = (scope: ReportsScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

export const reportSharesQuery = (scope: ReportsScope): ApiQueryOptions<typeof SHARES> =>
  apiQuery(SHARES, { params: { path: pathOf(scope) } });

export const reportSchedulesQuery = (scope: ReportsScope): ApiQueryOptions<typeof SCHEDULES> => ({
  ...apiQuery(SCHEDULES, { params: { path: pathOf(scope) } }),
  // Each answer carries a next send worked out from the clock of the server
  staleTime: 0,
});

/**
 * The public report a link opens: no sign-in, so a 404 (unknown, expired or revoked) is final and a 429 is shown
 * by the page, which asks again on a press of "Try again", not by a silent retry.
 */
export const publicReportQuery = (token: string): ApiQueryOptions<typeof PUBLIC_REPORT> => ({
  ...apiQuery(PUBLIC_REPORT, { params: { path: { token } } }),
  retry: false,
  staleTime: 0,
});

/** Send `body: { expires_in_days: 7 | 30 | 90 }`; the answer holds the link's token, this once. */
export const createReportShareMutation = apiMutation('post', SHARES);
/** Revoking a link already revoked changes nothing. */
export const revokeReportShareMutation = apiMutation('delete', `${SHARES}/{report_share_id}`);
export const createReportScheduleMutation = apiMutation('post', SCHEDULES);
export const updateReportScheduleMutation = apiMutation('patch', `${SCHEDULES}/{report_schedule_id}`);
export const deleteReportScheduleMutation = apiMutation('delete', `${SCHEDULES}/{report_schedule_id}`);

/** After a change to a link or a schedule: the project's lists of both. */
export const refreshReports = (queryClient: QueryClient, scope: ReportsScope): Promise<void> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: reportSharesQuery(scope).queryKey }),
    queryClient.invalidateQueries({ queryKey: reportSchedulesQuery(scope).queryKey }),
  ]).then(() => undefined);
