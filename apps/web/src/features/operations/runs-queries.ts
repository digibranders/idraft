'use client';

import { useInfiniteQuery, useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { isOpen } from './run-model';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiMutation, apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { ManualRuns, Run, RunDetail } from '@/lib/api/types';
import { monthInstants, type MonthKey } from '@/lib/format/month';

/**
 * A project's collection runs (19 section 3.11.4). The list is read for one month by `created_at`, newest
 * first, in cursor pages that load one after another up to `MAX_RUNS`; the keys carry the project and the
 * month, so what is on screen never answers another project's or month's question.
 */

const RUNS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs';
const RUN = `${RUNS}/{run_id}` as const;
const CANCEL = `${RUN}/cancel` as const;

type ListQuery = NonNullable<paths[typeof RUNS]['get']['parameters']['query']>;
type RunPage = paths[typeof RUNS]['get']['responses'][200]['content']['application/json'];

export type RunWorkload = NonNullable<ListQuery['filter[workload_in]']>[number];
export type RunStatusFilter = NonNullable<ListQuery['filter[status_in]']>[number];
export type RunTriggerFilter = NonNullable<ListQuery['filter[trigger_in]']>[number];

export interface RunsScope {
  workspaceId: string;
  projectId: string;
}

/** The filters of the list; an empty list leaves the filter out of the request, which refuses empty parameters. */
export interface RunFilters {
  workloads: readonly RunWorkload[];
  statuses: readonly RunStatusFilter[];
  triggers: readonly RunTriggerFilter[];
}

/** A month's rows are loaded up to this many, the newest first. */
export const MAX_RUNS = 2000;
/** The runs asked for in one page. */
const PAGE = 200;
/** The cursor of the first page: none. */
const FIRST_PAGE: string | null = null;
/** How often the page asks again while a run is still open (the API's `Retry-After`, 19 section 2.10). */
const FOLLOW_MS = 10_000;

/** Every query of a project's runs, the list and each run: `refreshRuns` invalidates them all. */
export const runsKey = (scope: RunsScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'runs'];

/** After a change to a run: the list of every month and every open run's detail. Resolves once the queries on screen read again. */
export function refreshRuns(queryClient: QueryClient, scope: RunsScope): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: runsKey(scope) });
}

/** The request's filter parameters: only the filters that are set. */
function filterQuery(filters: RunFilters): ListQuery {
  return {
    ...(filters.workloads.length === 0 ? {} : { 'filter[workload_in]': [...filters.workloads] }),
    ...(filters.statuses.length === 0 ? {} : { 'filter[status_in]': [...filters.statuses] }),
    ...(filters.triggers.length === 0 ? {} : { 'filter[trigger_in]': [...filters.triggers] }),
  };
}

async function readPage(
  scope: RunsScope,
  month: MonthKey,
  filters: RunFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<RunPage> {
  const { from, to } = monthInstants(month);
  return unwrap(
    api.GET(RUNS, {
      params: {
        path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
        query: { ...filterQuery(filters), from, to, limit: PAGE, ...(cursor === null ? {} : { cursor }) },
      },
      signal,
    }),
  );
}

/** What Runs shows of the list: the rows at hand and how they were read. */
export interface MonthRuns {
  rows: readonly Run[];
  /** The first page has not arrived. */
  loading: boolean;
  /** Any page is being read, the first or a later one, or the list is read again. */
  fetching: boolean;
  /** The first page failed. */
  error: unknown;
  refetch: () => void;
  /** More runs match than the `MAX_RUNS` shown: these are the newest. */
  capped: boolean;
  /** A page after the first did not load, so the rows are not all there. */
  incomplete: { retry: () => void; retrying: boolean } | null;
  /** The day's manual runs of the project (UTC), from the first page. */
  manualRunsToday: ManualRuns | null;
}

/**
 * The runs of `month` for the filters, every page of them up to `MAX_RUNS`. While a run is open the list is
 * read again every few seconds, so a run is followed to its end.
 */
export function useMonthRuns(scope: RunsScope, month: MonthKey, filters: RunFilters): MonthRuns {
  const query = useInfiniteQuery({
    queryKey: [...runsKey(scope), 'list', month, filters],
    queryFn: ({ pageParam, signal }) => readPage(scope, month, filters, pageParam, signal),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    // Open runs are the newest, so the first page tells whether anything is still moving
    refetchInterval: (state) => (state.state.data?.pages[0]?.data.some(isOpen) === true ? FOLLOW_MS : false),
  });
  const { data, hasNextPage, isFetching, isError, fetchNextPage } = query;
  const loaded = useMemo(() => (data === undefined ? [] : allRows(data)), [data]);
  // The rest of the pages follow one after another, up to the cap, while nothing else is being read
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError && loaded.length < MAX_RUNS) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, loaded.length, fetchNextPage]);
  const rows = loaded.length > MAX_RUNS ? loaded.slice(0, MAX_RUNS) : loaded;
  const failedLater = query.isFetchNextPageError;
  return {
    rows,
    loading: query.isPending,
    fetching: isFetching,
    // A failed later page leaves the rows that loaded; the list says it is incomplete instead
    error: failedLater ? null : query.error,
    refetch: () => void query.refetch(),
    capped: loaded.length >= MAX_RUNS && (hasNextPage || loaded.length > MAX_RUNS),
    incomplete: failedLater ? { retry: () => void fetchNextPage(), retrying: query.isFetchingNextPage } : null,
    manualRunsToday: data?.pages[0]?.meta.manual_runs_today ?? null,
  };
}

const allRows = (data: { pages: readonly RunPage[] }): Run[] => data.pages.flatMap((page) => page.data);

/** The request for one run with its tasks by status. */
export function runDetailQuery(scope: RunsScope, runId: string): ApiQueryOptions<typeof RUN> {
  return apiQuery(RUN, {
    params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, run_id: runId } },
  });
}

/** `GET {P}/runs/{run_id}`, read again every few seconds while the run is open. `null` asks nothing. */
export function useRunDetail(scope: RunsScope, runId: string | null): UseQueryResult<{ data: RunDetail }> {
  return useQuery({
    ...runDetailQuery(scope, runId ?? ''),
    enabled: runId !== null,
    refetchInterval: (state) => (state.state.data !== undefined && isOpen(state.state.data.data) ? FOLLOW_MS : false),
  });
}

/** `POST {P}/runs/{run_id}/cancel`. */
export const CANCEL_RUN = apiMutation('post', CANCEL);
