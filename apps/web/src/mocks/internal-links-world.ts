import { MOCK_PROJECTS, mockUser } from './fixtures';
import { onMockReset } from './state';
import { inScope, scopeOf, type EdgeScope, type LinkScope, type Placement } from '@/lib/internal-links/scopes';
import type {
  AlertSettings,
  CrawlRun,
  CrawlTrigger,
  EdgeRow,
  InternalLinksSettings,
  InternalLinksSettingsPatch,
  Neighbor,
  PageRow,
  PageTier,
  TierFlow,
  TierRef,
  TierRuleView,
  Worklists,
} from '@/lib/internal-links/types';

/**
 * The internal links of the mock API (decision W21): one finished crawl of eventussecurity.com (the Eventus
 * Security project, the site the design preview shows), the workspace's four default tiers, two tier rules,
 * and the state a session changes (tiers, rules, tags, crawls, settings). Kept in the memory of one page session,
 * as every handler's state is (`state.ts`).
 *
 * The API payloads carry `equity_share` (nothing here computes it: null, or 0 for a tier), and no screen reads it.
 * The crawl runs and the settings are functions here (`crawlsOf`, `requestCrawl`, `cancelCrawl`, `settingsOf`,
 * `changeSettings`), which the handlers of `handlers/internal-links.ts` answer from.
 */

const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (eventus === undefined) throw new Error('The fixtures have no Eventus Security project');
export const EVENTUS = eventus;
const HOST = 'https://eventussecurity.com';
export const MOCK_RUN_ID = '0192e4a0-1000-7000-8000-000000000001';
const FINISHED = '2026-11-14T03:12:00Z';
const OWNER = mockUser('owner');
const OWNER_REF = { user_id: OWNER.user_id, name: OWNER.name, email: OWNER.email };

interface FixturePage {
  id: string;
  path: string;
  title: string;
  status: number;
  redirectTo?: string;
  indexable?: boolean;
  reason?: string;
  inSitemap?: boolean;
}

const PAGES: readonly FixturePage[] = [
  { id: '101', path: '/', title: 'Eventus Security: managed security services' },
  { id: '102', path: '/services', title: 'Managed security services' },
  { id: '103', path: '/services/soc-as-a-service', title: 'SOC as a service' },
  { id: '104', path: '/services/managed-detection-and-response', title: 'Managed detection and response' },
  { id: '105', path: '/services/vapt', title: 'Vulnerability assessment and penetration testing' },
  {
    id: '106',
    path: '/services/penetration-testing',
    title: 'Redirects to /services/vapt',
    status: 301,
    redirectTo: '105',
    inSitemap: false,
  },
  {
    id: '107',
    path: '/services/threat-hunting',
    title: 'Not found',
    status: 404,
    indexable: false,
    reason: 'Not found (404)',
    inSitemap: false,
  },
  { id: '108', path: '/pricing', title: 'Plans and pricing' },
  { id: '109', path: '/contact', title: 'Talk to a security expert' },
  {
    id: '110',
    path: '/contact/thank-you',
    title: 'Thank you',
    indexable: false,
    reason: 'noindex meta tag',
    inSitemap: false,
  },
  { id: '111', path: '/blog', title: 'Blog' },
  { id: '112', path: '/blog/what-is-a-soc', title: 'What is a SOC?' },
  { id: '113', path: '/blog/soc-vs-mdr', title: 'SOC vs MDR: which one you need' },
  { id: '114', path: '/blog/vapt-checklist', title: 'VAPT checklist for 2026' },
  { id: '115', path: '/blog/threat-report-2022', title: 'Threat report 2022' },
  { id: '116', path: '/about', title: 'About Eventus Security' },
  { id: '117', path: '/partners', title: 'Partners' },
  { id: '118', path: '/compare/eventus-vs-in-house-soc', title: 'Eventus vs an in-house SOC' },
].map((page) => ({ status: 200, ...page }));

type FixtureLink = readonly [from: string, to: string, placement: Placement, anchor: string];

const LINKS: readonly FixtureLink[] = [
  ['101', '102', 'navigation', 'Services'],
  ['101', '108', 'navigation', 'Pricing'],
  ['101', '109', 'navigation', 'Contact'],
  ['101', '111', 'navigation', 'Blog'],
  ['101', '116', 'footer', 'About'],
  ['103', '101', 'header', 'Home'],
  ['112', '101', 'header', 'Home'],
  ['103', '108', 'navigation', 'Pricing'],
  ['112', '108', 'navigation', 'Pricing'],
  ['113', '109', 'footer', 'Contact'],
  ['101', '103', 'content', 'SOC as a service'],
  ['101', '104', 'content', 'MDR'],
  ['102', '103', 'content', 'SOC as a service'],
  ['102', '104', 'content', 'Managed detection and response'],
  ['102', '105', 'content', 'VAPT'],
  ['102', '106', 'content', 'Penetration testing'],
  ['103', '108', 'content', 'See plans'],
  ['103', '104', 'content', 'add MDR'],
  ['103', '109', 'content', 'Talk to an expert'],
  ['104', '103', 'content', 'SOC as a service'],
  ['104', '107', 'content', 'Threat hunting'],
  ['104', '108', 'content', 'MDR pricing'],
  ['105', '109', 'content', 'Book a test'],
  ['108', '103', 'content', 'SOC as a service'],
  ['108', '109', 'content', 'Get a quote'],
  ['108', '118', 'content', 'Compare with an in-house SOC'],
  ['109', '110', 'content', 'Thank you'],
  ['111', '112', 'content', 'What is a SOC?'],
  ['111', '113', 'content', 'SOC vs MDR'],
  ['111', '114', 'content', 'VAPT checklist'],
  ['112', '103', 'content', 'SOC as a service'],
  ['112', '113', 'content', 'SOC vs MDR'],
  ['113', '104', 'content', 'MDR'],
  ['113', '112', 'content', 'What is a SOC?'],
  ['114', '105', 'content', 'VAPT services'],
  ['118', '103', 'content', 'our SOC'],
  ['112', '113', 'auto_generated', 'Next: SOC vs MDR'],
  ['113', '112', 'auto_generated', 'Previous: What is a SOC?'],
  ['113', '114', 'auto_generated', 'Next: VAPT checklist'],
  ['114', '113', 'auto_generated', 'Previous: SOC vs MDR'],
  ['114', '115', 'auto_generated', 'Next: Threat report 2022'],
  ['115', '114', 'auto_generated', 'Previous: VAPT checklist'],
];

const TIER_SEED = [
  ['Money pages', 'Service, pricing and contact pages that bring leads'],
  ['Supporting pages', 'Hubs, industries, comparisons and case studies that lead to money pages'],
  ['Content pages', 'Blog posts, guides and resources'],
  ['Utility pages', 'About, legal, partners and careers'],
] as const;
const tierId = (n: number): string => `0192e4a0-2000-7000-8000-00000000000${String(n)}`;
const MANUAL_SEED: readonly (readonly [string, number])[] = [
  ['101', 2],
  ['102', 2],
  ['108', 1],
  ['109', 1],
  ['116', 4],
  ['117', 4],
  ['118', 2],
];

export interface StoredTier {
  tier_id: string;
  name: string;
  description: string;
  updated_at: string;
}
export interface StoredRule {
  rule_id: string;
  match_type: 'exact' | 'prefix' | 'pattern';
  value: string;
  tier_id: string;
  created_at: string;
}
export interface StoredManual {
  tier_id: string | null;
  set_at: string;
}

interface World {
  tiers: StoredTier[];
  rules: StoredRule[];
  manual: Map<string, StoredManual>;
  tags: Map<string, Set<string>>;
  /** Crawls by project, newest first. */
  crawls: Map<string, CrawlRun[]>;
  /** When a crawling run was asked to stop (epoch ms), by run id: the worker ends it a moment later. */
  cancels: Map<string, number>;
  settings: Map<string, InternalLinksSettings>;
  /** The worker setting CRAWLS_ENABLED: on by default here, so the dev mock keeps its simulated crawl. */
  crawlsEnabled: boolean;
  nextId: number;
}

function seed(): World {
  return {
    tiers: TIER_SEED.map(([name, description], index) => ({
      tier_id: tierId(index + 1),
      name,
      description,
      updated_at: FINISHED,
    })),
    rules: [
      {
        rule_id: '0192e4a0-3000-7000-8000-000000000001',
        match_type: 'prefix',
        value: '/services/',
        tier_id: tierId(1),
        created_at: FINISHED,
      },
      {
        rule_id: '0192e4a0-3000-7000-8000-000000000002',
        match_type: 'pattern',
        value: '/blog/*',
        tier_id: tierId(3),
        created_at: FINISHED,
      },
    ],
    manual: new Map(MANUAL_SEED.map(([id, position]) => [id, { tier_id: tierId(position), set_at: FINISHED }])),
    tags: new Map(),
    crawls: new Map([[EVENTUS.project_id, [finishedRun()]]]),
    cancels: new Map(),
    settings: new Map(),
    crawlsEnabled: true,
    nextId: 1,
  };
}

function finishedRun(): CrawlRun {
  return {
    run_id: MOCK_RUN_ID,
    trigger: 'schedule',
    state: 'ready',
    ceiling: 2000,
    pages_found: PAGES.length,
    pages_crawled: PAGES.length,
    sitemap_pages: 14,
    render_javascript: false,
    estimated_cost_usd: '0.300000',
    cost_usd: '0.300000',
    stop_reason: null,
    error_code: null,
    error_message: null,
    hints: [],
    is_latest: true,
    created_at: '2026-11-14T03:00:00Z',
    submitted_at: '2026-11-14T03:00:05Z',
    finished_at: FINISHED,
    requested_by: null,
    links_available: true,
    previous_run_id: null,
    enrich_state: 'done',
  };
}

let world = seed();
onMockReset(() => {
  world = seed();
});

export const linksWorld = (): World => world;
export const freshId = (): string => {
  world.nextId += 1;
  return `0192e4a0-9000-7000-8000-${String(world.nextId).padStart(12, '0')}`;
};

// -------------------------------------------------------------------------------------------------
// Tiers and rules

export function tierRef(id: string | null): TierRef | null {
  const position = world.tiers.findIndex((tier) => tier.tier_id === id);
  const tier = world.tiers[position];
  return tier === undefined ? null : { tier_id: tier.tier_id, code: `T${String(position + 1)}`, name: tier.name };
}

export function ruleMatches(rule: Pick<StoredRule, 'match_type' | 'value'>, path: string): boolean {
  if (rule.match_type === 'exact') return path === rule.value;
  if (rule.match_type === 'prefix') return path.startsWith(rule.value);
  const pattern = rule.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${pattern}$`).test(path);
}

export interface Assigned {
  tier: TierRef | null;
  source: 'manual' | 'rule' | null;
  ruleId: string | null;
  setAt: string | null;
}

/** Manual beats rules; the first matching rule wins (spec 5.2). */
export function assignedTier(page: Pick<FixturePage, 'id' | 'path'>): Assigned {
  const manual = world.manual.get(page.id);
  if (manual !== undefined)
    return { tier: tierRef(manual.tier_id), source: 'manual', ruleId: null, setAt: manual.set_at };
  const rule = world.rules.find((candidate) => ruleMatches(candidate, page.path));
  if (rule !== undefined) return { tier: tierRef(rule.tier_id), source: 'rule', ruleId: rule.rule_id, setAt: FINISHED };
  return { tier: null, source: null, ruleId: null, setAt: null };
}

export const ruleView = (rule: StoredRule, position: number): TierRuleView => ({
  rule_id: rule.rule_id,
  position,
  match_type: rule.match_type,
  value: rule.value,
  tier: tierRef(rule.tier_id) ?? { tier_id: rule.tier_id, code: 'T1', name: '' },
  created_at: rule.created_at,
});

export function pageTierViews(): PageTier[] {
  return world.tiers.map((tier, index) => {
    const pages = PAGES.filter((page) => assignedTier(page).tier?.tier_id === tier.tier_id).length;
    const code = `T${String(index + 1)}`;
    return {
      tier_id: tier.tier_id,
      position: index + 1,
      code,
      name: tier.name,
      description: tier.description,
      label: `${code} ${tier.name}`,
      page_count: pages,
      rule_count: world.rules.filter((rule) => rule.tier_id === tier.tier_id).length,
      updated_at: tier.updated_at,
    };
  });
}

// -------------------------------------------------------------------------------------------------
// The crawl's graph

const byId = new Map(PAGES.map((page) => [page.id, page]));
export const crawledPage = (id: string): FixturePage | undefined => byId.get(id);
export const crawledPages = (): readonly FixturePage[] => PAGES;
const edgeScope = (link: FixtureLink): EdgeScope => scopeOf(link[2]);

function depths(withoutAuto: boolean): Map<string, number> {
  const found = new Map<string, number>([['101', 0]]);
  let frontier = ['101'];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const step = (found.get(id) ?? 0) + 1;
      const redirect = byId.get(id)?.redirectTo;
      const targets = [
        ...LINKS.filter((link) => link[0] === id && !(withoutAuto && link[2] === 'auto_generated')).map(
          (link) => link[1],
        ),
        ...(redirect === undefined ? [] : [redirect]),
      ];
      for (const target of targets) {
        if (found.has(target)) continue;
        found.set(target, step);
        next.push(target);
      }
    }
    frontier = next;
  }
  return found;
}
const DEPTH = depths(false);
const DEPTH_WITHOUT_AUTO = depths(true);

const linksIn = (id: string, view: LinkScope): FixtureLink[] =>
  LINKS.filter((link) => link[1] === id && link[0] !== id && inScope(edgeScope(link), view));
const linksOut = (id: string, view: LinkScope): FixtureLink[] =>
  LINKS.filter((link) => link[0] === id && link[1] !== id && inScope(edgeScope(link), view));
const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

export type StatusClassName = '2xx' | '3xx' | '4xx' | '5xx';
export const statusClassOf = (status: number): StatusClassName =>
  status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';

export function pageRow(page: FixturePage, view: LinkScope): PageRow {
  const assigned = assignedTier(page);
  const inbound = unique(linksIn(page.id, view).map((link) => link[0]));
  const inboundAll = unique(linksIn(page.id, 'all').map((link) => link[0]));
  const outbound = unique(linksOut(page.id, view).map((link) => link[1]));
  const outboundAll = unique(linksOut(page.id, 'all').map((link) => link[1]));
  const targets = outboundAll.map((id) => byId.get(id)).filter((target) => target !== undefined);
  const indexable = page.indexable ?? page.status === 200;
  const depth = DEPTH.get(page.id) ?? null;
  const withoutAuto = DEPTH_WITHOUT_AUTO.get(page.id) ?? null;
  const byTier = new Map<string, { tier: TierRef | null; pages: number }>();
  for (const id of inbound) {
    const source = byId.get(id);
    const tier = source === undefined ? null : assignedTier(source).tier;
    const key = tier?.tier_id ?? 'none';
    byTier.set(key, { tier, pages: (byTier.get(key)?.pages ?? 0) + 1 });
  }
  const anchors = new Map<string, number>();
  for (const link of linksIn(page.id, view)) anchors.set(link[3], (anchors.get(link[3]) ?? 0) + 1);
  const topAnchor = [...anchors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const editorialIn = linksIn(page.id, 'editorial').length;
  const flags: PageRow['flags'] = [];
  if (page.status >= 400) flags.push('broken');
  if (page.status >= 300 && page.status < 400) flags.push('redirect');
  if (page.status === 200 && !indexable) flags.push('non_indexable');
  if (page.id !== '101' && page.status === 200 && inboundAll.length === 0 && (page.inSitemap ?? true))
    flags.push('orphan');
  else if (page.id !== '101' && page.status === 200 && inboundAll.length > 0 && editorialIn === 0) {
    flags.push('editorial_orphan');
  }
  if (depth !== null && (withoutAuto === null || withoutAuto > depth + 3)) flags.push('deep_only_through_auto');
  return {
    url_id: page.id,
    url: `${HOST}${page.path}`,
    path: page.path,
    title: page.title,
    status_code: page.status,
    resource_type: page.status >= 400 ? 'broken' : page.status >= 300 ? 'redirect' : 'html',
    redirect_url: page.redirectTo === undefined ? null : `${HOST}${byId.get(page.redirectTo)?.path ?? ''}`,
    is_indexable: indexable,
    non_indexable_reason: indexable ? null : (page.reason ?? null),
    canonical_url: null,
    in_sitemap: page.inSitemap ?? true,
    click_depth: depth,
    depth_without_auto: withoutAuto,
    equity_share: null,
    linking_pages: inbound.length,
    linking_pages_all: inboundAll.length,
    outlinks: outbound.length,
    outlinks_all: outboundAll.length,
    linked_from_tiers: [...byTier.values()],
    outlinks_to_t1: outbound.filter((id) => {
      const target = byId.get(id);
      return target !== undefined && assignedTier(target).tier?.code === 'T1';
    }).length,
    broken_outlinks: targets.filter((target) => target.status >= 400).length,
    redirect_outlinks: targets.filter((target) => target.status >= 300 && target.status < 400).length,
    non_indexable_outlinks: targets.filter((target) => target.status === 200 && target.indexable === false).length,
    top_anchor: topAnchor,
    tier: assigned.tier,
    tier_source: assigned.source,
    tier_rule_id: assigned.ruleId,
    tier_set_by: assigned.source === 'manual' ? OWNER_REF : null,
    tier_set_at: assigned.setAt,
    tags: [...(world.tags.get(page.id) ?? [])].map((term_id) => ({ term_id, name: term_id.slice(-4) })),
    flags,
  };
}

/** The neighbors of one page on one side, as the API answers them (sorted by tier then path). */
export function neighborsOf(id: string, direction: 'in' | 'out', view: LinkScope): Neighbor[] {
  const page = byId.get(id);
  if (page === undefined) return [];
  if (direction === 'out' && page.redirectTo !== undefined) {
    const target = byId.get(page.redirectTo);
    return target === undefined ? [] : [neighbor(target, null, view, direction, id)];
  }
  const links = direction === 'out' ? linksOut(id, view) : linksIn(id, view);
  const seen = new Map<string, FixtureLink>();
  for (const link of links) {
    const other = direction === 'out' ? link[1] : link[0];
    if (!seen.has(other)) seen.set(other, link);
  }
  return [...seen]
    .flatMap(([other, link]) => {
      const found = byId.get(other);
      return found === undefined ? [] : [neighbor(found, link, view, direction, id)];
    })
    .sort((a, b) => (a.tier?.code ?? 'T9').localeCompare(b.tier?.code ?? 'T9') || a.path.localeCompare(b.path));
}

function neighbor(
  page: FixturePage,
  link: FixtureLink | null,
  view: LinkScope,
  direction: 'in' | 'out',
  from: string,
): Neighbor {
  const row = pageRow(page, view);
  // The links on the far side of this page, in the same direction: what opening its card would show
  const further = direction === 'out' ? linksOut(page.id, view) : linksIn(page.id, view);
  return {
    url_id: page.id,
    url: row.url,
    path: page.path,
    title: page.title,
    status_code: page.status,
    redirect_url_id: page.redirectTo ?? null,
    tier: row.tier,
    click_depth: row.click_depth,
    linking_pages: row.linking_pages,
    linking_pages_all: row.linking_pages_all,
    equity_share: null,
    anchor: link === null ? null : link[3],
    placement: link === null ? null : link[2],
    scope: link === null ? null : edgeScope(link),
    is_followed: true,
    rel: [],
    occurrences: 1,
    links: 1,
    has_children: further.length > 0 || page.redirectTo !== undefined,
    // A link goes both ways when the far page links back to the page the step started from
    reciprocal: further.some((candidate) => (direction === 'out' ? candidate[1] : candidate[0]) === from),
  };
}

export function otherScopes(
  id: string,
  direction: 'in' | 'out',
  view: LinkScope,
): { scope: EdgeScope; pages: number }[] {
  if (view === 'all') return [];
  return (['editorial', 'auto_generated', 'template'] as const)
    .filter((scope) => scope !== view)
    .map((scope) => ({ scope, pages: neighborsOf(id, direction, scope).length }))
    .filter((entry) => entry.pages > 0);
}

export function edgeRows(view: LinkScope): EdgeRow[] {
  const order: Record<EdgeScope, number> = { template: 0, auto_generated: 1, editorial: 2 };
  const edgePage = (id: string): EdgeRow['source'] => {
    const page = byId.get(id);
    return {
      url_id: id,
      url: `${HOST}${page?.path ?? ''}`,
      path: page?.path ?? '',
      tier: page === undefined ? null : assignedTier(page).tier,
      status_code: page?.status ?? null,
      redirect_url: page?.redirectTo === undefined ? null : `${HOST}${byId.get(page.redirectTo)?.path ?? ''}`,
      is_indexable: page === undefined ? null : (page.indexable ?? page.status === 200),
    };
  };
  return LINKS.map((link, index) => ({ link, index }))
    .filter(({ link }) => inScope(edgeScope(link), view))
    .map(({ link, index }) => ({
      link_id: String(1000 + index),
      source: edgePage(link[0]),
      target: edgePage(link[1]),
      anchor: link[3],
      kind: 'text' as const,
      placement: link[2],
      scope: edgeScope(link),
      rel: [],
      is_followed: true,
      occurrences: 1,
    }))
    .sort(
      (a, b) =>
        order[a.scope] - order[b.scope] ||
        a.target.path.localeCompare(b.target.path) ||
        a.link_id.localeCompare(b.link_id),
    );
}

export function tierFlow(view: LinkScope): TierFlow {
  const keys: (TierRef | null)[] = [...world.tiers.map((tier) => tierRef(tier.tier_id)), null];
  const pairs = new Set<string>();
  const counts = new Map<string, number>();
  for (const link of LINKS) {
    if (!inScope(edgeScope(link), view) || link[0] === link[1]) continue;
    const pair = `${link[0]}>${link[1]}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    const from = byId.get(link[0]);
    const to = byId.get(link[1]);
    if (from === undefined || to === undefined) continue;
    const key = `${assignedTier(from).tier?.tier_id ?? 'none'}>${assignedTier(to).tier?.tier_id ?? 'none'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    run_id: MOCK_RUN_ID,
    scope: view,
    stale: false,
    cells: keys.flatMap((from) =>
      keys.map((to) => ({
        from_tier: from,
        to_tier: to,
        links: counts.get(`${from?.tier_id ?? 'none'}>${to?.tier_id ?? 'none'}`) ?? 0,
      })),
    ),
    tiers: keys.map((tier) => {
      const members = PAGES.filter((page) => (assignedTier(page).tier?.tier_id ?? null) === (tier?.tier_id ?? null));
      const reached = members.map((page) => DEPTH.get(page.id)).filter((depth) => depth !== undefined);
      return {
        tier,
        pages: members.length,
        equity_share: 0,
        average_depth: reached.length === 0 ? null : reached.reduce((sum, depth) => sum + depth, 0) / reached.length,
      };
    }),
  };
}

export function worklists(): Worklists {
  const rows = PAGES.map((page) => pageRow(page, 'editorial'));
  return {
    run_id: MOCK_RUN_ID,
    under_linked_t1: rows.filter(
      (row) =>
        row.tier?.code === 'T1' &&
        row.status_code === 200 &&
        row.is_indexable &&
        (row.linking_pages < 3 || (row.click_depth ?? 99) > 3),
    ).length,
    orphans: rows.filter((row) => row.flags.includes('orphan')).length,
    editorial_orphans: rows.filter((row) => row.flags.includes('editorial_orphan')).length,
    deep_only_through_auto: rows.filter((row) => row.flags.includes('deep_only_through_auto')).length,
    broken_and_redirected: LINKS.filter((link) => (byId.get(link[1])?.status ?? 200) >= 300).length,
    links_to_non_indexable: LINKS.filter((link) => {
      const target = byId.get(link[1]);
      return target !== undefined && target.status === 200 && target.indexable === false;
    }).length,
    // The changes and the weak links belong to the history task of the mock (plan 05 Task 9)
    lost_links_top: 0,
    weak_outlinks: 0,
  };
}

// -------------------------------------------------------------------------------------------------
// Crawls and settings

const QUEUED_MS = 3000;
const PROGRESS_MS = 8000;
/** A crawling run asked to stop ends this long after the request, as the worker ends it at its next tick. */
const CANCEL_MS = 2000;
const DEFAULT_CEILING = 2000;
const HIGHER_CEILING = 4000;
/** About $0.15 per 1,000 pages, ten times as much with JavaScript rendered (spec 6.2). */
const MICRO_USD_PER_PAGE = 150;
const RENDER_FACTOR = 10;
const MICRO = 1_000_000;

/** The API's money text: dollars with six decimals, from whole millionths (no float arithmetic on money). */
const usdText = (microUsd: number): string =>
  `${String(Math.floor(microUsd / MICRO))}.${String(microUsd % MICRO).padStart(6, '0')}`;

/** The crawls of a project with their mocked progress: a crawl started here runs 8 seconds, then is ready. */
export function crawlsOf(projectId: string, now = Date.now()): CrawlRun[] {
  const runs = world.crawls.get(projectId) ?? [];
  const advanced = runs.map((run): CrawlRun => {
    if (run.state !== 'queued' && run.state !== 'crawling') return run;
    const asked = world.cancels.get(run.run_id);
    if (asked !== undefined && now - asked >= CANCEL_MS) {
      return { ...run, state: 'cancelled', finished_at: new Date(asked + CANCEL_MS).toISOString() };
    }
    const elapsed = now - Date.parse(run.created_at);
    // A run waits in the queue first, long enough for a screen to show it and for Cancel to end it at once
    if (elapsed < QUEUED_MS) return run;
    // A website added in this session has no fixture to finish with: it keeps crawling
    if (projectId !== EVENTUS.project_id || elapsed < PROGRESS_MS) {
      return {
        ...run,
        state: 'crawling',
        pages_found: Math.min(run.ceiling, 120 + Math.floor(elapsed / 25)),
        submitted_at: run.created_at,
      };
    }
    return {
      ...run,
      state: 'ready',
      pages_found: PAGES.length,
      pages_crawled: PAGES.length,
      sitemap_pages: 14,
      cost_usd: run.estimated_cost_usd,
      submitted_at: run.created_at,
      finished_at: new Date(Date.parse(run.created_at) + PROGRESS_MS).toISOString(),
    };
  });
  const latestDone = advanced.findIndex((run) => run.state === 'ready' || run.state === 'stopped_at_ceiling');
  return advanced.map((run, index) => ({ ...run, is_latest: index === latestDone }));
}

/** Switches site crawls on or off, as the worker setting does; a reset of the mocks switches them on again. */
export function setCrawlsEnabled(enabled: boolean): void {
  world.crawlsEnabled = enabled;
}

export type CrawlRequest =
  | { ok: true; run: CrawlRun }
  | { ok: false; code: 'crawls_disabled' }
  | { ok: false; code: 'no_website' }
  | { ok: false; code: 'crawl_in_progress'; runId: string }
  | { ok: false; code: 'no_stopped_crawl' };

const isUnderWay = (run: CrawlRun): boolean =>
  run.state === 'queued' || run.state === 'crawling' || run.state === 'processing';

/**
 * What `POST .../link-crawls` does (backend `api/internal_links/crawls.py`): refuses everything while crawls are
 * switched off (checked first, nothing queued, so a project created with `map_internal_links` queues no crawl
 * either), a project without a website, a crawl while one is under way, and a higher limit while no crawl stopped
 * at its ceiling. A budget refusal (`budget_exceeded`) is not mocked: the mock world has no site crawl budget.
 * `trigger` is `website_added` for the crawl a new project queues.
 */
export function requestCrawl(
  projectId: string,
  {
    hasWebsite,
    higherLimit,
    trigger,
    now = Date.now(),
  }: { hasWebsite: boolean; higherLimit: boolean; trigger?: CrawlTrigger; now?: number },
): CrawlRequest {
  if (!world.crawlsEnabled) return { ok: false, code: 'crawls_disabled' };
  if (!hasWebsite) return { ok: false, code: 'no_website' };
  const runs = crawlsOf(projectId, now);
  const running = runs.find(isUnderWay);
  if (running !== undefined) return { ok: false, code: 'crawl_in_progress', runId: running.run_id };
  if (higherLimit && !runs.some((run) => run.state === 'stopped_at_ceiling')) {
    return { ok: false, code: 'no_stopped_crawl' };
  }
  const ceiling = higherLimit ? HIGHER_CEILING : DEFAULT_CEILING;
  const render = settingsOf(projectId).render_javascript;
  const estimate = ceiling * MICRO_USD_PER_PAGE * (render ? RENDER_FACTOR : 1);
  const run: CrawlRun = {
    ...finishedRun(),
    run_id: freshId(),
    trigger: trigger ?? (higherLimit ? 'ceiling_retry' : 'manual'),
    state: 'queued',
    ceiling,
    pages_found: 0,
    pages_crawled: 0,
    sitemap_pages: null,
    render_javascript: render,
    estimated_cost_usd: usdText(estimate),
    cost_usd: null,
    is_latest: false,
    created_at: new Date(now).toISOString(),
    submitted_at: null,
    finished_at: null,
    requested_by: trigger === 'website_added' ? null : OWNER_REF,
  };
  world.crawls.set(projectId, [run, ...(world.crawls.get(projectId) ?? [])]);
  return { ok: true, run };
}

export type CancelResult = { ok: true; run: CrawlRun } | { ok: false; code: 'not_found' | 'invalid_state_transition' };

/**
 * What `POST .../link-crawls/{run_id}/cancel` does (backend docs section 4.8): a queued crawl ends `cancelled` at
 * once; a crawling one is asked to stop and still answers `crawling`; any other state is `invalid_state_transition`.
 */
export function cancelCrawl(projectId: string, runId: string, now = Date.now()): CancelResult {
  const stored = world.crawls.get(projectId) ?? [];
  const run = crawlsOf(projectId, now).find((candidate) => candidate.run_id === runId);
  if (run === undefined) return { ok: false, code: 'not_found' };
  if (run.state === 'queued') {
    const ended: CrawlRun = { ...run, state: 'cancelled', finished_at: new Date(now).toISOString() };
    world.crawls.set(
      projectId,
      stored.map((candidate) => (candidate.run_id === runId ? ended : candidate)),
    );
    return { ok: true, run: ended };
  }
  if (run.state !== 'crawling') return { ok: false, code: 'invalid_state_transition' };
  if (!world.cancels.has(runId)) world.cancels.set(runId, now);
  return { ok: true, run };
}

export const hasFinishedCrawl = (projectId: string): boolean => crawlsOf(projectId).some((run) => run.is_latest);

/** The backend defaults of `internal_links.alerts` (`crawl/changes.py` `alert_settings`). */
const DEFAULT_ALERTS: AlertSettings = { enabled: true, max_position: 2, threshold: 1, channel: 'app' };

const DEFAULT_SETTINGS: InternalLinksSettings = {
  schedule: 'weekly',
  render_javascript: false,
  allowed_subdomains: [],
};

export const settingsOf = (projectId: string): InternalLinksSettings =>
  world.settings.get(projectId) ?? { ...DEFAULT_SETTINGS };

/** The settings after a patch of any of the three; the others keep their value. */
export function changeSettings(projectId: string, patch: InternalLinksSettingsPatch): InternalLinksSettings {
  const { alerts, ...rest } = patch;
  const current = settingsOf(projectId);
  // The alert rules merge member by member over the backend defaults; the other three replace
  const next: InternalLinksSettings = {
    ...current,
    ...rest,
    ...(alerts === undefined ? {} : { alerts: { ...DEFAULT_ALERTS, ...current.alerts, ...alerts } }),
  };
  world.settings.set(projectId, next);
  return next;
}
