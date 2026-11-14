import { HttpResponse, type HttpHandler } from 'msw';

import { MANUAL_RUN_LIMIT, manualRunsToday, operationsProjectCaller } from './operations-rules';
import { isoOf, workspaceProjects } from './prompts';
import { fixtureEngines, fixturePrompts, PROMPT_QUOTA, runInstants } from '../prompt-fixtures';
import { activePromptCount, AI_ANSWER_QUOTA, promptsOf } from '../prompts-state';
import { mock } from '../respond';
import type { Schemas } from '@/lib/api/types';

/**
 * `GET {P}/ai/limits` (contract C1, backend `api/ai/limits_routes.py`): the numbers the page header and the confirm
 * dialogs show before a click, the same ones the writes check. Active prompts of the whole workspace against the
 * limit of 150; the AI answers of the workspace this UTC month (the fixtures' schedules and what Run now asked, as
 * `./prompt-run-now.ts` counts them) against 20,000; the manual runs the project has had today, shared with every
 * other manual run (`manualRunsToday`).
 * shortcut: the month's answers repeat `scheduledAnswers` of ./prompt-run-now.ts, which is not exported; export it
 * from there and import it here when that file is free to change.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

const monthOf = (instant: number): string => isoOf(instant).slice(0, 7);

/** The answers the fixtures' schedules asked of the workspace's projects in the month of `now`. */
function scheduledAnswers(projectIds: readonly string[], now: number): number {
  const runs = runInstants(now).filter((at) => monthOf(at) === monthOf(now)).length;
  return projectIds.reduce((sum, id) => sum + runs * fixturePrompts(id).length * fixtureEngines(id).length, 0);
}

export const promptLimitHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/limits`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const now = Date.now();
    const projects = workspaceProjects(caller);
    const data: Schemas['AiLimits'] = {
      prompts: { limit: PROMPT_QUOTA, used: activePromptCount(projects) },
      ai_observations_month: {
        limit: AI_ANSWER_QUOTA,
        used:
          scheduledAnswers(projects, now) +
          projects.reduce((sum, id) => sum + (promptsOf(id).answersAsked.get(monthOf(now)) ?? 0), 0),
      },
      manual_runs_today: {
        limit: MANUAL_RUN_LIMIT,
        used: manualRunsToday(caller.operations, caller.project.project_id, now),
      },
    };
    return HttpResponse.json({ data });
  }),
];
