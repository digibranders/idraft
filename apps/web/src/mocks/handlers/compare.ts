import type { HttpHandler } from 'msw';

import { queryError } from './rules';
import { daysBetween, shiftIsoDate, type WindowDateRange } from '../serp-views';
import { COMPARE_DETECTABLE_COOKIE, cookieOf } from '../session';
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
  const earlierDay = month === 2 && day === 29 ? 28 : day;
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(year - 1, 4)}-${pad(month, 2)}-${pad(earlierDay, 2)}`;
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
 * a year earlier. `compare` is a literal of the route, so a value outside it is refused whatever the dates say; the
 * dates win over a valid value only. Pure: the caller answers an `invalid` plan with a 422 and a `too_large` one with
 * `window_too_large`.
 */
export function compareWindowOf(url: URL, range: WindowDateRange, timezone: string, maxDays: number): ComparePlan {
  const compare = url.searchParams.get('compare') ?? 'none';
  if (compare !== 'none' && compare !== 'previous_period' && compare !== 'previous_year') {
    return {
      kind: 'invalid',
      errors: [queryError('compare', 'literal_error', "Input should be 'none', 'previous_period' or 'previous_year'")],
    };
  }
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
  return { kind: 'none' };
}

/**
 * The row's engine over the compared window (`build`), or null when none of the row's prompts has an answer of the
 * engine there (C-2: a fact row of any status counts, so an engine whose answers are all invalid has cells with a
 * denominator of 0, not null). `answered` says whether one prompt has such a fact row. Pure.
 */
export function previousEngineOf(
  promptIds: readonly string[],
  answered: (promptId: string) => boolean,
  build: () => EngineSummary,
): EngineSummary | null {
  return promptIds.some(answered) ? build() : null;
}

/** Whether the request carries the cookie that asks for one detectable change (`withDetectableChange`). */
export const detectableAsked = (cookies: Readonly<Record<string, string>>): boolean =>
  cookieOf(cookies, COMPARE_DETECTABLE_COOKIE) === 'on';

/** The counted answers of a window by prompt and engine code, as far as `withDetectableChange` reads them. */
type DriftAnswers<T> = Map<string, Map<string, T[]>>;
interface DriftFacts {
  facts: { is_valid: boolean; own_mentioned: boolean };
}

/** The share of an answer set's valid answers that mention the own brand; `null` with no valid answer. */
function mentionRate(answers: readonly DriftFacts[]): number | null {
  const valid = answers.filter((answer) => answer.facts.is_valid);
  return valid.length === 0 ? null : valid.filter((answer) => answer.facts.own_mentioned).length / valid.length;
}

/**
 * Makes ONE topic's change of the compared window clearly detectable, for the e2e of the colour rule (the
 * `mock-compare-detectable` cookie): each prompt of the smallest topic keeps every answer of the compared window
 * (same count, same validity) but all of them say the opposite of what the prompt's answers say now, so the prompts'
 * Mention rate and the topic's move by at least half and the interim test finds them. Every other prompt is the same
 * object as before (a single prompt is not enough: its topic pools the answers of all its prompts, which dilutes the
 * move below what the test finds). Without `asked`, or with no topic held, `before` itself comes back; a prompt with
 * no valid answer now is left as it was. Pure.
 */
export function withDetectableChange<T extends DriftFacts>(
  before: DriftAnswers<T>,
  now: DriftAnswers<T>,
  held: ReadonlyMap<string, ReadonlySet<string>>,
  asked: boolean,
): DriftAnswers<T> {
  if (!asked) return before;
  const smallest = [...held.values()].reduce<ReadonlySet<string> | null>(
    (least, members) => (least === null || members.size < least.size ? members : least),
    null,
  );
  if (smallest === null) return before;
  const moved = new Map(before);
  for (const prompt of smallest) {
    const rate = mentionRate([...(now.get(prompt)?.values() ?? [])].flat());
    const engines = before.get(prompt);
    if (rate === null || engines === undefined) continue;
    const mentioned = rate < 0.5;
    moved.set(
      prompt,
      new Map(
        [...engines].map(([code, answers]) => [
          code,
          answers.map((answer) => ({ ...answer, facts: { ...answer.facts, own_mentioned: mentioned } })),
        ]),
      ),
    );
  }
  return moved;
}

/**
 * One engine of a row with the same engine over the compared window beside it (C-2): `previous` holds that window's
 * four cells, or is null when there is none (the row has no answer of the engine there, see `previousEngineOf`). The
 * entity cells of the engine get their `previous` the same way, by entity id, and null exactly when the engine's is.
 * The series and every other member stay as they were. Pure.
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
