import type { Schedule, ScheduleInput, ScheduleUpdate, Selector, ValidationItem } from '@/lib/api/types';

/**
 * What a schedule's form offers, reads and sends (19 section 3.11.3, backend plan D10). Plain data and
 * functions: the dialog and the table put the words to it.
 */

/** The workloads this step schedules; the API names more, which come with their own steps. */
export const SCHEDULE_WORKLOADS = ['keyword_metrics', 'seo_rank'] as const satisfies readonly Schedule['workload'][];
export type ScheduleWorkload = (typeof SCHEDULE_WORKLOADS)[number];

/** The cadences the planner runs. `cron` is `422 cadence_not_supported`, so it is never offered. */
export const CADENCES = ['daily', 'weekly', 'monthly'] as const satisfies readonly Schedule['cadence'][];
export type Cadence = (typeof CADENCES)[number];

export const SCHEDULE_PRIORITIES = ['high', 'standard', 'low'] as const satisfies readonly Schedule['priority'][];
export type SchedulePriority = (typeof SCHEDULE_PRIORITIES)[number];

export const PROVIDER_MODES = [
  'standard_queue',
  'priority_queue',
  'live',
] as const satisfies readonly Schedule['provider_mode'][];
export type ProviderMode = (typeof PROVIDER_MODES)[number];

/** The catalog key of a provider mode under `dialog.providerModes`: keys are camel case, the API's codes are not. */
export const PROVIDER_MODE_KEYS = {
  standard_queue: 'standardQueue',
  priority_queue: 'priorityQueue',
  live: 'live',
} as const satisfies Record<ProviderMode, string>;

/** How a form chooses the keywords a schedule collects. One mode is one radio of the selector. */
export const SELECTOR_MODES = ['stale', 'all', 'groups', 'priority'] as const;
export type SelectorMode = (typeof SELECTOR_MODES)[number];

/** The selectors each workload takes, in the order its form lists them (D10). */
export const WORKLOAD_SELECTOR_MODES: Readonly<Record<ScheduleWorkload, readonly SelectorMode[]>> = {
  keyword_metrics: ['stale', 'all', 'groups'],
  seo_rank: ['all', 'groups', 'priority'],
};

/** The selector a new schedule of each workload starts on. */
export const DEFAULT_SELECTOR_MODE: Readonly<Record<ScheduleWorkload, SelectorMode>> = {
  keyword_metrics: 'stale',
  seo_rank: 'all',
};

/** The staleness the monthly keyword metrics schedule of every project uses (D8). */
export const DEFAULT_STALE_DAYS = 25;
/** The contract's range for `stale_days`: 0 refreshes every keyword each time. */
export const MIN_STALE_DAYS = 0;
export const MAX_STALE_DAYS = 365;
export const MAX_NAME_LENGTH = 100;
/** Keyword priorities run from 1, the highest, to 5 (the API's `priority_lte`). */
export const KEYWORD_PRIORITIES = [1, 2, 3, 4, 5] as const;
/** A monthly schedule runs on day 1 to 28, so every month has the day. */
export const MONTH_DAYS: readonly number[] = Array.from({ length: 28 }, (_, index) => index + 1);
/** A window lasts 1 to 24 hours. */
export const WINDOW_HOURS: readonly number[] = Array.from({ length: 24 }, (_, index) => index + 1);
/** Sunday is 0, as the API numbers weekdays. */
export { WEEKDAYS } from '@/lib/projects/fields';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const WHOLE_NUMBER = /^\d+$/;

/** Whether `text` is a time of day as the API takes it: 24-hour `HH:MM`, no seconds, no offset. */
export const isClock = (text: string): boolean => CLOCK.test(text);

/** The `HH:MM` of a time the API wrote as `HH:MM:SS`. */
export const clockOf = (time: string): string => time.slice(0, 5);

/** The whole number `text` holds when it is within `min` to `max`, else `null`. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return list.some((candidate) => candidate === value);
}

/** A schedule the dialog can change: one of the two workloads, on a cadence the planner runs. */
export type EditableSchedule = Schedule & { workload: ScheduleWorkload; cadence: Cadence };

export function isEditableSchedule(schedule: Schedule): schedule is EditableSchedule {
  return isOneOf(SCHEDULE_WORKLOADS, schedule.workload) && isOneOf(CADENCES, schedule.cadence);
}

/** The values of the schedule form, as the controls hold them: text, so an empty control is not a zero. */
export interface ScheduleValues {
  name: string;
  workload: ScheduleWorkload;
  cadence: Cadence;
  /** `0` to `6`, Sunday first. Held while the cadence is not weekly, so a change of mind keeps it. */
  weekday: string;
  /** `1` to `28`. */
  month_day: string;
  /** `HH:MM`. */
  window_start_local: string;
  window_hours: string;
  timezone: string;
  priority: SchedulePriority;
  provider_mode: ProviderMode;
  selector_mode: SelectorMode;
  stale_days: string;
  priority_lte: string;
  groups: string[];
  terms: string[];
}

/** The values of a new schedule: daily keyword metrics in `timezone`, the project's own. */
export function newScheduleValues(timezone: string): ScheduleValues {
  return {
    name: '',
    workload: 'keyword_metrics',
    cadence: 'daily',
    weekday: '1',
    month_day: '1',
    window_start_local: '02:00',
    window_hours: '6',
    timezone,
    priority: 'standard',
    provider_mode: 'standard_queue',
    selector_mode: DEFAULT_SELECTOR_MODE.keyword_metrics,
    stale_days: String(DEFAULT_STALE_DAYS),
    priority_lte: '2',
    groups: [],
    terms: [],
  };
}

function modeOf(selector: Selector, workload: ScheduleWorkload): SelectorMode {
  if ((selector.groups?.length ?? 0) > 0 || (selector.terms?.length ?? 0) > 0) return 'groups';
  if (selector.all === true) return 'all';
  if (selector.stale_days != null && workload === 'keyword_metrics') return 'stale';
  if (selector.priority_lte != null && workload === 'seo_rank') return 'priority';
  return DEFAULT_SELECTOR_MODE[workload];
}

/** The values of the form for a schedule it can change; asking for any other is a mistake of the caller. */
export function valuesOfSchedule(schedule: Schedule): ScheduleValues {
  if (!isEditableSchedule(schedule)) {
    throw new Error(`A ${schedule.workload} schedule on a ${schedule.cadence} cadence cannot be edited`);
  }
  const { selector } = schedule;
  return {
    name: schedule.name,
    workload: schedule.workload,
    cadence: schedule.cadence,
    weekday: String(schedule.weekday ?? 1),
    month_day: String(schedule.month_day ?? 1),
    window_start_local: clockOf(schedule.window_start_local),
    window_hours: String(schedule.window_hours),
    timezone: schedule.timezone,
    priority: schedule.priority,
    provider_mode: schedule.provider_mode,
    selector_mode: modeOf(selector, schedule.workload),
    stale_days: String(selector.stale_days ?? DEFAULT_STALE_DAYS),
    priority_lte: String(selector.priority_lte ?? 2),
    groups: selector.groups ?? [],
    terms: selector.terms ?? [],
  };
}

/**
 * What a schedule that names groups or terms also names, which the form has no control for: the days of
 * a keyword metrics selector, the priority of a rank selector. An edit of the groups keeps them, but only
 * when the schedule already named groups or terms: a schedule switched to groups from the days, the
 * priority or all keywords leaves what its old mode held behind, since the form shows none of it.
 */
function keptMembers(workload: ScheduleWorkload, original: Selector | undefined): Selector {
  if (original === undefined || modeOf(original, workload) !== 'groups') return {};
  if (workload === 'keyword_metrics') return original.stale_days == null ? {} : { stale_days: original.stale_days };
  return original.priority_lte == null ? {} : { priority_lte: original.priority_lte };
}

/** The selector the form's choice stands for. `original` is the selector of the schedule being edited. */
export function selectorOfValues(values: ScheduleValues, original?: Selector): Selector {
  switch (values.selector_mode) {
    case 'all':
      return { all: true };
    case 'stale':
      return { stale_days: Number(values.stale_days) };
    case 'priority':
      return { priority_lte: Number(values.priority_lte) };
    case 'groups':
      return {
        ...(values.groups.length > 0 ? { groups: values.groups } : {}),
        ...(values.terms.length > 0 ? { terms: values.terms } : {}),
        ...keptMembers(values.workload, original),
      };
  }
}

/** Whether two lists of ids hold the same ids, in any order. */
function sameIds(first: readonly string[], second: readonly string[]): boolean {
  const sorted = [...second].sort();
  return first.length === second.length && [...first].sort().every((id, index) => id === sorted[index]);
}

/**
 * Whether the person changed the selector: its mode, or the control of the mode it is on. A selector the
 * form cannot show whole (a priority beside all keywords) is not rebuilt from what the form does show
 * unless they changed it, so a rename never rewrites what the schedule collects.
 */
function selectorTouched(values: ScheduleValues, initial: ScheduleValues): boolean {
  if (values.selector_mode !== initial.selector_mode) return true;
  switch (values.selector_mode) {
    case 'all':
      return false;
    case 'stale':
      return Number(values.stale_days) !== Number(initial.stale_days);
    case 'priority':
      return Number(values.priority_lte) !== Number(initial.priority_lte);
    case 'groups':
      return !sameIds(values.groups, initial.groups) || !sameIds(values.terms, initial.terms);
  }
}

/**
 * The body of a new schedule. The provider mode is left out for keyword metrics, whose only mode is the
 * workload's own (`live`); a day is sent only for the cadence that uses it.
 */
export function createBodyOf(values: ScheduleValues): ScheduleInput {
  return {
    name: values.name.trim(),
    workload: values.workload,
    cadence: values.cadence,
    ...(values.cadence === 'weekly' ? { weekday: Number(values.weekday) } : {}),
    ...(values.cadence === 'monthly' ? { month_day: Number(values.month_day) } : {}),
    window_start_local: values.window_start_local,
    window_hours: Number(values.window_hours),
    timezone: values.timezone,
    priority: values.priority,
    ...(values.workload === 'seo_rank' ? { provider_mode: values.provider_mode } : {}),
    selector: selectorOfValues(values),
  };
}

/**
 * The body of a change: only what differs from `schedule`, since every change of the rule moves the next
 * run. A cadence that starts to use a day names it (`required` otherwise); one that stops using it does
 * not (`not_applicable` otherwise). The selector is sent only when a control of it changed. The body is
 * empty while nothing changed.
 */
export function updateBodyOf(values: ScheduleValues, schedule: Schedule): ScheduleUpdate {
  const initial = valuesOfSchedule(schedule);
  const cadenceChanged = values.cadence !== initial.cadence;
  return {
    ...(values.name.trim() === schedule.name ? {} : { name: values.name.trim() }),
    ...(cadenceChanged ? { cadence: values.cadence } : {}),
    ...(values.cadence === 'weekly' && (cadenceChanged || values.weekday !== initial.weekday)
      ? { weekday: Number(values.weekday) }
      : {}),
    ...(values.cadence === 'monthly' && (cadenceChanged || values.month_day !== initial.month_day)
      ? { month_day: Number(values.month_day) }
      : {}),
    ...(values.window_start_local === initial.window_start_local
      ? {}
      : { window_start_local: values.window_start_local }),
    ...(values.window_hours === initial.window_hours ? {} : { window_hours: Number(values.window_hours) }),
    ...(values.timezone === initial.timezone ? {} : { timezone: values.timezone }),
    ...(values.priority === initial.priority ? {} : { priority: values.priority }),
    ...(values.workload === 'seo_rank' && values.provider_mode !== initial.provider_mode
      ? { provider_mode: values.provider_mode }
      : {}),
    ...(selectorTouched(values, initial) ? { selector: selectorOfValues(values, schedule.selector) } : {}),
  };
}

/** The names of the groups or the terms of a project by id: `null` while the list is loading, `'failed'` when it did not load. */
export type NameList = ReadonlyMap<string, string> | 'failed' | null;

/** The names the table puts to the ids of a selector. */
export interface SelectorNames {
  groups: NameList;
  terms: NameList;
}

/** One thing a selector says, before it is put into words. */
export type SelectorPart =
  | { kind: 'all' }
  | { kind: 'stale'; days: number }
  | { kind: 'priority'; max: number }
  | {
      kind: 'groups' | 'terms';
      names: string[];
      removed: number;
      /** Ids whose names are still loading. */
      pending: number;
      /** Ids whose names could not be loaded; the member is left out while the list did not fail. */
      unread?: number;
    };

function namedPart(
  kind: 'groups' | 'terms',
  ids: readonly string[] | null | undefined,
  names: NameList,
): SelectorPart[] {
  if (ids == null || ids.length === 0) return [];
  if (names === null) return [{ kind, names: [], removed: 0, pending: ids.length }];
  if (names === 'failed') return [{ kind, names: [], removed: 0, pending: 0, unread: ids.length }];
  const found = ids.flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [name];
  });
  return [{ kind, names: found, removed: ids.length - found.length, pending: 0 }];
}

/**
 * What a selector collects, part by part: all keywords, the staleness, the priority, the groups and the
 * terms. A group or term the project no longer has counts as removed: a deleted one simply stops matching
 * (19 section 3.11.3).
 */
export function selectorParts(selector: Selector, names: SelectorNames): SelectorPart[] {
  return [
    ...(selector.all === true ? [{ kind: 'all' as const }] : []),
    ...(selector.stale_days == null ? [] : [{ kind: 'stale' as const, days: selector.stale_days }]),
    ...(selector.priority_lte == null ? [] : [{ kind: 'priority' as const, max: selector.priority_lte }]),
    ...namedPart('groups', selector.groups, names.groups),
    ...namedPart('terms', selector.terms, names.terms),
  ];
}

/** The field of the form that shows what each path of the request body names. */
const FIELD_OF_PATH: Readonly<Record<string, keyof ScheduleValues>> = {
  name: 'name',
  workload: 'workload',
  cadence: 'cadence',
  weekday: 'weekday',
  month_day: 'month_day',
  window_start_local: 'window_start_local',
  window_hours: 'window_hours',
  timezone: 'timezone',
  priority: 'priority',
  provider_mode: 'provider_mode',
  selector: 'selector_mode',
  'selector.all': 'selector_mode',
  'selector.groups': 'groups',
  'selector.terms': 'terms',
  'selector.priority_lte': 'priority_lte',
  'selector.stale_days': 'stale_days',
};
/** The codes that are about the selector as a whole, wherever in it the service found them. */
const SELECTOR_CODES: readonly string[] = ['selector_empty', 'selector_conflict', 'selector_not_supported'];

/**
 * The message under `projectSettings.schedules.errors` for each `field.code` key of `errorTarget`. The
 * catalog's keys are camel case and cannot hold a dot, so the codes of the API are looked up here. An
 * error that is not listed shows the words of the server.
 */
export const SCHEDULE_ERROR_KEYS = {
  'window_start_local.value_error': 'timeInvalid',
  'window_start_local.time_parsing': 'timeInvalid',
  'weekday.required': 'weekdayRequired',
  'weekday.not_applicable': 'daysNotApplicable',
  'month_day.required': 'monthDayRequired',
  'month_day.not_applicable': 'daysNotApplicable',
  'timezone.timezone_unknown': 'timezoneUnknown',
  'timezone.string_pattern_mismatch': 'timezoneUnknown',
  'cadence.cadence_not_supported': 'cadenceNotSupported',
  'provider_mode.provider_mode_not_supported': 'providerModeNotSupported',
  'workload.workload_not_available': 'workloadNotAvailable',
  'selector_mode.selector_empty': 'selectorEmpty',
  'selector_mode.selector_conflict': 'selectorConflict',
  'selector_mode.selector_not_supported': 'selectorNotSupported',
  'groups.group_unknown': 'groupUnknown',
  'terms.term_unknown': 'termUnknown',
} as const satisfies Readonly<Record<string, string>>;

/** The catalog key of the words for an error key of `errorTarget`, or `null` when there are none. */
export function errorMessageKey(key: string): (typeof SCHEDULE_ERROR_KEYS)[keyof typeof SCHEDULE_ERROR_KEYS] | null {
  for (const [known, message] of Object.entries(SCHEDULE_ERROR_KEYS)) {
    if (known === key) return message;
  }
  return null;
}

/**
 * The field of the form an error of the API belongs to, and the key of its words (`field.code`). The
 * selector is a choice with several controls: an error about the selector as a whole is on the radios,
 * one about a member on the control that holds it. `field` is `null` for an error about the body as a
 * whole or about something the form does not show; its key then names the path.
 */
export function errorTarget(item: ValidationItem): { field: keyof ScheduleValues | null; key: string } {
  const longest = Object.keys(FIELD_OF_PATH)
    .filter((path) => item.path === path || item.path.startsWith(`${path}.`))
    .sort((a, b) => b.length - a.length)[0];
  const ofPath = longest === undefined ? undefined : FIELD_OF_PATH[longest];
  const wholeSelector = SELECTOR_CODES.includes(item.code) && item.path.startsWith('selector');
  const field = wholeSelector ? 'selector_mode' : ofPath;
  return field === undefined
    ? { field: null, key: `${item.path}.${item.code}` }
    : { field, key: `${field}.${item.code}` };
}
