'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { NewestRunRead } from './ai-health-model';
import { apiQuery } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { Run } from '@/lib/api/types';

/**
 * What the shell and the AI pages read of a project's collection (WP-30), shared like the taxonomy reads: a
 * feature never imports another feature, so what two of them use lives here (26 section 2). The runs are
 * keyed under the project's `runs` prefix, so a refresh of Runs refreshes them too.
 */

const RUNS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs';
const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines';

type StatusFilter = NonNullable<
  NonNullable<paths[typeof RUNS]['get']['parameters']['query']>['filter[status_in]']
>[number];

/** The project whose runs and engines are read. */
export interface AiRunsScope {
  workspaceId: string;
  projectId: string;
}

/** How often the sidebar asks again for the newest run (D13): once a minute. */
export const NEWEST_RUN_MS = 60_000;

/** The statuses of a run that ended with answers: the run an Updated time is about. */
const ANSWERED: readonly StatusFilter[] = ['completed', 'completed_with_errors'];

const pathOf = (scope: AiRunsScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

/**
 * `GET {P}/runs?limit=1`, every minute: the newest run of the project, of any workload. `null` until the
 * first read answers. A poll that fails after a good read keeps what was read; only a first read that
 * failed is `failed`.
 */
export function useNewestRun(scope: AiRunsScope): NewestRunRead | null {
  const { data, isError } = useQuery({
    ...apiQuery(RUNS, { params: { path: pathOf(scope), query: { limit: 1 } } }),
    refetchInterval: NEWEST_RUN_MS,
  });
  if (data !== undefined) return { state: 'ready', run: data.data[0] ?? null };
  return isError ? { state: 'failed' } : null;
}

/**
 * The newest AI run of the project that finished with answers (`completed` or `completed_with_errors`), or
 * `null` while it is read, when there is none, and when it cannot be read: the caller then has no link to
 * offer, which is the safe answer. `enabled` is false for a member who cannot read the data.
 */
export function useLatestFinishedAiRun(scope: AiRunsScope, enabled: boolean): Run | null {
  const { data } = useQuery({
    ...apiQuery(RUNS, {
      params: {
        path: pathOf(scope),
        query: { 'filter[workload_in]': ['ai_prompt'], 'filter[status_in]': [...ANSWERED], limit: 1 },
      },
    }),
    enabled,
  });
  // The request's filters are the answer's reason; the check here keeps a link from pointing at a run the
  // answers did not come from, whatever the server sent
  return data?.data.find((run) => run.workload === 'ai_prompt' && ANSWERED.includes(run.status)) ?? null;
}

/**
 * The names of the engines of the project from `GET {P}/engines`, as a function of the engine's code. An
 * engine that is not in the answer, or an answer that is not here yet, is shown as its code: never blank.
 */
export function useEngineNames(scope: AiRunsScope): (code: string) => string {
  const { data } = useQuery(apiQuery(ENGINES, { params: { path: pathOf(scope) } }));
  const names = useMemo(
    () => new Map<string, string>((data?.data ?? []).map((row) => [row.engine.engine_code, row.engine.label])),
    [data],
  );
  return useCallback((code) => names.get(code) ?? code, [names]);
}
