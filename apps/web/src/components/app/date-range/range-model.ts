import {
  addDays,
  daysInclusive,
  FIRST_BUSINESS_DATE,
  isBeforeFirstDay,
  isBusinessDate,
  type BusinessDate,
} from './business-date';

/**
 * The longest range the picker lets a person choose: 91 project days, both ends included.
 *
 * The routes that carry the range accept different lengths. The prompts summary, the sources and the
 * collection and annotation routes count project days and accept 92 (`SUMMARY_MAX_DAYS` in
 * `backend/src/idraft/api/ai/summary.py`, used by `summary_dates` there and in `ai/sources.py`). The answers
 * route (`OBSERVATIONS_MAX_DAYS` in `ai/observations.py`) measures elapsed time between the start of the first
 * day and the end of the last one and refuses more than 92 days of it: 92 project days that cross any fall-back
 * clock change last 92 days and 1 hour, and `422 window_too_large` follows. 91 days is the longest range that
 * every route accepts in every zone and in every month. A page whose requests all count project days may pass
 * a larger `maxDays` (never above `CEILING_RANGE_DAYS`); a narrower one passes a smaller number.
 */
export const MAX_RANGE_DAYS = 91;
/** The most days any route accepts: a larger `maxDays` is cut to it (`limitDaysOf`). */
export const CEILING_RANGE_DAYS = 92;
export const RANGE_PRESETS = ['7d', '28d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const DEFAULT_PRESET: RangePreset = '28d';
export const PRESET_DAYS: Readonly<Record<RangePreset, number>> = { '7d': 7, '28d': 28, '90d': 90 };

export type DateRangeValue =
  { kind: 'preset'; preset: RangePreset } | { kind: 'custom'; from: BusinessDate; to: BusinessDate };

export interface ResolvedRange {
  from: BusinessDate;
  to: BusinessDate;
  days: number;
}

const DEFAULT_VALUE: DateRangeValue = { kind: 'preset', preset: DEFAULT_PRESET };

/** A preset ends on `today`, both ends included; a custom range is itself. */
export function resolveRange(value: DateRangeValue, today: BusinessDate): ResolvedRange {
  if (value.kind === 'custom') {
    return { from: value.from, to: value.to, days: daysInclusive(value.from, value.to) };
  }
  const days = PRESET_DAYS[value.preset];
  return { from: addDays(today, 1 - days), to: today, days };
}

export interface RangeLimits {
  today: BusinessDate;
  /** The first day with data, when known. */
  earliest?: BusinessDate | null | undefined;
  /** At most `MAX_RANGE_DAYS` unless every request of the page counts project days (see that constant). */
  maxDays?: number | undefined;
}

export type RangeProblem =
  | { code: 'invalid'; field: 'from' | 'to' }
  | { code: 'order' }
  | { code: 'future'; today: BusinessDate }
  | { code: 'before_start'; earliest: BusinessDate }
  | { code: 'too_long'; days: number; max: number };

/** The days a range may have: `maxDays`, cut to the ceiling. */
export function limitDaysOf({ maxDays }: RangeLimits): number {
  // `maxDays` is a prop a developer writes, not input of a person: a number above what the routes accept is a
  // mistake to correct here, not a limit to show
  return Math.min(maxDays ?? MAX_RANGE_DAYS, CEILING_RANGE_DAYS);
}

/** The first day a range may start on: the first day with data, and never before the first business date. */
export function firstDay({ earliest }: RangeLimits): BusinessDate {
  return earliest != null && earliest > FIRST_BUSINESS_DATE ? earliest : FIRST_BUSINESS_DATE;
}

const isKnownDate = (text: string): boolean => isBusinessDate(text) || isBeforeFirstDay(text);

/** The first problem of a typed or picked range, in this order: invalid, order, future, before start, too long. */
export function checkRange(from: string, to: string, limits: RangeLimits): RangeProblem | null {
  // A real day before 2000 is a date, only too early: it is told apart from a text that is not a date
  if (!isKnownDate(from)) return { code: 'invalid', field: 'from' };
  if (!isKnownDate(to)) return { code: 'invalid', field: 'to' };
  // ISO dates of one shape sort as text
  if (from > to) return { code: 'order' };
  if (to > limits.today) return { code: 'future', today: limits.today };
  const first = firstDay(limits);
  if (from < first) return { code: 'before_start', earliest: first };
  const days = daysInclusive(from, to);
  const max = limitDaysOf(limits);
  return days > max ? { code: 'too_long', days, max } : null;
}

/** The last day an end may be while only `from` is picked: the earlier of today and from + max - 1. */
export function lastEnd(from: BusinessDate, limits: RangeLimits): BusinessDate {
  const capped = addDays(from, limitDaysOf(limits) - 1);
  return capped < limits.today ? capped : limits.today;
}

/** Why a link's range was not used: the code of the problem. */
export type DroppedReason = RangeProblem['code'];
export type DroppedMessageKey =
  'droppedInvalid' | 'droppedOrder' | 'droppedFuture' | 'droppedBeforeStart' | 'droppedTooLong';

/**
 * The message (`common.dateRange.<key>`) that tells a page's reader why the last 28 days are shown instead of the
 * range in the link. A link past `maxDays` is `too_long`. `droppedTooLong` takes `max`, `droppedBeforeStart` takes `date`.
 */
export function droppedMessageKey(reason: DroppedReason): DroppedMessageKey {
  switch (reason) {
    case 'invalid':
      return 'droppedInvalid';
    case 'order':
      return 'droppedOrder';
    case 'future':
      return 'droppedFuture';
    case 'before_start':
      return 'droppedBeforeStart';
    case 'too_long':
      return 'droppedTooLong';
  }
}

/** URL form (23-application-patterns.md section 15): `win=7d|28d|90d`, or `from` and `to`. The default writes nothing. */
export interface RangeParams {
  win: string | null;
  from: string | null;
  to: string | null;
}

export function writeRangeParams(value: DateRangeValue): RangeParams {
  if (value.kind === 'custom') return { win: null, from: value.from, to: value.to };
  return { win: value.preset === DEFAULT_PRESET ? null : value.preset, from: null, to: null };
}

const presetOf = (text: string): RangePreset | undefined => RANGE_PRESETS.find((preset) => preset === text);

/** Never throws: an unreadable or refused range falls back to the default, with the reason. */
export function readRangeParams(
  params: RangeParams,
  limits: RangeLimits,
): { value: DateRangeValue; dropped: RangeProblem | null } {
  const fallback = (dropped: RangeProblem): { value: DateRangeValue; dropped: RangeProblem } => ({
    value: DEFAULT_VALUE,
    dropped,
  });
  if (params.from !== null || params.to !== null) {
    const from = params.from ?? '';
    const to = params.to ?? '';
    const problem = checkRange(from, to, limits);
    return problem === null ? { value: { kind: 'custom', from, to }, dropped: null } : fallback(problem);
  }
  if (params.win === null) return { value: DEFAULT_VALUE, dropped: null };
  const preset = presetOf(params.win);
  if (preset === undefined) return fallback({ code: 'invalid', field: 'from' });
  const days = PRESET_DAYS[preset];
  const max = limitDaysOf(limits);
  if (days > max) return fallback({ code: 'too_long', days, max });
  return { value: { kind: 'preset', preset }, dropped: null };
}
