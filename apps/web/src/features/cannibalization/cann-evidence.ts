import { MIN_PAGE_CHECKS, pageToken } from './cann-model';
import type { SeriesRole } from '@/lib/charts/category-chart';
import type { CannKeywordDetail } from '@/lib/api/types';
import { formatPercent } from '@/lib/format';

/**
 * The pure parts of the keyword inspector (docs/33 section 7.2): the pages of one keyword with their letters, the plain
 * sentence of what the checks show, the causes worth checking, and the series, lanes and switches the three tabs draw.
 * Sentences come back as a message key and its values, so the words stay in `messages/en.json`.
 */

/** A message key (under `cannibalization.inspector.sentence` or `.causes`) and the values its words take. */
export interface Words<K extends string> {
  key: K;
  values: Record<string, string | number>;
}

export type SentenceKey =
  'unranked' | 'insufficient' | 'likely' | 'coRanking' | 'unstable' | 'noneChanged' | 'noneSteady';
export type CauseKey =
  'titleOverlap' | 'sameSection' | 'differentSections' | 'offTarget' | 'coRanking' | 'internalLinks';

export interface PageRef {
  id: string;
  /** `A` is the page to compare with; `+` a page the checks name that the keyword's pages list does not. */
  letter: string;
  /** The chart token that colors the page, the same as the page's table. */
  token: string;
  path: string;
  title: string | null;
  url: string;
  isPrimary: boolean;
  isTarget: boolean;
  isSubResult: boolean;
  /** Checks of the period on which the page ranked. */
  ranked: number;
  share: number;
  bestCount: number;
  median: number | null;
  bestEver: number | null;
}

/** The pages of a keyword in the API's order (A first), then any page only a check or a switch names. */
export function pageRefs(detail: CannKeywordDetail): PageRef[] {
  const known = new Set(detail.keyword.pages.map((page) => page.url_id));
  const own = detail.keyword.pages.map((page): PageRef => ({
    id: page.url_id,
    letter: page.letter,
    token: pageToken(page.letter),
    path: page.path,
    title: page.title,
    url: page.url,
    isPrimary: page.is_primary,
    isTarget: page.is_target,
    isSubResult: page.is_sub_result,
    ranked: page.ranked,
    share: page.share,
    bestCount: page.best_count,
    median: page.median,
    bestEver: page.best_ever,
  }));
  const extra = detail.urls
    .filter((url) => !known.has(url.url_id))
    .map((url): PageRef => ({
      id: url.url_id,
      letter: '+',
      token: pageToken('+'),
      path: url.path,
      title: url.title,
      url: url.url,
      isPrimary: false,
      isTarget: url.url_id === detail.keyword.target_url_id,
      isSubResult: false,
      ranked: 0,
      share: 0,
      bestCount: 0,
      median: null,
      bestEver: null,
    }));
  return [...own, ...extra];
}

/** The pages the keyword's lists name: those ranked on enough checks. */
const competing = (refs: readonly PageRef[]): PageRef[] => refs.filter((ref) => ref.ranked >= MIN_PAGE_CHECKS);

/** The page to compare with, and the first other page that competes with it. */
function pairOf(refs: readonly PageRef[]): { a: PageRef; b: PageRef | undefined } | null {
  const [first] = refs;
  if (first === undefined) return null;
  const a = refs.find((ref) => ref.isPrimary) ?? first;
  return { a, b: competing(refs).find((ref) => ref.id !== a.id) };
}

// -------------------------------------------------------------------------------------------------
// The sentence

/** What the checks show, in one plain sentence: it says what was seen and never why. */
export function evidenceSentence(detail: CannKeywordDetail, days: number): Words<SentenceKey> {
  const { keyword, meta } = detail;
  const refs = pageRefs(detail);
  const pair = pairOf(refs);
  const count = keyword.switches.length;
  const current = refs.find((ref) => ref.id === keyword.current_url_id) ?? pair?.a;
  switch (keyword.verdict) {
    case 'unranked':
      return { key: 'unranked', values: { days } };
    case 'insufficient':
      return { key: 'insufficient', values: { count: keyword.ranked_checks, min: meta.min_checks } };
    case 'likely':
      if (pair?.b !== undefined) {
        return {
          key: 'likely',
          values: { a: pair.a.path, b: pair.b.path, count, gap: Math.round(keyword.rank_gap) },
        };
      }
      break;
    case 'co_ranking': {
      const [first, second] = [...competing(refs)].sort((x, y) => y.ranked - x.ranked);
      if (first !== undefined && second !== undefined) {
        return {
          key: 'coRanking',
          values: {
            a: first.path,
            aMedian: Math.round(first.median ?? 0),
            b: second.path,
            bMedian: Math.round(second.median ?? 0),
            share: formatPercent(keyword.together_rate, { decimals: 0 }),
          },
        };
      }
      break;
    }
    case 'unstable':
      return { key: 'unstable', values: { count } };
    case 'none':
      break;
  }
  const page = current?.path ?? '';
  return count > 0 ? { key: 'noneChanged', values: { page, count } } : { key: 'noneSteady', values: { page } };
}

// -------------------------------------------------------------------------------------------------
// Possible causes

const WORDS_MIN = 3;
const STOP = new Set(['the', 'and', 'for']);
const words = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= WORDS_MIN && !STOP.has(word)),
  );

/** Share of title words two pages have in common (Jaccard): a hint that they answer the same question, never a verdict. */
export function titleOverlap(a: string, b: string): number {
  const [x, y] = [words(a), words(b)];
  const both = [...x].filter((word) => y.has(word)).length;
  const all = x.size + y.size - both;
  return all === 0 ? 0 : both / all;
}

/** Titles sharing this much of their words are worth naming as a possible cause. */
const OVERLAP_MIN = 0.3;

/** The folder an address starts in: `/blog/` for `/blog/a-post`; empty for a page at the root. */
function sectionOf(path: string): string {
  const [first = '', ...rest] = path.split('/').filter((part) => part !== '');
  return rest.length === 0 ? '' : `/${first}/`;
}

/**
 * Hypotheses to check, each said as one: title overlap (both titles known), the section the pages are in (the only page
 * type the API gives), target mismatch, and internal links, which the detector cannot see.
 */
export function causesOf(detail: CannKeywordDetail): Words<CauseKey>[] {
  const { keyword } = detail;
  const refs = pageRefs(detail);
  const pair = pairOf(refs);
  const list: Words<CauseKey>[] = [];
  if (pair?.b !== undefined) {
    const { a, b } = pair;
    if (a.title !== null && b.title !== null) {
      const overlap = titleOverlap(a.title, b.title);
      if (overlap >= OVERLAP_MIN) {
        list.push({
          key: 'titleOverlap',
          values: { share: formatPercent(overlap, { decimals: 0 }), a: a.title, b: b.title },
        });
      }
    }
    const [sa, sb] = [sectionOf(a.path), sectionOf(b.path)];
    if (sa !== '' && sa === sb) list.push({ key: 'sameSection', values: { section: sa } });
    else if (sa !== '' && sb !== '') list.push({ key: 'differentSections', values: { a: sa, b: sb } });
  }
  if (keyword.on_target === false) {
    const target = refs.find((ref) => ref.id === keyword.target_url_id);
    const current = refs.find((ref) => ref.id === keyword.current_url_id);
    if (target !== undefined && current !== undefined) {
      list.push({ key: 'offTarget', values: { target: target.path, current: current.path } });
    }
  }
  if (keyword.verdict === 'co_ranking') list.push({ key: 'coRanking', values: {} });
  list.push({ key: 'internalLinks', values: {} });
  return list;
}

// -------------------------------------------------------------------------------------------------
// Rank by page

/** The color role of a page letter, matching `pageToken`: A the brand color, B to F the palette, later pages the quiet one. */
export function roleOfLetter(letter: string): SeriesRole {
  const index = 'ABCDEF'.indexOf(letter);
  if (letter.length !== 1 || index < 0) return { kind: 'other' };
  if (index === 0) return { kind: 'brand' };
  return { kind: 'palette', index: (index + 1) as 2 | 3 | 4 | 5 | 6 };
}

export interface RankLine {
  page: PageRef;
  /** One rank per check; `null` where the page did not rank or the check could not be read. */
  values: (number | null)[];
}

/** One line per page that ranked on enough checks, over the checks of the period. */
export function rankLines(detail: CannKeywordDetail, refs: readonly PageRef[]): { dates: string[]; lines: RankLine[] } {
  const lines = competing(refs)
    .filter((ref) => 'ABCDEF'.includes(ref.letter))
    .map((page) => ({
      page,
      values: detail.checks.map((check) =>
        check.readable ? (check.ranks.find((rank) => rank.url_id === page.id)?.rank ?? null) : null,
      ),
    }));
  return { dates: detail.checks.map((check) => check.date), lines };
}

// -------------------------------------------------------------------------------------------------
// Timeline

/** A check for one page: the ranking page, ranked beside it, not ranked, or a check whose result address was hidden. */
export type CellKind = 'ranking' | 'beside' | 'none' | 'unreadable';

export interface LaneCell {
  date: string;
  kind: CellKind;
  rank: number | null;
}

export interface Lane {
  page: PageRef;
  cells: LaneCell[];
  /** Checks on which the page was the ranking page. */
  rankingChecks: number;
}

/** One lane per page that ranked in the period, one cell per check. */
export function timelineLanes(detail: CannKeywordDetail, refs: readonly PageRef[]): Lane[] {
  const rankingOn = new Map(
    detail.keyword.strip.flatMap((cell) =>
      cell.kind === 'page' && cell.url_id !== null ? [[cell.date, cell.url_id]] : [],
    ),
  );
  return refs
    .filter((ref) => ref.ranked > 0)
    .map((page) => {
      const cells = detail.checks.map((check): LaneCell => {
        const rank = check.ranks.find((entry) => entry.url_id === page.id)?.rank ?? null;
        if (!check.readable) return { date: check.date, kind: 'unreadable', rank: null };
        if (rankingOn.get(check.date) === page.id) return { date: check.date, kind: 'ranking', rank };
        return { date: check.date, kind: rank === null ? 'none' : 'beside', rank };
      });
      return { page, cells, rankingChecks: cells.filter((cell) => cell.kind === 'ranking').length };
    });
}

export interface SwitchItem {
  date: string;
  from: PageRef;
  to: PageRef;
  before: number;
  after: number;
  heldDays: number;
  flipFlop: boolean;
}

/** The confirmed switches, newest first. A switch that names a page the answer does not carry is left out. */
export function switchList(detail: CannKeywordDetail, refs: readonly PageRef[]): SwitchItem[] {
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  return detail.keyword.switches
    .flatMap((event) => {
      const [from, to] = [byId.get(event.from_url_id), byId.get(event.to_url_id)];
      return from === undefined || to === undefined
        ? []
        : [
            {
              date: event.date,
              from,
              to,
              before: event.rank_before,
              after: event.rank_after,
              heldDays: event.held_days,
              flipFlop: event.is_flip_flop,
            },
          ];
    })
    .sort((x, y) => y.date.localeCompare(x.date));
}
