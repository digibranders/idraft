'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { overviewSchedulesQuery, type ProjectRef } from '../../../data/overview-queries';
import { mapRead, useRead, type Read } from '../../../data/read-state';
import { useOverview } from '../../../overview-context';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { BudgetStatus, Run, Schedule } from '@/lib/api/types';
import { useCan } from '@/lib/permissions';

/**
 * The reads of the activity family (WP-37 plan section 3): the AI runs, the AI schedules and the budgets' status.
 * A card reads through these hooks and never calls the API itself, so when the WP-30 routes are built only this file
 * and the models change. Each key starts with the project (or workspace) and then the route, so a refresh of the
 * project reaches them, and two cards that ask the same thing make one request.
 *
 * The Overview hooks (`useOverviewSchedule`, `useOverviewEngines`) take no `subscribed` option yet (WP-33 adds it):
 * these hooks run for a card in customize mode too, and gate only on what the person may read.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RUNS = `${P}/runs` as const;
const BUDGET_STATUS = '/api/v1/workspaces/{workspace_id}/budgets/status' as const;

/** Runs the card looks at: the newest AI runs are enough to find the last finished one and any run under way. */
export const AI_RUNS_PAGE = 10;

/** `GET {P}/runs` of the AI workload, newest first. */
export const aiRunsQuery = (project: ProjectRef): ApiQueryOptions<typeof RUNS> =>
  apiQuery(RUNS, {
    params: {
      path: { workspace_id: project.workspaceId, project_id: project.projectId },
      query: { 'filter[workload_in]': ['ai_prompt'], limit: AI_RUNS_PAGE },
    },
  });

/** `GET {W}/budgets/status` for the current month (UTC); every budget the member may see. */
export const budgetStatusQuery = (workspaceId: string): ApiQueryOptions<typeof BUDGET_STATUS> =>
  apiQuery(BUDGET_STATUS, { params: { path: { workspace_id: workspaceId } } });

/**
 * The newest AI runs. Not asked, and `idle`, for a member without access to runs (`canViewRuns`): a card that
 * would show them says so instead.
 */
export function useAiRuns(): Read<readonly Run[]> {
  const { workspaceId, project, canViewRuns } = useOverview();
  const query = useQuery({ ...aiRunsQuery({ workspaceId, projectId: project.id }), enabled: canViewRuns });
  const read = useRead(query, canViewRuns ? 'run' : 'idle');
  return useMemo(() => mapRead(read, (page): readonly Run[] => page.data), [read]);
}

/** The AI schedules of the project, paused ones too: the same request as `useOverviewSchedule`. */
export function useAiSchedules(): Read<readonly Schedule[]> {
  const { workspaceId, project } = useOverview();
  const read = useRead(useQuery(overviewSchedulesQuery({ workspaceId, projectId: project.id })));
  return useMemo(() => mapRead(read, (page): readonly Schedule[] => page.data), [read]);
}

/** The budgets' status of the month. Not asked, and `idle`, without `costs:read`: money is not read for a viewer. */
export function useBudgetStatus(): Read<readonly BudgetStatus[]> {
  const { workspaceId } = useOverview();
  const canReadCosts = useCan('costs:read');
  const query = useQuery({ ...budgetStatusQuery(workspaceId), enabled: canReadCosts });
  const read = useRead(query, canReadCosts ? 'run' : 'idle');
  return useMemo(() => mapRead(read, (page): readonly BudgetStatus[] => page.data), [read]);
}
