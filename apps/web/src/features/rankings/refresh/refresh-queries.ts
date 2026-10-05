'use client';

import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import { OPEN_RUNS_LIMIT, RUN_POLL_MS, isOpenRun } from './refresh-model';
import type { ProjectScope } from '../rankings-queries';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiMutation } from '@/lib/api/query';
import type { ManualRuns, Run } from '@/lib/api/types';

/**
 * What the metrics refresh asks the API (19-api-specification.md sections 3.6.1 and 3.11.4): the refresh
 * itself, the project's open manual refreshes with the day's count of manual runs, and each run it follows.
 * The write sends no `Idempotency-Key`, as no write of this app does: the contract does not declare the header.
 */

const RUNS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs';
const RUN = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}';
export const REFRESH_PATH = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-metrics/refresh';

/** `POST {P}/keyword-metrics/refresh`: a manual run of the `keyword_metrics` workload, answered `202`. */
export const REFRESH_METRICS = apiMutation('post', REFRESH_PATH);

const path = (scope: ProjectScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

const refreshKey = (scope: ProjectScope): QueryKey => [
  ...projectKey(scope.workspaceId, scope.projectId),
  'runs',
  'keyword-refresh',
];

/** The key of the open manual refreshes and the day's count. */
export const openRefreshesKey = (scope: ProjectScope): QueryKey => [...refreshKey(scope), 'open'];

/** The key of one run the header follows. */
export const refreshRunKey = (scope: ProjectScope, runId: string): QueryKey => [...refreshKey(scope), 'run', runId];

/** The project's open manual refreshes, and how many manual runs the project has started today (UTC), when it says. */
export interface OpenRefreshes {
  runs: readonly Run[];
  manual: ManualRuns | null;
}

async function readOpen(scope: ProjectScope, signal: AbortSignal): Promise<OpenRefreshes> {
  const page = await unwrap(
    api.GET(RUNS, {
      params: {
        path: path(scope),
        query: {
          'filter[workload_in]': ['keyword_metrics'],
          'filter[trigger_in]': ['manual'],
          'filter[status_in]': ['planned', 'running'],
          limit: OPEN_RUNS_LIMIT,
        },
      },
      signal,
    }),
  );
  return { runs: page.data, manual: page.meta.manual_runs_today ?? null };
}

/**
 * The open manual refreshes of the project, which a reload resumes in the header, with the day's count of
 * manual runs (`meta.manual_runs_today`) that the menu quotes. Read on mount and again by `refetch`, when the
 * menu opens and after a refresh starts.
 */
export function useOpenRefreshes(scope: ProjectScope, enabled: boolean): UseQueryResult<OpenRefreshes> {
  return useQuery({
    queryKey: openRefreshesKey(scope),
    enabled,
    queryFn: ({ signal }) => readOpen(scope, signal),
  });
}

/** A run that ended no longer counts as open in what a reload found: the header must not take it up again. */
export function forgetOpenRefresh(queryClient: QueryClient, scope: ProjectScope, runId: string): void {
  queryClient.setQueryData<OpenRefreshes>(openRefreshesKey(scope), (held) =>
    held === undefined ? held : { ...held, runs: held.runs.filter((run) => run.run_id !== runId) },
  );
}

/** Puts a run the API just answered into the cache, so the header shows it before it asks. */
export function rememberRefreshRun(queryClient: QueryClient, scope: ProjectScope, run: Run): void {
  queryClient.setQueryData<Run>(refreshRunKey(scope, run.run_id), run);
}

async function readRun(scope: ProjectScope, runId: string, signal: AbortSignal): Promise<Run> {
  const answer = await unwrap(api.GET(RUN, { params: { path: { ...path(scope), run_id: runId } }, signal }));
  return answer.data;
}

/** One run, asked about every few seconds while it is planned or running, and not again once it has ended. */
export function useRefreshRun(scope: ProjectScope, runId: string): UseQueryResult<Run> {
  return useQuery({
    queryKey: refreshRunKey(scope, runId),
    queryFn: ({ signal }) => readRun(scope, runId, signal),
    refetchInterval: (query) => (query.state.data !== undefined && !isOpenRun(query.state.data) ? false : RUN_POLL_MS),
  });
}
