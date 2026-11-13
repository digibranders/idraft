'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { useDateRangeParams, type DateRangeParamsState } from '@/components/app/date-range/use-date-range-params';
import type { SourceFilters, SourceSort } from '@/lib/citations/source-queries';
import type { DomainRole, EngineCode } from '@/lib/citations/types';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { parseText } from '@/lib/filters/filter-values';
import { parseDensity, type Density } from '@/lib/tables/table-state';

/**
 * What the Citations page keeps in its address (WB-CIT-02 to 05): the tab, the filters, the comparison, the
 * fewest units a row needs, the sort and the table's own state. The date range is the picker's (`win`, `from`,
 * `to`). `parseScope` and `toFilters` are pure; `useCitationScope` only reads the address and hands both.
 */

export type CitationTab = 'domains' | 'pages';

/** Every URL key of the page besides the date range's: the saved views govern these. */
export const CITATION_KEYS = [
  'tab',
  'engine',
  'role',
  'topic',
  'branded',
  'cmp',
  'min',
  'sort',
  'domain',
  'density',
  'cols',
] as const;

export type CitationKey = (typeof CITATION_KEYS)[number];

/** The address as nuqs gives it: each key's text, or absent. */
export type CitationSearch = Readonly<Partial<Record<CitationKey, string | null | undefined>>>;

/** The most engines one read takes. */
export const MAX_ENGINES = 3;
const ROLES: readonly DomainRole[] = ['own', 'competitor', 'third_party'];
const SORTS: readonly SourceSort[] = ['-citation_units', '-observations', '-prompts'];
export const DEFAULT_SORT: SourceSort = '-citation_units';
/** Rows with fewer citation units than this are left out (DS 9.7 says 2). */
export const DEFAULT_MIN_SUPPORT = 2;
export const MIN_SUPPORT_RANGE = { min: 1, max: 1000 } as const;

export interface CitationScope {
  tab: CitationTab;
  /** Enabled engines only, at most 3; none means every engine that is on. */
  engines: readonly EngineCode[];
  roles: readonly DomainRole[];
  /** One topic term: the prompts given it or one below it. */
  term: string | null;
  includeBranded: boolean;
  /** False for `cmp=off`: no previous period is read and no change is shown. */
  compare: boolean;
  minSupport: number;
  sort: SourceSort;
  /** The registrable domain the Pages tab is filtered to (`domain=equals:g2.com`). */
  domain: string | null;
  density: Density;
  /** The visible columns as the address writes them; the table knows which ids exist and parses them. */
  columns: string | null;
}

/** The members of `a,b` that `allowed` holds, each once, in the order given. */
function listOf<TValue extends string>(text: string | null | undefined, allowed: readonly TValue[]): TValue[] {
  const members = (text ?? '').split(',').map((member) => member.trim());
  return allowed.filter((value) => members.includes(value)).sort((a, b) => members.indexOf(a) - members.indexOf(b));
}

function minSupportOf(text: string | null | undefined): number {
  if (text === null || text === undefined || !/^-?\d+$/.test(text.trim())) return DEFAULT_MIN_SUPPORT;
  return Math.min(MIN_SUPPORT_RANGE.max, Math.max(MIN_SUPPORT_RANGE.min, Number(text)));
}

function domainOf(text: string | null | undefined): string | null {
  const filter = parseText(text);
  return filter?.operator === 'equals' ? filter.text : null;
}

/** The scope the address names. A value that does not read falls back to its default; nothing throws. */
export function parseScope(search: CitationSearch, enabledEngines: readonly EngineCode[]): CitationScope {
  const term = search.topic?.trim() ?? '';
  const columns = search.cols?.trim() ?? '';
  return {
    tab: search.tab === 'pages' ? 'pages' : 'domains',
    engines: listOf(search.engine, enabledEngines).slice(0, MAX_ENGINES),
    roles: listOf(search.role, ROLES),
    term: term === '' ? null : term,
    includeBranded: search.branded === 'include',
    compare: search.cmp !== 'off',
    minSupport: minSupportOf(search.min),
    sort: SORTS.find((sort) => sort === search.sort) ?? DEFAULT_SORT,
    domain: domainOf(search.domain),
    density: parseDensity(search.density),
    columns: columns === '' ? null : columns,
  };
}

/** The first and last day of the window, in the project's zone. */
export interface DateWindow {
  from: string;
  to: string;
}

/**
 * The filters every read of the page shares. The domain filter is not one of them (only the pages read takes it,
 * as `registrableDomain`), and a prompt is never set: this page reads the whole project.
 */
export function toFilters(scope: CitationScope, range: DateWindow): SourceFilters {
  return {
    from: range.from,
    to: range.to,
    engines: scope.engines,
    roles: scope.roles,
    ...(scope.term === null ? {} : { term: scope.term }),
    includeBranded: scope.includeBranded,
  };
}

const PARSERS: Record<CitationKey, typeof parseAsString> = Object.fromEntries(
  CITATION_KEYS.map((key) => [key, parseAsString]),
) as Record<CitationKey, typeof parseAsString>;

export interface CitationScopeState {
  scope: CitationScope;
  /** The date range's keys, for the picker, and the window the reads use. */
  picked: DateRangeParamsState;
  range: DateWindow;
  /** Writes keys of the page with history replace; a `null` removes one. */
  setSearch: (values: Partial<Record<CitationKey, string | null>>) => void;
}

/**
 * The page's scope from the address. `enabledEngines` are the engines that are on: an engine of a link that is
 * off is left out. Nothing is written to the address on load.
 */
export function useCitationScope(timeZone: string, enabledEngines: readonly EngineCode[]): CitationScopeState {
  const [search, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const scope = useMemo(() => parseScope(search, enabledEngines), [search, enabledEngines]);
  // `today` is a day of the project's zone: the one place the clock is read
  const today = useZoneDay(timeZone);
  const picked = useDateRangeParams({ today });
  const range = useMemo((): DateWindow => ({ from: picked.range.from, to: picked.range.to }), [picked.range]);
  const setSearch = useCallback(
    (values: Partial<Record<CitationKey, string | null>>): void => {
      void setState(values);
    },
    [setState],
  );
  return { scope, picked, range, setSearch };
}
