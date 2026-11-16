/**
 * Internal links: the state and the maths every tab of the mock shares (spec sections 4, 5 and 6.4). Link scope,
 * tiers from manual choices and URL rules, click depth with and without auto-generated links, equity share
 * (PageRank, damping 0.85), flags, worklists and the tier flow. The tabs read from here and call refresh().
 */
import { crawlSettings, crawls, links, pages, rules, tagNames, tiers } from './il-data.js';
import { el } from './prompts-parts.js';

export { crawlSettings, crawls, links, pages, rules, tagNames, tiers };

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
  journey: { focus: 'soc', view: 'canvas', cards: 'editorial', opened: new Set(), more: new Map(), groups: new Set(), pinned: new Set(), treeDir: 'out', treeOpen: new Set() },
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
export const rulePreviewCount = (rule, draftRules = rules) => pages.filter((page) => !page.manualTier && draftRules.find((candidate) => ruleMatches(candidate, page.path))?.id === rule.id).length;

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
export const scopeOf = (link) => (link.placement === 'content' ? 'editorial' : link.placement === 'auto_generated' ? 'auto' : 'template');
export const SCOPE_WORD = { editorial: 'editorial', auto: 'auto-generated', template: 'menu and footer' };
export const PLACEMENT_LABEL = { content: 'Content', auto_generated: 'Auto-generated', navigation: 'Navigation', footer: 'Footer', breadcrumb: 'Breadcrumb', header: 'Header', sidebar: 'Sidebar' };
const inScope = (link, scope) => scope === 'all' || scopeOf(link) === scope;

/** Links out of a page, one per target page (the first by placement order: content, auto-generated, template). */
export function outs(id, scope = 'all') {
  const seen = new Set();
  return links.filter((link) => link.from === id && link.to !== id && inScope(link, scope) && !seen.has(link.to) && seen.add(link.to));
}
/** Links into a page, one per linking page. */
export function ins(id, scope = 'all') {
  const seen = new Set();
  return links.filter((link) => link.to === id && link.from !== id && inScope(link, scope) && !seen.has(link.from) && seen.add(link.from));
}
export const statusOf = (id) => pageById(id).status;

// -------------------------------------------------------------------------------------------------
// Crawl metrics (spec 6.4). They come from the crawl, so tier changes never move them.

function bfs(skipAuto) {
  const depth = { home: 0 };
  const queue = ['home'];
  while (queue.length > 0) {
    const current = queue.shift();
    const page = pageById(current);
    const next = page.redirect ? [page.redirect] : links.filter((link) => link.from === current && link.rel !== 'nofollow' && !(skipAuto && link.placement === 'auto_generated')).map((link) => link.to);
    next.forEach((to) => {
      if (depth[to] === undefined) {
        depth[to] = depth[current] + 1;
        queue.push(to);
      }
    });
  }
  return depth;
}
export const depth = bfs(false);
export const depthWithoutAuto = bfs(true);

/** Equity share: PageRank (d 0.85) over unique followed pairs. Redirects pass it on, nofollow drops it, errors keep it. */
export const equity = (() => {
  const ids = pages.map((page) => page.id);
  const n = ids.length;
  const out = Object.fromEntries(ids.map((id) => {
    const page = pageById(id);
    if (page.redirect) return [id, { follow: [page.redirect], degree: 1 }];
    if (page.status >= 400) return [id, { follow: [], degree: 0 }];
    const unique = outs(id, 'all');
    return [id, { follow: unique.filter((link) => link.rel !== 'nofollow').map((link) => link.to), degree: unique.length }];
  }));
  let rank = Object.fromEntries(ids.map((id) => [id, 1 / n]));
  for (let round = 0; round < 100; round += 1) {
    const next = Object.fromEntries(ids.map((id) => [id, 0.15 / n]));
    ids.forEach((id) => out[id].follow.forEach((to) => (next[to] += (0.85 * rank[id]) / out[id].degree)));
    const change = Math.max(...ids.map((id) => Math.abs(next[id] - rank[id])));
    rank = next;
    if (change < 1e-9) break;
  }
  const total = ids.reduce((sum, id) => sum + rank[id], 0);
  return Object.fromEntries(ids.map((id) => [id, rank[id] / total]));
})();

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
  return list;
}

// 25th percentile of equity share among live, indexable pages
const lowQuarterEquity = (() => {
  const shares = pages.filter((page) => isLive(page) && page.indexable).map((page) => equity[page.id]).sort((a, b) => a - b);
  return shares[Math.floor((shares.length - 1) * 0.25)] ?? 0;
})();

/** Saved views of the Pages tab (spec 7.2). */
export const WORKLISTS = [
  { key: 'underlinked', label: 'Under-linked T1 pages', test: (page) => isLive(page) && page.indexable && tierPosition(tierIdOf(page)) === 1 && (ins(page.id, 'editorial').length < 3 || (depth[page.id] ?? 99) > 3 || equity[page.id] <= lowQuarterEquity) },
  { key: 'orphans', label: 'Orphans', test: (page) => flags(page).some((flag) => flag.key === 'orphan') },
  { key: 'editorialOrphans', label: 'Editorial orphans', test: (page) => flags(page).some((flag) => flag.key === 'editorialOrphan') },
  { key: 'deepAuto', label: 'Deep only through previous and next', test: (page) => flags(page).some((flag) => flag.key === 'deepAuto') },
  { key: 'brokenLinks', label: 'Broken and redirected links', test: (page) => flags(page).some((flag) => flag.key === 'broken' || flag.key === 'toRedirect') },
  { key: 'toNonIndexable', label: 'Links to non-indexable pages', test: (page) => outs(page.id, 'all').some((link) => !pageById(link.to).indexable || statusOf(link.to) !== 200) },
];
export const worklistCount = (key) => pages.filter(WORKLISTS.find((list) => list.key === key).test).length;

// -------------------------------------------------------------------------------------------------
// Tier flow (spec 7.6): unique pairs from tier to tier in a scope, and each tier's share of equity

export const tierKeys = () => [...tiers.map((tier) => tier.id), null];
export function tierFlow(scope) {
  const keys = tierKeys();
  const matrix = new Map(keys.map((from) => [from, new Map(keys.map((to) => [to, 0]))]));
  const seen = new Set();
  links.forEach((link) => {
    if (!inScope(link, scope) || link.from === link.to) return;
    const pair = `${link.from}>${link.to}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    const from = tierIdOf(pageById(link.from));
    const to = tierIdOf(pageById(link.to));
    matrix.get(from).set(to, matrix.get(from).get(to) + 1);
  });
  const strip = keys.map((key) => {
    const members = pages.filter((page) => tierIdOf(page) === key);
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
    ['URL', 'Title', 'Tier', 'Tier source', 'Status', 'Depth', `Linking pages (${SCOPE_WORD[scope] ?? 'all'})`, 'Outlinks', 'Equity share', 'Flags', 'Tags'],
    ...list.map((page) => [`https://eventussecurity.com${page.path}`, page.title, tierLabel(tierIdOf(page)), tierOf(page).source ?? '', page.status, depth[page.id] ?? '', ins(page.id, scope).length, outs(page.id, scope).length, pct(equity[page.id]), flags(page).map((flag) => flag.label).join('; '), page.tags.join('; ')]),
  ];
}

export const currentCrawl = () => crawls.find((crawl) => crawl.id === state.crawl) ?? crawls[0];

/**
 * Opens the Journey on a page (and switches to its tab). The focus is kept in the address (spec 7.5) as a history
 * entry, so a link reproduces the view and Back returns to the previous focus.
 */
export function setFocus(id) {
  const journey = state.journey;
  if (journey.focus === id && globalThis.location.hash === JOURNEY_HASH) return;
  journey.focus = id;
  clearJourney();
  globalThis.history.pushState(null, '', `${globalThis.location.pathname}?focus=${encodeURIComponent(id)}${JOURNEY_HASH}`);
  // The preview router listens to hashchange, so the Journey tab shows even when the user came from another tab
  globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
  refresh();
}
const JOURNEY_HASH = '#/internal-links/journey';
const clearJourney = () => [state.journey.opened, state.journey.more, state.journey.groups, state.journey.pinned, state.journey.treeOpen].forEach((set) => set.clear());
// Back and forward return to the previous focus without pushing a new entry
globalThis.addEventListener?.('popstate', () => {
  const id = new URLSearchParams(globalThis.location.search).get('focus');
  if (globalThis.location.hash !== JOURNEY_HASH || !id || !byId.has(id) || id === state.journey.focus) return;
  state.journey.focus = id;
  clearJourney();
  refresh();
});
const focusParam = new URLSearchParams(globalThis.location?.search ?? '').get('focus');
if (focusParam && byId.has(focusParam)) state.journey.focus = focusParam;
export const allTags = () => tagNames;
