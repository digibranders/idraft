import { HttpResponse, type HttpHandler } from 'msw';

import { groupErrors, idListError, integerError, termErrors } from './keyword-rules';
import { operationsProjectCaller, savedOperations, type OperationsProjectCaller } from './operations-rules';
import {
  bodyError,
  booleanQuery,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  offsetPageOf,
  offsetPaging,
  queryError,
  textError,
} from './rules';
import { stateTime } from '../entities-codec';
import { lastWindowStart, nextAfterChange, nextOccurrence, scheduleView } from '../factories/operations';
import {
  CADENCES,
  operationIdMinter,
  operationWorld,
  PROVIDER_MODES,
  SCHEDULE_PRIORITIES,
  SCHEDULE_WORKLOADS,
  withSchedule,
  type StoredSchedule,
  type StoredSelector,
} from '../operations-state';
import { invalid, mock, noContent, problem } from '../respond';
import type { ValidationItem } from '@/lib/api/types';
import { currentTimeZoneName, isKnownTimeZone, TIMEZONE_PATTERN } from '@/lib/format/time-zone';

/**
 * A project's schedules (19 section 3.11, backend plan D10): `daily`, `weekly` (on a weekday, 0 is Sunday)
 * and `monthly` (on day 1 to 28) cadences, for the two workloads this step runs, with a selector checked per
 * workload. Pausing keeps the schedule; resuming does not catch up. A delete keeps the row for its runs and
 * is refused while a tracked keyword names the schedule. As built (backend `api/operations/schedules.py`),
 * the service answers the first stage that fails: the workload, the cadence and the provider mode; then the
 * selector; then the days (on a change) or `cron_expr`; then the time zone; then the groups and terms.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const TASK_WORKLOADS = [
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
] as const;
const INPUT_CADENCES = [...CADENCES, 'cron'] as const;
/** In the order the service checks them, so the first error found is always the same one. */
const SELECTOR_MEMBERS = ['all', 'groups', 'terms', 'priority_lte', 'stale_days'] as const;
type Workload = (typeof SCHEDULE_WORKLOADS)[number];
/** What each workload takes (D10): its selector members, its provider modes, and whether it needs a selector. */
const WORKLOAD_RULES: Readonly<
  Record<Workload, { selectors: readonly string[]; providerModes: readonly string[]; needsSelector: boolean }>
> = {
  // Labs is called live (D6)
  keyword_metrics: {
    selectors: ['stale_days', 'all', 'groups', 'terms'],
    providerModes: ['live'],
    needsSelector: false,
  },
  seo_rank: {
    selectors: ['all', 'groups', 'terms', 'priority_lte'],
    providerModes: ['standard_queue', 'priority_queue', 'live'],
    needsSelector: true,
  },
};
const CREATE_FIELDS = [
  'name',
  'workload',
  'cadence',
  'cron_expr',
  'weekday',
  'month_day',
  'window_start_local',
  'window_hours',
  'timezone',
  'priority',
  'provider_mode',
  'selector',
] as const;
const UPDATE_FIELDS = CREATE_FIELDS.filter((name) => name !== 'workload' && name !== 'cron_expr');
/** A time as Pydantic parses it: hours, minutes, seconds with a fraction, an offset. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d)(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * A window's start is a wall-clock `HH:MM` in the schedule's zone (backend `_local_minute`): a time with
 * an offset of its own, or with seconds, is a `value_error` at the field.
 */
function localMinuteError(value: unknown): ValidationItem[] {
  if (value === undefined || value === null) return [];
  const parsed = typeof value === 'string' ? TIME.exec(value) : null;
  if (parsed === null) return [bodyError('window_start_local', 'time_parsing', 'Input should be a valid time')];
  if (parsed[6] !== undefined) {
    return [
      bodyError(
        'window_start_local',
        'value_error',
        "Value error, a local time, without an offset: the schedule's zone gives it",
      ),
    ];
  }
  const seconds = Number(parsed[4] ?? '0') + Number(parsed[5] ?? '0');
  return seconds === 0 ? [] : [bodyError('window_start_local', 'value_error', 'Value error, hours and minutes only')];
}

/** `HH:MM:SS`, as the API writes a time. */
const fullTime = (value: string): string => `${value.slice(0, 5)}:00`;

/** A schedule's provider mode when the body leaves it out: its workload's own. */
const DEFAULT_PROVIDER_MODE: Readonly<Record<Workload, (typeof PROVIDER_MODES)[number]>> = {
  keyword_metrics: 'live',
  seo_rank: 'standard_queue',
};

function selectorShapeErrors(value: unknown): ValidationItem[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return [bodyError('selector', 'model_attributes_type', 'Input should be an object')];
  return [
    ...extraMembers(value, SELECTOR_MEMBERS, 'selector'),
    ...(value.all === undefined || value.all === null || value.all === true
      ? []
      : [bodyError('selector.all', 'literal_error', 'Input should be true')]),
    ...(value.groups === null ? [] : idListError(value.groups, 'selector.groups', 100)),
    ...(value.terms === null ? [] : idListError(value.terms, 'selector.terms', 100)),
    ...integerError(value.priority_lte, 'selector.priority_lte', { min: 1, max: 5, nullable: true }),
    ...integerError(value.stale_days, 'selector.stale_days', { min: 0, max: 365, nullable: true }),
  ];
}

/**
 * The schema checks of a `ScheduleInput` or a `ScheduleUpdate`. A valid `ScheduleInput` then has its days
 * held to its cadence, as one error for the whole body (the model's own check).
 */
function shapeErrors(body: Readonly<Record<string, unknown>>, create: boolean): ValidationItem[] {
  const fields = fieldErrors(body, create);
  if (!create || fields.length > 0) return fields;
  const named = (name: 'weekday' | 'month_day'): boolean => body[name] !== undefined && body[name] !== null;
  if ((body.cadence === 'weekly') !== named('weekday')) {
    return [bodyError('', 'value_error', 'Value error, `weekday` is given exactly when the cadence is weekly')];
  }
  if ((body.cadence === 'monthly') !== named('month_day')) {
    return [bodyError('', 'value_error', 'Value error, `month_day` is given exactly when the cadence is monthly')];
  }
  return [];
}

function fieldErrors(body: Readonly<Record<string, unknown>>, create: boolean): ValidationItem[] {
  const required = create ? (['name', 'workload', 'cadence', 'window_start_local', 'timezone'] as const) : [];
  // A create may leave the provider mode out or null: the workload's own applies
  const notNull = [
    'name',
    'cadence',
    'timezone',
    'window_start_local',
    'window_hours',
    'priority',
    ...(create ? [] : ['provider_mode']),
  ];
  return [
    ...extraMembers(body, create ? CREATE_FIELDS : UPDATE_FIELDS),
    ...required.filter((name) => body[name] === undefined).map((name) => bodyError(name, 'missing', 'Field required')),
    ...notNull
      .filter((name) => body[name] === null)
      .map((name) => bodyError(name, 'null_not_allowed', 'Cannot be null.')),
    ...(!create && Object.keys(body).length === 0 ? [bodyError('', 'value_error', 'Change at least one field.')] : []),
    ...textError(body.name ?? undefined, 'name', { max: 100 }),
    ...(body.workload === undefined ? [] : enumError(body.workload, 'workload', TASK_WORKLOADS)),
    ...(body.cadence === undefined || body.cadence === null ? [] : enumError(body.cadence, 'cadence', INPUT_CADENCES)),
    ...(body.cron_expr === undefined || body.cron_expr === null
      ? []
      : textError(body.cron_expr, 'cron_expr', { max: 100 })),
    ...integerError(body.weekday, 'weekday', { min: 0, max: 6, nullable: true }),
    ...integerError(body.month_day, 'month_day', { min: 1, max: 28, nullable: true }),
    ...localMinuteError(body.window_start_local),
    ...integerError(body.window_hours ?? undefined, 'window_hours', { min: 1, max: 24 }),
    ...textError(body.timezone ?? undefined, 'timezone', { max: 64 }),
    ...(typeof body.timezone === 'string' && body.timezone !== '' && !TIMEZONE_PATTERN.test(body.timezone)
      ? [bodyError('timezone', 'string_pattern_mismatch', `String should match pattern '${TIMEZONE_PATTERN.source}'`)]
      : []),
    ...(body.priority === undefined || body.priority === null
      ? []
      : enumError(body.priority, 'priority', SCHEDULE_PRIORITIES)),
    ...(body.provider_mode === undefined || body.provider_mode === null
      ? []
      : enumError(body.provider_mode, 'provider_mode', PROVIDER_MODES)),
    ...selectorShapeErrors(body.selector),
  ];
}

const ids = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

/** A selector as sent, its null members and empty lists dropped: an empty list selects nothing. */
function selectorOf(value: Readonly<Record<string, unknown>>): StoredSelector {
  const groups = ids(value.groups);
  const terms = ids(value.terms);
  return {
    ...(value.all === true ? { all: true as const } : {}),
    ...(groups === undefined || groups.length === 0 ? {} : { groups }),
    ...(terms === undefined || terms.length === 0 ? {} : { terms }),
    ...(typeof value.priority_lte === 'number' ? { priority_lte: value.priority_lte } : {}),
    ...(typeof value.stale_days === 'number' ? { stale_days: value.stale_days } : {}),
  };
}

/** What the planner cannot run, first found: the workload, then the cadence, then the provider mode. */
function plannerErrors(workload: unknown, cadence: unknown, providerMode: string): ValidationItem[] {
  if (!isOneOf(workload, SCHEDULE_WORKLOADS)) {
    return [bodyError('workload', 'workload_not_available', 'Schedules of this workload come later.')];
  }
  if (!isOneOf(cadence, CADENCES)) {
    return [bodyError('cadence', 'cadence_not_supported', 'A schedule runs daily, weekly or monthly.')];
  }
  const modes = WORKLOAD_RULES[workload].providerModes;
  if (!modes.includes(providerMode)) {
    return [
      bodyError(
        'provider_mode',
        'provider_mode_not_supported',
        `A ${workload} schedule takes the provider mode ${[...modes].sort().join(' or ')}.`,
      ),
    ];
  }
  return [];
}

/** The first thing wrong with a selector for its workload. */
function selectorErrors(workload: Workload, selector: StoredSelector): ValidationItem[] {
  const rules = WORKLOAD_RULES[workload];
  const unsupported = SELECTOR_MEMBERS.find((name) => selector[name] !== undefined && !rules.selectors.includes(name));
  if (unsupported !== undefined) {
    return [
      bodyError(
        `selector.${unsupported}`,
        'selector_not_supported',
        `A ${workload} schedule does not select by ${unsupported}.`,
      ),
    ];
  }
  if (rules.needsSelector && Object.keys(selector).length === 0) {
    return [bodyError('selector', 'selector_empty', 'Name the keywords: all, groups, terms or a priority.')];
  }
  if (selector.all !== undefined && selector.stale_days !== undefined) {
    return [bodyError('selector.stale_days', 'selector_conflict', 'Give all or stale_days, not both.')];
  }
  return [];
}

/**
 * A change's weekday and day of the month: kept while the cadence uses them, dropped when it no longer
 * does, and required when it starts to; one given for a cadence without one is refused.
 */
function changedDays(
  body: Readonly<Record<string, unknown>>,
  current: StoredSchedule,
  cadence: string,
): { weekday: number | null; monthDay: number | null; errors: ValidationItem[] } {
  const given = (name: 'weekday' | 'month_day'): number | null | undefined =>
    name in body ? (typeof body[name] === 'number' ? body[name] : null) : undefined;
  const errors: ValidationItem[] = [];
  let weekday = given('weekday') === undefined ? current.weekday : (given('weekday') ?? null);
  let monthDay = given('month_day') === undefined ? current.month_day : (given('month_day') ?? null);
  if (cadence === 'weekly') {
    if (weekday === null) errors.push(bodyError('weekday', 'required', 'A weekly schedule names its day.'));
  } else if (given('weekday') !== undefined && given('weekday') !== null) {
    errors.push(bodyError('weekday', 'not_applicable', 'Only weekly schedules have one.'));
  } else {
    weekday = null;
  }
  if (cadence === 'monthly') {
    if (monthDay === null) errors.push(bodyError('month_day', 'required', 'A monthly schedule names its day.'));
  } else if (given('month_day') !== undefined && given('month_day') !== null) {
    errors.push(bodyError('month_day', 'not_applicable', 'Only monthly schedules have one.'));
  } else {
    monthDay = null;
  }
  return { weekday, monthDay, errors };
}

/**
 * The schedule a valid body makes of `base` (the defaults on a create, the schedule as it is on a change),
 * or the errors of the first stage that fails, as the service checks them.
 */
function scheduled(
  caller: OperationsProjectCaller,
  body: Readonly<Record<string, unknown>>,
  base: StoredSchedule,
  create: boolean,
): StoredSchedule | ValidationItem[] {
  const workload = create ? body.workload : base.workload;
  const cadence = typeof body.cadence === 'string' ? body.cadence : base.cadence;
  const providerMode = isOneOf(body.provider_mode, PROVIDER_MODES)
    ? body.provider_mode
    : create && isOneOf(workload, SCHEDULE_WORKLOADS)
      ? DEFAULT_PROVIDER_MODE[workload]
      : base.provider_mode;
  const selector = isRecord(body.selector) ? selectorOf(body.selector) : base.selector;
  const planner = plannerErrors(workload, cadence, providerMode);
  if (planner.length > 0) return planner;
  const known = isOneOf(workload, SCHEDULE_WORKLOADS) ? workload : base.workload;
  const selection = selectorErrors(known, selector);
  if (selection.length > 0) return selection;
  let weekday: number | null;
  let monthDay: number | null;
  if (create) {
    if (body.cron_expr !== undefined && body.cron_expr !== null) {
      return [bodyError('cron_expr', 'not_applicable', 'Only a cron schedule has an expression.')];
    }
    // The schema already holds the days to the cadence on a create
    weekday = typeof body.weekday === 'number' ? body.weekday : null;
    monthDay = typeof body.month_day === 'number' ? body.month_day : null;
  } else {
    const days = changedDays(body, base, cadence);
    if (days.errors.length > 0) return days.errors;
    weekday = days.weekday;
    monthDay = days.monthDay;
  }
  const timezone = typeof body.timezone === 'string' ? body.timezone : base.timezone;
  if (typeof body.timezone === 'string' && !isKnownTimeZone(timezone)) {
    return [bodyError('timezone', 'timezone_unknown', 'Unknown time zone.')];
  }
  if (create || isRecord(body.selector)) {
    // The terms only filter: any terms of the project's vocabularies, several of one included
    const references = [
      ...groupErrors(caller, selector.groups ?? [], 'selector.groups'),
      ...termErrors(caller, selector.terms ?? [], 'selector.terms', { removing: true }),
    ];
    if (references.length > 0) return references;
  }
  return {
    ...base,
    workload: known,
    name: typeof body.name === 'string' ? body.name : base.name,
    cadence: isOneOf(cadence, CADENCES) ? cadence : base.cadence,
    weekday,
    month_day: monthDay,
    window_start_local:
      typeof body.window_start_local === 'string' ? fullTime(body.window_start_local) : base.window_start_local,
    window_hours: typeof body.window_hours === 'number' ? body.window_hours : base.window_hours,
    // A zone that was renamed is kept by its current name
    timezone: currentTimeZoneName(timezone),
    priority: isOneOf(body.priority, SCHEDULE_PRIORITIES) ? body.priority : base.priority,
    provider_mode: providerMode,
    selector,
  };
}

/**
 * `next` with its next window set again after now, outside the period the last window of `current` ran
 * in (backend `next_after_change`), and that window remembered for the next time.
 */
function rescheduled(
  caller: OperationsProjectCaller,
  current: StoredSchedule,
  next: StoredSchedule,
  now: number,
): StoredSchedule {
  const last = lastWindowStart(caller.operations, current, now);
  return {
    ...next,
    next_run_at: nextAfterChange(next, now, last),
    last_window_at: last === null ? null : new Date(last).toISOString(),
  };
}

/** The live schedule of the project with this id. */
const liveSchedule = (
  caller: OperationsProjectCaller,
  id: string | readonly string[] | undefined,
): StoredSchedule | undefined =>
  caller.operations.schedules.find(
    (row) => row.schedule_id === id && row.project_id === caller.project.project_id && row.deleted_at === null,
  );

/** Saves `row` and answers it. */
function answer(request: Request, caller: OperationsProjectCaller, row: StoredSchedule, status = 200): Response {
  const changes = withSchedule(caller.operationChanges, row);
  const cookie = savedOperations(request, changes);
  if (typeof cookie !== 'string') return cookie;
  return HttpResponse.json(
    { data: scheduleView(operationWorld(changes), row, Date.now()) },
    { status, headers: { 'set-cookie': cookie } },
  );
}

export const scheduleHandlers: HttpHandler[] = [
  mock('get', `${P}/schedules`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[workload]', 'filter[is_active]', 'offset', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const workload = caller.url.searchParams.get('filter[workload]');
    const active = caller.url.searchParams.has('filter[is_active]')
      ? booleanQuery(caller.url, 'filter[is_active]', true)
      : null;
    const paging = offsetPaging(caller.url);
    const errors: ValidationItem[] = [
      ...(workload === null || isOneOf(workload, TASK_WORKLOADS)
        ? []
        : [queryError('filter[workload]', 'enum', `Allowed: ${TASK_WORKLOADS.join(', ')}.`)]),
      ...(active === null || typeof active === 'boolean' ? [] : [active]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const now = Date.now();
    const rows = caller.operations.schedules
      .filter(
        (row) =>
          row.project_id === caller.project.project_id &&
          row.deleted_at === null &&
          (workload === null || row.workload === workload) &&
          (active === null || row.is_active === active),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.schedule_id.localeCompare(b.schedule_id))
      .map((row) => scheduleView(caller.operations, row, now));
    return HttpResponse.json(offsetPageOf(rows, paging));
  }),

  mock('post', `${P}/schedules`, async ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'schedules:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape = shapeErrors(body, true);
    if (shape.length > 0) return invalid(request, shape);
    const minter = operationIdMinter(caller.operationChanges);
    const base: StoredSchedule = {
      schedule_id: minter.next('schedule'),
      project_id: caller.project.project_id,
      name: '',
      workload: isOneOf(body.workload, SCHEDULE_WORKLOADS) ? body.workload : 'seo_rank',
      cadence: 'daily',
      weekday: null,
      month_day: null,
      window_start_local: '02:00:00',
      window_hours: 6,
      timezone: 'UTC',
      priority: 'standard',
      provider_mode: 'standard_queue',
      selector: {},
      is_active: true,
      created_at: stateTime(),
      deleted_at: null,
      next_run_at: null,
      last_window_at: null,
    };
    const made = scheduled(caller, body, base, true);
    if (Array.isArray(made)) return invalid(request, made);
    const row: StoredSchedule = { ...made, next_run_at: new Date(nextOccurrence(made, Date.now())).toISOString() };
    const changes = minter.commit(withSchedule(caller.operationChanges, row));
    const cookie = savedOperations(request, changes);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: scheduleView(operationWorld(changes), row, Date.now()) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('get', `${P}/schedules/{schedule_id}`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const row = liveSchedule(caller, params.schedule_id);
    if (row === undefined) return problem(request, 'not_found');
    return HttpResponse.json({ data: scheduleView(caller.operations, row, Date.now()) });
  }),

  mock('patch', `${P}/schedules/{schedule_id}`, async ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'schedules:write',
    });
    if (caller instanceof Response) return caller;
    const current = liveSchedule(caller, params.schedule_id);
    if (current === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape = shapeErrors(body, false);
    if (shape.length > 0) return invalid(request, shape);
    const changed = scheduled(caller, body, current, false);
    if (Array.isArray(changed)) return invalid(request, changed);
    // A change that leaves the rule alone leaves the next window alone; a new rule starts after now,
    // outside the period a window of the schedule already started in
    const sameRule =
      changed.cadence === current.cadence &&
      changed.timezone === current.timezone &&
      changed.window_start_local === current.window_start_local &&
      changed.weekday === current.weekday &&
      changed.month_day === current.month_day;
    return answer(request, caller, sameRule ? changed : rescheduled(caller, current, changed, Date.now()));
  }),

  mock('delete', `${P}/schedules/{schedule_id}`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'schedules:write',
    });
    if (caller instanceof Response) return caller;
    const current = liveSchedule(caller, params.schedule_id);
    if (current === undefined) return problem(request, 'not_found');
    const naming = caller.keywords.tracked.filter(
      (row) => row.schedule_id === current.schedule_id && row.deleted_at === null,
    ).length;
    if (naming > 0) {
      // As the backend answers: the code and a sentence, no count
      return problem(request, 'schedule_in_use', {
        detail: 'Tracked keywords use this schedule. Move them to another one first.',
      });
    }
    const cookie = savedOperations(
      request,
      withSchedule(caller.operationChanges, { ...current, is_active: false, deleted_at: stateTime() }),
    );
    if (typeof cookie !== 'string') return cookie;
    return noContent({ 'set-cookie': cookie });
  }),

  mock('post', `${P}/schedules/{schedule_id}/pause`, async ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'schedules:write',
    });
    if (caller instanceof Response) return caller;
    const current = liveSchedule(caller, params.schedule_id);
    if (current === undefined) return problem(request, 'not_found');
    // The body is optional: none, or `null`, pauses without a reason
    const text = await request.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);
    const body: unknown = parsed === null ? {} : parsed;
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...extraMembers(body, ['reason']),
      ...(body.reason === undefined || body.reason === null ? [] : textError(body.reason, 'reason', { max: 500 })),
    ];
    if (errors.length > 0) return invalid(request, errors);
    return answer(request, caller, { ...current, is_active: false });
  }),

  mock('post', `${P}/schedules/{schedule_id}/resume`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'schedules:write',
    });
    if (caller instanceof Response) return caller;
    const current = liveSchedule(caller, params.schedule_id);
    if (current === undefined) return problem(request, 'not_found');
    // The next window after now, missed ones not caught up, and as after a change of the rule, not again
    // in the period a window already ran in (backend 45a726c)
    return answer(request, caller, rescheduled(caller, current, { ...current, is_active: true }, Date.now()));
  }),
];
