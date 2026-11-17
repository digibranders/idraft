import { addDays, addMonths, daysInclusive, type BusinessDate } from '@/components/app/date-range/business-date';
import type { DateRangeValue, ResolvedRange } from '@/components/app/date-range/range-model';
import type { CompareKind } from '@/lib/compare/compare-model';

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

/**
 * The measure the trend and the group heat map draw (`metric`): AI Visibility, mention rate, citation rate or share
 * of voice. It changes what a card draws, never what is read, so it is not part of `scopeKey`.
 */
export const SCOPE_METRICS = ['visibility', 'mention', 'citation', 'sov'] as const;
export type ScopeMetric = (typeof SCOPE_METRICS)[number];
export const DEFAULT_METRIC: ScopeMetric = 'visibility';

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
  /** What the comparison is with (`cmp=year` is the same dates a year earlier); the period before otherwise. */
  compareKind: CompareKind;
  /** The window `compare` reads: just before `range`, as long as it, or the same dates a year earlier; present even when off. */
  previous: DateWindow;
  /** An ISO 3166 alpha-2 code, or `null` for every country. */
  country: string | null;
  /** The engines chosen, in the order given, or `null` for every enabled engine. Never an empty list. */
  engines: readonly string[] | null;
  /** One topic term id and the topics below it, or `null` for all topics. */
  topic: string | null;
  branded: Branded;
  /** The measure the trend and the heat map draw. */
  metric: ScopeMetric;
}

/** The parts of the scope a person changes; a key left out stays as it is. */
export interface ScopePatch {
  range?: DateRangeValue;
  compare?: boolean;
  /** What the comparison is with; left out it is the period before. Choosing it turns the comparison on. */
  compareKind?: CompareKind;
  country?: string | null;
  /** `null` or an empty list is every enabled engine. */
  engines?: readonly string[] | null;
  topic?: string | null;
  branded?: Branded;
  metric?: ScopeMetric;
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

/** The same dates a year earlier, the rule of `compare=previous_year` (29 February becomes 28 February). */
export const previousYearWindow = (from: BusinessDate, to: BusinessDate): DateWindow => ({
  from: addMonths(from, -12),
  to: addMonths(to, -12),
});

/** The window a comparison of `kind` reads. */
export const comparedWindowOf = (kind: CompareKind, from: BusinessDate, to: BusinessDate): DateWindow =>
  kind === 'previous_year' ? previousYearWindow(from, to) : previousWindow(from, to);

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

/** `visibility`, `mention`, `citation` or `sov`; visibility (the default) for anything else. */
export const parseMetric = (value: string | null): ScopeMetric =>
  SCOPE_METRICS.find((metric) => metric === value) ?? DEFAULT_METRIC;

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

/**
 * The one platform the page is for, or `null` for All platforms. The page has a single Platform select, so a link
 * that names several engines (`engine=a,b`, from before the select) reads as All platforms.
 */
export function singlePlatform(scope: Pick<OverviewScope, 'engines'>): string | null {
  return scope.engines?.length === 1 ? (scope.engines[0] ?? null) : null;
}

/** Whether the scope came from a link that names several platforms, which `singlePlatform` reads as All platforms. */
export function namesSeveralPlatforms(scope: Pick<OverviewScope, 'engines'>): boolean {
  return (scope.engines?.length ?? 0) > 1;
}

/**
 * The engines the page works with: a link that names several platforms that are all on (from before the Platform
 * select) is All platforms, `null`. Anything else is kept as it is: one platform, even one the project has off (the
 * cards say that no platform is asked), or a list that names a platform that is off, which the filter bar drops from
 * the address and says so. `enabled` empty means the platforms are not known yet; every read waits for them.
 */
export function onePlatform(engines: readonly string[] | null, enabled: readonly string[]): readonly string[] | null {
  if (engines === null || engines.length < 2 || enabled.length === 0) return engines;
  return engines.every((code) => enabled.includes(code)) ? null : engines;
}

/** The summary's branded parameters for a choice. `branded_only` counts branded prompts alone. */
export function brandedParams(branded: Branded): { include_branded: boolean; branded_only?: true } {
  if (branded === 'only') return { include_branded: true, branded_only: true };
  return { include_branded: branded === 'included' };
}

/**
 * The engines of a scope once the engines that are on are known: a choice that holds every one of them, in any
 * order (and perhaps an engine that is off), is no filter, which is `null`. `enabled` empty means they are not
 * known yet: the choice is kept as it is.
 */
export function normalizeEngines(
  engines: readonly string[] | null,
  enabled: readonly string[],
): readonly string[] | null {
  if (engines === null || enabled.length === 0) return engines;
  return enabled.every((code) => engines.includes(code)) ? null : engines;
}

/**
 * What "Reset scope" puts back: the comparison, the platform, the group, the branded choice and the measure the trend
 * and the heat map draw; never the window or the location.
 */
export const RESET_PATCH = {
  compare: true,
  compareKind: 'previous_period',
  engines: null,
  topic: null,
  branded: 'excluded',
  metric: DEFAULT_METRIC,
} as const satisfies ScopePatch;

/**
 * How many of the scope's filters are not their default (comparison on, every platform, no group, branded excluded):
 * the count on the Filters button and the reason for "Reset filters". The window and the country are scope the
 * top bar owns, and a default window does not count (19 section 4.1).
 */
export function changedFilterCount(scope: OverviewScope): number {
  return [
    !scope.compare || scope.compareKind !== 'previous_period',
    scope.engines !== null,
    scope.topic !== null,
    scope.branded !== 'excluded',
  ].filter(Boolean).length;
}

/** Whether "Reset scope" has anything to put back: a filter, or the measure the trend and the heat map draw. */
export const canResetScope = (scope: OverviewScope): boolean =>
  changedFilterCount(scope) > 0 || scope.metric !== DEFAULT_METRIC;

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
