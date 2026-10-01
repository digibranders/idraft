import { z } from 'zod';

import { jsonCookie, readJsonCookie } from './cookie-json';
import { minutesOf, timeOf } from './entities-codec';
import { MOCK_CREATED_AT } from './fixtures';
import { FIRST_MINTED, mockId, mockIdNumber, type IdKind } from './mock-ids';
import { MOCK_RUNS, MOCK_SCHEDULES } from './operations-fixtures';
import { OPERATIONS_COOKIE } from './session';

/**
 * What one browser changed in the schedules and runs of its workspace through the mocks (backend plan D9 and
 * D10): schedules created, edited, paused or deleted, and the manual runs it started or cancelled. Only the
 * changes are kept, against the fixtures (./operations-fixtures.ts), in their own cookie and in a compact
 * form: each row a tuple, a mock id as its number, a schedule time in whole minutes and a run time in whole
 * seconds after the fixture time (a run moves on within seconds).
 */
export { OPERATIONS_COOKIE };

export const SCHEDULE_WORKLOADS = ['keyword_metrics', 'seo_rank'] as const;
export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export const SCHEDULE_PRIORITIES = ['standard', 'high', 'low'] as const;
export const PROVIDER_MODES = ['standard_queue', 'priority_queue', 'live'] as const;
export const TRIGGERS = ['manual', 'schedule'] as const;
/** How a run ends when nothing stops it; `budget_blocked` never starts. */
export const RUN_ENDINGS = ['completed', 'completed_with_errors', 'failed', 'budget_blocked'] as const;

export type ScheduleWorkload = (typeof SCHEDULE_WORKLOADS)[number];
export type Cadence = (typeof CADENCES)[number];
export type SchedulePriority = (typeof SCHEDULE_PRIORITIES)[number];
export type ProviderMode = (typeof PROVIDER_MODES)[number];
export type Trigger = (typeof TRIGGERS)[number];
export type RunEnding = (typeof RUN_ENDINGS)[number];

/** Which subjects a schedule collects (`Selector`); members the workload does not take are left out. */
export interface StoredSelector {
  all?: true | undefined;
  groups?: string[] | undefined;
  terms?: string[] | undefined;
  priority_lte?: number | undefined;
  stale_days?: number | undefined;
}

export interface StoredSchedule {
  schedule_id: string;
  project_id: string;
  name: string;
  workload: ScheduleWorkload;
  cadence: Cadence;
  /** 0 is Sunday, as `deep_check_weekday`; weekly only. */
  weekday: number | null;
  /** 1 to 28; monthly only. */
  month_day: number | null;
  /** `HH:MM:SS`, in the schedule's time zone. */
  window_start_local: string;
  window_hours: number;
  timezone: string;
  priority: SchedulePriority;
  provider_mode: ProviderMode;
  selector: StoredSelector;
  is_active: boolean;
  created_at: string;
  deleted_at: string | null;
  /**
   * The next window as the API stores it: set on a create, a change of the rule and a resume, and moved on
   * by the planner once it is due. `null` for a fixture, whose next window follows from its rule.
   */
  next_run_at: string | null;
}

export interface StoredRun {
  run_id: string;
  project_id: string;
  schedule_id: string | null;
  workload: ScheduleWorkload;
  trigger: Trigger;
  created_at: string;
  /** The user who started it, or `null` for the system (a schedule, or the new-keyword tick of D8). */
  created_by: string | null;
  tasks_total: number;
  tasks_failed: number;
  /** Labs calls the run makes: one per location and language (D6). */
  calls: number;
  /** What the run was asked for, as `config_snapshot` shows it. */
  keyword_count: number | null;
  stale_days: number | null;
  ending: RunEnding;
  status_reason: string | null;
  blocked_by_budget_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface OperationChanges {
  /** The last number minted here. */
  minted?: number | undefined;
  /** Schedules created here, and fixture schedules as they are now; one row per id. */
  schedules?: StoredSchedule[] | undefined;
  /** Runs started here, as they are now. */
  runs?: StoredRun[] | undefined;
}

/** The fixtures with this browser's changes. */
export interface OperationWorld {
  schedules: StoredSchedule[];
  runs: StoredRun[];
}

export function operationWorld(changes: OperationChanges): OperationWorld {
  const edited = new Map((changes.schedules ?? []).map((row) => [row.schedule_id, row]));
  const fixtures = MOCK_SCHEDULES.map((row) => edited.get(row.schedule_id) ?? row);
  const fixtureIds = new Set(MOCK_SCHEDULES.map((row) => row.schedule_id));
  const created = (changes.schedules ?? []).filter((row) => !fixtureIds.has(row.schedule_id));
  return { schedules: [...fixtures, ...created], runs: [...MOCK_RUNS, ...(changes.runs ?? [])] };
}

export const withSchedule = (changes: OperationChanges, row: StoredSchedule): OperationChanges => ({
  ...changes,
  schedules: [...(changes.schedules ?? []).filter((other) => other.schedule_id !== row.schedule_id), row],
});

export const withRun = (changes: OperationChanges, row: StoredRun): OperationChanges => ({
  ...changes,
  runs: [...(changes.runs ?? []).filter((other) => other.run_id !== row.run_id), row],
});

/** Ids for the rows a request creates, counted on from the last one this browser made. */
export function operationIdMinter(changes: OperationChanges): {
  next: (kind: IdKind) => string;
  commit: (next: OperationChanges) => OperationChanges;
} {
  let last = changes.minted ?? FIRST_MINTED - 1;
  return {
    next: (kind) => {
      last += 1;
      return mockId(kind, last);
    },
    commit: (next) => ({ ...next, minted: last }),
  };
}

// The cookie

const BASE_MS = Date.parse(MOCK_CREATED_AT);
const secondsOf = (iso: string): number => Math.max(0, Math.round((Date.parse(iso) - BASE_MS) / 1000));
const timeOfSeconds = (seconds: number): string => new Date(BASE_MS + seconds * 1000).toISOString();

/** A mock id of `kind` as its number, any other id as it is. */
const idCell = (id: string, kind: IdKind): number | string => mockIdNumber(id, kind) ?? id;
const idOf = (cell: number | string, kind: IdKind): string => (typeof cell === 'number' ? mockId(kind, cell) : cell);
const code = <T extends string>(value: T, values: readonly T[]): number => Math.max(0, values.indexOf(value));
const valueOf = <T extends string>(index: number, values: readonly [T, ...T[]]): T => values[index] ?? values[0];

const ID = z.union([z.number().int().positive(), z.string().min(1).max(64)]);
const SELECTOR = z.object({
  all: z.literal(true).optional(),
  groups: z.array(z.string()).optional(),
  terms: z.array(z.string()).optional(),
  priority_lte: z.number().int().optional(),
  stale_days: z.number().int().optional(),
});
/** An index into the cookie's table of project and user ids, which are long and repeat. */
const REF = z.number().int().nonnegative();
const SCHEDULE = z.tuple([
  ID, // schedule
  REF, // project
  z.string(), // name
  z.number().int(), // workload
  z.number().int(), // cadence
  z.number().int().nullable(), // weekday
  z.number().int().nullable(), // month day
  z.string(), // window start, HH:MM:SS
  z.number().int(), // window hours
  z.string(), // time zone
  z.number().int(), // priority
  z.number().int(), // provider mode
  SELECTOR,
  z.number().int(), // active, 1 or 0
  z.number().int(), // created, minutes
  z.number().int().nullable(), // deleted, minutes
  z.number().int().nullable().optional(), // next window, minutes; left out by cookies written before it
]);
const RUN = z.tuple([
  ID, // run
  REF, // project
  ID.nullable(), // schedule
  z.number().int(), // workload
  z.number().int(), // trigger
  z.number().int(), // created, seconds
  REF.nullable(), // created by
  z.number().int(), // tasks
  z.number().int(), // tasks failed
  z.number().int(), // calls
  z.number().int().nullable(), // keyword count
  z.number().int().nullable(), // stale days
  z.number().int(), // ending
  z.string().nullable(), // status reason
  ID.nullable(), // blocking budget
  z.number().int().nullable(), // cancelled, seconds
  z.string().nullable(), // cancel reason
]);
const COMPACT = z.object({
  n: z
    .number()
    .int()
    .min(FIRST_MINTED - 1)
    .optional(),
  u: z.array(z.string()).optional(),
  s: z.array(SCHEDULE).optional(),
  r: z.array(RUN).optional(),
});
type Compact = z.infer<typeof COMPACT>;

/** A reference the table does not hold: the cookie was edited or is of another format. */
class BrokenReference extends Error {}

function encode(changes: OperationChanges): Compact {
  const table: string[] = [];
  const ref = (id: string): number => {
    const index = table.indexOf(id);
    if (index >= 0) return index;
    table.push(id);
    return table.length - 1;
  };
  const schedules = (changes.schedules ?? []).map((row): z.infer<typeof SCHEDULE> => [
    idCell(row.schedule_id, 'schedule'),
    ref(row.project_id),
    row.name,
    code(row.workload, SCHEDULE_WORKLOADS),
    code(row.cadence, CADENCES),
    row.weekday,
    row.month_day,
    row.window_start_local,
    row.window_hours,
    row.timezone,
    code(row.priority, SCHEDULE_PRIORITIES),
    code(row.provider_mode, PROVIDER_MODES),
    row.selector,
    row.is_active ? 1 : 0,
    minutesOf(row.created_at),
    row.deleted_at === null ? null : minutesOf(row.deleted_at),
    row.next_run_at === null ? null : minutesOf(row.next_run_at),
  ]);
  const runs = (changes.runs ?? []).map((row): z.infer<typeof RUN> => [
    idCell(row.run_id, 'run'),
    ref(row.project_id),
    row.schedule_id === null ? null : idCell(row.schedule_id, 'schedule'),
    code(row.workload, SCHEDULE_WORKLOADS),
    code(row.trigger, TRIGGERS),
    secondsOf(row.created_at),
    row.created_by === null ? null : ref(row.created_by),
    row.tasks_total,
    row.tasks_failed,
    row.calls,
    row.keyword_count,
    row.stale_days,
    code(row.ending, RUN_ENDINGS),
    row.status_reason,
    row.blocked_by_budget_id === null ? null : idCell(row.blocked_by_budget_id, 'budget'),
    row.cancelled_at === null ? null : secondsOf(row.cancelled_at),
    row.cancel_reason,
  ]);
  return {
    ...(changes.minted === undefined ? {} : { n: changes.minted }),
    ...(table.length === 0 ? {} : { u: table }),
    ...(schedules.length === 0 ? {} : { s: schedules }),
    ...(runs.length === 0 ? {} : { r: runs }),
  };
}

function decode(compact: Compact): OperationChanges {
  const table = compact.u ?? [];
  const idAt = (index: number): string => {
    const id = table[index];
    if (id === undefined) throw new BrokenReference(`No id at ${String(index)}`);
    return id;
  };
  const schedules = (compact.s ?? []).map(
    ([
      id,
      project,
      name,
      workload,
      cadence,
      weekday,
      monthDay,
      start,
      hours,
      timezone,
      priority,
      mode,
      selector,
      active,
      created,
      deleted,
      next,
    ]): StoredSchedule => ({
      schedule_id: idOf(id, 'schedule'),
      project_id: idAt(project),
      name,
      workload: valueOf(workload, SCHEDULE_WORKLOADS),
      cadence: valueOf(cadence, CADENCES),
      weekday,
      month_day: monthDay,
      window_start_local: start,
      window_hours: hours,
      timezone,
      priority: valueOf(priority, SCHEDULE_PRIORITIES),
      provider_mode: valueOf(mode, PROVIDER_MODES),
      selector,
      is_active: active === 1,
      created_at: timeOf(created),
      deleted_at: deleted === null ? null : timeOf(deleted),
      next_run_at: next === null || next === undefined ? null : timeOf(next),
    }),
  );
  const runs = (compact.r ?? []).map(
    ([
      id,
      project,
      schedule,
      workload,
      trigger,
      created,
      by,
      tasks,
      failed,
      calls,
      keywords,
      stale,
      ending,
      reason,
      budget,
      cancelled,
      cancelReason,
    ]): StoredRun => ({
      run_id: idOf(id, 'run'),
      project_id: idAt(project),
      schedule_id: schedule === null ? null : idOf(schedule, 'schedule'),
      workload: valueOf(workload, SCHEDULE_WORKLOADS),
      trigger: valueOf(trigger, TRIGGERS),
      created_at: timeOfSeconds(created),
      created_by: by === null ? null : idAt(by),
      tasks_total: tasks,
      tasks_failed: failed,
      calls,
      keyword_count: keywords,
      stale_days: stale,
      ending: valueOf(ending, RUN_ENDINGS),
      status_reason: reason,
      blocked_by_budget_id: budget === null ? null : idOf(budget, 'budget'),
      cancelled_at: cancelled === null ? null : timeOfSeconds(cancelled),
      cancel_reason: cancelReason,
    }),
  );
  return {
    ...(compact.n === undefined ? {} : { minted: compact.n }),
    ...(schedules.length === 0 ? {} : { schedules }),
    ...(runs.length === 0 ? {} : { runs }),
  };
}

export function readOperationChanges(cookies: Readonly<Record<string, string>>): OperationChanges {
  try {
    return decode(readJsonCookie(cookies, OPERATIONS_COOKIE, COMPACT, {}));
  } catch (error) {
    // A cookie that names ids it does not hold is ignored, like one of another shape
    if (error instanceof BrokenReference) return {};
    throw error;
  }
}

/**
 * The `Set-Cookie` that keeps `changes`, or `null` when they no longer fit in a cookie. Runs of earlier days
 * are long over; the oldest of them make room first, so today's runs (and the day's manual run count) stay.
 */
export function operationsCookie(changes: OperationChanges, now: number = Date.now()): string | null {
  const today = new Date(now).toISOString().slice(0, 10);
  const older = (changes.runs ?? [])
    .filter((run) => run.created_at.slice(0, 10) < today)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (let dropped = 0; dropped <= older.length; dropped += 1) {
    const gone = new Set(older.slice(0, dropped).map((run) => run.run_id));
    const kept = { ...changes, runs: (changes.runs ?? []).filter((run) => !gone.has(run.run_id)) };
    const cookie = jsonCookie(OPERATIONS_COOKIE, encode(kept));
    if (cookie !== null) return cookie;
  }
  return null;
}

/** Now, to the second a run keeps. */
export const runTime = (now: number = Date.now()): string => timeOfSeconds(secondsOf(new Date(now).toISOString()));
