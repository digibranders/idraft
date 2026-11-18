import { gscClicksOf, gscState, keywordsOf } from './internal-links-changes-world';
import {
  assignedTier,
  crawledPage,
  crawledPages,
  edgeRows,
  HOST,
  linksScenario,
  linksWorld,
  tierRef,
  type FixturePage,
  type RunView,
} from './internal-links-world';
import { onMockReset } from './state';
import type {
  ChangePage,
  EdgeRow,
  Opportunity,
  OpportunityPage,
  OpportunityPair,
  OpportunityStatus,
  Route,
  Routes,
  SuggestionSelection,
  TierRef,
  TierSuggestionList,
  TierSuggestionRow,
} from '@/lib/internal-links/types';

/**
 * Opportunities, suggested tiers and routes of the mock (plan 04 routes), over the fixture graph of
 * `internal-links-world.ts`. The suggestions run the backend's rule (`crawl/suggest.py`) on the clicks and keyword
 * ranks of `internal-links-changes-world.ts`; the routes are the backend's level by level search.
 */

const pageOfPath = (path: string): FixturePage => {
  const found = crawledPages().find((page) => page.path === path);
  if (found === undefined) throw new Error(`The mock crawl has no page ${path}`);
  return found;
};

function changePage(page: FixturePage): ChangePage {
  return { url_id: page.id, url: `${HOST}${page.path}`, path: page.path, tier: assignedTier(page).tier };
}

const position = (tier: TierRef | null): number => (tier === null ? 99 : Number(tier.code.slice(1)));

// ---------------------------------------------------------------------------------------------
// Opportunities

type Mention = readonly [from: string, to: string, phrase: string, context: string, origin: Opportunity['origin']];

/** Pages that mention another page's topic without an editorial link to it (none of these links exists in the crawl). */
const MENTIONS: readonly Mention[] = [
  [
    '/blog/what-is-a-soc',
    '/services/managed-detection-and-response',
    'managed detection and response',
    'A managed detection and response team watches your logs around the clock instead of waiting for a monthly review.',
    'keyword',
  ],
  [
    '/blog/vapt-checklist',
    '/pricing',
    'managed soc pricing',
    'Teams often ask what managed soc pricing looks like before they agree to a first test.',
    'keyword',
  ],
  [
    '/blog/soc-vs-mdr',
    '/services/soc-as-a-service',
    'soc as a service',
    'Smaller teams often choose soc as a service because they cannot staff a night shift.',
    'keyword',
  ],
  [
    '/about',
    '/contact',
    'contact our team',
    'If you want to discuss a project, contact our team and we reply to every request within a day.',
    'anchor',
  ],
  [
    '/blog/threat-report-2022',
    '/services/vapt',
    'vapt services',
    'Most of the intrusions in this report would have been found by regular vapt services.',
    'keyword',
  ],
  [
    '/blog',
    '/services',
    'managed security services',
    'Our managed security services cover monitoring, testing and response for growing teams.',
    'anchor',
  ],
  [
    '/blog/what-is-a-soc',
    '/compare/eventus-vs-in-house-soc',
    'in-house SOC',
    'Building an in-house SOC takes a year and a team of at least eight people.',
    'anchor',
  ],
  [
    '/blog/soc-vs-mdr',
    '/blog',
    'security blog',
    'We cover this topic again in our security blog every month.',
    'anchor',
  ],
];

const pairKey = (source: string, target: string): string => `${source}>${target}`;

let decisions = new Map<string, Exclude<OpportunityStatus, 'open'>>();
let dismissedSuggestions = new Set<string>();
onMockReset(() => {
  decisions = new Map();
  dismissedSuggestions = new Set();
});

/** Every opportunity of the crawl with the decisions made so far (a decision belongs to the project, not to a crawl). */
function allOpportunities(): Opportunity[] {
  if (linksScenario().noOpportunities) return [];
  return MENTIONS.map(([from, to, phrase, context, origin]): Opportunity => {
    const source = changePage(pageOfPath(from));
    const target = changePage(pageOfPath(to));
    const key = pairKey(source.url_id, target.url_id);
    return {
      key,
      source,
      target,
      phrase,
      context,
      anchor: phrase,
      // The equity of the source page is never given
      source_equity_share: null,
      status: decisions.get(key) ?? 'open',
      origin,
    };
  }).sort(
    (a, b) =>
      position(a.target.tier) - position(b.target.tier) ||
      a.source.path.localeCompare(b.source.path) ||
      a.target.path.localeCompare(b.target.path),
  );
}

export interface OpportunityQuery {
  status: OpportunityStatus | null;
  /** A tier position as text, or `none` for pages without a tier. */
  tier: string | null;
  q: string | null;
  offset: number;
  limit: number;
}

function filtered(query: Omit<OpportunityQuery, 'offset' | 'limit'>): Opportunity[] {
  const needle = query.q?.toLowerCase() ?? null;
  return allOpportunities().filter(
    (row) =>
      (query.status === null || row.status === query.status) &&
      (query.tier === null ||
        (query.tier === 'none' ? row.target.tier === null : position(row.target.tier) === Number(query.tier))) &&
      (needle === null ||
        row.source.path.toLowerCase().includes(needle) ||
        row.target.path.toLowerCase().includes(needle)),
  );
}

export function opportunities(view: RunView, query: OpportunityQuery): OpportunityPage {
  const all = allOpportunities();
  const rows = filtered(query);
  return {
    data: rows.slice(query.offset, query.offset + query.limit),
    meta: {
      run_id: view.run.run_id,
      total: rows.length,
      counts: {
        open: all.filter((row) => row.status === 'open').length,
        accepted: all.filter((row) => row.status === 'accepted').length,
        dismissed: all.filter((row) => row.status === 'dismissed').length,
      },
    },
  };
}

/**
 * Accepts or dismisses pairs of the latest crawl's list, or reopens pairs that have a decision. `matched` is the
 * number of submitted pairs that qualified, `changed` the number whose state changed.
 */
export function decideOpportunities(
  items: readonly OpportunityPair[],
  status: OpportunityStatus,
): { matched: number; changed: number } {
  const listed = new Set(allOpportunities().map((row) => row.key));
  let matched = 0;
  let changed = 0;
  for (const key of new Set(items.map((item) => pairKey(item.source_url_id, item.target_url_id)))) {
    const before = decisions.get(key);
    // A reopen takes any pair that has a decision; the others take the pairs the list shows
    if (status === 'open' ? before === undefined : !listed.has(key)) continue;
    matched += 1;
    if (before === status || (status === 'open' && before === undefined)) continue;
    if (status === 'open') decisions.delete(key);
    else decisions.set(key, status);
    changed += 1;
  }
  return { matched, changed };
}

const CSV_HEADER = ['Source URL', 'Target URL', 'Anchor', 'Context', 'Status'];
const csvRows = (rows: readonly Opportunity[]): string[][] => [
  CSV_HEADER,
  ...rows.map((row) => [row.source.url, row.target.url, row.anchor, row.context, row.status]),
];

/** The rows of `opportunities?format=csv`: the list as it is filtered, without paging. */
export const opportunitiesCsv = (query: Omit<OpportunityQuery, 'offset' | 'limit'>): string[][] =>
  csvRows(filtered(query));

/** The rows of `opportunities?export=planned`: the accepted rows, or every open row when none is accepted. */
export function plannedFixesCsv(): string[][] {
  const accepted = filtered({ status: 'accepted', tier: null, q: null });
  return csvRows(accepted.length > 0 ? accepted : filtered({ status: 'open', tier: null, q: null }));
}

// ---------------------------------------------------------------------------------------------
// Tier suggestions

const BUSIEST_SHARE = 0.2;
const RANK_MAX = 5;
const VOLUME_MIN = 2000;
const THIRD_TIER_CLICKS = 50;

const isLive = (page: FixturePage): boolean => page.status === 200 && (page.indexable ?? true);

/** `suggest_tiers` of the backend: the top fifth by clicks or a top 5 rank for 2,000 searches, T3 or lower, get T2. */
function suggestionRows(): TierSuggestionRow[] {
  if (linksScenario().noSuggestions) return [];
  const { tiers } = linksWorld();
  if (tiers.length < 2) return [];
  const pages = crawledPages()
    .filter(isLive)
    .sort((a, b) => a.path.localeCompare(b.path));
  const busiestCount = Math.ceil(pages.length * BUSIEST_SHARE);
  const busiest = new Set(
    [...pages]
      .sort((a, b) => gscClicksOf(b) - gscClicksOf(a))
      .slice(0, busiestCount)
      .filter((page) => gscClicksOf(page) > 0)
      .map((page) => page.id),
  );
  const rows: TierSuggestionRow[] = [];
  for (const page of pages) {
    const assigned = assignedTier(page);
    if (assigned.source === 'manual' || dismissedSuggestions.has(page.id)) continue;
    const current = assigned.tier === null ? Infinity : position(assigned.tier);
    const reasons: TierSuggestionRow['reasons'] = [];
    if (current >= 3 && busiest.has(page.id)) {
      reasons.push({ kind: 'clicks', clicks: gscClicksOf(page), rank: null, keyword: null, volume: null });
    }
    const best = keywordsOf(page)
      .filter((hit) => hit.rank !== null && hit.rank <= RANK_MAX && (hit.volume ?? 0) >= VOLUME_MIN)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0];
    if (current >= 3 && best !== undefined) {
      reasons.push({ kind: 'rank', clicks: null, rank: best.rank, keyword: best.keyword, volume: best.volume });
    }
    const toPosition =
      reasons.length > 0
        ? 2
        : tiers.length >= 3 && assigned.tier === null && gscClicksOf(page) >= THIRD_TIER_CLICKS
          ? 3
          : null;
    const to = toPosition === null ? null : tierRef(tiers[toPosition - 1]?.tier_id ?? null);
    if (toPosition === null || to === null) continue;
    rows.push({
      url_id: page.id,
      url: `${HOST}${page.path}`,
      path: page.path,
      title: page.title,
      from_tier: assigned.tier,
      to_tier: to,
      reasons:
        reasons.length > 0
          ? reasons
          : [{ kind: 'clicks', clicks: gscClicksOf(page), rank: null, keyword: null, volume: null }],
    });
  }
  return rows;
}

export function tierSuggestions(view: RunView): TierSuggestionList {
  return { data: suggestionRows(), meta: { run_id: view.run.run_id, gsc_state: gscState() } };
}

/** The suggestions a body names: all of them, or those of its ids (an id that is no suggestion is left out). */
const chosen = (selection: SuggestionSelection): TierSuggestionRow[] =>
  suggestionRows().filter((row) => selection.all === true || (selection.url_ids ?? []).includes(row.url_id));

/** Each chosen page gets its suggested tier as a manual tier, as `PUT pages/tiers` sets it. */
export function acceptSuggestions(selection: SuggestionSelection): { matched: number; changed: number } {
  const rows = chosen(selection);
  const { manual } = linksWorld();
  let changed = 0;
  for (const row of rows) {
    if (manual.get(row.url_id)?.tier_id === row.to_tier.tier_id) continue;
    manual.set(row.url_id, { tier_id: row.to_tier.tier_id, set_at: new Date().toISOString() });
    changed += 1;
  }
  return { matched: rows.length, changed };
}

/** The chosen suggestions are hidden for the project. */
export function dismissSuggestions(selection: SuggestionSelection): { matched: number; changed: number } {
  const rows = chosen(selection);
  let changed = 0;
  for (const row of rows) {
    if (!dismissedSuggestions.has(row.url_id)) changed += 1;
    dismissedSuggestions.add(row.url_id);
  }
  return { matched: rows.length, changed };
}

// ---------------------------------------------------------------------------------------------
// Routes

/** A page is not reached in more than this many clicks (`MAX_LEVELS` of the backend). */
const MAX_LEVELS = 12;
const REDIRECT_ANCHOR = '301 redirect';
const SCOPE_RANK = { editorial: 0, auto_generated: 1, template: 2 } as const;

interface Hop {
  from: string;
  anchor: string;
  placement: EdgeRow['placement'];
  scope: EdgeRow['scope'];
  redirect: boolean;
}

/** The order of the ways into a page: editorial first, then the lower source id, then the lower link id. */
const compareHops = (a: EdgeRow, b: EdgeRow): number => {
  const bySource = BigInt(a.source.url_id) - BigInt(b.source.url_id);
  return (
    SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] ||
    (bySource < 0n ? -1 : bySource > 0n ? 1 : 0) ||
    Number(a.link_id) - Number(b.link_id)
  );
};

/** The hop that reached each page, level by level from `start`; null when `target` is not reached in 12 clicks. */
function search(start: string, target: string, editorialOnly: boolean): Map<string, Hop> | null {
  const edges = edgeRows(editorialOnly ? 'editorial' : 'all').filter(
    (edge) => edge.is_followed && edge.source.url_id !== edge.target.url_id,
  );
  const parents = new Map<string, Hop>();
  const seen = new Set([start]);
  let frontier = [start];
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    if (frontier.length === 0 || seen.has(target)) break;
    const following: string[] = [];
    const plain = new Set<string>();
    for (const id of frontier) {
      const goal = crawledPage(id)?.redirectTo;
      // A redirect has one way on: its target
      if (goal === undefined) plain.add(id);
      else if (!seen.has(goal)) {
        seen.add(goal);
        parents.set(goal, {
          from: id,
          anchor: REDIRECT_ANCHOR,
          placement: 'content',
          scope: 'editorial',
          redirect: true,
        });
        following.push(goal);
      }
    }
    const best = new Map<string, EdgeRow>();
    for (const edge of edges) {
      if (!plain.has(edge.source.url_id) || seen.has(edge.target.url_id)) continue;
      const current = best.get(edge.target.url_id);
      if (current === undefined || compareHops(edge, current) < 0) best.set(edge.target.url_id, edge);
    }
    for (const [id, edge] of best) {
      seen.add(id);
      parents.set(id, {
        from: edge.source.url_id,
        anchor: edge.anchor,
        placement: edge.placement,
        scope: edge.scope,
        redirect: false,
      });
      following.push(id);
    }
    frontier = following;
  }
  return seen.has(target) ? parents : null;
}

function routeOf(start: string, target: string, editorialOnly: boolean): Route | null {
  const parents = search(start, target, editorialOnly);
  if (parents === null) return null;
  const steps: Route['steps'] = [];
  for (let id = target; ;) {
    const hop = parents.get(id);
    const page = crawledPage(id);
    if (page === undefined) return null;
    steps.unshift({
      page: changePage(page),
      status_code: page.status,
      anchor: hop?.anchor ?? null,
      placement: hop?.placement ?? null,
      scope: hop?.scope ?? null,
      via_redirect: hop?.redirect ?? false,
    });
    if (hop === undefined) break;
    id = hop.from;
  }
  return { clicks: steps.length - 1, steps };
}

/** The shortest route from the start page to a page, or null for a page the crawl does not hold. */
export function routesTo(urlId: string): Routes | null {
  const page = crawledPage(urlId);
  if (page === undefined) return null;
  const start = crawledPages().find((candidate) => candidate.path === '/');
  // A crawl with no start page has no route to any page
  if (start === undefined || linksScenario().noStartPage) {
    return { target: changePage(page), any: null, editorial: null };
  }
  return {
    target: changePage(page),
    any: routeOf(start.id, urlId, false),
    editorial: routeOf(start.id, urlId, true),
  };
}
