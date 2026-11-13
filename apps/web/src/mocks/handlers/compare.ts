import type { HttpHandler } from 'msw';

import { queryError } from './rules';
import { daysBetween, shiftIsoDate, type WindowDateRange } from '../serp-views';
import type { EngineSummary, EntityCells, Schemas, ValidationItem } from '@/lib/api/types';

/** WP-19: answers the C2 compare routes. The summary's own handler lives with the summary (`prompt-answers.ts`). */
export const compareHandlers: HttpHandler[] = [];

/** What the summary's `compare`, `compare_from` and `compare_to` ask for (contract C2, C-1). */
export type ComparePlan =
  | { kind: 'none' }
  | { kind: 'window'; window: Schemas['MetricWindow'] }
  | { kind: 'invalid'; errors: ValidationItem[] }
  | { kind: 'too_large'; limit_days: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The same date a year earlier; 29 February becomes the 28th. */
function yearBefore(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  const leapDay = month === 2 && day === 29;
  return `${String(year - 1).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(leapDay ? 28 : day).padStart(2, '0')}`;
}

/** One of `compare_from` and `compare_to`: a calendar date, or the error that says what it is not. */
function dateOf(url: URL, name: 'compare_from' | 'compare_to'): string | ValidationItem {
  const raw = url.searchParams.get(name) ?? '';
  if (!ISO_DATE.test(raw)) return queryError(name, 'date_parsing', 'Input should be a valid date');
  return shiftIsoDate(raw, 0) === raw
    ? raw
    : queryError(name, 'out_of_range', 'Input should be a date in the calendar');
}

const isError = (value: string | ValidationItem): value is ValidationItem => typeof value !== 'string';

/**
 * The window the summary is compared with: `compare_from` with `compare_to` (both or neither, at most `maxDays`, any
 * position) win over `compare`; `previous_period` is as many days just before `range`, `previous_year` the same dates
 * a year earlier. Pure: the caller answers an `invalid` plan with a 422 and a `too_large` one with `window_too_large`.
 */
export function compareWindowOf(url: URL, range: WindowDateRange, timezone: string, maxDays: number): ComparePlan {
  const given = (['compare_from', 'compare_to'] as const).filter((name) => url.searchParams.has(name));
  if (given.length === 1) {
    const missing = given[0] === 'compare_from' ? 'compare_to' : 'compare_from';
    return { kind: 'invalid', errors: [queryError(missing, 'missing', 'Field required')] };
  }
  if (given.length === 2) {
    const from = dateOf(url, 'compare_from');
    const to = dateOf(url, 'compare_to');
    if (isError(from) || isError(to)) return { kind: 'invalid', errors: [from, to].filter(isError) };
    if (from > to) {
      return {
        kind: 'invalid',
        errors: [queryError('compare_from', 'range_invalid', '`compare_from` is after `compare_to`.')],
      };
    }
    if (daysBetween(from, to) > maxDays) return { kind: 'too_large', limit_days: maxDays };
    return { kind: 'window', window: { from, to, timezone } };
  }
  const compare = url.searchParams.get('compare') ?? 'none';
  if (compare === 'previous_period') {
    const days = daysBetween(range.firstDate, range.lastDate);
    return {
      kind: 'window',
      window: { from: shiftIsoDate(range.firstDate, -days), to: shiftIsoDate(range.firstDate, -1), timezone },
    };
  }
  if (compare === 'previous_year') {
    return {
      kind: 'window',
      window: { from: yearBefore(range.firstDate), to: yearBefore(range.lastDate), timezone },
    };
  }
  if (compare === 'none') return { kind: 'none' };
  return {
    kind: 'invalid',
    errors: [queryError('compare', 'literal_error', "Input should be 'none', 'previous_period' or 'previous_year'")],
  };
}

/**
 * One engine of a row with the same engine over the compared window beside it (C-2): `previous` holds that window's
 * four cells, or is null when none of the row's prompts has an answer of the engine there. The entity cells of the engine get their `previous` the same way, by entity id, and null exactly when the engine's
 * is. The series and every other member stay as they were. Pure.
 */
export function attachPrevious(current: EngineSummary, previous: EngineSummary | null): EngineSummary {
  const entity = (cells: EntityCells): EntityCells => {
    const before = previous?.entities?.find((candidate) => candidate.entity_id === cells.entity_id);
    return {
      ...cells,
      previous: before === undefined ? null : { mentioned: before.mentioned, share_of_voice: before.share_of_voice },
    };
  };
  return {
    ...current,
    previous:
      previous === null
        ? null
        : {
            mentioned: previous.mentioned,
            cited: previous.cited,
            outcomes: previous.outcomes,
            share_of_voice: previous.share_of_voice,
          },
    ...(current.entities == null ? {} : { entities: current.entities.map(entity) }),
  };
}
