'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiAllPagesQuery, apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { BudgetStatusList, CostList, CostWorkload } from '@/lib/api/types';
import { monthDays, type MonthKey } from '@/lib/format/month';

/**
 * What a workspace spends (19 section 3.11): costs grouped for a month, the month's budget states and the
 * price book. The month's days are UTC, as the API counts them; `now` comes from the screen (`useUtcDay`),
 * the same `Date` for the whole UTC day, so a key never changes between renders within a day and the last
 * day of a running month is today.
 */

const COSTS = '/api/v1/workspaces/{workspace_id}/costs';
const BUDGETS = '/api/v1/workspaces/{workspace_id}/budgets/status';
const PRICE_BOOK = '/api/v1/workspaces/{workspace_id}/price-book';

/** One `group_by` choice of the costs route. */
export type CostGroup = NonNullable<paths[typeof COSTS]['get']['parameters']['query']['group_by']>[number];

export interface CostScope {
  workspaceId: string;
  month: MonthKey;
  /** Filters from the URL; `undefined` leaves a filter out of the request, which refuses empty parameters. */
  projectId?: string | undefined;
  workloads?: readonly CostWorkload[] | undefined;
  provider?: string | undefined;
}

/** The request for the month with `groupBy`; none gives the total in one row. */
export function costsQuery(scope: CostScope, groupBy: readonly CostGroup[], now: Date): ApiQueryOptions<typeof COSTS> {
  const { from, to } = monthDays(scope.month, now);
  const workloads = scope.workloads ?? [];
  return apiQuery(COSTS, {
    params: {
      path: { workspace_id: scope.workspaceId },
      query: {
        from,
        to,
        ...(groupBy.length === 0 ? {} : { group_by: [...groupBy] }),
        ...(scope.projectId === undefined ? {} : { 'filter[project_id]': scope.projectId }),
        ...(workloads.length === 0 ? {} : { 'filter[workload_in]': [...workloads] }),
        ...(scope.provider === undefined ? {} : { 'filter[provider_code]': scope.provider }),
      },
    },
  });
}

/** `GET {W}/costs` for the month with `groupBy` (none is the total). */
export function useCosts(scope: CostScope, groupBy: readonly CostGroup[], now: Date): UseQueryResult<CostList> {
  return useQuery(costsQuery(scope, groupBy, now));
}

/** The request for the budget states of a month; budgets ignore the filters of the page. */
export function budgetStatusQuery(workspaceId: string, month: MonthKey): ApiQueryOptions<typeof BUDGETS> {
  return apiQuery(BUDGETS, { params: { path: { workspace_id: workspaceId }, query: { month } } });
}

/** `GET {W}/budgets/status` for the month. */
export function useBudgetStatus(workspaceId: string, month: MonthKey): UseQueryResult<BudgetStatusList> {
  return useQuery(budgetStatusQuery(workspaceId, month));
}

/** The prices valid on the month's last day (today in a running month), every page. */
export function priceBookQuery(workspaceId: string, month: MonthKey, now: Date): ApiQueryOptions<typeof PRICE_BOOK> {
  return apiAllPagesQuery(PRICE_BOOK, (price) => price.price_id, {
    params: { path: { workspace_id: workspaceId }, query: { valid_at: monthDays(month, now).to } },
  });
}

/** `GET {W}/price-book` valid on the month's last day, every page (`apiAllPagesQuery`). */
export function usePriceBook(
  workspaceId: string,
  month: MonthKey,
  now: Date,
): UseQueryResult<ApiResponse<'get', typeof PRICE_BOOK>> {
  return useQuery(priceBookQuery(workspaceId, month, now));
}
