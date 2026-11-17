/**
 * Internal links: the state and the maths every tab of the mock shares (spec sections 4, 5 and 6.4). Link scope,
 * tiers from manual choices and URL rules, click depth with and without auto-generated links, equity share
 * (PageRank, damping 0.85), flags, worklists and the tier flow. The tabs read from here and call refresh().
 */
import { citations, crawlSettings, crawls, keywords, links, mentions, pages, rules, tagNames, tiers } from './il-data.js';
import { el } from './prompts-parts.js';

export { citations, crawlSettings, crawls, keywords, links, mentions, pages, rules, tagNames, tiers };

// -------------------------------------------------------------------------------------------------
// State of the page. Tabs keep their own parts under their key.

export const state = {
  tab: 'pages',
  scope: 'editorial',
  search: '',
  filters: [],
  worklist: null,
  sort: { key: 'tier', dir: 'asc' },
  selected: new Set(),
  hidden: new Set(['tags', 'reason', 'sitemap', 'toT1', 'broken', 'redirects', 'topAnchor', 'impressions']),
  review: 'ready',
  crawl: 'c4',
  open: null,
  // pair: { from: tierId|null, to: tierId|null, scope } set by a Tier flow cell; the Links tab shows it as a chip
  links: { search: '', sort: { key: 'source', dir: 'asc' }, placement: '', pair: null, limit: 200 },
  // opportunityStatus: `${from}>${to}` to 'accepted' or 'dismissed' (absent = open); dismissedTierSuggestions: page ids
  opportunityStatus: {},
  dismissedTierSuggestions: new Set(),
  journey: { focus: 'soc', view: 'canvas', layout: 'step', laneHide: new Set(), cards: 'editorial', opened: new Set(), more: new Map(), groups: new Set(), pinned: new Set(), treeDir: 'out', treeOpen: new Set() },
};

let renderer = () => {};
export const setRenderer = (fn) => {
  renderer = fn;
};
export const refresh = () => renderer();

// -------------------------------------------------------------------------------------------------
// Small helpers

export const plural = (count, noun) => `${count.toLocaleString('en-US')} ${count === 1 ? noun : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
export const pct = (value) => `${(value * 100).toFixed(1)}%`;
export const number = (value) => value.toLocaleString('en-US');
const byId = new Map(pages.map((page) => [page.id, page]));
export const pageById = (id) => byId.get(id);

// -------------------------------------------------------------------------------------------------
// Tiers (spec 5): position gives the code and the colour; a manual tier beats the first matching rule

export const tierById = (id) => tiers.find((tier) => tier.id === id) ?? null;
export const tierPosition = (id) => tiers.findIndex((tier) => tier.id === id) + 1;
export const tierCode = (id) => (id && tierById(id) ? `T${tierPosition(id)}` : 'Untiered');
export const tierLabel = (id) => (id && tierById(id) ? `${tierCode(id)} ${tierById(id).name}` : 'Untiered');
// Whole class names so Tailwind compiles them; one sequential scale, darkest (most contrast) for T1
const TIER_BG = ['bg-seq-7', 'bg-seq-6', 'bg-seq-5', 'bg-seq-4', 'bg-seq-3', 'bg-seq-3', 'bg-seq-2', 'bg-seq-2'];
const TIER_BORDER = ['border-l-seq-7', 'border-l-seq-6', 'border-l-seq-5', 'border-l-seq-4', 'border-l-seq-3', 'border-l-seq-3', 'border-l-seq-2', 'border-l-seq-2'];
export const tierBg = (id) => (id && tierById(id) ? TIER_BG[tierPosition(id) - 1] : 'bg-border-strong');
export const tierEdge = (id) => (id && tierById(id) ? TIER_BORDER[tierPosition(id) - 1] : 'border-l-border-strong');

function ruleMatches(rule, path) {
  if (rule.match === 'exact') return path === rule.value;
  if (rule.match === 'prefix') return path.startsWith(rule.value);
  const pattern = new RegExp(`^${rule.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return pattern.test(path);
}
export const ruleText = (rule) => `${{ exact: 'Path is', prefix: 'Path starts with', pattern: 'Path matches' }[rule.match]} ${rule.value}`;

/** @returns {{tier: string|null, source: 'manual'|'rule'|null, rule: object|null}} */
export function tierOf(page) {
  if (page.manualTier === 'none') return { tier: null, source: 'manual', rule: null };
  if (page.manualTier && tierById(page.manualTier)) return { tier: page.manualTier, source: 'manual', rule: null };
  const rule = rules.find((candidate) => (candidate.tier === 'none' || tierById(candidate.tier)) && ruleMatches(candidate, page.path));
  return rule ? { tier: rule.tier === 'none' ? null : rule.tier, source: 'rule', rule } : { tier: null, source: null, rule: null };
}
export const tierIdOf = (page) => tierOf(page).tier;
export const sourceText = (page) => {
  const info = tierOf(page);
  if (info.source === 'manual') return `Manual${info.tier ? '' : ': Untiered'}, set by ${page.setBy ?? 'you'} on ${page.setOn ?? 'today'}`;
  if (info.source === 'rule') return `Rule: ${ruleText(info.rule)}`;
  return 'No tier set and no rule matches';
};
/** Pages without a manual tier for which this rule is the first matching rule of the list (default: the saved rules). */
export const rulePreviewPages = (rule, draftRules = rules) => pages.filter((page) => !page.manualTier && draftRules.find((candidate) => ruleMatches(candidate, page.path))?.id === rule.id);
export const rulePreviewCount = (rule, draftRules = rules) => rulePreviewPages(rule, draftRules).length;

export function setTier(ids, tierId) {
  ids.forEach((id) => {
    const page = pageById(id);
    page.manualTier = tierId ?? 'none';
    page.setBy = 'you';
    page.setOn = 'today';
  });
}
/** Clears the manual choice (a tier or Untiered), so the first matching rule decides again. */
export function resetToRule(ids) {
  ids.forEach((id) => {
    const page = pageById(id);
    page.manualTier = null;
    page.setBy = null;
    page.setOn = null;
  });
}

/** Deletes a tier and moves its pages and rules to another tier or to Untiered (spec 5.1). */
export function deleteTier(id, moveTo) {
  pages.forEach((page) => {
    if (page.manualTier === id) page.manualTier = moveTo ?? 'none';
  });
  rules.forEach((rule) => {
    if (rule.tier === id) rule.tier = moveTo ?? 'none';
  });
  tiers.splice(tiers.findIndex((tier) => tier.id === id), 1);
}
export const pagesInTier = (id) => pages.filter((page) => tierIdOf(page) === id).length;

/** CSV of url,tier (code or name). Unknown URLs are kept as pending, unknown tiers are errors with a line number. */
export function parseTierCsv(text) {
  const accepted = [];
  const pending = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim();
    if (!raw || (index === 0 && /^url\s*,/i.test(raw))) return;
    const [url, tierText = ''] = raw.split(',').map((part) => part.trim());
    const wanted = tierText.toLowerCase();
    const tier = wanted === 'untiered' ? null : tiers.find((candidate) => tierCode(candidate.id).toLowerCase() === wanted || candidate.name.toLowerCase() === wanted);
    if (tier === undefined) {
      errors.push(`Line ${index + 1}: no tier called "${tierText}"`);
      return;
    }
    const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
    const page = pages.find((candidate) => candidate.path === path);
    if (page) accepted.push({ id: page.id, tier: tier ? tier.id : null });
    else pending.push(path);
  });
  return { accepted, pending, errors };
}

// -------------------------------------------------------------------------------------------------
// Link scope (spec 4): editorial, auto-generated, template

export const SCOPES = [
  ['editorial', 'Editorial links'],
  ['auto', 'Auto-generated links'],
  ['template', 'Menu and footer links'],
  ['all', 'All links'],
];
// Short names for the toolbar menus (Links tab, Tier flow): the same four words everywhere
export const SCOPE_MENU = [['editorial', 'Editorial'], ['auto', 'Auto-generated'], ['template', 'Menu and footer'], ['all', 'All links']];
export const scopeOf = (link) => (link.placement === 'content' ? 'editorial' : link.placement === 'auto_generated' ? 'auto' : 'template');
export const SCOPE_WORD = { editorial: 'editorial', auto: 'auto-generated', template: 'menu and footer' };
export const PLACEMENT_LABEL = { content: 'Content', auto_generated: 'Auto-generated', navigation: 'Navigation', footer: 'Footer', breadcrumb: 'Breadcrumb', header: 'Header', sidebar: 'Sidebar' };
const inScope = (link, scope) => scope === 'all' || scopeOf(link) === scope;

// Crawl in view (spec 6.2): a link or a page counts only when the crawl that is open saw it
const pageActive = (page, n) => page.since <= n && (page.lastSeen ?? Infinity) >= n;
export const activeN = () => currentCrawl().n;
export const isActiveLink = (link, n = activeN()) => link.since <= n && link.lastSeen >= n;
/** The pages the crawl in view found; `pages` stays the full list. */
export function activePages() {
  const n = activeN();
  return pages.filter((page) => pageActive(page, n));
}

const outsAt = (id, scope, n) => {
  const seen = new Set();
  return links.filter((link) => link.from === id && link.to !== id && isActiveLink(link, n) && inScope(link, scope) && !seen.has(link.to) && seen.add(link.to));
};
const insAt = (id, scope, n) => {
  const seen = new Set();
  return links.filter((link) => link.to === id && link.from !== id && isActiveLink(link, n) && inScope(link, scope) && !seen.has(link.from) && seen.add(link.from));
};
/** Links out of a page in the crawl in view, one per target page (the first by placement order: content, auto-generated, template). */
export const outs = (id, scope = 'all') => outsAt(id, scope, activeN());
/** Links into a page in the crawl in view, one per linking page. */
export const ins = (id, scope = 'all') => insAt(id, scope, activeN());
export const statusOf = (id) => pageById(id).status;

// -------------------------------------------------------------------------------------------------
// Crawl metrics (spec 6.4). They come from the crawl, so tier changes never move them.

function bfs(n, skipAuto) {
  const result = { home: 0 };
  const queue = ['home'];
  while (queue.length > 0) {
    const current = queue.shift();
    const page = pageById(current);
    const next = page.redirect ? [page.redirect] : links.filter((link) => link.from === current && isActiveLink(link, n) && link.rel !== 'nofollow' && !(skipAuto && link.placement === 'auto_generated')).map((link) => link.to);
    next.forEach((to) => {
      if (result[to] === undefined) {
        result[to] = result[current] + 1;
        queue.push(to);
      }
    });
  }
  return result;
}

/** Equity share: PageRank (d 0.85) over unique followed pairs. Redirects pass it on, nofollow drops it, errors keep it. A page the crawl did not find has 0. */
function equityAt(n) {
  const ids = pages.filter((page) => pageActive(page, n)).map((page) => page.id);
  const count = ids.length;
  const out = Object.fromEntries(ids.map((id) => {
    const page = pageById(id);
    if (page.redirect) return [id, { follow: [page.redirect], degree: 1 }];
    if (page.status >= 400) return [id, { follow: [], degree: 0 }];
    const unique = outsAt(id, 'all', n);
    return [id, { follow: unique.filter((link) => link.rel !== 'nofollow').map((link) => link.to), degree: unique.length }];
  }));
  let rank = Object.fromEntries(ids.map((id) => [id, 1 / count]));
  for (let round = 0; round < 100; round += 1) {
    const next = Object.fromEntries(ids.map((id) => [id, 0.15 / count]));
    ids.forEach((id) => out[id].follow.forEach((to) => (next[to] += (0.85 * rank[id]) / out[id].degree)));
    const change = Math.max(...ids.map((id) => Math.abs(next[id] - rank[id])));
    rank = next;
    if (change < 1e-9) break;
  }
  const total = ids.reduce((sum, id) => sum + rank[id], 0);
  return Object.fromEntries(pages.map((page) => [page.id, ids.includes(page.id) ? rank[page.id] / total : 0]));
}

/** Pure: the three metrics of crawl number n, without touching the shared objects. */
export const computeMetrics = (n) => ({ depth: bfs(n, false), depthWithoutAuto: bfs(n, true), equity: equityAt(n) });
const metricsCache = new Map();
/** { depth, depthWithoutAuto, equity } of any crawl number, kept after the first call (the crawls never change). */
export function metricsFor(n) {
  if (!metricsCache.has(n)) metricsCache.set(n, computeMetrics(n));
  return metricsCache.get(n);
}

// The three shared objects keep their identity (other files import them); recompute() refills them for the crawl in view
export const depth = {};
export const depthWithoutAuto = {};
export const equity = {};
export function recompute() {
  const metrics = metricsFor(activeN());
  [[depth, metrics.depth], [depthWithoutAuto, metrics.depthWithoutAuto], [equity, metrics.equity]].forEach(([target, source]) => {
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, source);
  });
}
/** Opens another crawl: the whole site then shows as that crawl saw it. */
export function setCrawl(id) {
  if (!crawls.some((crawl) => crawl.id === id)) return;
  state.crawl = id;
  recompute();
  const live = new Set(activePages().map((page) => page.id));
  if (state.open && !live.has(state.open)) state.open = null;
  const { journey } = state;
  if (!live.has(journey.focus) || (journey.pathTarget && !live.has(journey.pathTarget))) {
    journey.focus = 'home';
    journey.pathTarget = null;
    clearJourney();
  }
  refresh();
}

export const isLive = (page) => page.status === 200;

/** Flags of a page (spec 7.2). Tone follows the design system: negative for errors, warning for risks. */
export function flags(page) {
  const list = [];
  if (page.status === 404) list.push({ key: 'notfound', label: 'Not found', tone: 'negative' });
  if (page.status === 301) list.push({ key: 'redirect', label: 'Redirect', tone: 'warning' });
  if (isLive(page) && !page.indexable) list.push({ key: 'nonindexable', label: 'Not indexable', tone: 'warning' });
  const all = ins(page.id, 'all').length;
  const editorial = ins(page.id, 'editorial').length;
  if (isLive(page) && page.id !== 'home' && all === 0) list.push({ key: 'orphan', label: 'Orphan', tone: 'negative' });
  else if (isLive(page) && page.id !== 'home' && editorial === 0) list.push({ key: 'editorialOrphan', label: 'No editorial links in', tone: 'warning' });
  if (depth[page.id] !== undefined && (depthWithoutAuto[page.id] === undefined || depthWithoutAuto[page.id] > depth[page.id] + 3)) list.push({ key: 'deepAuto', label: 'Deep only through previous and next', tone: 'warning' });
  const out = outs(page.id, 'all');
  if (out.some((link) => statusOf(link.to) >= 400)) list.push({ key: 'broken', label: 'Broken outlink', tone: 'negative' });
  if (out.some((link) => statusOf(link.to) === 301)) list.push({ key: 'toRedirect', label: 'Links to a redirect', tone: 'warning' });
  if (isLive(page) && page.indexable && tierPosition(tierIdOf(page)) === 1 && editorial < 3) list.push({ key: 'fewLinks', label: 'Few editorial links', tone: 'warning' });
  const anchors = anchorStats(page.id);
  if (anchors.total >= 2 && anchors.genericShare > 0.5) list.push({ key: 'genericAnchors', label: 'Mostly generic anchors', tone: 'warning' });
  return list;
}

/** Saved views of the Pages tab (spec 7.2). */
export const WORKLISTS = [
  { key: 'underlinked', label: 'Under-linked T1 pages', test: (page) => isLive(page) && page.indexable && tierPosition(tierIdOf(page)) === 1 && (ins(page.id, 'editorial').length < 3 || (depth[page.id] ?? 99) > 3) },
  { key: 'orphans', label: 'Orphans', test: (page) => flags(page).some((flag) => flag.key === 'orphan') },
  { key: 'editorialOrphans', label: 'Editorial orphans', test: (page) => flags(page).some((flag) => flag.key === 'editorialOrphan') },
  { key: 'deepAuto', label: 'Deep only through previous and next', test: (page) => flags(page).some((flag) => flag.key === 'deepAuto') },
  { key: 'brokenLinks', label: 'Broken and redirected links', test: (page) => flags(page).some((flag) => flag.key === 'broken' || flag.key === 'toRedirect') },
  { key: 'toNonIndexable', label: 'Links to non-indexable pages', test: (page) => outs(page.id, 'all').some((link) => !pageById(link.to).indexable || statusOf(link.to) !== 200) },
  { key: 'lostLinks', get label() { return `Lost links to ${alertTierText()}`; }, test: (page) => lostToTop().some((link) => link.to === page.id) },
  { key: 'weakOutlinks', label: 'T1 pages linking out to weak pages', test: (page) => linksOutToWeakPages(page) },
];
export const worklistCount = (key) => activePages().filter(WORKLISTS.find((list) => list.key === key).test).length;

// Weak targets: tier position 4, Untiered, or a page that is not a 200 or not indexable (spec slice 2)
const isWeakTarget = (page) => [0, 4].includes(tierPosition(tierIdOf(page))) || page.status !== 200 || !page.indexable;
function linksOutToWeakPages(page) {
  if (!isLive(page) || tierPosition(tierIdOf(page)) !== 1) return false;
  const out = outs(page.id, 'editorial');
  return out.length >= 3 && out.filter((link) => isWeakTarget(pageById(link.to))).length / out.length > 0.5;
}

// -------------------------------------------------------------------------------------------------
// Tier flow (spec 7.6): unique pairs from tier to tier in a scope, and each tier's share of equity

export const tierKeys = () => [...tiers.map((tier) => tier.id), null];
export function tierFlow(scope) {
  const keys = tierKeys();
  const matrix = new Map(keys.map((from) => [from, new Map(keys.map((to) => [to, 0]))]));
  const seen = new Set();
  const live = activePages();
  links.forEach((link) => {
    if (!isActiveLink(link) || !inScope(link, scope) || link.from === link.to) return;
    const pair = `${link.from}>${link.to}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    const from = tierIdOf(pageById(link.from));
    const to = tierIdOf(pageById(link.to));
    matrix.get(from).set(to, matrix.get(from).get(to) + 1);
  });
  const strip = keys.map((key) => {
    const members = live.filter((page) => tierIdOf(page) === key);
    const reached = members.filter((page) => depth[page.id] !== undefined);
    return {
      key,
      pages: members.length,
      equity: members.reduce((sum, page) => sum + equity[page.id], 0),
      depth: reached.length ? reached.reduce((sum, page) => sum + depth[page.id], 0) / reached.length : null,
    };
  });
  return { keys, matrix, strip };
}

// -------------------------------------------------------------------------------------------------
// Shared cells

/** Outline badge with the tier colour square and the code (spec 7.9 TierBadge). */
export function tierBadge(tierId, { withName = false } = {}) {
  const badge = el('span', 'inline-flex h-badge items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 type-label text-foreground whitespace-nowrap');
  badge.append(el('span', `size-2 shrink-0 rounded-xs ${tierBg(tierId)}`), withName ? tierLabel(tierId) : tierCode(tierId));
  if (!withName && tierId) badge.title = tierLabel(tierId);
  return badge;
}

const TONE = { negative: 'bg-negative-subtle text-negative-text', warning: 'bg-warning-subtle text-warning-text', neutral: 'bg-surface-subtle text-foreground-secondary' };
export const flagBadge = (flag) => el('span', `inline-flex h-badge items-center rounded-sm px-1.5 type-label whitespace-nowrap ${TONE[flag.tone]}`, flag.label);
export function statusBadge(page) {
  if (page.status === 200) return el('span', 'type-table num text-foreground-secondary', '200');
  return flagBadge({ label: String(page.status), tone: page.status === 301 ? 'warning' : 'negative' });
}

/** Rows for CSV export of the pages table. */
export function pageCsvRows(list, scope) {
  return [
    ['URL', 'Title', 'Tier', 'Tier source', 'Status', 'Depth', `Linking pages (${SCOPE_WORD[scope] ?? 'all'})`, 'Outlinks', 'Flags', 'Tags', 'Tracked keywords', 'Average rank', 'AI citations (28 days)', 'Editorial links in change vs previous crawl'],
    ...list.map((page) => [`https://eventussecurity.com${page.path}`, page.title, tierLabel(tierIdOf(page)), tierOf(page).source ?? '', page.status, depth[page.id] ?? '', ins(page.id, scope).length, outs(page.id, scope).length, flags(page).map((flag) => flag.label).join('; '), page.tags.join('; '), keywordsOf(page.id).map((row) => row.keyword).join('; '), avgRank(page.id) ?? '', citationsOf(page.id).total, pageDelta(page.id).editorialIn ?? 'New']),
  ];
}

export const currentCrawl = () => crawls.find((crawl) => crawl.id === state.crawl) ?? crawls[0];

/**
 * The shortest route from the home page over followed links (redirects followed), as
 * [{ id, link }] from home to the page; `link` is the link that reached that step (null for home).
 * Returns null when the page cannot be reached. With scope 'editorial' only body links are followed (redirects always are).
 */
export function routeFromHome(id, scope = 'all') {
  const previous = new Map([['home', null]]);
  const queue = ['home'];
  while (queue.length > 0 && !previous.has(id)) {
    const current = queue.shift();
    const page = pageById(current);
    const next = page.redirect
      ? [{ from: current, to: page.redirect, anchor: '301 redirect', placement: 'content', rel: 'follow' }]
      : outs(current, scope).filter((link) => link.rel !== 'nofollow');
    next.forEach((link) => {
      if (previous.has(link.to)) return;
      previous.set(link.to, link);
      queue.push(link.to);
    });
  }
  if (!previous.has(id)) return null;
  const route = [];
  for (let step = id; step; step = previous.get(step)?.from ?? null) route.unshift({ id: step, link: previous.get(step) });
  return route;
}
/** The shortest route from home to a page over any link and over editorial links only (null when there is none). */
export const findPaths = (toId) => ({ any: routeFromHome(toId, 'all'), editorial: routeFromHome(toId, 'editorial') });

// -------------------------------------------------------------------------------------------------
// Changes between crawls and alerts (spec slice 2)

export const crawlOrder = (id) => crawls.find((crawl) => crawl.id === id)?.n;
export const previousCrawl = (id) => crawls.find((crawl) => crawl.n === crawlOrder(id) - 1) ?? null;

/** The highest tier position that counts as important for alerts and the "lost to top tiers" numbers. */
export const alertMaxPosition = () => crawlSettings.alerts.maxPosition;
/** "T1" or "T1 and T2" (the tiers the alert setting covers), for every label that describes those counts. */
export const alertTierText = () => {
  const max = alertMaxPosition();
  return max <= 1 ? 'T1' : max === 2 ? 'T1 and T2' : `T1 to T${max}`;
};

// One representative link per source and target pair that a crawl had in a scope (the first by placement order)
function pairLinks(n, scope) {
  const pairs = new Map();
  links.forEach((link) => {
    const key = `${link.from}>${link.to}`;
    if (link.from !== link.to && isActiveLink(link, n) && inScope(link, scope) && !pairs.has(key)) pairs.set(key, link);
  });
  return pairs;
}

/**
 * What this crawl added and lost against the one before it (all empty for the oldest crawl), per source and target pair
 * in the scope (editorial links by default). A pair is lost when the previous crawl had a link in that scope and this one
 * has none. Rows are the link fields plus stillLinkedBy: the placement label of another link that still connects the
 * pair in this crawl (for example "Navigation"), or null.
 */
export function linkChanges(crawlId = state.crawl, scope = 'editorial') {
  const n = crawlOrder(crawlId);
  if (!(n > 1)) return { added: [], lost: [], addedPages: [], lostPages: [] };
  const [now, before] = [pairLinks(n, scope), pairLinks(n - 1, scope)];
  const stillLinkedBy = (link) => {
    const other = links.find((candidate) => candidate.from === link.from && candidate.to === link.to && isActiveLink(candidate, n));
    return other ? PLACEMENT_LABEL[other.placement] : null;
  };
  return {
    added: [...now].filter(([key]) => !before.has(key)).map(([, link]) => ({ ...link, stillLinkedBy: null })),
    lost: [...before].filter(([key]) => !now.has(key)).map(([, link]) => ({ ...link, stillLinkedBy: stillLinkedBy(link) })),
    addedPages: pages.filter((page) => page.since === n),
    lostPages: pages.filter((page) => page.lastSeen === n - 1),
  };
}

/** Lost editorial links whose target sits in tier position 1 to maxPosition (the alert setting by default). */
export const lostToTop = (crawlId = state.crawl, maxPosition = alertMaxPosition()) =>
  linkChanges(crawlId).lost.filter((link) => {
    const position = tierPosition(tierIdOf(pageById(link.to)));
    return position >= 1 && position <= maxPosition;
  });

/** The lost links that raise an alert under the project's alert settings (empty when alerts are off or below the threshold). */
export function alertsFor(crawlId = state.crawl) {
  const { lostTop, threshold } = crawlSettings.alerts;
  if (!lostTop) return [];
  const lost = lostToTop(crawlId);
  return lost.length >= threshold ? lost : [];
}

const NO_DELTA = { editorialIn: null, equityPoints: null, depth: null };
/**
 * How a page moved against the previous crawl: editorial linking pages, equity share (points) and click depth.
 * A page new in the crawl has no earlier numbers (all null). Depth is a number of levels, 'lost' when the earlier crawl
 * reached the page and this one does not, 'found' for the reverse, null when neither reaches it.
 */
export function pageDelta(id, crawlId = state.crawl) {
  const n = crawlOrder(crawlId);
  if (!(n > 1)) return { editorialIn: 0, equityPoints: 0, depth: null };
  if (pageById(id).since === n) return { ...NO_DELTA };
  const [now, before] = [metricsFor(n), metricsFor(n - 1)];
  const [was, is] = [before.depth[id], now.depth[id]];
  return {
    editorialIn: insAt(id, 'editorial', n).length - insAt(id, 'editorial', n - 1).length,
    equityPoints: Math.round((now.equity[id] - before.equity[id]) * 1000) / 10 + 0, // + 0 turns -0 into 0
    depth: was === undefined && is === undefined ? null : was === undefined ? 'found' : is === undefined ? 'lost' : is - was,
  };
}

// -------------------------------------------------------------------------------------------------
// Tracked keywords, AI citations and anchors (spec slices 2 and 3)

export const keywordsOf = (pageId) => keywords.filter((row) => row.page === pageId);
/** Mean position of the keywords that rank (one decimal), or null when the page has none that rank. */
export function avgRank(pageId) {
  const ranks = keywordsOf(pageId).flatMap((row) => (row.rank === null ? [] : [row.rank]));
  return ranks.length ? Math.round((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length) * 10) / 10 : null;
}
/** The largest monthly search volume among the page's tracked keywords, or null without keywords. */
export const topVolume = (pageId) => {
  const rows = keywordsOf(pageId);
  return rows.length ? Math.max(...rows.map((row) => row.volume)) : null;
};
export function citationsOf(pageId) {
  const row = citations.find((item) => item.page === pageId);
  const [chatgpt, gemini, aimode] = [row?.chatgpt ?? 0, row?.gemini ?? 0, row?.aimode ?? 0];
  return { chatgpt, gemini, aimode, total: chatgpt + gemini + aimode };
}

const GENERIC_ANCHORS = new Set(['click here', 'read more', 'learn more', 'here', 'this', 'more', 'link', 'see more', 'find out more', 'details']);
const cleanAnchor = (text) => text.trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim();

/**
 * Anchor texts of the links into a page in a scope, in the crawl in view. Every link counts (not one per linking page);
 * texts group without letter case. matchesKeyword: null without tracked keywords, else whether a descriptive anchor
 * contains a keyword or is part of one.
 */
export function anchorStats(pageId, scope = 'editorial', limit = 5) {
  const n = activeN();
  const groups = new Map();
  links.filter((link) => link.to === pageId && link.from !== pageId && isActiveLink(link, n) && inScope(link, scope)).forEach((link) => {
    const text = cleanAnchor(link.anchor);
    const key = text.toLowerCase();
    const group = groups.get(key) ?? { text, count: 0, generic: GENERIC_ANCHORS.has(key) };
    group.count += 1;
    groups.set(key, group);
  });
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const genericCount = rows.filter((row) => row.generic).reduce((sum, row) => sum + row.count, 0);
  const wanted = keywordsOf(pageId).map((row) => row.keyword.toLowerCase());
  const matchesKeyword = wanted.length === 0 ? null : rows.some((row) => row.text && !row.generic && wanted.some((word) => word.includes(row.text.toLowerCase()) || row.text.toLowerCase().includes(word)));
  return { total, distinct: rows.length, genericCount, genericShare: total ? genericCount / total : 0, top: rows.slice(0, limit), matchesKeyword };
}

// -------------------------------------------------------------------------------------------------
// Link opportunities (spec slice 3): a page mentions what another page is about, but does not link to it

/** Rows { key, from, to, phrase, context, anchor, sourceEquity, status: 'open'|'accepted'|'dismissed' }, T1 targets first, then the strongest source. */
export function opportunities() {
  const n = activeN();
  const rows = mentions.flatMap(({ page, phrase, target, context }) => {
    const [from, to] = [pageById(page), pageById(target)];
    if (!isLive(from) || depth[page] === undefined || !pageActive(to, n) || outs(page, 'editorial').some((link) => link.to === target)) return [];
    const key = `${page}>${target}`;
    return [{ key, from: page, to: target, phrase, context, anchor: phrase, sourceEquity: equity[page], status: state.opportunityStatus[key] ?? 'open' }];
  });
  const position = (id) => tierPosition(tierIdOf(pageById(id))) || Infinity;
  return rows.sort((a, b) => position(a.to) - position(b.to) || b.sourceEquity - a.sourceEquity);
}
/** Sets 'accepted' or 'dismissed'; null makes the opportunity open again. Callers refresh() afterwards. */
export function setOpportunityStatus(key, status) {
  if (status === null) delete state.opportunityStatus[key];
  else state.opportunityStatus[key] = status;
}
export function opportunityCounts() {
  const counts = { open: 0, accepted: 0, dismissed: 0 };
  opportunities().forEach((row) => (counts[row.status] += 1));
  return counts;
}

// -------------------------------------------------------------------------------------------------
// Tier suggestions (spec slice 3): never for a page whose tier a person chose

/** Rows { id, from: tier id|null, to: tier id, reasons: string[] }. */
export function tierSuggestions() {
  const candidates = activePages().filter((page) => isLive(page) && page.indexable);
  const busiest = [...candidates].sort((a, b) => b.clicks - a.clicks).slice(0, Math.ceil(candidates.length / 5)).filter((page) => page.clicks > 0);
  const second = tiers[1]?.id;
  const third = tiers[2]?.id;
  return candidates.flatMap((page) => {
    if (page.manualTier || state.dismissedTierSuggestions.has(page.id)) return [];
    const from = tierIdOf(page);
    const position = tierPosition(from) || Infinity;
    const reasons = [];
    if (second && position >= 3 && busiest.includes(page)) reasons.push(`${number(page.clicks)} clicks in 28 days`);
    const best = keywordsOf(page.id).filter((row) => row.rank !== null && row.rank <= 5 && row.volume >= 2000).sort((a, b) => a.rank - b.rank)[0];
    if (second && position >= 3 && best) reasons.push(`ranks #${best.rank} for '${best.keyword}' (${number(best.volume)} searches)`);
    if (reasons.length) return [{ id: page.id, from, to: second, reasons }];
    if (third && from === null && page.clicks >= 50) return [{ id: page.id, from, to: third, reasons: [`${number(page.clicks)} clicks in 28 days`] }];
    return [];
  });
}
export const applyTierSuggestion = (id) => {
  const row = tierSuggestions().find((item) => item.id === id);
  if (row) setTier([id], row.to);
};
export const dismissTierSuggestion = (id) => {
  state.dismissedTierSuggestions.add(id);
};

// Topics of the sample pages (the real feature reads them from page text and tracked keywords)
const TOPICS = {
  soc: ['SOC', 'monitoring'], mdr: ['MDR', 'SOC', 'monitoring'], vapt: ['VAPT', 'testing'], siem: ['SIEM', 'monitoring'], ir: ['incident response', 'ransomware'],
  cloud: ['cloud'], iso: ['ISO 27001', 'compliance'], pci: ['PCI DSS', 'compliance', 'banking'], ot: ['OT', 'manufacturing', 'monitoring'], socin: ['SOC'],
  pricing: ['pricing'], banking: ['banking', 'compliance'], health: ['healthcare', 'incident response'], mfg: ['manufacturing', 'OT', 'cloud'],
  compare: ['SOC', 'MDR', 'pricing'], case: ['SOC', 'banking'], b1: ['SOC', 'monitoring'], b2: ['SOC', 'MDR'], b3: ['VAPT', 'testing', 'PCI DSS'],
  b4: ['SIEM', 'monitoring'], b5: ['banking', 'compliance'], b6: ['incident response', 'ransomware'], b7: ['cloud'], b8: ['ISO 27001', 'compliance'],
  b9: ['ransomware', 'incident response'], b10: ['ransomware'], webinar: ['SOC', 'monitoring'],
};
const words = (id) => new Set(TOPICS[id] ?? []);

/**
 * Pages that could link to `id` (live, indexable, reachable from home), scored by shared title words, shared tags
 * and their own equity. With `skipLinked` the pages that already link to it by an editorial link are left out.
 * The anchor is the most common editorial anchor today, or the target's title when no editorial link exists yet.
 */
function rankSources(id, skipLinked) {
  const target = pageById(id);
  if (!isLive(target) || !target.indexable) return [];
  const editorial = ins(id, 'editorial');
  const already = skipLinked ? new Set(editorial.map((link) => link.from)) : new Set();
  const targetWords = words(id);
  const counts = new Map();
  editorial.forEach((link) => counts.set(link.anchor, (counts.get(link.anchor) ?? 0) + 1));
  const anchor = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? target.title;
  return activePages()
    .filter((page) => page.id !== id && isLive(page) && page.indexable && !already.has(page.id) && page.id !== 'thanks' && depth[page.id] !== undefined)
    .map((page) => {
      const shared = [...words(page.id)].filter((word) => targetWords.has(word));
      const tags = page.tags.filter((tag) => target.tags.includes(tag));
      const reasons = [];
      if (shared.length) reasons.push(`Same subject: ${shared.slice(0, 2).join(', ')}`);
      if (tags.length) reasons.push(`Same tag: ${tags.join(', ')}`);
      if (equity[page.id] >= 0.02) reasons.push('Well linked page');
      const score = (shared.length * 2 + tags.length * 1.5) * (1 + equity[page.id] * 20);
      return { id: page.id, score, reasons, anchor };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Pages that could link to `id` but do not yet (no editorial link), each with the reasons and a suggested anchor.
 * shortcut: the mock matches titles and tags only; the real feature (spec slice 3) reads page text and tracked keywords.
 */
export const suggestedLinks = (id, limit = 5) => rankSources(id, true).slice(0, limit);
/** True when some page relates to `id`, whether or not it already links there (tells "nothing related" from "all linked"). */
export const hasRelatedPages = (id) => rankSources(id, false).length > 0;

/**
 * Opens the Journey on a page (and switches to its tab). The focus is kept in the address (spec 7.5) as a history
 * entry, so a link reproduces the view and Back returns to the previous focus.
 */
export function setFocus(id) {
  const journey = state.journey;
  if (journey.focus === id && globalThis.location.hash === JOURNEY_HASH) return;
  journey.focus = id;
  clearJourney();
  globalThis.history.pushState(null, '', `${globalThis.location.pathname}${buildQuery(JOURNEY_HASH)}${JOURNEY_HASH}`);
  // The preview router listens to hashchange, so the Journey tab shows even when the user came from another tab
  globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
  refresh();
}
const JOURNEY_HASH = '#/internal-links/journey';
const clearJourney = () => [state.journey.opened, state.journey.more, state.journey.groups, state.journey.pinned, state.journey.treeOpen].forEach((set) => set.clear());
// Back and forward return to the previous focus without pushing a new entry
globalThis.addEventListener?.('popstate', () => {
  const { location } = globalThis;
  if (!location.hash.startsWith('#/internal-links')) return;
  // The address is the view: start from the defaults so a query that is gone from this entry is gone from the view
  Object.assign(state, { worklist: null, scope: 'editorial', sort: { key: 'tier', dir: 'asc' }, search: '', filters: [] });
  Object.assign(state.links, { search: '', placement: '', pair: null, limit: 200 });
  try {
    readQuery();
  } catch {
    // A malformed address falls back to the default view
  }
  const id = new URLSearchParams(location.search).get('focus');
  if (location.hash === JOURNEY_HASH && id && byId.has(id)) state.journey.focus = id;
  clearJourney();
  refresh();
});
const focusParam = new URLSearchParams(globalThis.location?.search ?? '').get('focus');
if (focusParam && byId.has(focusParam)) state.journey.focus = focusParam;
export const allTags = () => tagNames;

/**
 * Adds a tag name to the workspace list. A name that exists already (any letter case) returns the existing tag, so
 * the caller puts it on the page without a duplicate in the list. @returns {{tag?: string, error?: string}}
 */
export function addTag(name) {
  const tag = String(name).trim();
  if (!tag) return { error: 'Enter a tag name.' };
  const existing = tagNames.find((candidate) => candidate.toLowerCase() === tag.toLowerCase());
  if (existing) return { tag: existing };
  tagNames.push(tag);
  return { tag };
}

// -------------------------------------------------------------------------------------------------
// View state in the address: a reload or a shared link reproduces the view (spec 7.5)

const FILTER_KEYS = ['tier', 'tag', 'status', 'indexable', 'flag'];
const DEFAULT_SORT = 'tier.asc';

function buildQuery(hash) {
  const query = new URLSearchParams();
  if (state.worklist) query.set('view', state.worklist);
  if (state.scope !== 'editorial') query.set('scope', state.scope);
  const sort = `${state.sort.key}.${state.sort.dir}`;
  if (sort !== DEFAULT_SORT) query.set('sort', sort);
  if (state.search) query.set('q', state.search);
  if (state.filters.length > 0) query.set('f', state.filters.map((filter) => `${filter.field}:${encodeURIComponent(filter.value)}`).join(','));
  if (state.links.search) query.set('lq', state.links.search);
  if (state.links.placement) query.set('lp', state.links.placement);
  const { pair } = state.links;
  if (pair) query.set('pair', [pair.from ?? 'none', pair.to ?? 'none', pair.scope].join('.'));
  if (hash === JOURNEY_HASH) query.set('focus', state.journey.focus);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Rewrites the query string from the state, keeping the hash. Called at the start of every render. */
export function writeQuery() {
  const { location, history } = globalThis;
  if (!location.hash.startsWith('#/internal-links')) return;
  history.replaceState(history.state ?? null, '', `${location.pathname}${buildQuery(location.hash)}${location.hash}`);
}

function readQuery() {
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  const view = query.get('view');
  if (view && WORKLISTS.some((list) => list.key === view)) state.worklist = view;
  const scope = query.get('scope');
  if (scope && SCOPES.some(([key]) => key === scope)) state.scope = scope;
  const [key, dir] = (query.get('sort') ?? '').split('.');
  if (/^[a-zA-Z]+$/.test(key ?? '') && (dir === 'asc' || dir === 'desc')) state.sort = { key, dir };
  state.search = query.get('q') ?? '';
  state.filters = (query.get('f') ?? '').split(',').flatMap((part) => {
    const at = part.indexOf(':');
    const field = part.slice(0, at);
    if (at < 1 || !FILTER_KEYS.includes(field)) return [];
    const value = decodeURIComponent(part.slice(at + 1));
    return [{ field, value, label: `${field}: ${value}` }];
  });
  state.links.search = query.get('lq') ?? '';
  const placement = query.get('lp');
  if (placement && PLACEMENT_LABEL[placement]) state.links.placement = placement;
  const [from, to, pairScope] = (query.get('pair') ?? '').split('.');
  const tierKey = (value) => (value === 'none' ? null : tierById(value) ? value : undefined);
  if (from && to && SCOPES.some(([scopeKey]) => scopeKey === pairScope) && tierKey(from) !== undefined && tierKey(to) !== undefined) state.links.pair = { from: tierKey(from), to: tierKey(to), scope: pairScope };
}
try {
  readQuery();
} catch {
  // A malformed address (bad percent encoding) falls back to the default view
}

recompute();
