'use client';

import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import { workspaceKey } from '@/lib/api/keys';
import { apiMutation, apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';
import type { BudgetStatusList } from '@/lib/api/types';
import type { MonthKey } from '@/lib/format/month';

/**
 * What the Budgets and usage page reads and writes (19 section 3.11.2): the month's budgets with their spend, the
 * forecast of the month's AI spend, the quotas of the plan, and the three writes. The status read is the same
 * request as the Costs page makes, so the two share one cache entry and a change here shows there.
 */

const STATUS = '/api/v1/workspaces/{workspace_id}/budgets/status';
const FORECAST = '/api/v1/workspaces/{workspace_id}/costs/forecast';
const LIMITS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/limits';

export const CREATE_BUDGET = apiMutation('post', '/api/v1/workspaces/{workspace_id}/budgets');
export const UPDATE_BUDGET = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/budgets/{budget_id}');
export const DELETE_BUDGET = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/budgets/{budget_id}');

/** The request for the budgets of a month, each with what it has spent and its state. */
export const budgetStatusQuery = (workspaceId: string, month: MonthKey): ApiQueryOptions<typeof STATUS> =>
  apiQuery(STATUS, { params: { path: { workspace_id: workspaceId }, query: { month } } });

/** `GET {W}/budgets/status` for the month: a refresh keeps the rows on screen. */
export function useBudgetStatus(workspaceId: string, month: MonthKey): UseQueryResult<BudgetStatusList> {
  return useQuery(budgetStatusQuery(workspaceId, month));
}

/**
 * `GET {W}/costs/forecast` for the month: a row for each project that has a price and live AI schedules. It is
 * asked for only while there is an AI budget to show it on (`enabled`).
 */
export function useForecast(
  workspaceId: string,
  month: MonthKey,
  enabled: boolean,
): UseQueryResult<ApiResponse<'get', typeof FORECAST>> {
  return useQuery({
    ...apiQuery(FORECAST, { params: { path: { workspace_id: workspaceId }, query: { month } } }),
    enabled,
  });
}

export interface LimitsScope {
  workspaceId: string;
  /** The project the read goes through (the route needs one); `null` when the member has none to open. */
  projectId: string | null;
}

/**
 * `GET {P}/ai/limits`: the workspace's active prompts and this month's AI answers against the plan. The route
 * needs `data:read` and a project in its path, so without either nothing is asked (`enabled`).
 */
export function useAiLimits(
  { workspaceId, projectId }: LimitsScope,
  enabled: boolean,
): UseQueryResult<ApiResponse<'get', typeof LIMITS>> {
  return useQuery({
    ...apiQuery(LIMITS, { params: { path: { workspace_id: workspaceId, project_id: projectId ?? '' } } }),
    enabled: enabled && projectId !== null,
  });
}

/** Reads the budgets again after a write, and waits for them, so the dialog closes onto the new list. */
export function refreshBudgets(queryClient: QueryClient, workspaceId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [...workspaceKey(workspaceId), 'budgets'] });
}
