import type { CollectionStatus } from '@/components/app/status/collection-progress';
import type { Run } from '@/lib/api/types';
import { can } from '@/lib/permissions';

export type RunStatus = Run['status'];
export type RunTrigger = Run['trigger'];

/** What a run's cancel rule and its task counts read: the fields of a `Run` they use. */
export type RunFacts = Pick<
  Run,
  'status' | 'trigger' | 'created_by' | 'tasks_total' | 'tasks_succeeded' | 'tasks_failed'
>;

/** The values of the list's filters, in the order the filter bar offers them; a test holds them to the API's enums. */
export const RUN_WORKLOADS: readonly Run['workload'][] = [
  'seo_rank',
  'ai_prompt',
  'ai_mode_keyword',
  'keyword_metrics',
  'discovery',
  'ai_benchmark',
  'gsc_sync',
  'bing_sync',
  'ga4_sync',
  'cloudflare_sync',
];
export const RUN_STATUSES: readonly RunStatus[] = [
  'planned',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'budget_blocked',
];
export const RUN_TRIGGERS: readonly RunTrigger[] = ['schedule', 'manual', 'backfill', 'retry'];

/** The catalog key of a run status under `runs.statuses`: keys are camelCase, the API's codes are not. */
export const RUN_STATUS_KEYS = {
  planned: 'planned',
  running: 'running',
  completed: 'completed',
  completed_with_errors: 'completedWithErrors',
  failed: 'failed',
  cancelled: 'cancelled',
  budget_blocked: 'budgetBlocked',
} as const satisfies Record<RunStatus, string>;

/** The catalog key of a trigger under `runs.triggers`. */
export const TRIGGER_KEYS = {
  schedule: 'schedule',
  manual: 'manual',
  backfill: 'backfill',
  retry: 'retry',
} as const satisfies Record<RunTrigger, string>;

/**
 * The task statuses of 21-scheduler-workers.md section 5.3 in reading order (17 section 4.1), with their
 * keys under `runs.taskStatuses`. `tasks_by_status` is open: a status not listed is shown as the API sent it.
 */
export const TASK_STATUS_KEYS = {
  ingested: 'ingested',
  skipped_cached: 'skippedCached',
  failed: 'failed',
  dead: 'dead',
  pending: 'pending',
  submit_unknown: 'submitUnknown',
  submitted: 'submitted',
  ready: 'ready',
  fetched: 'fetched',
  cancelled: 'cancelled',
} as const;

/** The reasons the API gives as codes (19 section 3.11.4), with their keys under `runs.reasons`. */
export const REASON_KEYS = {
  cancelled_by_user: 'cancelledByUser',
  budget_exceeded: 'budgetExceeded',
  project_not_collecting: 'projectNotCollecting',
  workload_unavailable: 'workloadUnavailable',
} as const;

type TaskStatusCode = keyof typeof TASK_STATUS_KEYS;
type ReasonCode = keyof typeof REASON_KEYS;
export type TaskStatusKey = (typeof TASK_STATUS_KEYS)[TaskStatusCode];
export type ReasonKey = (typeof REASON_KEYS)[ReasonCode];

const isTaskStatus = (code: string): code is TaskStatusCode => Object.hasOwn(TASK_STATUS_KEYS, code);
const isReason = (code: string): code is ReasonCode => Object.hasOwn(REASON_KEYS, code);

/** The status as `CollectionProgress` names it: a planned run is queued (17 section 4.1). */
export const collectionStatusOf = (status: RunStatus): CollectionStatus => (status === 'planned' ? 'queued' : status);

/** Planned and running runs may still be cancelled (19 section 3.11.4). */
export const isOpen = (run: Pick<Run, 'status'>): boolean => run.status === 'planned' || run.status === 'running';

/** `rows` with the newer reading of the runs among them: each run `newer` holds replaces its row. */
export function overlayRuns<T extends Pick<Run, 'run_id'>>(rows: readonly T[], newer: readonly T[]): readonly T[] {
  if (newer.length === 0) return rows;
  const byId = new Map(newer.map((run) => [run.run_id, run]));
  return rows.map((row) => byId.get(row.run_id) ?? row);
}

/**
 * Whether the poll's answer (the first page of the month's open runs) says the list is out of date: a run
 * the list holds as open is not among them, so it has ended; or one is that the list does not hold, so it was
 * started since. A poll that did not fit in one page can say neither.
 */
export function needsListRead(
  listed: readonly Pick<Run, 'run_id' | 'status'>[],
  heard: { data: readonly Pick<Run, 'run_id'>[]; page: { has_more: boolean } },
): boolean {
  if (heard.page.has_more) return false;
  const heardIds = new Set(heard.data.map((run) => run.run_id));
  const listedIds = new Set(listed.map((run) => run.run_id));
  return (
    listed.some((run) => isOpen(run) && !heardIds.has(run.run_id)) ||
    heard.data.some((run) => !listedIds.has(run.run_id))
  );
}

/**
 * Whether the member may cancel the run: `schedules:write` cancels any open run, `runs:trigger` the manual
 * runs the member asked for, which the run's actor names as a user with the member's id.
 */
export function canCancel(
  run: Pick<Run, 'status' | 'trigger' | 'created_by'>,
  member: { userId: string; permissions: readonly string[] },
): boolean {
  if (!isOpen(run)) return false;
  if (can(member.permissions, 'schedules:write')) return true;
  return (
    can(member.permissions, 'runs:trigger') &&
    run.trigger === 'manual' &&
    run.created_by?.actor_type === 'user' &&
    run.created_by.actor_id === member.userId
  );
}

export interface TaskSummary {
  /** Tasks with an outcome: succeeded or failed. */
  done: number;
  succeeded: number;
  failed: number;
  /** Tasks without one yet. */
  pending: number;
  total: number;
}

export function taskSummary(run: Pick<Run, 'tasks_total' | 'tasks_succeeded' | 'tasks_failed'>): TaskSummary {
  const done = run.tasks_succeeded + run.tasks_failed;
  return {
    done,
    succeeded: run.tasks_succeeded,
    failed: run.tasks_failed,
    pending: Math.max(0, run.tasks_total - done),
    total: run.tasks_total,
  };
}

export interface TaskStatusRow {
  /** The status as the API sent it. */
  code: string;
  /** Its key under `runs.taskStatuses`, or `null` for a status this client has no name for. */
  key: TaskStatusKey | null;
  count: number;
}

const TASK_ORDER: readonly string[] = Object.keys(TASK_STATUS_KEYS);

/** A run's `tasks_by_status` in reading order: the known statuses as the doc lists them, then the others. */
export function taskStatusRows(tasks: Readonly<Record<string, number>>): TaskStatusRow[] {
  const rank = (code: string): number => {
    const at = TASK_ORDER.indexOf(code);
    return at === -1 ? TASK_ORDER.length : at;
  };
  return Object.entries(tasks)
    .map(([code, count]): TaskStatusRow => ({ code, key: isTaskStatus(code) ? TASK_STATUS_KEYS[code] : null, count }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

/** The message key of a status reason that is one of the documented codes; `null` for anything else. */
export const reasonKeyOf = (reason: string | null): ReasonKey | null =>
  reason !== null && isReason(reason) ? REASON_KEYS[reason] : null;
