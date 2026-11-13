'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { AiCoverage, NewestRunRead } from './ai-health-model';
import { projectKey } from '@/lib/api/keys';
import { apiQuery } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { Run } from '@/lib/api/types';
import { isOpenRun } from '@/lib/runs/run-status';

/**
 * What the shell and the AI pages read of a project's collection (WP-30), shared like the taxonomy reads: a
 * feature never imports another feature, so what two of them use lives here (26 section 2). The runs are
 * keyed under the project's `runs` prefix, so a refresh of Runs refreshes them too.
 */

const RUNS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs';
const COVERAGE = `${RUNS}/{run_id}/ai-coverage` as const;
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

/** The statuses of a run that has not ended. */
const OPEN: readonly StatusFilter[] = ['planned', 'running'];

/** How often an open AI run is read again, as long as one is open (D15): the run's own poll (`FOLLOW_MS` of Runs). */
export const OPEN_RUN_MS = 10_000;

/** The open AI run in a runs answer; the request's filters are the reason, the check keeps a stray run out. */
const openAiRunOf = (answer: { data: readonly Run[] } | undefined): Run | null =>
  answer?.data.find((run) => run.workload === 'ai_prompt' && isOpenRun(run)) ?? null;

/**
 * The open (planned or running) AI run of the project, or `null` while it is read, when there is none, and
 * when the read failed (a poll that fails after a good read keeps the run). Read again every 10 seconds
 * while one is open and not at all otherwise: a run started from the page invalidates the project's runs,
 * which is how the next one is noticed. `enabled` is false for a member who cannot read the data.
 */
export function useOpenAiRun(scope: AiRunsScope, enabled: boolean): Run | null {
  const { data } = useQuery({
    ...apiQuery(RUNS, {
      params: {
        path: pathOf(scope),
        query: { 'filter[workload_in]': ['ai_prompt'], 'filter[status_in]': [...OPEN], limit: 1 },
      },
    }),
    enabled,
    refetchInterval: (query) => (openAiRunOf(query.state.data) === null ? false : OPEN_RUN_MS),
  });
  return openAiRunOf(data);
}

/** How often an open run's coverage is read again: the run's own poll (`FOLLOW_MS` of Runs). */
export const COVERAGE_MS = 10_000;

/**
 * `GET {P}/runs/{run_id}/ai-coverage`: what an AI run planned, stored and is missing, per engine. Keyed under
 * the project's `runs` prefix, so `refreshRuns` reads it again too. Read again every 10 seconds while the run
 * is `open`; a poll that fails after a good read keeps the data (`isError` with `data`). `enabled` is false for
 * a run that is not an AI run, which the API refuses with 422.
 */
export function useAiCoverage(
  scope: AiRunsScope,
  runId: string,
  enabled: boolean,
  open: boolean,
): UseQueryResult<{ data: AiCoverage }> {
  const query = useQuery({
    ...apiQuery(COVERAGE, { params: { path: { ...pathOf(scope), run_id: runId } } }),
    enabled,
    refetchInterval: open ? COVERAGE_MS : false,
  });
  // The run's own poll learns it ended up to 10 s after its last task: one more read, so the figures left on
  // screen are the run's final ones and not those of the last tick
  const wasOpen = useRef(open);
  const { refetch } = query;
  useEffect(() => {
    if (wasOpen.current && !open && enabled) void refetch();
    wasOpen.current = open;
  }, [open, enabled, refetch]);
  return query;
}

/** The part of a cached prompts summary this file reads: a prompt's id and its current text. */
interface CachedPrompts {
  data: { prompts: readonly { prompt_id: string; text: string }[] };
}

const isCachedPrompts = (value: unknown): value is CachedPrompts => {
  if (typeof value !== 'object' || value === null || !('data' in value)) return false;
  const { data } = value;
  return (
    typeof data === 'object' &&
    data !== null &&
    'prompts' in data &&
    Array.isArray(data.prompts) &&
    data.prompts.every(
      (row: unknown) =>
        typeof row === 'object' &&
        row !== null &&
        'prompt_id' in row &&
        typeof row.prompt_id === 'string' &&
        'text' in row &&
        typeof row.text === 'string',
    )
  );
};

/**
 * The text of the prompts the page has already read, by prompt id, from the prompts summaries in the cache of
 * the project. Nothing is asked for: a prompt not in the cache is not here, and the caller shows its id.
 * Read when the component renders, so it is as fresh as the cache is at that moment.
 */
export function usePromptTexts(scope: AiRunsScope): ReadonlyMap<string, string> {
  const queryClient = useQueryClient();
  const texts = new Map<string, string>();
  for (const [, data] of queryClient.getQueriesData({
    queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'ai', 'prompts-summary'],
  })) {
    if (isCachedPrompts(data)) for (const row of data.data.prompts) texts.set(row.prompt_id, row.text);
  }
  return texts;
}

/**
 * The names of the engines of the project from `GET {P}/engines`, as a function of the engine's code. An
 * engine that is not in the answer, or an answer that is not here yet, is shown as its code: never blank.
 * `enabled` is false for a member who cannot read the data: nothing is asked and every name is its code.
 */
export function useEngineNames(scope: AiRunsScope, enabled: boolean = true): (code: string) => string {
  const { data } = useQuery({ ...apiQuery(ENGINES, { params: { path: pathOf(scope) } }), enabled });
  const names = useMemo(
    () => new Map<string, string>((data?.data ?? []).map((row) => [row.engine.engine_code, row.engine.label])),
    [data],
  );
  return useCallback((code) => names.get(code) ?? code, [names]);
}
