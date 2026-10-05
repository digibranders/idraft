'use client';

import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';

import { OPEN_RUNS_LIMIT, RUN_FAILURES_MAX, RUN_POLL_MS } from './refresh-model';
import type { ProjectScope } from '../rankings-queries';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { ManualRuns, Run } from '@/lib/api/types';
import { isOpenRun } from '@/lib/runs/run-status';

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

/** The key of the runs that ended and were reported: what the screen remembers across leaving and coming back. */
const endedKey = (scope: ProjectScope): QueryKey => [...refreshKey(scope), 'ended'];

/** The runs the header reported as ended (or let go of) while the cache held them: none is followed again. */
export function endedRefreshes(queryClient: QueryClient, scope: ProjectScope): ReadonlySet<string> {
  return queryClient.getQueryData<ReadonlySet<string>>(endedKey(scope)) ?? new Set();
}

/** Remembers that the header reported the run, so a screen opened again does not report it a second time. */
export function rememberEndedRefresh(queryClient: QueryClient, scope: ProjectScope, runId: string): void {
  queryClient.setQueryData<ReadonlySet<string>>(endedKey(scope), (held) => new Set(held).add(runId));
}

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
 * menu opens and after a refresh starts. Each open run it finds is put into the cache of the run itself, unless
 * that holds a reading already, so the header shows a run a reload resumed before the run is asked about.
 */
export function useOpenRefreshes(scope: ProjectScope, enabled: boolean): UseQueryResult<OpenRefreshes> {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: openRefreshesKey(scope),
    enabled,
    queryFn: async ({ signal }) => {
      const open = await readOpen(scope, signal);
      for (const found of open.runs) {
        // Held as stale (updated at the start of time): it shows at once, and the run is still read on mount
        if (queryClient.getQueryData<Run>(refreshRunKey(scope, found.run_id)) === undefined) {
          queryClient.setQueryData<Run>(refreshRunKey(scope, found.run_id), found, { updatedAt: 0 });
        }
      }
      return open;
    },
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

/** What went wrong in the reads of a run since the last one that was answered. */
interface Trouble {
  /** Reads in a row that were not answered. */
  failures: number;
  /** The API refused to say: the member may no longer read runs. */
  forbidden: boolean;
}

const NO_TROUBLE: Trouble = { failures: 0, forbidden: false };

/** How a run that has not ended is followed no more. */
export type Lost = 'forbidden' | 'unreachable';

export interface RunFollow {
  /** The latest reading: the one that started the run, or a reload found, until the first read answers. */
  run: Run | undefined;
  /** The API does not know the run. */
  gone: boolean;
  /** Why the run is not asked about any more though it has not ended; `null` while it is followed. */
  lost: Lost | null;
}

/**
 * One run, asked about every few seconds while it is planned or running, and not again once it has ended.
 * It is let go of when the API refuses to say (403) and after `RUN_FAILURES_MAX` reads in a row that were
 * not answered, so an unreachable API is not asked every five seconds for good.
 */
export function useRefreshRun(scope: ProjectScope, runId: string): RunFollow {
  const [trouble, setTrouble] = useState<Trouble>(NO_TROUBLE);
  const lost: Lost | null = trouble.forbidden
    ? 'forbidden'
    : trouble.failures >= RUN_FAILURES_MAX
      ? 'unreachable'
      : null;
  const current = useQuery({
    queryKey: refreshRunKey(scope, runId),
    queryFn: async ({ signal }) => {
      try {
        const answer = await readRun(scope, runId, signal);
        setTrouble((held) => (held === NO_TROUBLE ? held : NO_TROUBLE));
        return answer;
      } catch (error) {
        setTrouble((held) => ({
          failures: held.failures + 1,
          forbidden: held.forbidden || (isApiProblem(error) && error.status === 403),
        }));
        throw error;
      }
    },
    enabled: lost === null,
    refetchInterval: (query) => (query.state.data !== undefined && !isOpenRun(query.state.data) ? false : RUN_POLL_MS),
  });
  return { run: current.data, gone: isApiProblem(current.error, 'not_found'), lost };
}
