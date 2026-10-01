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
import { scheduleView } from '../factories/operations';
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
import { isKnownTimeZone } from '@/lib/format/time-zone';

/**
 * A project's schedules (19 section 3.11, backend plan D10): `daily`, `weekly` (on a weekday, 0 is Sunday)
 * and `monthly` (on day 1 to 28) cadences, for the two workloads this step runs, with a selector checked per
 * workload. Pausing keeps the schedule; resuming does not catch up. A delete keeps the row for its runs and
 * is refused while a tracked keyword names the schedule.
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
const SELECTOR_MEMBERS = ['all', 'groups', 'terms', 'priority_lte', 'stale_days'] as const;
/** The selector members each workload takes (D10). */
const SELECTOR_OF: Readonly<Record<(typeof SCHEDULE_WORKLOADS)[number], readonly string[]>> = {
  keyword_metrics: ['stale_days', 'all', 'groups', 'terms'],
  seo_rank: ['all', 'groups', 'terms', 'priority_lte'],
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
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

/** `HH:MM:SS`, as the API writes a time. */
const fullTime = (value: string): string => (value.length === 5 ? `${value}:00` : value);

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

/** The schema checks of a `ScheduleInput` or a `ScheduleUpdate`. */
function shapeErrors(body: Readonly<Record<string, unknown>>, create: boolean): ValidationItem[] {
  const required = create ? (['name', 'workload', 'cadence', 'window_start_local', 'timezone'] as const) : [];
  const notNull = ['name', 'cadence', 'timezone', 'window_start_local', 'window_hours', 'priority', 'provider_mode'];
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
    ...(body.window_start_local === undefined || body.window_start_local === null
      ? []
      : typeof body.window_start_local === 'string' && TIME.test(body.window_start_local)
        ? []
        : [bodyError('window_start_local', 'time_parsing', 'Input should be a valid time')]),
    ...integerError(body.window_hours ?? undefined, 'window_hours', { min: 1, max: 24 }),
    ...textError(body.timezone ?? undefined, 'timezone', { max: 64 }),
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

/**
 * The schedule a valid body makes of `base` (the schedule as it is, or the defaults), or the service's
 * errors, all of them: cadences, workloads, time zones, days and selectors the planner cannot use.
 */
function scheduled(
  caller: OperationsProjectCaller,
  body: Readonly<Record<string, unknown>>,
  base: StoredSchedule,
  requestedCadence: unknown,
  requestedWorkload: unknown,
): StoredSchedule | ValidationItem[] {
  const errors: ValidationItem[] = [];
  if (requestedCadence === 'cron') {
    errors.push(bodyError('cadence', 'cadence_not_supported', 'Use a daily, weekly or monthly cadence.'));
  }
  if (requestedWorkload !== undefined && !isOneOf(requestedWorkload, SCHEDULE_WORKLOADS)) {
    errors.push(bodyError('workload', 'workload_not_available', 'Schedules run keyword metrics and rankings for now.'));
  }
  const cadence = isOneOf(body.cadence, CADENCES) ? body.cadence : base.cadence;
  const timezone = typeof body.timezone === 'string' ? body.timezone : base.timezone;
  if (typeof body.timezone === 'string' && !isKnownTimeZone(timezone)) {
    errors.push(bodyError('timezone', 'invalid_timezone', 'Not a time zone of the IANA database.'));
  }
  const weekday = 'weekday' in body ? (typeof body.weekday === 'number' ? body.weekday : null) : base.weekday;
  const monthDay = 'month_day' in body ? (typeof body.month_day === 'number' ? body.month_day : null) : base.month_day;
  if (cadence === 'weekly' && weekday === null) {
    errors.push(bodyError('weekday', 'weekday_required', 'A weekly schedule needs its weekday.'));
  }
  if (cadence === 'monthly' && monthDay === null) {
    errors.push(bodyError('month_day', 'month_day_required', 'A monthly schedule needs its day of the month.'));
  }
  const selector = isRecord(body.selector) ? selectorOf(body.selector) : base.selector;
  // A selector is judged against its workload; a workload the planner cannot run has nothing to judge by
  const workloadKnown = requestedWorkload === undefined || isOneOf(requestedWorkload, SCHEDULE_WORKLOADS);
  if (workloadKnown) {
    const allowed = SELECTOR_OF[base.workload];
    for (const name of SELECTOR_MEMBERS) {
      if (selector[name] !== undefined && !allowed.includes(name)) {
        errors.push(
          bodyError(`selector.${name}`, 'selector_member_not_allowed', `Not a selector of ${base.workload}.`),
        );
      }
    }
    if (base.workload === 'seo_rank' && Object.keys(selector).length === 0) {
      errors.push(bodyError('selector', 'selector_empty', 'Choose the keywords: all, groups, terms or a priority.'));
    }
  }
  errors.push(...groupErrors(caller, selector.groups ?? [], 'selector.groups'));
  // The terms only filter: any terms of the project's vocabularies, several of one included
  errors.push(...termErrors(caller, selector.terms ?? [], 'selector.terms', { removing: true }));
  if (errors.length > 0) return errors;
  return {
    ...base,
    name: typeof body.name === 'string' ? body.name : base.name,
    cadence,
    weekday: cadence === 'weekly' ? weekday : null,
    month_day: cadence === 'monthly' ? monthDay : null,
    window_start_local:
      typeof body.window_start_local === 'string' ? fullTime(body.window_start_local) : base.window_start_local,
    window_hours: typeof body.window_hours === 'number' ? body.window_hours : base.window_hours,
    timezone,
    priority: isOneOf(body.priority, SCHEDULE_PRIORITIES) ? body.priority : base.priority,
    provider_mode: isOneOf(body.provider_mode, PROVIDER_MODES) ? body.provider_mode : base.provider_mode,
    selector,
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
    };
    const row = scheduled(caller, body, base, body.cadence, body.workload);
    if (Array.isArray(row)) return invalid(request, row);
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
    const row = scheduled(caller, body, current, body.cadence, undefined);
    if (Array.isArray(row)) return invalid(request, row);
    return answer(request, caller, row);
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
      return problem(request, 'schedule_in_use', {
        detail: `${String(naming)} tracked keywords use this schedule. Give them another schedule first.`,
        tracked_keyword_count: naming,
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
    const text = await request.text();
    const body: unknown = text === '' ? {} : JSON.parse(text);
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
    // The next run is the next window from now: missed ones are not caught up
    return answer(request, caller, { ...current, is_active: true });
  }),
];
