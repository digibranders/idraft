import { TZDate } from '@date-fns/tz';
import { getISOWeek, getISOWeekYear } from 'date-fns';

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

/** What decides a schedule's windows. */
export type ScheduleRule = Pick<
  StoredSchedule,
  'cadence' | 'weekday' | 'month_day' | 'window_start_local' | 'timezone'
>;

/**
 * The first window start strictly after `after` (backend `next_occurrence`): every day, on the weekday (0
 * is Sunday) or on the day of the month, at the wall-clock time in the rule's zone. It looks from the day
 * before, since where clocks go forward over midnight a late window of one day starts early on the next.
 */
export function nextOccurrence(rule: ScheduleRule, after: number): number {
  const local = new TZDate(after, rule.timezone);
  const [hour = 0, minute = 0] = rule.window_start_local.split(':').map(Number);
  // A rule has a window at least every 31 days: the day before, `after`'s day and 31 more hold the next
  for (let offset = -1; offset <= 32; offset += 1) {
    // The wall clock time in the zone; a time a clock change skips moves forward
    const at = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + offset, hour, minute, rule.timezone);
    const fits =
      rule.cadence === 'daily' ||
      (rule.cadence === 'weekly' && at.getDay() === rule.weekday) ||
      (rule.cadence === 'monthly' && at.getDate() === rule.month_day);
    if (fits && at.getTime() > after) return at.getTime();
  }
  throw new Error('A schedule rule has a window at least once a month');
}

/** The local day, ISO week or month an instant is in, by the rule's cadence (backend `_period`). */
function periodOf(rule: ScheduleRule, instant: number): string {
  const day = new TZDate(instant, rule.timezone);
  if (rule.cadence === 'weekly') return `${String(getISOWeekYear(day))}-W${String(getISOWeek(day))}`;
  if (rule.cadence === 'monthly') return `${String(day.getFullYear())}-${String(day.getMonth() + 1)}`;
  return `${String(day.getFullYear())}-${String(day.getMonth() + 1)}-${String(day.getDate())}`;
}

/** The window the schedule's chain starts from: its stored next window, or for a fixture its first. */
const firstWindow = (schedule: StoredSchedule): number =>
  schedule.next_run_at === null
    ? nextOccurrence(schedule, Date.parse(schedule.created_at))
    : Date.parse(schedule.next_run_at);

/**
 * The schedule's next window as the API answers it at `now`. The mocks have no planner, so this does its
 * part: an active schedule's windows that came due were planned, and each moved the next one on. A paused
 * schedule is not planned, so its next window stays where it was until it resumes.
 */
export function currentNextRunAt(schedule: StoredSchedule, now: number): string {
  let next = firstWindow(schedule);
  if (schedule.is_active) {
    while (next <= now) next = nextOccurrence(schedule, next);
  }
  return new Date(next).toISOString();
}

/**
 * The start of the latest window the schedule ran (backend `last_window_start`): its newest scheduled run,
 * or a window the planner would have planned by `now`, whichever is later; `null` before the first.
 */
export function lastWindowStart(world: OperationWorld, schedule: StoredSchedule, now: number): number | null {
  const runs = world.runs
    .filter((run) => run.schedule_id === schedule.schedule_id && run.trigger === 'schedule')
    .map((run) => Date.parse(run.created_at))
    .filter((at) => at <= now);
  let planned: number | null = null;
  if (schedule.is_active) {
    for (let window = firstWindow(schedule); window <= now; window = nextOccurrence(schedule, window)) {
      planned = window;
    }
  }
  // What the stand-in planner ran before the next window was last set
  const remembered = schedule.last_window_at === null ? null : Date.parse(schedule.last_window_at);
  const latest = Math.max(...runs, planned ?? Number.NEGATIVE_INFINITY, remembered ?? Number.NEGATIVE_INFINITY);
  return Number.isFinite(latest) ? latest : null;
}

/**
 * The next window under a rule that was just changed (backend `next_after_change`): after `now`, and
 * outside the period a window of the schedule already started in, so moving today's window later does
 * not collect today twice.
 */
export function nextAfterChange(rule: ScheduleRule, now: number, lastWindow: number | null): string {
  let candidate = nextOccurrence(rule, now);
  if (lastWindow !== null) {
    const done = periodOf(rule, lastWindow);
    while (periodOf(rule, candidate) === done) candidate = nextOccurrence(rule, candidate);
  }
  return new Date(candidate).toISOString();
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
    next_run_at: currentNextRunAt(schedule, now),
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
    // The API names a cancel by its code; any free text a member gave is kept for the audit, not sent here
    status_reason: state.status === 'cancelled' ? 'cancelled_by_user' : run.status_reason,
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
