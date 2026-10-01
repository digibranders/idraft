import { TZDate } from '@date-fns/tz';

import { MOCK_USERS } from '../fixtures';
import { LABS_ITEM_MICROS, LABS_TASK_MICROS } from '../operations-fixtures';
import type { OperationWorld, StoredRun, StoredSchedule } from '../operations-state';
import type { components } from '@/lib/api/schema';

/**
 * Schedules and runs as the API answers them (19 sections 2.10 and 3.11): a schedule's next run in its own
 * time zone, and a run that moves on by itself. A run made in a browser is planned for a few seconds, runs
 * for a few more, and ends as its `ending` says unless it was cancelled first; the fixture runs are long over.
 */

type Schemas = components['schemas'];
type Run = Schemas['Run'];
type RunDetail = Schemas['RunDetail'];
type Schedule = Schemas['Schedule'];
type Operation = Schemas['Operation'];
type RunStatus = Run['status'];

/** How long a new run waits for the planner, and how long its live calls take after that. */
export const RUN_PLANNED_MS = 3_000;
export const RUN_WORKING_MS = 12_000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The next start of a schedule's window after `now`, in its time zone: every day, on its weekday (0 is
 * Sunday) or on its day of the month. A paused schedule still has one; resuming does not catch up.
 */
export function nextRunAt(schedule: StoredSchedule, now: number): string {
  const today = new TZDate(now, schedule.timezone);
  const [hour = 0, minute = 0] = schedule.window_start_local.split(':').map(Number);
  // Two months of days always hold the next day of the month
  for (let offset = 0; offset <= 62; offset += 1) {
    // The wall clock time in the zone; a time a clock change skips moves forward
    const at = new TZDate(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
      hour,
      minute,
      schedule.timezone,
    );
    const fits =
      schedule.cadence === 'daily' ||
      (schedule.cadence === 'weekly' && at.getDay() === schedule.weekday) ||
      (schedule.cadence === 'monthly' && at.getDate() === schedule.month_day);
    if (fits && at.getTime() > now) return new Date(at.getTime()).toISOString();
  }
  throw new Error(`No next run for schedule ${schedule.schedule_id}`);
}

export function scheduleView(world: OperationWorld, schedule: StoredSchedule, now: number): Schedule {
  const last = world.runs
    .filter((run) => run.schedule_id === schedule.schedule_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    schedule_id: schedule.schedule_id,
    project_id: schedule.project_id,
    name: schedule.name,
    workload: schedule.workload,
    cadence: schedule.cadence,
    cron_expr: null,
    weekday: schedule.weekday,
    month_day: schedule.month_day,
    window_start_local: schedule.window_start_local,
    window_hours: schedule.window_hours,
    timezone: schedule.timezone,
    priority: schedule.priority,
    provider_mode: schedule.provider_mode,
    selector: {
      all: schedule.selector.all ?? null,
      groups: schedule.selector.groups ?? null,
      terms: schedule.selector.terms ?? null,
      priority_lte: schedule.selector.priority_lte ?? null,
      stale_days: schedule.selector.stale_days ?? null,
    },
    is_active: schedule.is_active,
    next_run_at: nextRunAt(schedule, now),
    last_run_id: last?.run_id ?? null,
    created_at: schedule.created_at,
  };
}

// Runs

/** Money as the API writes it: a decimal string, to the micro-dollar (D6). */
export const usdOfMicros = (micros: number): string =>
  `${String(Math.floor(micros / 1_000_000))}.${String(micros % 1_000_000).padStart(6, '0')}`;

/** What `tasks` Labs readings in `calls` calls cost (doc 27 section 1). */
export const labsMicros = (calls: number, tasks: number): number => calls * LABS_TASK_MICROS + tasks * LABS_ITEM_MICROS;

export interface RunState {
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Tasks done (ingested) and failed so far. */
  done: number;
  failed: number;
  /** Labs calls answered and charged so far. */
  calls: number;
  /** What those calls cost once the run has ended, or `null` while it has not. */
  costMicros: number | null;
}

const NOTHING_YET = { startedAt: null, completedAt: null, done: 0, failed: 0, calls: 0, costMicros: null };

/** Where a run is at `now`. */
export function runState(run: StoredRun, now: number): RunState {
  if (run.ending === 'budget_blocked') return { status: 'budget_blocked', ...NOTHING_YET };
  const started = Date.parse(run.created_at) + RUN_PLANNED_MS;
  const finished = started + RUN_WORKING_MS;
  const startedAt = new Date(started).toISOString();
  /** Tasks the calls had answered by `at`, and the calls that took. */
  const progress = (at: number): { done: number; calls: number } => {
    const done = at <= started ? 0 : Math.floor((run.tasks_total * (at - started)) / RUN_WORKING_MS);
    return { done, calls: done === 0 ? 0 : Math.ceil((run.calls * done) / Math.max(1, run.tasks_total)) };
  };
  const cancelled = run.cancelled_at === null ? null : Date.parse(run.cancelled_at);
  if (cancelled !== null && cancelled < finished) {
    // Calls already answered are kept and paid for; the rest is cancelled
    const { done, calls } = progress(cancelled);
    return {
      status: 'cancelled',
      startedAt: cancelled >= started ? startedAt : null,
      completedAt: run.cancelled_at,
      done,
      failed: 0,
      calls,
      costMicros: labsMicros(calls, done),
    };
  }
  if (now < started) return { status: 'planned', ...NOTHING_YET };
  if (now < finished) {
    const { done, calls } = progress(now);
    return { status: 'running', startedAt, completedAt: null, done, failed: 0, calls, costMicros: null };
  }
  // A failed live call is not charged
  const succeeded = run.tasks_total - run.tasks_failed;
  const calls = succeeded === 0 ? 0 : run.calls;
  return {
    status: run.ending,
    startedAt,
    completedAt: new Date(finished).toISOString(),
    done: succeeded,
    failed: run.tasks_failed,
    calls,
    costMicros: labsMicros(calls, succeeded),
  };
}

const OPERATION_STATUS: Readonly<Record<RunStatus, Operation['status']>> = {
  planned: 'queued',
  running: 'running',
  completed: 'succeeded',
  completed_with_errors: 'succeeded_with_errors',
  failed: 'failed',
  cancelled: 'cancelled',
  budget_blocked: 'blocked',
};

const SYSTEM_ACTOR: Schemas['Actor'] = { actor_id: 'system', actor_type: 'system', label: 'Sightline' };

function actorOf(userId: string | null): Schemas['Actor'] | null {
  if (userId === null) return SYSTEM_ACTOR;
  const user = MOCK_USERS.find((candidate) => candidate.user_id === userId);
  return { actor_id: userId, actor_type: 'user', label: user?.name ?? 'Member' };
}

/** The path of a run in the API, for `operation.links`. */
export const runPath = (workspaceId: string, run: StoredRun): string =>
  `/api/v1/workspaces/${workspaceId}/projects/${run.project_id}/runs/${run.run_id}`;

export function runView(workspaceId: string, schedules: readonly StoredSchedule[], run: StoredRun, now: number): Run {
  const state = runState(run, now);
  const schedule = schedules.find((candidate) => candidate.schedule_id === run.schedule_id);
  const windowStart = Date.parse(run.created_at);
  const windowHours = schedule?.window_hours ?? 1;
  const open = state.status === 'planned' || state.status === 'running';
  const self = runPath(workspaceId, run);
  return {
    run_id: run.run_id,
    project_id: run.project_id,
    schedule_id: run.schedule_id,
    workload: run.workload,
    trigger: run.trigger,
    status: state.status,
    status_reason: state.status === 'cancelled' ? (run.cancel_reason ?? 'Cancelled.') : run.status_reason,
    window_start: run.created_at,
    window_end: new Date(windowStart + windowHours * HOUR_MS).toISOString(),
    tasks_total: run.tasks_total,
    tasks_succeeded: state.done,
    tasks_failed: state.failed,
    estimated_cost_usd: usdOfMicros(labsMicros(run.calls, run.tasks_total)),
    actual_cost_usd: state.costMicros === null ? null : usdOfMicros(state.costMicros),
    blocked_by_budget_id: run.blocked_by_budget_id,
    created_by: actorOf(run.created_by),
    created_at: run.created_at,
    completed_at: state.completedAt,
    operation: {
      kind: 'collection_run',
      status: OPERATION_STATUS[state.status],
      progress: { done: state.done + state.failed, total: run.tasks_total, unit: 'tasks' },
      started_at: state.startedAt,
      finished_at: state.completedAt,
      error:
        state.status === 'failed' ? { code: 'provider_timeout', detail: run.status_reason ?? 'The run failed.' } : null,
      links: { self, ...(open ? { cancel: `${self}/cancel` } : {}) },
    },
  };
}

export function runDetailView(
  workspaceId: string,
  schedules: readonly StoredSchedule[],
  run: StoredRun,
  now: number,
): RunDetail {
  const view = runView(workspaceId, schedules, run, now);
  const state = runState(run, now);
  const left = run.tasks_total - state.done - state.failed;
  const tasks: Record<string, number> = {};
  if (state.status !== 'budget_blocked') {
    if (state.done > 0) tasks.ingested = state.done;
    if (state.failed > 0) tasks.failed = state.failed;
    if (left > 0) tasks[state.status === 'cancelled' ? 'cancelled' : 'pending'] = left;
  }
  return {
    ...view,
    tasks_by_status: tasks,
    config_snapshot: {
      workload: run.workload,
      provider_mode: 'live',
      // The cookie keeps how many keywords a manual run named, not their ids
      selector:
        run.stale_days !== null
          ? { stale_days: run.stale_days }
          : { keyword_count: run.keyword_count ?? run.tasks_total },
    },
  };
}
