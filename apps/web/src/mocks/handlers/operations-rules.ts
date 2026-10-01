import type { HttpResponse } from 'msw';

import {
  keywordProjectCaller,
  keywordWorkspaceCaller,
  type KeywordProjectCaller,
  type KeywordWorkspaceCaller,
  type ScheduleCheck,
} from './keyword-rules';
import { labsMicros, runState } from '../factories/operations';
import { KEYWORD_OVERVIEW_ENDPOINT, MOCK_BUDGETS, type BudgetGroup, type StoredBudget } from '../operations-fixtures';
import {
  OPERATIONS_COOKIE,
  operationsCookie,
  operationWorld,
  readOperationChanges,
  type OperationChanges,
  type OperationWorld,
  type ScheduleWorkload,
  type StoredRun,
} from '../operations-state';
import { problem } from '../respond';
import { projectList } from '../workspace-state';
import type { Permission } from '@/lib/permissions/permissions';
import type { Problem } from '@/lib/api/types';

/**
 * What the schedule, run and cost routes share: callers that also carry the schedules and runs, the check a
 * tracked keyword's `schedule_id` passes, the cost events the runs leave (D14, read the way `ops.cost_daily`
 * is) and the budget states the runs are judged against (doc 27 section 10.3).
 */

type PathParam = string | readonly string[] | undefined;
interface Gate {
  permission: Permission;
  query?: readonly string[];
}

export interface OperationsProjectCaller extends KeywordProjectCaller {
  operationChanges: OperationChanges;
  operations: OperationWorld;
}

export interface OperationsWorkspaceCaller extends KeywordWorkspaceCaller {
  operationChanges: OperationChanges;
  operations: OperationWorld;
}

export function operationsProjectCaller(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  workspaceId: PathParam,
  projectId: PathParam,
  gate: Gate,
): OperationsProjectCaller | HttpResponse<Problem> {
  const caller = keywordProjectCaller(request, cookies, workspaceId, projectId, gate);
  if (caller instanceof Response) return caller;
  const operationChanges = readOperationChanges(cookies);
  return { ...caller, operationChanges, operations: operationWorld(operationChanges) };
}

export function operationsWorkspaceCaller(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  workspaceId: PathParam,
  gate: Gate,
): OperationsWorkspaceCaller | HttpResponse<Problem> {
  const caller = keywordWorkspaceCaller(request, cookies, workspaceId, gate);
  if (caller instanceof Response) return caller;
  const operationChanges = readOperationChanges(cookies);
  return { ...caller, operationChanges, operations: operationWorld(operationChanges) };
}

/** The `Set-Cookie` that keeps `changes`, or the `422` to answer when they no longer fit in the cookie. */
export function savedOperations(request: Request, changes: OperationChanges): string | HttpResponse<Problem> {
  return (
    operationsCookie(changes) ??
    problem(request, 'mock_state_full', {
      detail: `What this browser changed no longer fits in the mock state. Expire the ${OPERATIONS_COOKIE} cookie to start again from the fixtures.`,
    })
  );
}

/** A tracked keyword may name a live `seo_rank` schedule of its own project (D10). */
export const scheduleCheckOf =
  (world: OperationWorld): ScheduleCheck =>
  (projectId, scheduleId) =>
    world.schedules.some(
      (schedule) =>
        schedule.schedule_id === scheduleId &&
        schedule.project_id === projectId &&
        schedule.workload === 'seo_rank' &&
        schedule.deleted_at === null,
    );

/** The schedule check of the request's cookies, for the tracked keyword routes. */
export const scheduleCheckFor = (cookies: Readonly<Record<string, string>>): ScheduleCheck =>
  scheduleCheckOf(operationWorld(readOperationChanges(cookies)));

// Manual runs (D9)

/** Manual runs users may start per project and UTC day; system runs do not count. */
export const MANUAL_RUN_LIMIT = 20;

export function manualRunsToday(world: OperationWorld, projectId: string, now: number): number {
  const day = new Date(now).toISOString().slice(0, 10);
  return world.runs.filter(
    (run) =>
      run.project_id === projectId &&
      run.trigger === 'manual' &&
      run.created_by !== null &&
      run.created_at.slice(0, 10) === day,
  ).length;
}

// Cost events, as the hourly rollup groups them (D14)

/** The budget group a task workload's spend counts in (doc 04 section 11.4.1). */
export const BUDGET_GROUP_OF: Readonly<Record<ScheduleWorkload, BudgetGroup>> = {
  keyword_metrics: 'keyword_research',
  seo_rank: 'seo_rank',
};

export interface CostEvent {
  /** The UTC day the cost was booked. */
  day: string;
  project_id: string;
  workload: ScheduleWorkload;
  provider: string;
  endpoint: string;
  engine: string;
  channel: string;
  micros: number;
  requests: number;
  subjects: number;
}

/** The budget scope of a caller's workspace: every live project of it, whatever the caller may see. */
export const budgetScopeOf = (caller: KeywordWorkspaceCaller | KeywordProjectCaller): BudgetScope => ({
  workspaceId: caller.access.workspace.workspace_id,
  projectIds: new Set(projectList(caller.changes, caller.access.workspace.workspace_id).map((p) => p.project_id)),
});

/** The cost events of the runs that have spent something by `now`. */
export function costEvents(world: OperationWorld, now: number): CostEvent[] {
  return world.runs.flatMap((run) => {
    const state = runState(run, now);
    if (state.costMicros === null || state.costMicros === 0 || state.completedAt === null) return [];
    return [
      {
        day: state.completedAt.slice(0, 10),
        project_id: run.project_id,
        workload: run.workload,
        provider: 'dataforseo',
        endpoint: KEYWORD_OVERVIEW_ENDPOINT,
        engine: 'google',
        channel: 'research',
        micros: state.costMicros,
        requests: state.calls,
        subjects: state.done,
      },
    ];
  });
}

// Budgets (doc 27 section 10.3)

export interface BudgetReading {
  budget: StoredBudget;
  spentMicros: number;
  committedMicros: number;
  state: 'ok' | 'soft_exceeded' | 'hard_exceeded';
  blockedRuns: number;
}

const microsOfUsd = (usd: string): number => {
  const [whole = '0', fraction = ''] = usd.split('.');
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0').slice(0, 6));
};

/** A workspace and its projects: what a budget reads spend from. */
export interface BudgetScope {
  workspaceId: string;
  projectIds: ReadonlySet<string>;
}

/** Whether spend of `projectId` and `workload` counts against `budget` of `scope`. */
const counts = (budget: StoredBudget, scope: BudgetScope, projectId: string, workload: ScheduleWorkload): boolean =>
  scope.projectIds.has(projectId) &&
  (budget.project_id === null || budget.project_id === projectId) &&
  (budget.workload === 'all' || budget.workload === BUDGET_GROUP_OF[workload]);

/**
 * Where each budget of the workspace stands in `month` (`YYYY-MM`). A member limited to some projects
 * (`visible`) sees those projects' budgets only.
 */
export function budgetReadings(
  world: OperationWorld,
  scope: BudgetScope,
  month: string,
  now: number,
  visible: ReadonlySet<string> | null,
): BudgetReading[] {
  const events = costEvents(world, now).filter((event) => event.day.startsWith(month));
  return MOCK_BUDGETS.filter(
    (budget) =>
      budget.workspace_id === scope.workspaceId &&
      (visible === null || (budget.project_id !== null && visible.has(budget.project_id))),
  ).map((budget) => {
    const spentMicros = events
      .filter((event) => counts(budget, scope, event.project_id, event.workload))
      .reduce((sum, event) => sum + event.micros, 0);
    // What the runs under way are still expected to spend: their estimate, as they have not been charged yet
    const committedMicros = world.runs
      .filter((run) => counts(budget, scope, run.project_id, run.workload))
      .filter((run) => {
        const { status } = runState(run, now);
        return status === 'planned' || status === 'running';
      })
      .reduce((sum, run) => sum + labsMicros(run.calls, run.tasks_total), 0);
    const limit = microsOfUsd(budget.limit_usd);
    const state =
      spentMicros >= limit
        ? 'hard_exceeded'
        : spentMicros * 100 >= limit * budget.soft_limit_pct
          ? 'soft_exceeded'
          : 'ok';
    const blockedRuns = world.runs.filter(
      (run) => run.blocked_by_budget_id === budget.budget_id && run.created_at.startsWith(month),
    ).length;
    return { budget, spentMicros, committedMicros, state, blockedRuns };
  });
}

/** The budget a new run of `estimateMicros` would go over, if its hard limit pauses runs (pre-flight). */
export function blockingBudget(
  world: OperationWorld,
  scope: BudgetScope,
  run: Pick<StoredRun, 'project_id' | 'workload'>,
  estimateMicros: number,
  now: number,
): StoredBudget | null {
  const month = new Date(now).toISOString().slice(0, 7);
  const reading = budgetReadings(world, scope, month, now, null).find(
    ({ budget, spentMicros, committedMicros }) =>
      budget.action_on_hard === 'pause' &&
      counts(budget, scope, run.project_id, run.workload) &&
      spentMicros + committedMicros + estimateMicros > microsOfUsd(budget.limit_usd),
  );
  return reading?.budget ?? null;
}
