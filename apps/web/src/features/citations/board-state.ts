'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { engineCodeValues } from '@/lib/api/schema';
import type { EngineCode } from '@/lib/api/types';
import type { RunsChoice } from '@/lib/citations/board-queries';

/**
 * What the Citations page keeps in its address (brief section 3.1, C 40 to 66): the scope (`platform`, `group`, `runs`,
 * `comp`), the Cited pages owner, the gap filter and the search. Defaults are never written. The keys of the page this
 * one replaces are read once and dropped. `parseBoard`, `writeBoard` and `migrationOf` are pure.
 */

export type Platform = EngineCode | 'all';
/** The owner of a cited page as the address writes it (C 26 to 31); `third` is the API's `third_party`. */
export type Owner = 'own' | 'competitor' | 'third' | 'all';
export const OWNERS: readonly Owner[] = ['own', 'competitor', 'third', 'all'];
/** The Runs menu, in its order (D 24 to 28). */
export const RUN_CHOICES: readonly RunsChoice[] = [4, 2, 1];
export const MAX_COMPETITORS = 5;
export const MAX_SEARCH = 200;
/** D-7: the first three tracked competitors. */
const DEFAULT_COMPETITORS = 3;

export const BOARD_KEYS = ['platform', 'group', 'runs', 'comp', 'owner', 'gaps', 'q'] as const;
export type BoardKey = (typeof BOARD_KEYS)[number];
/** The keys of the old page (`features/citations/citation-scope.ts` and the date range picker). */
export const OLD_KEYS = [
  'tab',
  'kind',
  'engine',
  'role',
  'topic',
  'branded',
  'redirects',
  'internal',
  'cmp',
  'min',
  'sort',
  'domain',
  'density',
  'cols',
  'country',
  'win',
  'from',
  'to',
] as const;
type OldKey = (typeof OLD_KEYS)[number];
type AnyKey = BoardKey | OldKey;

export type BoardSearch = Readonly<Partial<Record<AnyKey, string | null>>>;
export type BoardPatch = Partial<Record<AnyKey, string | null>>;

export interface BoardState {
  platform: Platform;
  /** A topic term id, or `all`. */
  group: string;
  runs: RunsChoice;
  /** Tracked competitor ids, at most five. */
  competitors: readonly string[];
  owner: Owner;
  gapsOnly: boolean;
  search: string;
}

/** What values are checked against; `null` while it is not known, when a value is kept as given. */
export interface BoardOptions {
  engines: readonly EngineCode[] | null;
  terms: ReadonlySet<string> | null;
  tracked: readonly string[] | null;
}

const isEngineCode = (value: string): value is EngineCode => engineCodeValues.some((code) => code === value);

export const defaultCompetitors = (tracked: readonly string[]): readonly string[] =>
  tracked.slice(0, DEFAULT_COMPETITORS);

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function platformOf(raw: string | null | undefined, engines: readonly EngineCode[] | null): Platform {
  if (raw === null || raw === undefined || !isEngineCode(raw)) return 'all';
  return engines === null || engines.includes(raw) ? raw : 'all';
}

function groupOf(raw: string | null | undefined, terms: ReadonlySet<string> | null): string {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'all') return 'all';
  return terms === null || terms.has(value) ? value : 'all';
}

function competitorsOf(raw: string | null | undefined, tracked: readonly string[] | null): readonly string[] {
  if (raw === null || raw === undefined) return tracked === null ? [] : defaultCompetitors(tracked);
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ];
  return (tracked === null ? ids : ids.filter((id) => tracked.includes(id))).slice(0, MAX_COMPETITORS);
}

/** The state the address names. A value that does not read falls back to its default; nothing throws. */
export function parseBoard(search: BoardSearch, options: BoardOptions): BoardState {
  return {
    platform: platformOf(search.platform, options.engines),
    group: groupOf(search.group, options.terms),
    runs: RUN_CHOICES.find((choice) => String(choice) === search.runs) ?? 4,
    competitors: competitorsOf(search.comp, options.tracked),
    owner: OWNERS.find((owner) => owner === search.owner) ?? 'own',
    gapsOnly: search.gaps !== 'all',
    search: (search.q ?? '').trim().slice(0, MAX_SEARCH),
  };
}

/** The address of `state`: each default as `null`, which removes its key. */
export function writeBoard(state: BoardState, tracked: readonly string[] | null): Record<BoardKey, string | null> {
  const defaults = tracked === null ? null : defaultCompetitors(tracked);
  return {
    platform: state.platform === 'all' ? null : state.platform,
    group: state.group === 'all' ? null : state.group,
    runs: state.runs === 4 ? null : String(state.runs),
    comp: defaults !== null && sameList(state.competitors, defaults) ? null : state.competitors.join(','),
    owner: state.owner === 'own' ? null : state.owner,
    gaps: state.gapsOnly ? null : 'all',
    q: state.search === '' ? null : state.search,
  };
}

/**
 * The write that moves an old link onto this page's keys, or `null` when it has none: `role` becomes `owner`, `topic`
 * becomes `group` (D-1), and every old key is removed. Any `tab` opens Cited pages, which `/ai/citations` is.
 */
export function migrationOf(search: BoardSearch): BoardPatch | null {
  const present = OLD_KEYS.filter((key) => search[key] !== null && search[key] !== undefined);
  if (present.length === 0) return null;
  const patch: BoardPatch = {};
  for (const key of present) patch[key] = null;
  const role = search.role?.trim();
  const owner = role === 'own' || role === 'competitor' ? role : role === 'third_party' ? 'third' : null;
  if (owner !== null && (search.owner ?? null) === null) patch.owner = owner;
  const topic = search.topic?.trim() ?? '';
  if (topic !== '' && (search.group ?? null) === null) patch.group = topic;
  return patch;
}

// One string parser per key, as `citation-scope.ts` builds them
const PARSERS = Object.fromEntries([...BOARD_KEYS, ...OLD_KEYS].map((key) => [key, parseAsString])) as Record<
  AnyKey,
  typeof parseAsString
>;

export interface BoardStateResult {
  state: BoardState;
  /** Writes a change with history replace, as the preview does (C 65). */
  set: (patch: Partial<BoardState>) => void;
  /** Platform, Group, Runs and Competitors back to their defaults (C 180). */
  resetScope: () => void;
  isDefaultScope: boolean;
}

export function useBoardState(options: BoardOptions): BoardStateResult {
  const [search, setSearch] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parseBoard(search, options), [search, options]);
  // An old link is moved once, on the first render that has its keys
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    const patch = migrationOf(search);
    if (patch !== null) void setSearch(patch, { history: 'replace' });
  }, [search, setSearch]);
  const { tracked } = options;
  const set = useCallback(
    (patch: Partial<BoardState>): void => {
      void setSearch(writeBoard({ ...state, ...patch }, tracked), { history: 'replace' });
    },
    [state, tracked, setSearch],
  );
  const defaults = useMemo(() => (tracked === null ? [] : defaultCompetitors(tracked)), [tracked]);
  const resetScope = useCallback(
    (): void => set({ platform: 'all', group: 'all', runs: 4, competitors: defaults }),
    [set, defaults],
  );
  const isDefaultScope =
    state.platform === 'all' && state.group === 'all' && state.runs === 4 && sameList(state.competitors, defaults);
  return { state, set, resetScope, isDefaultScope };
}
