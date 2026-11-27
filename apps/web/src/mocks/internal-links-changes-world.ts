import {
  alertSettingsOf,
  assignedTier,
  crawledPages,
  crawlsOf,
  edgeRows,
  HOST,
  linksScenario,
  pageRow,
  weakOutlinkIds,
  type FixturePage,
  type RunView,
} from './internal-links-world';
import type { Placement } from '@/lib/internal-links/scopes';
import type {
  ChangeKind,
  ChangeLink,
  ChangeLinkPage,
  ChangeOnly,
  ChangePage,
  ChangeScope,
  ChangesState,
  ChangesSummary,
  CrawlRun,
  GscState,
  MovedPage,
  MovedPageList,
  PageChange,
  PageDetailExtras,
  PageExtras,
  PageInclude,
  Worklists,
} from '@/lib/internal-links/types';

/**
 * What the crawl history of the mock says about the Eventus pages (plan 04 routes): the links the latest crawl lost
 * and gained against the one before it, the numbers next to a page (tracked keywords, AI citations, anchors, Search
 * Console clicks) and the worklists that need them. Everything is derived from the fixture graph of
 * `internal-links-world.ts` and the tables below, so it is the same on every run; the world's switches
 * (`setLinksScenario`) put it in the other states of the contract.
 *
 * No equity figure is invented here: `equity_points` is null in every answer.
 */

// ---------------------------------------------------------------------------------------------
// What the crawls changed

type LostSeed = readonly [from: string, to: string, anchor: string, stillLinkedBy: Placement | null];
type AddedSeed = readonly [from: string, to: string, anchor: string];
interface DepthChange {
  state: 'lost' | 'found' | null;
  delta: number | null;
}
interface ChangeSet {
  lost: readonly LostSeed[];
  added: readonly AddedSeed[];
  /** The pages the crawl found for the first time. */
  newPaths: readonly string[];
  depth: ReadonlyMap<string, DepthChange>;
  pagesLost: number;
}

/** Editorial links the previous crawl had that the latest one does not, the most important first. */
const LOST: readonly LostSeed[] = [
  ['/blog/what-is-a-soc', '/services/managed-detection-and-response', 'managed detection and response', null],
  ['/blog/what-is-a-soc', '/pricing', 'compare plans', 'navigation'],
  ['/blog/soc-vs-mdr', '/services/soc-as-a-service', 'our SOC service', null],
  ['/about', '/contact', 'Talk to us', null],
  ['/compare/eventus-vs-in-house-soc', '/services', 'managed security services', null],
  ['/blog', '/blog/threat-report-2022', 'Threat report 2022', null],
];
/** Editorial links the latest crawl has that the previous one did not. */
const ADDED: readonly AddedSeed[] = [
  ['/blog/vapt-checklist', '/services/vapt', 'VAPT services'],
  ['/compare/eventus-vs-in-house-soc', '/services/soc-as-a-service', 'our SOC'],
];

const LATEST: ChangeSet = {
  lost: LOST,
  added: ADDED,
  newPaths: ['/compare/eventus-vs-in-house-soc'],
  depth: new Map<string, DepthChange>([
    ['/services/vapt', { state: null, delta: -1 }],
    ['/blog/vapt-checklist', { state: null, delta: 1 }],
    ['/partners', { state: 'lost', delta: null }],
  ]),
  pagesLost: 1,
};
/** The crawl before the latest was compared with the one before it: a smaller change. */
const BEFORE: ChangeSet = {
  lost: LOST.slice(0, 2),
  added: ADDED.slice(0, 1),
  newPaths: [],
  depth: new Map(),
  pagesLost: 0,
};
const NOTHING: ChangeSet = { lost: [], added: [], newPaths: [], depth: new Map(), pagesLost: 0 };

/** A crawl is compared with the one before it once enrichment is done; the oldest crawl has none to compare with. */
const isCompared = (run: CrawlRun): boolean => run.previous_run_id !== null && run.enrich_state === 'done';

function changeSetOf(view: RunView): ChangeSet {
  if (!isCompared(view.run)) return NOTHING;
  if (view.rank === 0) return linksScenario().noChanges ? NOTHING : LATEST;
  return view.rank === 1 ? BEFORE : NOTHING;
}

/**
 * The backend also says `ready` or `first_crawl` once the enrichment phase has reached `anchors`, `mentions` or
 * `done`, even while `enrich_state` is still `running` or `failed`. The mock has no phase and keys on `enrich_state`
 * alone, so it never produces those combinations.
 */
function summaryState(run: CrawlRun): ChangesState {
  if (run.enrich_state === 'done') return run.previous_run_id === null ? 'first_crawl' : 'ready';
  return run.enrich_state === 'failed' ? 'unavailable' : 'pending';
}

export const pageOfPath = (path: string): FixturePage => {
  const found = crawledPages().find((page) => page.path === path);
  if (found === undefined) throw new Error(`The mock crawl has no page ${path}`);
  return found;
};

/** The page card of a fixture page, with its tier of today. */
export function changePage(path: string): ChangePage {
  const page = pageOfPath(path);
  return { url_id: page.id, url: `${HOST}${page.path}`, path: page.path, tier: assignedTier(page).tier };
}

/** The tier position of a page card, 99 for an untiered page, as the API orders and counts them. */
export const position = (tier: ChangePage['tier']): number => (tier === null ? 99 : Number(tier.code.slice(1)));
const priorityOf = (tier: ChangePage['tier']): ChangeLink['priority'] =>
  position(tier) === 1 ? 'lost_to_t1' : position(tier) === 2 ? 'lost_to_t2' : 'lower';

const byImportance = (a: ChangeLink, b: ChangeLink): number =>
  position(a.target.tier) - position(b.target.tier) ||
  a.source.path.localeCompare(b.source.path) ||
  a.target.path.localeCompare(b.target.path);

function lostRows(set: ChangeSet): ChangeLink[] {
  return set.lost
    .map(([from, to, anchor, still]): ChangeLink => {
      const target = changePage(to);
      return {
        source: changePage(from),
        target,
        anchor,
        placement: 'content',
        priority: priorityOf(target.tier),
        still_linked_by: still,
      };
    })
    .sort(byImportance);
}

function addedRows(set: ChangeSet): ChangeLink[] {
  return set.added
    .map(([from, to, anchor]): ChangeLink => ({
      source: changePage(from),
      target: changePage(to),
      anchor,
      placement: 'content',
      priority: 'none',
      still_linked_by: null,
    }))
    .sort(byImportance);
}

export function changesSummary(projectId: string, view: RunView, now = Date.now()): ChangesSummary {
  const { run } = view;
  const set = changeSetOf(view);
  const alerts = alertSettingsOf(projectId);
  const lost = lostRows(set);
  const top = lost.filter((row) => position(row.target.tier) <= alerts.max_position);
  const previous = crawlsOf(projectId, now).find((candidate) => candidate.run_id === run.previous_run_id);
  return {
    run_id: run.run_id,
    previous_run_id: run.previous_run_id,
    previous_finished_at: previous?.finished_at ?? null,
    state: summaryState(run),
    // False when the links of this crawl or of the one before were dropped: the link counts are then zero, not measured
    links_compared: run.links_available && previous?.links_available !== false,
    editorial_lost: lost.length,
    editorial_added: set.added.length,
    all_lost: lost.filter((row) => row.still_linked_by === null).length,
    all_added: set.added.length,
    lost_to_top: top.length,
    important_max_position: alerts.max_position,
    pages_added: set.newPaths.length,
    pages_lost: set.pagesLost,
    alert:
      alerts.enabled && top.length >= alerts.threshold
        ? {
            lost_links: top.length,
            max_position: alerts.max_position,
            threshold: alerts.threshold,
            channel: alerts.channel,
            delivery_state: alerts.channel === 'app' ? 'shown_in_app' : 'channel_unavailable',
          }
        : null,
  };
}

export interface ChangeLinksQuery {
  change: ChangeKind;
  linkScope: ChangeScope;
  only: ChangeOnly;
  offset: number;
  limit: number;
}

/** Every row of the change, scope and importance asked for (the list and its CSV share them). */
function selectedChanges(projectId: string, view: RunView, query: ChangeLinksQuery): ChangeLink[] {
  const set = changeSetOf(view);
  const base = query.change === 'lost' ? lostRows(set) : addedRows(set);
  // The all-links scope holds the links no other placement still carries
  const scoped = query.linkScope === 'all' ? base.filter((row) => row.still_linked_by === null) : base;
  const max = alertSettingsOf(projectId).max_position;
  return query.only === 'top' ? scoped.filter((row) => position(row.target.tier) <= max) : scoped;
}

export function changeLinks(projectId: string, view: RunView, query: ChangeLinksQuery): ChangeLinkPage {
  const rows = selectedChanges(projectId, view, query);
  return {
    data: rows.slice(query.offset, query.offset + query.limit),
    meta: {
      run_id: view.run.run_id,
      previous_run_id: view.run.previous_run_id,
      change: query.change,
      link_scope: query.linkScope,
      only: query.only,
      total: rows.length,
      truncated: false,
    },
  };
}

// `PLACEMENT_LABEL` of backend/src/idraft/api/internal_links/changes.py
const PLACEMENT_LABEL: Readonly<Record<Placement, string>> = {
  content: 'Content',
  auto_generated: 'Auto-generated',
  navigation: 'Navigation',
  footer: 'Footer',
  breadcrumb: 'Breadcrumb',
  header: 'Header',
  sidebar: 'Sidebar',
};

/** The rows of `changes/links?format=csv`: the header, then every row of the change (no paging). */
export function changeLinksCsv(projectId: string, view: RunView, query: ChangeLinksQuery): string[][] {
  const label = query.change === 'lost' ? 'Lost' : 'Added';
  return [
    ['Change', 'Source', 'Target', 'Anchor', 'Link type', 'Target tier', 'Still linked from'],
    ...selectedChanges(projectId, view, query).map((row) => [
      label,
      row.source.path,
      row.target.path,
      row.anchor,
      PLACEMENT_LABEL[row.placement],
      row.target.tier?.code ?? 'Untiered',
      row.still_linked_by === null ? '' : PLACEMENT_LABEL[row.still_linked_by],
    ]),
  ];
}

/** The change of links in a page's editorial links: one more for each link added to it, one less for each lost. */
export function pageDelta(view: RunView, page: FixturePage): number {
  const set = changeSetOf(view);
  return set.added.filter(([, to]) => to === page.path).length - set.lost.filter(([, to]) => to === page.path).length;
}

/**
 * What changed for one page, or null when that is not known: the crawl has no previous crawl, or its comparison
 * is not done yet. A compared page that did not move shows zeros.
 */
export function pageChangeOf(view: RunView, page: FixturePage): PageChange | null {
  if (!isCompared(view.run)) return null;
  const set = changeSetOf(view);
  const isNew = set.newPaths.includes(page.path);
  const depth = set.depth.get(page.path);
  return {
    is_new: isNew,
    editorial_in_delta: isNew ? null : pageDelta(view, page),
    equity_points: null,
    depth_state: depth?.state ?? null,
    depth_delta: isNew ? null : depth === undefined ? 0 : depth.delta,
  };
}

export function movedPages(view: RunView, limit: number): MovedPageList {
  const rows = crawledPages()
    .filter((page) => page.status === 200)
    .flatMap((page) => {
      const change = pageChangeOf(view, page);
      if (change === null || change.is_new) return [];
      const moved =
        (change.editorial_in_delta ?? 0) !== 0 || (change.depth_delta ?? 0) !== 0 || change.depth_state !== null;
      return moved ? [{ page, change }] : [];
    })
    .sort(
      (a, b) =>
        Math.abs(b.change.editorial_in_delta ?? 0) - Math.abs(a.change.editorial_in_delta ?? 0) ||
        Math.abs(b.change.depth_delta ?? 0) - Math.abs(a.change.depth_delta ?? 0) ||
        a.page.path.localeCompare(b.page.path),
    )
    .slice(0, limit)
    .map(({ page, change }): MovedPage => {
      const row = pageRow(page, 'editorial');
      return {
        page: changePage(page.path),
        editorial_in: row.linking_pages,
        editorial_in_delta: change.editorial_in_delta,
        equity_points: null,
        depth: row.click_depth,
        depth_state: change.depth_state,
        depth_delta: change.depth_delta,
      };
    });
  return { data: rows, meta: { run_id: view.run.run_id, previous_run_id: view.run.previous_run_id } };
}

// ---------------------------------------------------------------------------------------------
// The worklists that need the history

/** The pages in an important tier that lost an editorial link (the `lost_links_top` worklist). */
export function lostLinksTopIds(projectId: string, view: RunView): ReadonlySet<string> {
  const max = alertSettingsOf(projectId).max_position;
  return new Set(
    lostRows(changeSetOf(view))
      .filter((row) => position(row.target.tier) <= max)
      .map((row) => row.target.url_id),
  );
}

/**
 * The worklist counts of a crawl: `base` (the page graph's counts) with the two the history gives. The counts that
 * come from the crawl's links (broken and redirected, links to non-indexable pages, weak outlinks) are zero for a
 * crawl whose links were dropped, as in the backend.
 */
export function worklistCounts(projectId: string, view: RunView, base: Worklists): Worklists {
  const linked = view.run.links_available;
  return {
    ...base,
    run_id: view.run.run_id,
    lost_links_top: lostLinksTopIds(projectId, view).size,
    weak_outlinks: linked ? weakOutlinkIds().length : 0,
    broken_and_redirected: linked ? base.broken_and_redirected : 0,
    links_to_non_indexable: linked ? base.links_to_non_indexable : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// The numbers next to a page

/** The day of the newest rank and citation check: those columns are today's numbers whichever crawl is in view. */
const CHECKED_ON = '2026-11-18';

interface KeywordFact {
  keyword: string;
  rank: number | null;
  change: number | null;
  volume: number | null;
}

/** The tracked keywords of the pages that have any, by path. */
const KEYWORDS: Readonly<Record<string, readonly KeywordFact[]>> = {
  '/services/soc-as-a-service': [
    { keyword: 'soc as a service', rank: 4, change: 1, volume: 1900 },
    { keyword: 'managed soc', rank: 9, change: 0, volume: 880 },
    { keyword: 'soc service provider', rank: null, change: null, volume: 590 },
  ],
  '/services/managed-detection-and-response': [
    { keyword: 'managed detection and response', rank: 7, change: 2, volume: 5400 },
    { keyword: 'mdr services', rank: 15, change: -3, volume: 1300 },
  ],
  '/services/vapt': [{ keyword: 'vapt services', rank: 11, change: 0, volume: 1600 }],
  '/pricing': [{ keyword: 'managed soc pricing', rank: 6, change: 1, volume: 320 }],
  '/blog/what-is-a-soc': [{ keyword: 'what is a soc', rank: 5, change: 0, volume: 14800 }],
  '/blog/soc-vs-mdr': [{ keyword: 'soc vs mdr', rank: 5, change: 1, volume: 2400 }],
  '/blog/vapt-checklist': [{ keyword: 'vapt checklist', rank: 18, change: -2, volume: 720 }],
  // The same redirected page still ranks for a keyword (the Issues page finds it as a broken page that ranks)
  '/services/penetration-testing': [{ keyword: 'penetration testing services', rank: 12, change: -2, volume: 1200 }],
};

/** The tracked keywords of a page, best rank first and the ones that do not rank last (the API's order). */
export const keywordsOf = (page: Pick<FixturePage, 'path'>): KeywordFact[] =>
  [...(KEYWORDS[page.path] ?? [])].sort(
    (a, b) =>
      Number(a.rank === null) - Number(b.rank === null) ||
      (a.rank ?? 0) - (b.rank ?? 0) ||
      a.keyword.localeCompare(b.keyword),
  );

function keywordSummary(page: FixturePage): NonNullable<PageExtras['keywords']> {
  const rows = keywordsOf(page);
  const ranks = rows.flatMap((row) => (row.rank === null ? [] : [row.rank]));
  const volumes = rows.flatMap((row) => (row.volume === null ? [] : [row.volume]));
  return {
    tracked: rows.length,
    ranking: ranks.length,
    average_rank:
      ranks.length === 0 ? null : Math.round((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length) * 10) / 10,
    best_volume: volumes.length === 0 ? null : Math.max(...volumes),
    rank_as_of: ranks.length === 0 ? null : CHECKED_ON,
  };
}

/** Answers in 28 days that cited the page, per engine; today's numbers whichever crawl is in view. */
const CITATIONS: Readonly<Record<string, readonly [chatgpt: number, gemini: number, aiMode: number]>> = {
  '/services/soc-as-a-service': [5, 3, 2],
  '/services/managed-detection-and-response': [3, 2, 0],
  '/pricing': [1, 0, 0],
  '/blog/what-is-a-soc': [4, 2, 0],
  '/blog/soc-vs-mdr': [2, 1, 1],
};

function citationsOf(page: FixturePage): NonNullable<PageExtras['citations']> {
  const [chatgpt, gemini, aiMode] = CITATIONS[page.path] ?? [0, 0, 0];
  return { chatgpt, gemini, ai_mode: aiMode, total: chatgpt + gemini + aiMode, citations_as_of: CHECKED_ON };
}

/** Search Console clicks and impressions over the 28 days before the latest crawl, by path. */
const GSC_DAYS: Readonly<Record<string, readonly [clicks: number, impressions: number]>> = {
  '/': [3100, 41200],
  '/services/soc-as-a-service': [2400, 31000],
  '/services/managed-detection-and-response': [540, 9800],
  '/pricing': [960, 12000],
  '/contact': [420, 5200],
  '/blog/what-is-a-soc': [1810, 52000],
  '/blog/soc-vs-mdr': [640, 19800],
  '/blog/vapt-checklist': [210, 6400],
  '/blog': [150, 3900],
  // A redirected page Google still sends visitors to (the Issues page finds it as a broken page with clicks)
  '/services/penetration-testing': [180, 3100],
};
export const GSC_WINDOW = { start: '2026-10-18', end: '2026-11-14' } as const;

/** The clicks of a page over the window: none while Search Console is pending or not connected. */
export const gscClicksOf = (page: Pick<FixturePage, 'path'>): number =>
  linksScenario().gsc === 'ok' ? (GSC_DAYS[page.path]?.[0] ?? 0) : 0;

export const gscState = (): GscState => linksScenario().gsc;

function gscOf(page: FixturePage): NonNullable<PageExtras['gsc']> {
  const state = linksScenario().gsc;
  if (state !== 'ok') {
    return { state, clicks: null, impressions: null, window_start: null, window_end: null };
  }
  // A page with no day in the window counts zero, not nothing
  const [clicks, impressions] = GSC_DAYS[page.path] ?? [0, 0];
  return { state, clicks, impressions, window_start: GSC_WINDOW.start, window_end: GSC_WINDOW.end };
}

// ---------------------------------------------------------------------------------------------
// Anchors

/** `GENERIC_ANCHORS` of backend/src/idraft/crawl/anchors.py */
const GENERIC_ANCHORS: ReadonlySet<string> = new Set([
  'click here',
  'read more',
  'learn more',
  'here',
  'this',
  'more',
  'link',
  'see more',
  'find out more',
  'details',
]);
/** More than half of the editorial anchors, with at least two links (spec 7.10). */
const GENERIC_MIN_LINKS = 2;
const QUOTES = /^[\s"'“‘”’]+|[\s"'“‘”’]+$/g;
const TOP_ANCHORS = 5;

interface AnchorGroup {
  text: string;
  key: string;
  count: number;
  generic: boolean;
}

/** The editorial anchors in to a page, grouped by their trimmed lower case text, the most used first. */
function anchorGroups(page: FixturePage): AnchorGroup[] {
  const groups = new Map<string, AnchorGroup>();
  for (const edge of edgeRows('editorial')) {
    if (edge.target.url_id !== page.id || edge.source.url_id === page.id) continue;
    const text = edge.anchor.replace(QUOTES, '');
    const key = text.toLowerCase();
    const found = groups.get(key);
    if (found === undefined) groups.set(key, { text, key, count: edge.occurrences, generic: GENERIC_ANCHORS.has(key) });
    else {
      found.count += edge.occurrences;
      if (text < found.text) found.text = text;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

interface AnchorFigures {
  total: number;
  generic: number;
}

function anchorFigures(groups: readonly AnchorGroup[]): AnchorFigures {
  return {
    total: groups.reduce((sum, group) => sum + group.count, 0),
    generic: groups.filter((group) => group.generic).reduce((sum, group) => sum + group.count, 0),
  };
}

/** A page whose editorial anchors are mostly generic words: the `generic_anchors` flag. */
export function hasGenericAnchors(page: FixturePage): boolean {
  const { total, generic } = anchorFigures(anchorGroups(page));
  return total >= GENERIC_MIN_LINKS && generic * 2 > total;
}

/** Whether a tracked keyword and the anchor texts of a page overlap (one contains the other), generic texts apart. */
function matchesKeyword(page: FixturePage, groups: readonly AnchorGroup[]): boolean | null {
  const words = keywordsOf(page).map((row) => row.keyword.toLowerCase());
  if (words.length === 0) return null;
  return groups.some(
    (group) =>
      group.key !== '' && !group.generic && words.some((word) => word.includes(group.key) || group.key.includes(word)),
  );
}

function anchorSummary(page: FixturePage): NonNullable<PageExtras['anchors']> {
  const groups = anchorGroups(page);
  const { total, generic } = anchorFigures(groups);
  return {
    total,
    distinct: groups.length,
    generic,
    generic_share: total === 0 ? 0 : generic / total,
    // A page with no editorial link in matches no keyword, if it tracks any
    matches_keyword: total === 0 ? (keywordsOf(page).length > 0 ? false : null) : matchesKeyword(page, groups),
  };
}

function anchorDetail(page: FixturePage, dropped: boolean): PageDetailExtras['anchors'] {
  const groups = anchorGroups(page);
  const { total, generic } = anchorFigures(groups);
  const share = total === 0 ? 0 : generic / total;
  // A crawl whose links are gone keeps only the stored counts: no texts, no distinct count, no keyword match
  if (dropped) return { total, distinct: null, generic, generic_share: share, matches_keyword: null, top: null };
  if (total === 0) {
    const tracked = keywordsOf(page).length > 0;
    return { total: 0, distinct: 0, generic: 0, generic_share: 0, matches_keyword: tracked ? false : null, top: [] };
  }
  return {
    total,
    distinct: groups.length,
    generic,
    generic_share: share,
    matches_keyword: matchesKeyword(page, groups),
    top: groups
      .slice(0, TOP_ANCHORS)
      .map((group) => ({ text: group.text, count: group.count, generic: group.generic })),
  };
}

// ---------------------------------------------------------------------------------------------
// Extras

/** The parts of a page row asked for with `include`. */
export function pageExtras(view: RunView, page: FixturePage, include: readonly PageInclude[]): PageExtras {
  const dropped = !view.run.links_available;
  return {
    ...(include.includes('changes') ? { change: pageChangeOf(view, page) } : {}),
    ...(include.includes('keywords') ? { keywords: keywordSummary(page) } : {}),
    ...(include.includes('citations') ? { citations: citationsOf(page) } : {}),
    // A crawl without its links keeps no anchor list: the column shows nothing
    ...(include.includes('anchors') ? { anchors: dropped ? null : anchorSummary(page) } : {}),
    ...(include.includes('gsc') ? { gsc: gscOf(page) } : {}),
  };
}

/** Every part, for the page inspector. */
export function pageDetailExtras(view: RunView, page: FixturePage): PageDetailExtras {
  return {
    anchors: anchorDetail(page, !view.run.links_available),
    change: pageChangeOf(view, page),
    citations: citationsOf(page),
    gsc: gscOf(page),
    keywords: keywordsOf(page).map((fact) => ({ ...fact, rank_as_of: fact.rank === null ? null : CHECKED_ON })),
  };
}
