import type { CannCount, CannKeyword, CannPage, CannPair, CannSwitchRow } from '@/lib/api/types';
import { formatSignedInteger } from '@/lib/format';

/**
 * The pure parts of the Cannibalization page (docs/33 section 7): the address vocabulary, the filters of the tables,
 * the change against the previous period, and the facts a history strip's text alternative is made of.
 */

export type Device = 'desktop' | 'mobile';
export type Period = 14 | 30 | 90;
export type Verdict = CannKeyword['verdict'];

export const DEVICES: readonly Device[] = ['desktop', 'mobile'];
export const PERIODS: readonly Period[] = [14, 30, 90];
export const DEFAULT_PERIOD: Period = 30;
/** The tab's first view: By keyword; on Switching, Changes. */
export const KEYWORD_SHOWS = ['conflicts', 'likely', 'co_ranking', 'unstable', 'all'] as const;
export type KeywordShow = (typeof KEYWORD_SHOWS)[number];
export const SWITCH_SHOWS = ['all', 'flip_flop', 'improved', 'dropped', 'left_target'] as const;
export type SwitchShow = (typeof SWITCH_SHOWS)[number];
export type CannView = 'keywords' | 'pairs' | 'changes';
export type CannTab = 'cannibalization' | 'switching';
export const MAX_SEARCH = 200;
/** A page counts as one of a keyword's pages from this many ranked checks (the mock's "ranked >= 3"). */
export const MIN_PAGE_CHECKS = 3;
/** A rank gap from this many places is drawn as a warning. */
export const GAP_WARNING = 3;

export interface CannState {
  device: Device;
  /** A keyword group id, or `all`. */
  group: string;
  days: Period;
  view: CannView;
  show: KeywordShow;
  sw: SwitchShow;
  /** Switching, By keyword: only the keywords that switched. */
  switchedOnly: boolean;
  search: string;
  /** A page pair as `<url id>|<url id>`, or `''`. */
  pair: string;
}

export type CannSearch = Readonly<
  Partial<Record<'device' | 'group' | 'days' | 'view' | 'show' | 'sw' | 'switched' | 'q' | 'pair', string | null>>
>;

const pick = <T extends string>(allowed: readonly T[], raw: string | null | undefined, fallback: T): T =>
  allowed.find((value) => value === raw) ?? fallback;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const defaultView = (tab: CannTab): CannView => (tab === 'switching' ? 'changes' : 'keywords');

/** The views of a tab: Cannibalization has By keyword and By page pair; Switching has Changes and By keyword. */
export const viewsOf = (tab: CannTab): readonly CannView[] =>
  tab === 'switching' ? ['changes', 'keywords'] : ['keywords', 'pairs'];

/** The state the address names. A value that does not read falls back to its default; nothing throws. */
export function parseCann(search: CannSearch, tab: CannTab): CannState {
  const pair = (search.pair ?? '').split('|');
  return {
    device: pick(DEVICES, search.device, 'desktop'),
    group:
      search.group !== null && search.group !== undefined && UUID.test(search.group)
        ? search.group.toLowerCase()
        : 'all',
    days: PERIODS.find((period) => String(period) === search.days) ?? DEFAULT_PERIOD,
    view: pick(viewsOf(tab), search.view, defaultView(tab)),
    show: pick(KEYWORD_SHOWS, search.show, 'conflicts'),
    sw: pick(SWITCH_SHOWS, search.sw, 'all'),
    switchedOnly: search.switched !== 'all',
    search: (search.q ?? '').trim().slice(0, MAX_SEARCH),
    pair: pair.length === 2 && pair.every((id) => id !== '' && id.length <= 200) ? pair.join('|') : '',
  };
}

/** The address of a state: each default as `null`, which removes its key. */
export function writeCann(state: CannState, tab: CannTab): Record<string, string | null> {
  return {
    device: state.device === 'desktop' ? null : state.device,
    group: state.group === 'all' ? null : state.group,
    days: state.days === DEFAULT_PERIOD ? null : String(state.days),
    view: state.view === defaultView(tab) ? null : state.view,
    show: state.show === 'conflicts' ? null : state.show,
    sw: state.sw === 'all' ? null : state.sw,
    switched: state.switchedOnly ? null : 'all',
    q: state.search === '' ? null : state.search,
    pair: state.pair === '' ? null : state.pair,
  };
}

export const isDefaultScope = (state: CannState): boolean =>
  state.device === 'desktop' && state.group === 'all' && state.days === DEFAULT_PERIOD;

// -------------------------------------------------------------------------------------------------
// Pages of a keyword

/** The chart token that colors a page letter: A to F take `chart-1` to `chart-6`, any later page `chart-other`. */
export function pageToken(letter: string): string {
  const index = 'ABCDEF'.indexOf(letter);
  return index < 0 || letter.length !== 1 ? 'chart-other' : `chart-${String(index + 1)}`;
}

/** The pages a keyword's Pages cell names: those ranked on enough checks, in the API's order (A first). */
export const shownPages = (row: CannKeyword): CannPage[] => row.pages.filter((page) => page.ranked >= MIN_PAGE_CHECKS);

export const isConflict = (verdict: Verdict): boolean =>
  verdict === 'likely' || verdict === 'co_ranking' || verdict === 'unstable';

// -------------------------------------------------------------------------------------------------
// Filters

/** The keywords a By keyword table shows for a chip, a search and a page pair. */
export function filterKeywords(
  rows: readonly CannKeyword[],
  { show, search, pair }: Pick<CannState, 'show' | 'search' | 'pair'>,
): CannKeyword[] {
  const needle = search.toLowerCase();
  const ids = pair === '' ? null : pair.split('|');
  return rows.filter((row) => {
    if (needle !== '' && !row.keyword.toLowerCase().includes(needle)) return false;
    if (
      ids !== null &&
      !ids.every((id) => row.pages.some((page) => page.url_id === id && page.ranked >= MIN_PAGE_CHECKS))
    )
      return false;
    if (show === 'all') return row.verdict !== 'unranked';
    if (show === 'conflicts') return isConflict(row.verdict);
    return row.verdict === show;
  });
}

/** Switching, By keyword: the keywords that switched (or all ranked ones), searched. */
export function filterSwitchKeywords(
  rows: readonly CannKeyword[],
  { search, switchedOnly }: Pick<CannState, 'search' | 'switchedOnly'>,
): CannKeyword[] {
  const needle = search.toLowerCase();
  return rows.filter(
    (row) =>
      row.verdict !== 'unranked' &&
      (!switchedOnly || row.switches.length > 0) &&
      (needle === '' || row.keyword.toLowerCase().includes(needle)),
  );
}

/** Whether a page pair has a page whose address or title contains the search. */
export const pairMatches = (pair: CannPair, search: string): boolean => {
  const needle = search.toLowerCase();
  return (
    needle === '' ||
    [pair.a, pair.b].some(
      (page) => page.path.toLowerCase().includes(needle) || (page.title ?? '').toLowerCase().includes(needle),
    )
  );
};

/** The changes a Changes table shows for a chip and a search. */
export function filterSwitches(
  rows: readonly CannSwitchRow[],
  { sw, search }: Pick<CannState, 'sw' | 'search'>,
): CannSwitchRow[] {
  const needle = search.toLowerCase();
  return rows.filter((row) => {
    if (needle !== '' && !row.keyword.toLowerCase().includes(needle)) return false;
    switch (sw) {
      case 'flip_flop':
        return row.event.is_flip_flop;
      case 'improved':
        return row.rank_change > 0;
      case 'dropped':
        return row.rank_change < 0;
      case 'left_target':
        return row.left_target;
      case 'all':
        return true;
    }
  });
}

/** The chip counts of the Changes table, over the rows the search leaves. */
export function switchCounts(rows: readonly CannSwitchRow[], search: string): Record<SwitchShow, number> {
  return Object.fromEntries(SWITCH_SHOWS.map((sw) => [sw, filterSwitches(rows, { sw, search }).length])) as Record<
    SwitchShow,
    number
  >;
}

// -------------------------------------------------------------------------------------------------
// Figures

/** A change of a count against the previous period: neutral, so a number and its sign. `null` when unknown or unchanged. */
export function countChange(count: CannCount, hasPrevious: boolean): { text: string; before: number } | null {
  if (!hasPrevious || count.before === null || count.before === count.value) return null;
  return { text: formatSignedInteger(count.value - count.before), before: count.before };
}

/** What a history strip is made of: the checks per page (in the order of the letters) and the switches. */
export interface StripFacts {
  pages: { letter: string; path: string; checks: number }[];
  checks: number;
  switches: number;
}

export function stripFacts(row: CannKeyword): StripFacts {
  const counts = new Map<string, number>();
  for (const cell of row.strip) {
    if (cell.kind === 'page' && cell.url_id !== null) counts.set(cell.url_id, (counts.get(cell.url_id) ?? 0) + 1);
  }
  return {
    pages: row.pages.flatMap((page) => {
      const checks = counts.get(page.url_id);
      return checks === undefined ? [] : [{ letter: page.letter, path: page.path, checks }];
    }),
    checks: row.strip.length,
    switches: row.switches.length,
  };
}

/** Sorts a copy of rows by a numeric or text value; ties fall to the keyword's text so the order is stable. */
export function sortRows<T>(
  rows: readonly T[],
  dir: 'asc' | 'desc',
  value: (row: T) => string | number,
  tie: (a: T, b: T) => number,
): T[] {
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const order = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return (dir === 'asc' ? order : -order) || tie(a, b);
  });
}

/** The order of the verdicts when sorting by status: the worst first. */
export const SEVERITY: Readonly<Record<Verdict, number>> = {
  likely: 4,
  co_ranking: 3,
  unstable: 2,
  none: 1,
  insufficient: 0,
  unranked: 0,
};

/** The room, in pixels, a Pages cell needs for its marks, two short paths and the "+N", over the keywords in scope. */
export function pagesColumnWidth(rows: readonly CannKeyword[]): number {
  const CHAR = 7;
  const need = rows.map((row) => {
    const shown = shownPages(row);
    // a 20 px mark and a 6 px gap in front of each path, 12 for the gap between the two, 34 for "+N"
    return (
      shown.slice(0, 2).reduce((total, page) => total + 26 + page.path.length * CHAR, 0) +
      (shown.length > 1 ? 12 : 0) +
      (shown.length > 2 ? 34 : 0)
    );
  });
  // 24 px of cell padding, 4 for the button, 26 for the chevron
  return Math.min(260, Math.max(176, Math.ceil(Math.max(0, ...need) + 54)));
}
