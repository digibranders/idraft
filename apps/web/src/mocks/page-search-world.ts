import { comparedPeriod } from './ai-referrals';
import { pageTierViews } from './internal-links-world';
import { daysBetween, shiftIsoDate } from './serp-views';
import { onMockReset } from './state';
import { formatIsoDate } from '@/lib/format';
import type { Schemas } from '@/lib/api/types';

type BreakdownDimension = Schemas['BreakdownDimension'];
type PageCannibalization = Schemas['PageCannibalization'];
type PageHealth = Schemas['PageHealth'];
type PageNumbers = Schemas['PageNumbers'];
type PageQueries = Schemas['PageQueries'];
type SearchWindow = Schemas['SearchWindow'];
type SeriesPoint = Schemas['SeriesPoint'];
export type CompareParam = 'previous_period' | 'previous_year' | 'none';

/**
 * The pages of the mock Search Console (spec 2026-11-26, section 7): twelve crawled pages of the project's site, eight
 * of them tracked at the start, each with daily numbers that are a pure function of the page and the day, so one
 * request always answers the same and a total is the sum of its series. A page's character (declining, a sharp drop,
 * growing, stable, too small to judge, lost, new) is a monthly trend around 1 October 2026, so the last full month
 * against the month before shows each verdict. Which pages a project tracks is kept in memory, per project.
 */

export const TRACKED_LIMIT = 200;
export const MAX_DAYS = 92;
/** The history call reaches back 16 months, at most 487 rows (spec D2). */
const HISTORY_DAYS = 487;
const PIVOT = '2026-10-01';
const PACIFIC = 'America/Los_Angeles';
/** Google has final data up to three days back. */
const FINAL_LAG_DAYS = 3;
const QUERIES_CAP = 25_000;
/** The queries the page's breakdown lists make up this share of its clicks: Google leaves the rest out. */
const QUERY_COVERAGE = 0.88;

const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const PIVOT_DAY = dayNumber(PIVOT);
const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

// -------------------------------------------------------------------------------------------------
// The pages

type Profile = 'stable' | 'declining' | 'sharp_drop' | 'growing' | 'small' | 'lost' | 'new';

interface Shape {
  /** Clicks and impressions a day on 1 October, and what they are multiplied by every 30 days. */
  clicks: number;
  impressions: number;
  clicksGrowth: number;
  impressionsGrowth: number;
  /** The average position on 1 October, and how far it moves in 30 days. */
  position: number;
  drift: number;
}

const SHAPES: Record<Profile, Shape> = {
  stable: { clicks: 18, impressions: 1500, clicksGrowth: 1, impressionsGrowth: 1, position: 4.2, drift: 0 },
  declining: { clicks: 14, impressions: 1400, clicksGrowth: 0.74, impressionsGrowth: 0.97, position: 3.8, drift: 2 },
  sharp_drop: { clicks: 20, impressions: 1800, clicksGrowth: 0.45, impressionsGrowth: 0.62, position: 5.1, drift: 3.5 },
  growing: { clicks: 12, impressions: 1300, clicksGrowth: 1.4, impressionsGrowth: 1.3, position: 7.5, drift: -2 },
  small: { clicks: 0.3, impressions: 3, clicksGrowth: 1, impressionsGrowth: 1, position: 14, drift: 0 },
  lost: { clicks: 12, impressions: 900, clicksGrowth: 1, impressionsGrowth: 0.3, position: 9, drift: 0 },
  new: { clicks: 10, impressions: 900, clicksGrowth: 1, impressionsGrowth: 1, position: 9, drift: 0 },
};

/** What the page's query count is: a number the world makes up, the cap, a real 0, or a month that was never stored. */
type QueryCount = 'counted' | 'capped' | 'zero' | 'unstored';
type Start = 'tracked' | 'loading' | 'untracked';

export interface WorldPage {
  urlId: string;
  path: string;
  title: string | null;
  /** The position of its tier in the workspace's tier list (the internal links mock), or null for Untiered. */
  tier: number | null;
  profile: Profile;
  queries: QueryCount;
  start: Start;
}

export const PAGES: readonly WorldPage[] = [
  { urlId: '901', path: '/', title: 'Home', tier: 0, profile: 'stable', queries: 'counted', start: 'tracked' },
  {
    urlId: '902',
    path: '/pricing',
    title: 'Pricing',
    tier: 0,
    profile: 'declining',
    queries: 'counted',
    start: 'tracked',
  },
  {
    urlId: '903',
    path: '/blog/soc-guide',
    title: 'The SOC guide',
    tier: 1,
    profile: 'growing',
    queries: 'capped',
    start: 'tracked',
  },
  {
    urlId: '904',
    path: '/services/soc',
    title: 'SOC as a service',
    tier: 0,
    profile: 'sharp_drop',
    queries: 'counted',
    start: 'tracked',
  },
  {
    urlId: '905',
    path: '/blog/zero-trust',
    title: 'Zero trust basics',
    tier: 2,
    profile: 'stable',
    queries: 'zero',
    start: 'tracked',
  },
  {
    urlId: '906',
    path: '/about',
    title: 'About us',
    tier: null,
    profile: 'small',
    queries: 'counted',
    start: 'tracked',
  },
  {
    urlId: '907',
    path: '/blog/old-report',
    title: 'Threat report 2023',
    tier: 3,
    profile: 'lost',
    queries: 'unstored',
    start: 'tracked',
  },
  {
    urlId: '908',
    path: '/contact',
    title: 'Contact',
    tier: 1,
    profile: 'stable',
    queries: 'counted',
    start: 'loading',
  },
  {
    urlId: '909',
    path: '/services/pentest',
    title: 'Penetration testing',
    tier: 0,
    profile: 'new',
    queries: 'counted',
    start: 'untracked',
  },
  {
    urlId: '910',
    path: '/blog/incident-response',
    title: 'Incident response plan',
    tier: 1,
    profile: 'growing',
    queries: 'counted',
    start: 'untracked',
  },
  {
    urlId: '911',
    path: '/case-studies',
    title: null,
    tier: 2,
    profile: 'stable',
    queries: 'counted',
    start: 'untracked',
  },
  {
    urlId: '912',
    path: '/careers',
    title: 'Careers',
    tier: null,
    profile: 'small',
    queries: 'counted',
    start: 'untracked',
  },
];

export const pageById = (urlId: string): WorldPage | undefined => PAGES.find((page) => page.urlId === urlId);
export const pageByPath = (path: string): WorldPage | undefined => PAGES.find((page) => page.path === path);

/** The tier id of the page, from the tier list the internal links mock serves. */
export function tierIdOf(page: WorldPage): string | null {
  if (page.tier === null) return null;
  return pageTierViews()[page.tier]?.tier_id ?? null;
}

// -------------------------------------------------------------------------------------------------
// Which pages a project tracks

interface ProjectState {
  /** Tracked url ids with the instant they began; ids with no page are fillers that only take room. */
  tracked: Map<string, string>;
  /** Tracked pages whose history is not fetched yet. */
  loading: Set<string>;
}

const states = new Map<string, ProjectState>();
const STARTED = '2026-11-20T09:12:00Z';

function stateOf(projectId: string): ProjectState {
  const found = states.get(projectId);
  if (found !== undefined) return found;
  const made: ProjectState = { tracked: new Map(), loading: new Set() };
  for (const page of PAGES) {
    if (page.start === 'untracked') continue;
    made.tracked.set(page.urlId, STARTED);
    if (page.start === 'loading') made.loading.add(page.urlId);
  }
  states.set(projectId, made);
  return made;
}

export function resetPageSearchWorld(): void {
  states.clear();
}
onMockReset(resetPageSearchWorld);

export const trackedOf = (projectId: string): ReadonlyMap<string, string> => stateOf(projectId).tracked;
export const isLoading = (projectId: string, urlId: string): boolean => stateOf(projectId).loading.has(urlId);

/** The page's history is fetched the first time its detail is opened (spec D2). */
export function markHistoryReady(projectId: string, urlId: string): void {
  stateOf(projectId).loading.delete(urlId);
}

export function track(projectId: string, urlId: string, at: Date): void {
  stateOf(projectId).tracked.set(urlId, at.toISOString());
}

/** How many of `urlIds` were tracked and are not now. */
export function untrack(projectId: string, urlIds: readonly string[]): number {
  const state = stateOf(projectId);
  return urlIds.filter((urlId) => state.loading.delete(urlId) || state.tracked.delete(urlId)).length;
}

/** Tracks made-up pages until the project tracks `count`, to reach the limit. */
export function fillTracked(projectId: string, count: number): void {
  const { tracked } = stateOf(projectId);
  for (let n = 1; tracked.size < count; n += 1) tracked.set(`filler-${String(n)}`, STARTED);
}

// -------------------------------------------------------------------------------------------------
// Periods

export const finalThrough = (now: number): string =>
  shiftIsoDate(formatIsoDate(new Date(now).toISOString(), PACIFIC), -FINAL_LAG_DAYS);

export const historyFrom = (final: string): string => shiftIsoDate(final, 1 - HISTORY_DAYS);

const lastDayOfMonth = (day: string): string => {
  const [year = 0, month = 1] = day.split('-').map(Number);
  return `${day.slice(0, 8)}${String(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
};

const asWindow = (from: string, to: string): SearchWindow => ({ from, to, days: daysBetween(from, to) });

const isWholeMonth = (from: string, to: string): boolean =>
  from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7) && to === lastDayOfMonth(to);

/** The last calendar month that ends on or before the last final day. */
function lastFullMonth(final: string): SearchWindow {
  const end = final === lastDayOfMonth(final) ? final : shiftIsoDate(`${final.slice(0, 8)}01`, -1);
  return asWindow(`${end.slice(0, 8)}01`, end);
}

export type PeriodResult =
  { window: SearchWindow; compare: SearchWindow | null } | { problem: 'window_too_large' | 'starts_after_end' };

/**
 * The period asked for, cut to the last final day, and the period compared with: a whole calendar month with the
 * month before it, any other period with as many days just before it, or the same dates a year earlier.
 */
export function periodOf(from: string | null, to: string | null, compare: CompareParam, final: string): PeriodResult {
  let window: SearchWindow;
  if (from === null && to === null) {
    window = lastFullMonth(final);
  } else {
    const last = to === null || to > final ? final : to;
    const first = from ?? shiftIsoDate(last, -27);
    if (first > last) return { problem: 'starts_after_end' };
    if (daysBetween(first, last) > MAX_DAYS) return { problem: 'window_too_large' };
    window = asWindow(first, last);
  }
  if (compare === 'none') return { window, compare: null };
  if (compare === 'previous_period' && isWholeMonth(window.from, window.to)) {
    const end = shiftIsoDate(window.from, -1);
    return { window, compare: asWindow(`${end.slice(0, 8)}01`, end) };
  }
  const earlier = comparedPeriod(compare, window.from, window.to);
  return { window, compare: asWindow(earlier.from, earlier.to) };
}

const datesOf = (from: string, to: string): string[] =>
  Array.from({ length: daysBetween(from, to) }, (_, offset) => shiftIsoDate(from, offset));

// -------------------------------------------------------------------------------------------------
// The days

/** A number in [0, 1) that depends only on its three inputs. */
function unit(seed: number, n: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + salt * 7919, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

interface Day {
  clicks: number;
  impressions: number;
  position: number | null;
}

/** The trend stops at 75 days either side of 1 October, so a far period is flat and not absurd. */
const TREND_DAYS = 75;

function dayOf(page: WorldPage, day: string): Day {
  const shape = SHAPES[page.profile];
  const seed = Number(page.urlId);
  const n = dayNumber(day);
  const months = Math.max(-TREND_DAYS, Math.min(TREND_DAYS, n - PIVOT_DAY)) / 30;
  const before = day < PIVOT;
  const impressionsPerDay =
    page.profile === 'new' && before ? 0 : shape.impressions * shape.impressionsGrowth ** months;
  const clicksPerDay =
    (page.profile === 'new' && before) || (page.profile === 'lost' && !before)
      ? 0
      : shape.clicks * shape.clicksGrowth ** months;
  // A fraction is kept by rounding up now and then, so a page of 0.3 clicks a day still has some
  const impressions = Math.floor(impressionsPerDay * (0.8 + 0.4 * unit(seed, n, 1)) + unit(seed, n, 2));
  const clicks = Math.min(impressions, Math.floor(clicksPerDay * (0.8 + 0.4 * unit(seed, n, 3)) + unit(seed, n, 4)));
  const position =
    impressions === 0
      ? null
      : Math.max(1, round(shape.position + shape.drift * months + (unit(seed, n, 5) - 0.5) * 0.6, 1));
  return { clicks, impressions, position };
}

export function seriesOf(urlId: string, from: string, to: string): SeriesPoint[] {
  const page = pageById(urlId);
  return datesOf(from, to).map((date) => ({
    date,
    ...(page === undefined ? { clicks: 0, impressions: 0, position: null } : dayOf(page, date)),
  }));
}

interface Totals {
  clicks: number;
  impressions: number;
  /** Position times impressions, over the days that have a position. */
  positionSum: number;
  positionImpressions: number;
}

function totalsOf(series: readonly SeriesPoint[]): Totals {
  const totals: Totals = { clicks: 0, impressions: 0, positionSum: 0, positionImpressions: 0 };
  for (const point of series) {
    totals.clicks += point.clicks;
    totals.impressions += point.impressions;
    if (point.position !== null) {
      totals.positionSum += point.position * point.impressions;
      totals.positionImpressions += point.impressions;
    }
  }
  return totals;
}

const numbersFrom = (totals: Totals): PageNumbers => ({
  clicks: totals.clicks,
  impressions: totals.impressions,
  ctr: totals.impressions === 0 ? null : round(totals.clicks / totals.impressions, 4),
  position: totals.positionImpressions === 0 ? null : round(totals.positionSum / totals.positionImpressions, 1),
});

export const numbersOf = (urlId: string, from: string, to: string): PageNumbers =>
  numbersFrom(totalsOf(seriesOf(urlId, from, to)));

// -------------------------------------------------------------------------------------------------
// Health: `page_health_v1` (docs/32 section 6.1, backend `domain/page_search.py`), in floating point

const LOST_MIN_CLICKS = 25;
const LOW_CLICKS = 30;
const LOW_IMPRESSIONS = 300;
const MIN_CLICKS = 25;
const MIN_IMPRESSIONS = 500;
const SHARP_DROP = -0.4;
const MOVE = 0.1;
const CTR_FALL = -0.15;
const POSITION_SHIFT = 1.5;
const POSITION_MIN_IMPRESSIONS = 100;

function flagsOf(cur: Totals, prev: Totals, curDays: number, prevDays: number): string[] {
  if (cur.impressions === 0 || prev.impressions === 0) return [];
  const flags: string[] = [];
  if (prev.clicks > 0) {
    const ctr = (cur.clicks * prev.impressions) / (cur.impressions * prev.clicks) - 1;
    const shown = (cur.impressions * prevDays) / (prev.impressions * curDays) - 1;
    if (ctr <= CTR_FALL && shown >= MOVE) flags.push('ctr_fell_impressions_rose');
  }
  if (Math.min(cur.positionImpressions, prev.positionImpressions) >= POSITION_MIN_IMPRESSIONS) {
    const now = cur.positionSum / cur.positionImpressions;
    const earlier = prev.positionSum / prev.positionImpressions;
    if (Math.abs(now - earlier) >= POSITION_SHIFT) flags.push(now > earlier ? 'position_slipped' : 'position_improved');
  }
  return flags;
}

function healthOf(cur: Totals, prev: Totals | null, curDays: number, prevDays: number): PageHealth {
  const only = (verdict: PageHealth['verdict'], extra: Partial<PageHealth> = {}): PageHealth => ({
    verdict,
    basis: 'clicks',
    change: null,
    absolute: 0,
    small: false,
    flags: [],
    ...extra,
  });
  if (prev === null) return only(cur.impressions > 0 ? 'stable' : 'no_data');
  if (cur.impressions === 0 && prev.impressions === 0) return only('no_data');
  if (prev.impressions === 0) return only('new', { absolute: cur.clicks });
  if (prev.clicks >= LOST_MIN_CLICKS && cur.clicks === 0) return only('lost', { change: -1, absolute: -prev.clicks });
  const clicks = cur.clicks + prev.clicks;
  if (clicks < LOW_CLICKS && cur.impressions + prev.impressions < LOW_IMPRESSIONS) return only('low_data');
  const basis = clicks >= LOW_CLICKS ? 'clicks' : 'impressions';
  const minimum = basis === 'clicks' ? MIN_CLICKS : MIN_IMPRESSIONS;
  const now = basis === 'clicks' ? cur.clicks : cur.impressions;
  const before = basis === 'clicks' ? prev.clicks : prev.impressions;
  const expected = (before * curDays) / prevDays;
  const absolute = round(now - expected, 1);
  const material = Math.abs(now - expected) >= minimum;
  const flags = flagsOf(cur, prev, curDays, prevDays);
  if (before === 0) {
    return material ? only('growing', { basis, absolute, flags }) : only('low_data', { basis, absolute, small: true });
  }
  const change = round(now / expected - 1, 4);
  if (!material && Math.abs(change) >= MOVE) return only('low_data', { basis, change, absolute, small: true });
  let verdict: PageHealth['verdict'] = 'stable';
  if (material && change <= SHARP_DROP) verdict = 'sharp_drop';
  else if (material && change <= -MOVE) verdict = 'declining';
  else if (material && change >= MOVE) verdict = 'growing';
  return only(verdict, { basis, change, absolute, flags });
}

export interface PageSearch {
  current: PageNumbers;
  /** Null with no comparison, or when no day of the compared period is inside the page's history. */
  previous: PageNumbers | null;
  health: PageHealth;
  series: SeriesPoint[];
  previousSeries: SeriesPoint[];
}

/**
 * A page's numbers, verdict and series for a period and the period compared with. A compared period that starts
 * before the history is served from the days that are stored, as the API does (backend `previous_totals` and
 * `_points`): the days before the history are 0 with no position, and the totals are the sum of the rest.
 */
export function searchOf(
  urlId: string,
  period: { window: SearchWindow; compare: SearchWindow | null },
  history: string,
): PageSearch {
  const series = seriesOf(urlId, period.window.from, period.window.to);
  const compare = period.compare !== null && period.compare.to >= history ? period.compare : null;
  const previousSeries =
    compare === null
      ? []
      : seriesOf(urlId, compare.from, compare.to).map((point) =>
          point.date < history ? { date: point.date, clicks: 0, impressions: 0, position: null } : point,
        );
  const current = totalsOf(series);
  const previous = compare === null ? null : totalsOf(previousSeries);
  return {
    current: numbersFrom(current),
    previous: previous === null ? null : numbersFrom(previous),
    health: healthOf(current, previous, period.window.days, compare?.days ?? 0),
    series,
    previousSeries,
  };
}

// -------------------------------------------------------------------------------------------------
// Queries, the breakdown and the Cannibalization reservation

const monthKey = (day: string): number => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7));
const countOf = (page: WorldPage, month: number): number => 40 + Math.floor(unit(Number(page.urlId), month, 9) * 1400);

/**
 * The page's number of queries, as the API reads it from stored counts: only for a whole calendar month, and for the
 * month before it when that is compared. Anything else was never stored (null, which is not 0).
 */
export function queriesOf(urlId: string, from: string, to: string, compare: CompareParam): PageQueries | null {
  const page = pageById(urlId);
  if (page === undefined || page.queries === 'unstored' || !isWholeMonth(from, to)) return null;
  if (page.queries === 'capped') return { value: QUERIES_CAP, previous: null, capped: true };
  const month = monthKey(from);
  return {
    value: page.queries === 'zero' ? 0 : countOf(page, month),
    previous: compare === 'previous_period' ? countOf(page, month - 1) : null,
    capped: false,
  };
}

const CANNIBALIZED: Readonly<Record<string, PageCannibalization>> = {
  '902': { keywords: 3, likely: 1, co_ranking: 1, unstable: 1 },
  '904': { keywords: 2, likely: 0, co_ranking: 2, unstable: 0 },
  '905': { keywords: 0, likely: 0, co_ranking: 0, unstable: 0 },
};

/** Null for every page, as the API answers until the Cannibalization work fills it; `filled` shows three pages with it. */
export const cannibalizationOf = (urlId: string, filled: boolean): PageCannibalization | null =>
  filled ? (CANNIBALIZED[urlId] ?? null) : null;

interface Split {
  key: string;
  weight: number;
  /** Which period's rows the key is in (a query that is new, or one that dropped out of the top 100). */
  in: 'both' | 'current' | 'previous';
}

const QUERY_SPLIT: readonly Split[] = [
  { key: 'soc as a service', weight: 30, in: 'both' },
  { key: 'managed soc pricing', weight: 20, in: 'both' },
  { key: 'what is a soc', weight: 16, in: 'both' },
  { key: 'soc 2 compliance', weight: 12, in: 'both' },
  { key: 'security operations center', weight: 10, in: 'both' },
  { key: '24x7 threat monitoring', weight: 7, in: 'current' },
  { key: 'soc checklist 2023', weight: 5, in: 'previous' },
];
const COUNTRY_SPLIT: readonly Split[] = [
  { key: 'USA', weight: 46, in: 'both' },
  { key: 'IND', weight: 28, in: 'both' },
  { key: 'GBR', weight: 16, in: 'both' },
  { key: 'DEU', weight: 10, in: 'both' },
];
const DEVICE_SPLIT: readonly Split[] = [
  { key: 'DESKTOP', weight: 58, in: 'both' },
  { key: 'MOBILE', weight: 39, in: 'both' },
  { key: 'TABLET', weight: 3, in: 'both' },
];
const SPLITS: Record<BreakdownDimension, readonly Split[]> = {
  query: QUERY_SPLIT,
  country: COUNTRY_SPLIT,
  device: DEVICE_SPLIT,
};

/** `total` shared by `weights`: each part rounded down, the last one takes the rest, so the parts add up to `total`. */
function share(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((all, weight) => all + weight, 0);
  const parts = weights.map((weight) => Math.floor((total * weight) / sum));
  const last = parts.length - 1;
  parts[last] = total - parts.slice(0, last).reduce((all, part) => all + part, 0);
  return parts;
}

const rowsOf = (series: readonly SeriesPoint[], kept: readonly Split[], fraction: number): Map<string, PageNumbers> => {
  const totals = totalsOf(series);
  const position = numbersFrom(totals).position;
  const weights = kept.map((one) => one.weight);
  const clicks = share(Math.round(totals.clicks * fraction), weights);
  const impressions = share(Math.round(totals.impressions * fraction), weights);
  return new Map(
    kept.map((one, index): [string, PageNumbers] => {
      const shownClicks = clicks[index] ?? 0;
      const shownImpressions = impressions[index] ?? 0;
      return [
        one.key,
        {
          clicks: shownClicks,
          impressions: shownImpressions,
          ctr: shownImpressions === 0 ? null : round(shownClicks / shownImpressions, 4),
          position: position === null ? null : round(position + index * 0.4, 1),
        },
      ];
    }),
  );
};

export interface PageBreakdown {
  rows: { key: string; current: PageNumbers | null; previous: PageNumbers | null }[];
  /** The listed rows' clicks over the page's clicks; null when the page had none. */
  coverage: number | null;
}

/** The page's clicks split over fixed queries (88 percent of them), locations or devices, for both periods. */
export function breakdownOf(
  urlId: string,
  dimension: BreakdownDimension,
  period: { window: SearchWindow; compare: SearchWindow | null },
): PageBreakdown {
  const split = SPLITS[dimension];
  const fraction = dimension === 'query' ? QUERY_COVERAGE : 1;
  const side = (window: SearchWindow | null, kind: 'current' | 'previous'): Map<string, PageNumbers> =>
    window === null
      ? new Map()
      : rowsOf(
          seriesOf(urlId, window.from, window.to),
          split.filter((one) => one.in === 'both' || one.in === kind),
          fraction,
        );
  const now = side(period.window, 'current');
  const before = side(period.compare, 'previous');
  const total = numbersOf(urlId, period.window.from, period.window.to).clicks;
  const rows = split
    .filter((one) => now.has(one.key) || before.has(one.key))
    .map((one) => ({ key: one.key, current: now.get(one.key) ?? null, previous: before.get(one.key) ?? null }))
    .sort(
      (a, b) =>
        (b.current?.clicks ?? 0) - (a.current?.clicks ?? 0) || (b.previous?.clicks ?? 0) - (a.previous?.clicks ?? 0),
    );
  const shown = [...now.values()].reduce((all, one) => all + one.clicks, 0);
  return { rows, coverage: total === 0 ? null : round(shown / total, 2) };
}
