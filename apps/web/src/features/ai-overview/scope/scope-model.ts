import { addDays, daysInclusive, type BusinessDate } from '@/components/app/date-range/business-date';
import type { DateRangeValue, ResolvedRange } from '@/components/app/date-range/range-model';

/**
 * The scope of the AI visibility Overview (WP-33 plan section 3.2): the one value every read and every card
 * takes. These functions read the page's URL keys as plain strings and never trust them: a value that does
 * not read falls back to the default, which writes nothing to the URL.
 *
 * `parseCountry` and the branded and topic rules repeat those of the Prompts page (`features/prompts`), which a
 * feature may not import; a change of one must be made in the other.
 */

/** Branded prompts: left out (default), counted with the rest, or counted alone. */
export type Branded = 'excluded' | 'included' | 'only';

/** A span of project days, both ends included. */
export interface DateWindow {
  from: BusinessDate;
  to: BusinessDate;
}

export interface OverviewScope {
  /** The window asked, in project days (`win`, or `from` and `to`). */
  range: ResolvedRange;
  /** The range as the picker holds it (a preset or a custom range). */
  rangeValue: DateRangeValue;
  /** Whether the previous window is read and shown (`cmp=off` turns it off). */
  compare: boolean;
  /** The window just before `range`, as long as it; present even when `compare` is off. */
  previous: DateWindow;
  /** An ISO 3166 alpha-2 code, or `null` for every country. */
  country: string | null;
  /** The engines chosen, in the order given, or `null` for every enabled engine. Never an empty list. */
  engines: readonly string[] | null;
  /** One topic term id and the topics below it, or `null` for all topics. */
  topic: string | null;
  branded: Branded;
}

/** The parts of the scope a person changes; a key left out stays as it is. */
export interface ScopePatch {
  range?: DateRangeValue;
  compare?: boolean;
  country?: string | null;
  /** `null` or an empty list is every enabled engine. */
  engines?: readonly string[] | null;
  topic?: string | null;
  branded?: Branded;
}

/**
 * The window of as many days just before `from`, the rule of the summary's `compare_window`
 * (docs/ai-visibility/contracts/c2-summary.md): Oct 16 to Nov 12 gives Sep 18 to Oct 15.
 */
export function previousWindow(from: BusinessDate, to: BusinessDate): DateWindow {
  const days = daysInclusive(from, to);
  if (days < 1) throw new RangeError(`previousWindow: "${to}" is before "${from}"`);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** `cmp=off` is off; the comparison is on for anything else. */
export const parseCompare = (value: string | null): boolean => value !== 'off';

/** Two capital letters, the form `filter[country_iso]` takes. Anything else reads as every country. */
export const parseCountry = (value: string | null): string | null =>
  value !== null && /^[A-Z]{2}$/.test(value) ? value : null;

/**
 * The engine codes of a comma list that are in `known`, once each, in the order given. A list with none of
 * them (or no list) is `null`, which is every enabled engine: the scope never holds an empty list.
 */
export function parseEngines(value: string | null, known: readonly string[]): string[] | null {
  if (value === null) return null;
  const codes = value
    .split(',')
    .map((code) => code.trim())
    .filter((code, index, all) => known.includes(code) && all.indexOf(code) === index);
  return codes.length === 0 ? null : codes;
}

/**
 * `branded=only` and `branded=included`; excluded for anything else. The Prompts page writes `branded=include`
 * for the same choice, so a link from it reads as included here.
 */
export function parseBranded(value: string | null): Branded {
  if (value === 'include') return 'included';
  return value === 'only' || value === 'included' ? value : 'excluded';
}

const TERM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A term id (a UUID, what `filter[term]` takes), lowercased so equal ids share a query key; else all topics. */
export const parseTopic = (value: string | null): string | null =>
  value !== null && TERM_ID.test(value) ? value.toLowerCase() : null;

/** The summary's branded parameters for a choice. `branded_only` counts branded prompts alone. */
export function brandedParams(branded: Branded): { include_branded: boolean; branded_only?: true } {
  if (branded === 'only') return { include_branded: true, branded_only: true };
  return { include_branded: branded === 'included' };
}

/**
 * A string that is equal for equal scopes, for query keys. The order of the engines does not matter to a
 * read, and the previous window is part of the key only while the comparison is on.
 */
export function scopeKey(scope: OverviewScope): string {
  return JSON.stringify([
    scope.range.from,
    scope.range.to,
    scope.compare ? [scope.previous.from, scope.previous.to] : null,
    scope.country,
    scope.engines === null ? null : [...scope.engines].sort(),
    scope.topic,
    scope.branded,
  ]);
}
