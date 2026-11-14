'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { askedEngines, overviewSchedulesQuery, type ProjectRef, type ReadScope } from '../../../data/overview-queries';
import { mapRead, useRead, type Gate, type Read } from '../../../data/read-state';
import type { ReadOptions } from '../../../data/use-overview-reads';
import { useOverview } from '../../../overview-context';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { BudgetStatus, EngineCode, Run, Schedule, Schemas } from '@/lib/api/types';
import { useCan } from '@/lib/permissions';

/**
 * The reads of the activity family (WP-37 plan section 3): the AI runs, the AI schedules and the budgets' status.
 * A card reads through these hooks and never calls the API itself, so when the WP-30 routes are built only this file
 * and the models change. Each key starts with the project (or workspace) and then the route, so a refresh of the
 * project reaches them, and two cards that ask the same thing make one request.
 *
 * Each hook takes `{ subscribed }` like the Overview hooks (a card passes its `live`): while it is `false` (customize
 * mode) nothing is asked, the data the read already has stays, and a read with none is `idle`, never `error`. What
 * the person may read gates on top of that, so a read that is not permitted asks nothing whatever `subscribed` says.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RUNS = `${P}/runs` as const;
const BUDGET_STATUS = '/api/v1/workspaces/{workspace_id}/budgets/status' as const;
const COLLECTION_DAILY = `${P}/ai/collection/daily` as const;

/** What `GET {P}/ai/collection/daily` answers: a row per day and engine, and the window and engines it read. */
export type CollectionDaily = Schemas['CollectionDailyResponse'];

/** Runs the card looks at: the newest AI runs are enough to find the last finished one and any run under way. */
export const AI_RUNS_PAGE = 10;

/** `GET {P}/runs` of the AI workload, newest first. */
export const aiRunsQuery = (project: ProjectRef, limit: number = AI_RUNS_PAGE): ApiQueryOptions<typeof RUNS> =>
  apiQuery(RUNS, {
    params: {
      path: { workspace_id: project.workspaceId, project_id: project.projectId },
      query: { 'filter[workload_in]': ['ai_prompt'], limit },
    },
  });

/** `GET {W}/budgets/status` for the current month (UTC); every budget the member may see. */
export const budgetStatusQuery = (workspaceId: string): ApiQueryOptions<typeof BUDGET_STATUS> =>
  apiQuery(BUDGET_STATUS, { params: { path: { workspace_id: workspaceId } } });

/**
 * `GET {P}/ai/collection/daily` for the window of the scope. The route counts every answer of the project, so only the
 * window and the engines narrow it (the country, the topic and the branded choice do not reach it). The engine filter
 * is left out when every engine that is on is asked, as for the other AI reads.
 */
export function collectionDailyQuery(project: ProjectRef, read: ReadScope): ApiQueryOptions<typeof COLLECTION_DAILY> {
  const asked = askedEngines(read);
  const filter: { 'filter[engine_code_in]'?: EngineCode[] } =
    asked.length === read.enabledEngines.length ? {} : { 'filter[engine_code_in]': [...asked] };
  return apiQuery(COLLECTION_DAILY, {
    params: {
      path: { workspace_id: project.workspaceId, project_id: project.projectId },
      query: { from: read.scope.range.from, to: read.scope.range.to, ...filter },
    },
  });
}

/** `idle` when the person may not read it; otherwise `run`, or `paused` while the card is not subscribed. */
const gateOf = (allowed: boolean, subscribed: boolean): Gate => (!allowed ? 'idle' : subscribed ? 'run' : 'paused');

/**
 * The newest AI runs. Not asked, and `idle`, for a member without access to runs (`canViewRuns`): a card that
 * would show them says so instead.
 */
export function useAiRuns({
  subscribed = true,
  limit = AI_RUNS_PAGE,
}: ReadOptions & {
  /** The newest runs asked for (the route takes up to 200); a card that looks at a past window asks for more. */ limit?: number;
} = {}): Read<readonly Run[]> {
  const { workspaceId, project, canViewRuns } = useOverview();
  const gate = gateOf(canViewRuns, subscribed);
  const query = useQuery({ ...aiRunsQuery({ workspaceId, projectId: project.id }, limit), enabled: gate === 'run' });
  const read = useRead(query, gate);
  return useMemo(() => mapRead(read, (page): readonly Run[] => page.data), [read]);
}

/** The AI schedules of the project, paused ones too: the same request as `useOverviewSchedule`. */
export function useAiSchedules({ subscribed = true }: ReadOptions = {}): Read<readonly Schedule[]> {
  const { workspaceId, project } = useOverview();
  const query = useQuery({
    ...overviewSchedulesQuery({ workspaceId, projectId: project.id }),
    enabled: subscribed,
  });
  const read = useRead(query, gateOf(true, subscribed));
  return useMemo(() => mapRead(read, (page): readonly Schedule[] => page.data), [read]);
}

/** The budgets' status of the month. Not asked, and `idle`, without `costs:read`: money is not read for a viewer. */
export function useBudgetStatus({ subscribed = true }: ReadOptions = {}): Read<readonly BudgetStatus[]> {
  const { workspaceId } = useOverview();
  const gate = gateOf(useCan('costs:read'), subscribed);
  const query = useQuery({ ...budgetStatusQuery(workspaceId), enabled: gate === 'run' });
  const read = useRead(query, gate);
  return useMemo(() => mapRead(read, (page): readonly BudgetStatus[] => page.data), [read]);
}

/**
 * The collection of the answers day by day, for the window and the engines of the Overview scope: a row per project
 * day and engine, zero filled, with the answers by status and what the schedules planned (`scheduled` is `null`, never
 * 0, where that is not known). One request for every card that asks the same scope (the answer calendar, the answer
 * status chart and the key changes feed). `idle` while no engine of the scope is on (nothing to ask, so a card says
 * so and never shows zeros), `loading` until the engines are known, and a scope change keeps the last days on screen
 * until the new ones arrive. Pass `subscribed: live`: a paused read asks nothing.
 */
export function useCollectionDaily({ subscribed = true }: ReadOptions = {}): Read<CollectionDaily> {
  const { workspaceId, project, scope, engines, enabledEngines } = useOverview();
  const input: ReadScope = { scope, enabledEngines };
  const known = engines.data !== undefined;
  const gate: Gate = !known ? 'waiting' : askedEngines(input).length === 0 ? 'idle' : subscribed ? 'run' : 'paused';
  const query = useQuery({
    ...collectionDailyQuery({ workspaceId, projectId: project.id }, input),
    enabled: gate === 'run',
    placeholderData: keepPreviousData,
  });
  return useRead(query, gate);
}
