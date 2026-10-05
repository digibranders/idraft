import type { QueryClient } from '@tanstack/react-query';

import { projectKey } from '@/lib/api/keys';
import { apiAllPagesQuery, apiMutation, type ApiQueryOptions } from '@/lib/api/query';

/**
 * A project's schedules (19 section 3.11.3): the list the Schedules section shows whole, and the writes
 * of its dialog and menu. A schedule is a measurement instrument, so every change is pessimistic: the
 * screen waits for the answer and reads the list again (20 section 3.5, Mutations).
 */

const SCHEDULES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules';
const SCHEDULE = `${SCHEDULES}/{schedule_id}` as const;

/** The workspace and the project whose schedules are read. */
export interface ScheduleScope {
  workspaceId: string;
  projectId: string;
}

/**
 * Every schedule of the project, newest last, read page by page. Read again whenever it is asked for, since
 * each answer carries a next run that was worked out from the clock of the server.
 */
export const schedulesQuery = (scope: ScheduleScope): ApiQueryOptions<typeof SCHEDULES> => ({
  ...apiAllPagesQuery(SCHEDULES, (schedule) => schedule.schedule_id, {
    params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
  }),
  staleTime: 0,
});

/**
 * After a change to a schedule: the list, and the tracked keywords, whose detail names the schedule they
 * follow with its next run. Resolves once the queries on screen have read again.
 */
export function refreshSchedules(queryClient: QueryClient, scope: ScheduleScope): Promise<void> {
  const project = projectKey(scope.workspaceId, scope.projectId);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [...project, 'schedules'] }),
    queryClient.invalidateQueries({ queryKey: [...project, 'tracked-keywords'] }),
  ]).then(() => undefined);
}

export const CREATE_SCHEDULE = apiMutation('post', SCHEDULES);
export const UPDATE_SCHEDULE = apiMutation('patch', SCHEDULE);
export const DELETE_SCHEDULE = apiMutation('delete', SCHEDULE);
export const PAUSE_SCHEDULE = apiMutation('post', `${SCHEDULE}/pause`);
export const RESUME_SCHEDULE = apiMutation('post', `${SCHEDULE}/resume`);
