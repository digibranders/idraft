'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { CannState } from './cann-model';
import { isApiProblem } from '@/lib/api/problem';
import { apiQuery } from '@/lib/api/query';
import type { CannConflictList, CannPairList, CannSwitchList } from '@/lib/api/types';
import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/cannibalization';
const PAIRS = `${BASE}/pairs` as const;
const SWITCHES = `${BASE}/switches` as const;
/** The most rows the API answers (it caps `limit` at this). Tables sort and filter the rows in memory. */
export const ROWS_MAX = 500;

export interface CannScope {
  workspaceId: string;
  projectId: string;
}

/** What a tab's reads share: the device, the group and the period. */
type ScopeFilters = Pick<CannState, 'device' | 'group' | 'days'>;

const common = (scope: CannScope, filters: ScopeFilters) => ({
  path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
  device: filters.device,
  days: String(filters.days) as '14' | '30' | '90',
  ...(filters.group === 'all' ? {} : { group_id: filters.group }),
  limit: ROWS_MAX,
});

export interface CannRead<T> {
  status: 'loading' | 'error' | 'ready';
  data: T | undefined;
  /** A new scope is being read while the last answer stays on screen. */
  refetching: boolean;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
  /** The API answered 404 or 403: the project or the feature is not open to this member. */
  forbidden: boolean;
}

function useRead<T>(query: UseQueryResult<T>): CannRead<T> {
  const errorId = useErrorId(query.error);
  return {
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    data: query.data,
    refetching: query.isFetching && query.data !== undefined,
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
    forbidden: isApiProblem(query.error) && (query.error.status === 403 || query.error.status === 404),
  };
}

/** Every tracked keyword with its verdict, strip and pages: both tabs' By keyword views and the strip read it. */
export function useConflicts(scope: CannScope, filters: ScopeFilters): CannRead<CannConflictList> {
  const { path, ...query } = common(scope, filters);
  return useRead(
    useQuery({
      ...apiQuery(BASE, { params: { path, query: { ...query, verdict: 'all' } } }),
      select: (answer): CannConflictList => answer.data,
      placeholderData: keepPreviousData,
    }),
  );
}

export function usePairs(scope: CannScope, filters: ScopeFilters, enabled: boolean): CannRead<CannPairList> {
  const { path, ...query } = common(scope, filters);
  return useRead(
    useQuery({
      ...apiQuery(PAIRS, { params: { path, query } }),
      select: (answer): CannPairList => answer.data,
      placeholderData: keepPreviousData,
      enabled,
    }),
  );
}

export function useSwitches(scope: CannScope, filters: ScopeFilters, enabled: boolean): CannRead<CannSwitchList> {
  const { path, ...query } = common(scope, filters);
  return useRead(
    useQuery({
      ...apiQuery(SWITCHES, { params: { path, query: { ...query, kind: 'all' } } }),
      select: (answer): CannSwitchList => answer.data,
      placeholderData: keepPreviousData,
      enabled,
    }),
  );
}
