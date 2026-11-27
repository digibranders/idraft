/* global document */
/**
 * Internal links, Pages tab (spec 7.2): one row per crawled page with its tier, status, depth, linking pages, the
 * tiers those pages sit in, outlinks, Search Console clicks and flags. It follows the Keywords table:
 * toolbar, sticky header and first columns, select column, bulk bar, sort buttons and a footer line. A row opens the
 * page inspector (il-drawer.js). Exports `render(host)`, `exportRows()` and `shownPageIds()`.
 */
import { checkRow, downloadCsv, icon, popover, toast, BUTTON, BUTTON_PRIMARY, BUTTON_SM } from './perf-ui.js';
import { openDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import {
  WORKLISTS, SCOPE_MENU, activePages, addTag, alertTierText, allTags, anchorStats, applyTierSuggestion, avgRank, citationsOf, depth, dismissTierSuggestion,
  flagBadge, flags, ins, keywordsOf, number, outs, pageCsvRows, pageDelta, pct, pageById, plural,
  refresh, resetToRule, SCOPES, setFocus, setTier, sourceText, state, statusBadge, statusOf, tierBadge, tierBg, tierCode,
  tierIdOf, tierKeys, tierLabel, tierPosition, tierSuggestions, tiers, worklistCount,
} from './il-model.js';
import { openInspector } from './il-drawer.js';
import { searchPathOf } from './il-data.js';

const HOST_URL = 'https://eventussecurity.com';
const CELL = 'border-b border-border-subtle px-3 align-middle';
const PAGE_MIN = 300;
const PAGE_STEP = 25;

// id, label, width, sort key, header tooltip
const COLUMNS = [
  { id: 'tier', label: 'Tier', width: 96, sort: 'tier' },
  { id: 'status', label: 'Status', width: 80, sort: 'status' },
  { id: 'depth', label: 'Depth', width: 120, sort: 'depth', tip: 'Fewest clicks from the home page over every followed link' },
  { id: 'linking', label: 'Linking pages', width: 120, sort: 'linking', tip: 'Unique pages that link here, in the link scope chosen' },
  { id: 'fromTiers', label: 'Linked from tiers', width: 128, tip: 'Linking pages by tier, in the link scope chosen' },
  { id: 'outlinks', label: 'Outlinks', width: 96, sort: 'outlinks', tip: 'Unique pages this page links to, in the link scope chosen' },
  { id: 'clicks', label: 'GSC clicks', width: 104, sort: 'clicks', tip: 'Google Search Console, last 28 days' },
  { id: 'change', label: 'Change', width: 96, sort: 'change', optional: true, tip: 'Editorial links in, compared with the previous crawl' },
  { id: 'flags', label: 'Flags', width: 240, sort: 'flags' },
  { id: 'tags', label: 'Tags', width: 180, optional: true },
  { id: 'reason', label: 'Indexability reason', width: 240, optional: true },
  { id: 'sitemap', label: 'In sitemap', width: 96, optional: true },
  { id: 'toT1', label: 'Outlinks to T1', width: 120, optional: true },
  { id: 'broken', label: 'Broken outlinks', width: 120, optional: true },
  { id: 'redirects', label: 'Links to redirects', width: 130, optional: true },
  { id: 'topAnchor', label: 'Top anchor', width: 200, optional: true },
  { id: 'impressions', label: 'GSC impressions', width: 128, optional: true, tip: 'Google Search Console, last 28 days' },
  { id: 'keywords', label: 'Tracked keywords', width: 128, sort: 'keywords', optional: true, tip: 'Keywords tracked for this page in idraft rank tracking' },
  { id: 'avgRank', label: 'Average rank', width: 120, sort: 'avgRank', optional: true, tip: 'Average rank of the tracked keywords that rank, from idraft rank tracking' },
  { id: 'citations', label: 'AI citations', width: 112, sort: 'citations', optional: true, tip: 'Answers from ChatGPT, Gemini and AI Mode that cited this page, last 28 days' },
  { id: 'anchors', label: 'Anchors', width: 190, sort: 'anchors', optional: true, tip: 'Distinct anchor texts of the editorial links in, and how many of them are generic' },
  { id: 'anchorMatch', label: 'Anchor matches keyword', width: 160, optional: true, tip: 'Whether an editorial anchor contains one of the tracked keywords' },
];
// The new columns other than Change start hidden; the column chooser turns them on
['keywords', 'avgRank', 'citations', 'anchors', 'anchorMatch'].forEach((id) => state.hidden.add(id));

const EMPTY_WORKLIST = {
  underlinked: ['No under-linked T1 pages', 'Every T1 page has at least 3 editorial linking pages and sits within 3 clicks of the home page.'],
  orphans: ['No orphans', 'Every page has at least one internal link pointing to it.'],
  editorialOrphans: ['No editorial orphans', 'Every page is linked from at least one editorial link, not only from menus or related blocks.'],
  deepAuto: ['No pages deep only through previous and next', 'Every page can be reached without relying on previous and next links.'],
  brokenLinks: ['No broken or redirected links', 'No page links to a 4xx page or through a redirect.'],
  toNonIndexable: ['No links to non-indexable pages', 'Every internal link points to an indexable page.'],
  get lostLinks() {
    return [`No lost editorial links to ${alertTierText()}`, `No editorial links to ${alertTierText()} pages were lost since the last crawl.`];
  },
  weakOutlinks: ['No T1 pages linking out to weak pages', 'Every T1 page sends most of its links to pages that can rank.'],
};

let typing = false;
// Focus after a re-render: set before refresh(), used by the tab's render. A data-restore value, or `more:<index>`
// for the first row a "Show more" button added.
let restore = null;
export const setRestore = (key) => {
  restore = key;
};
export function applyRestore(root) {
  const key = restore;
  restore = null;
  if (!key) return;
  const node = key.startsWith('more:') ? root.querySelectorAll('tr[data-page]')[Number(key.slice(5))]?.querySelector('button, a') : root.querySelector(`[data-restore="${key}"]`);
  node?.focus();
}
let lastPicked = null;
let currentList = [];
let shownList = [];
let limit = PAGE_STEP;
let viewKey = '';

// -------------------------------------------------------------------------------------------------
// Filters

const FILTER_FIELDS = {
  tier: { label: 'Tier', values: () => [...tiers.map((tier) => [tier.id, tierLabel(tier.id)]), ['none', 'Untiered']], test: (page, value) => (value === 'none' ? tierIdOf(page) === null : tierIdOf(page) === value) },
  tag: { label: 'Tag', values: () => allTags().map((tag) => [tag, tag]), test: (page, value) => page.tags.includes(value) },
  status: { label: 'Status', values: () => [['200', '200'], ['301', '301'], ['404', '404']], test: (page, value) => String(page.status) === value },
  indexable: { label: 'Indexable', values: () => [['yes', 'Yes'], ['no', 'No']], test: (page, value) => (value === 'yes') === page.indexable },
  flag: {
    label: 'Flag',
    values: () => [...new Map(activePages().flatMap((page) => flags(page)).map((flag) => [flag.key, flag.label]))],
    test: (page, value) => flags(page).some((flag) => flag.key === value),
  },
};

const matchesFilters = (page) => {
  const fields = [...new Set(state.filters.map((filter) => filter.field))];
  return fields.every((field) => state.filters.filter((filter) => filter.field === field).some((filter) => FILTER_FIELDS[field].test(page, filter.value)));
};

// -------------------------------------------------------------------------------------------------
// Order

const tierRank = (page) => (tierIdOf(page) ? tierPosition(tierIdOf(page)) : 99);
const SORT = {
  page: (page) => page.path,
  tier: tierRank,
  status: (page) => page.status,
  depth: (page) => depth[page.id] ?? 1000,
  linking: (page) => ins(page.id, state.scope).length,
  outlinks: (page) => outs(page.id, state.scope).length,
  clicks: (page) => page.clicks,
  flags: (page) => flags(page).length,
  change: (page) => pageDelta(page.id).editorialIn ?? 0,
  keywords: (page) => keywordsOf(page.id).length,
  avgRank: (page) => avgRank(page.id) ?? 1000,
  citations: (page) => citationsOf(page.id).total,
  anchors: (page) => anchorStats(page.id).distinct,
};

function visiblePages() {
  const list = state.worklist ? WORKLISTS.find((candidate) => candidate.key === state.worklist) : null;
  const query = searchPathOf(state.search).toLowerCase();
  const items = activePages()
    .filter((page) => !list || list.test(page))
    .filter(matchesFilters)
    .filter((page) => !query || page.path.toLowerCase().includes(query) || page.title.toLowerCase().includes(query));
  const { key, dir } = state.sort;
  const read = SORT[key] ?? SORT.tier;
  const sign = dir === 'asc' ? 1 : -1;
  return items.sort((a, b) => (read(a) > read(b) ? sign : read(a) < read(b) ? -sign : ins(b.id, 'editorial').length - ins(a.id, 'editorial').length));
}

export const shownPageIds = () => visiblePages().map((page) => page.id);

/** The shared export rows plus the columns only this table has. */
function csvRows(list) {
  const [header, ...rows] = pageCsvRows(list, state.scope);
  return [
    [...header, 'Distinct anchors (editorial)', 'Generic anchor share', 'Anchor matches keyword'],
    ...rows.map((row, index) => {
      const anchors = anchorStats(list[index].id);
      return [...row, anchors.distinct, anchors.total ? pct(anchors.genericShare) : '', anchors.matchesKeyword === null ? 'n/a' : anchors.matchesKeyword ? 'Yes' : 'No'];
    }),
  ];
}
export const exportRows = () => csvRows(visiblePages());

// -------------------------------------------------------------------------------------------------
// Cells

const muted = (text) => el('span', 'type-table text-foreground-tertiary', text);
const numeric = (text) => el('span', 'type-table num text-foreground', text);

function td(content) {
  const cell = el('td', CELL);
  if (content) cell.append(content);
  return cell;
}

function fromTiers(page) {
  const counts = tierKeys().map((key) => [key, ins(page.id, state.scope).filter((link) => tierIdOf(pageById(link.from)) === key).length]);
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return muted('None');
  const text = counts.filter(([, count]) => count > 0).map(([key, count]) => `${tierCode(key)}: ${count}`).join(', ');
  const bar = el('span', 'flex h-2 w-16 overflow-hidden rounded-2xs bg-surface-subtle');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Linking pages by tier. ${text}`);
  bar.title = text;
  counts.filter(([, count]) => count > 0).forEach(([key, count]) => {
    const part = el('span', tierBg(key));
    part.style.flexGrow = String(count);
    bar.append(part);
  });
  return bar;
}

function flagList(page) {
  const list = flags(page);
  if (list.length === 0) return muted('None');
  const wrap = el('span', 'flex flex-wrap items-center gap-1 py-1');
  list.slice(0, 2).forEach((flag) => wrap.append(flagBadge(flag)));
  if (list.length > 2) {
    const more = el('span', 'type-label num text-foreground-tertiary', `+${list.length - 2}`);
    more.title = list.slice(2).map((flag) => flag.label).join(', ');
    wrap.append(more);
  }
  return wrap;
}

function topAnchor(page) {
  const text = anchorStats(page.id).top[0]?.text;
  return text ? el('span', 'type-table text-foreground truncate', `"${text}"`) : muted('n/a');
}

function chips(page) {
  if (page.tags.length === 0) return muted('None');
  const wrap = el('span', 'flex flex-wrap gap-1 py-1');
  page.tags.forEach((tag) => wrap.append(el('span', 'inline-flex h-badge items-center rounded-sm border border-border px-1.5 type-label text-foreground-secondary', tag)));
  return wrap;
}

function deltaCell(value, suffix = '') {
  if (value === null) return el('span', 'inline-flex h-badge items-center rounded-sm px-1.5 type-label whitespace-nowrap bg-surface-subtle text-foreground-secondary', 'New');
  if (value === 0) return el('span', 'type-table num text-foreground-tertiary', `0${suffix}`);
  return el('span', `type-table num ${value > 0 ? 'text-positive-text' : 'text-negative-text'}`, `${value > 0 ? '+' : '-'}${suffix ? Math.abs(value).toFixed(1) : Math.abs(value)}${suffix}`);
}

function citationsCell(page) {
  const { chatgpt, gemini, aimode, total } = citationsOf(page.id);
  const node = numeric(number(total));
  node.title = `ChatGPT ${chatgpt}, Gemini ${gemini}, AI Mode ${aimode} (28 days)`;
  return node;
}

function anchorsCell(page) {
  const stats = anchorStats(page.id);
  if (stats.total === 0) return muted('n/a');
  const share = Math.round(stats.genericShare * 100);
  return el('span', `type-table num truncate ${stats.genericShare > 0.5 ? 'text-warning-text' : 'text-foreground'}`, `${stats.distinct} distinct, ${share}% generic`);
}

function anchorMatchCell(page) {
  const { matchesKeyword } = anchorStats(page.id);
  return matchesKeyword === null ? muted('n/a') : el('span', 'type-table text-foreground', matchesKeyword ? 'Yes' : 'No');
}

function cellFor(column, page) {
  const out = outs(page.id, 'all');
  const builders = {
    tier: () => {
      // A redirect cannot hold a tier, so it says what it is
      if (page.status >= 300 && page.status < 400 && page.redirect) return el('span', 'inline-flex h-badge shrink-0 items-center rounded-sm border border-neutral-border bg-neutral-subtle px-2 type-micro text-neutral-text', 'Redirect');
      const badge = tierBadge(tierIdOf(page));
      badge.title = `${tierLabel(tierIdOf(page))}. ${sourceText(page)}`;
      return badge;
    },
    status: () => statusBadge(page),
    depth: () => (depth[page.id] === undefined ? muted('Not reachable') : numeric(String(depth[page.id]))),
    linking: () => numeric(String(ins(page.id, state.scope).length)),
    fromTiers: () => fromTiers(page),
    outlinks: () => numeric(String(outs(page.id, state.scope).length)),
    clicks: () => numeric(number(page.clicks)),
    flags: () => flagList(page),
    tags: () => chips(page),
    reason: () => (page.reason ? el('span', 'type-table text-foreground truncate', page.reason) : muted('Indexable')),
    sitemap: () => el('span', 'type-table text-foreground', page.inSitemap ? 'Yes' : 'No'),
    toT1: () => numeric(String(out.filter((link) => tierPosition(tierIdOf(pageById(link.to))) === 1).length)),
    broken: () => numeric(String(out.filter((link) => statusOf(link.to) >= 400).length)),
    redirects: () => numeric(String(out.filter((link) => statusOf(link.to) === 301).length)),
    topAnchor: () => topAnchor(page),
    impressions: () => numeric(number(page.impressions)),
    change: () => deltaCell(pageDelta(page.id).editorialIn),
    keywords: () => numeric(String(keywordsOf(page.id).length)),
    avgRank: () => (avgRank(page.id) === null ? muted('n/a') : numeric(avgRank(page.id).toFixed(1))),
    citations: () => citationsCell(page),
    anchors: () => anchorsCell(page),
    anchorMatch: () => anchorMatchCell(page),
  };
  return td(builders[column.id]());
}

function checkbox(label, checked, indeterminate = false) {
  const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
  box.type = 'checkbox';
  box.checked = checked;
  box.indeterminate = indeterminate;
  box.setAttribute('aria-label', label);
  return box;
}

function rowButton(iconName, label) {
  const node = el('button', 'size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-hover hover:text-foreground');
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.append(icon(iconName, 'size-icon-sm'));
  return node;
}

function pageRow(page, columns) {
  const chosen = state.selected.has(page.id);
  const row = el('tr', `group h-row cursor-default ${chosen ? 'bg-surface-selected' : 'bg-surface'} hover:bg-surface-hover`);
  row.dataset.page = page.id;
  const select = el('td', `${CELL} sticky left-0 z-(--z-pinned-cell) w-10 bg-inherit px-0 text-center`);
  const box = checkbox(`Select ${page.path}`, chosen);
  box.dataset.pick = page.id;
  select.append(box);
  const name = el('th', `${CELL} sticky left-10 z-(--z-pinned-cell) bg-inherit pr-2 text-left font-normal border-r border-r-border-subtle`);
  name.scope = 'row';
  const line = el('span', 'flex items-center gap-1 min-w-0');
  const text = el('span', 'flex min-w-0 flex-1 flex-col leading-tight');
  // A redirect shares its path with the page it leads to, so it says where it points
  const redirectsTo = page.status >= 300 && page.status < 400 && page.redirect ? pageById(page.redirect) : null;
  text.append(el('span', 'truncate type-table text-foreground', page.path), el('span', 'truncate type-label text-foreground-tertiary', redirectsTo ? `Redirects to ${redirectsTo.path}` : page.title));
  const journey = rowButton('workflow', `Open ${page.path} in journey`);
  journey.dataset.journey = page.id;
  journey.title = 'Open in journey';
  const visit = el('a', 'size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-hover hover:text-foreground');
  visit.href = `${HOST_URL}${page.path}`;
  visit.target = '_blank';
  visit.rel = 'noopener noreferrer';
  visit.setAttribute('aria-label', `Visit ${page.path}`);
  visit.append(icon('external-link', 'size-icon-sm'));
  line.append(text, journey, visit);
  name.append(line);
  row.append(select, name, ...columns.map((column) => cellFor(column, page)));
  return row;
}

// -------------------------------------------------------------------------------------------------
// Header, empty states

function headerCell(column) {
  const th = el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle');
  th.scope = 'col';
  if (column.tip) th.title = column.tip;
  const label = el('span', 'truncate type-table-header text-foreground-tertiary', column.label);
  if (!column.sort) {
    th.append(label);
    return th;
  }
  const active = state.sort.key === column.sort;
  th.setAttribute('aria-sort', active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const button = el('button', `flex items-center gap-1 min-w-0 w-full rounded-sm text-left ${active ? 'text-foreground' : ''}`);
  button.type = 'button';
  button.dataset.sort = column.sort;
  button.append(label);
  if (active) button.append(icon(state.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down', 'size-icon-sm shrink-0 text-foreground'));
  th.append(button);
  return th;
}

function actionButton(label, run) {
  const node = el('button', 'h-control px-3 rounded-md border border-border bg-surface type-body-strong hover:bg-surface-hover');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', run);
  return node;
}

function emptyState(title, text, action) {
  const box = el('div', 'flex flex-col items-center gap-2 px-6 py-14 text-center');
  box.append(el('h3', 'type-section-title', title), el('p', 'type-body text-foreground-secondary max-w-md', text));
  if (action) box.append(action);
  return box;
}

// -------------------------------------------------------------------------------------------------
// Toolbar and bulk bar

const ITEM = 'w-full min-h-9 px-2 rounded-md flex items-center gap-2 type-body text-foreground text-left hover:bg-surface-hover focus-visible:bg-surface-hover';

function menuItem(panel, api, label, run, { checked, detail } = {}) {
  const node = el('button', ITEM);
  node.type = 'button';
  node.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
  if (checked !== undefined) node.setAttribute('aria-checked', String(checked));
  node.append(el('span', 'flex-1 truncate', label));
  if (detail) node.append(el('span', 'type-label text-foreground-tertiary', detail));
  if (checked) node.append(icon('check', 'size-icon-sm text-primary-text'));
  node.addEventListener('click', () => {
    api.close();
    run();
  });
  panel.append(node);
  return node;
}

/** A compact toolbar button that opens a menu of radio items, instead of a native select. */
export function menuSelect(prefix, options, value, onChange, label) {
  const node = el('button', 'h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body text-foreground-secondary hover:bg-surface-hover aria-expanded:bg-surface-selected');
  node.type = 'button';
  const current = options.find(([key]) => key === value)?.[1] ?? '';
  // The name is the visible text (WCAG label in name); `label` only names the popover
  node.setAttribute('aria-label', `${prefix}: ${current}`);
  node.dataset.restore = `menu:${prefix}`;
  node.append(el('span', '', `${prefix}: `), el('span', 'type-body-strong text-foreground -ml-1', current), icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
  popover(node, (panel, api) => {
    panel.classList.add('p-1', 'flex', 'flex-col');
    options.forEach(([key, text]) => {
      const item = el('button', ITEM);
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(key === value));
      item.append(el('span', 'flex-1 truncate', text), key === value ? icon('check', 'size-icon-sm text-primary-text') : el('span', 'size-4'));
      item.addEventListener('click', () => {
        api.close();
        setRestore(`menu:${prefix}`);
        onChange(key);
      });
      panel.append(item);
    });
  }, { label });
  return node;
}

/** The "New tag" field of the Add tag popovers: creates the tag in the workspace list, then hands it to `apply`. */
export function newTagForm(panel, apply) {
  const form = el('div', 'flex flex-col gap-1 border-t border-border-subtle p-1 mt-1');
  const row = el('div', 'flex items-center gap-1');
  const input = el('input', 'h-control-sm min-w-0 flex-1 px-2 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary');
  input.type = 'text';
  input.placeholder = 'New tag';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'New tag');
  const error = el('p', 'type-meta text-negative-text');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const create = el('button', BUTTON_SM, 'Create');
  create.type = 'button';
  const submit = () => {
    const result = addTag(input.value);
    error.hidden = !result.error;
    error.textContent = result.error ?? '';
    if (result.tag) apply(result.tag);
  };
  create.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  });
  input.addEventListener('input', () => {
    error.hidden = true;
  });
  row.append(input, create);
  form.append(row, error);
  panel.append(form);
}

function filterMenu(trigger) {
  popover(trigger, (panel, api) => {
    const fields = () => {
      panel.classList.add('p-1', 'flex', 'flex-col');
      panel.replaceChildren();
      Object.entries(FILTER_FIELDS).forEach(([key, spec]) => {
        const row = menuItem(panel, { close: () => {} }, spec.label, () => values(key));
        row.append(icon('chevron-right', 'size-icon-sm text-foreground-tertiary'));
      });
    };
    const values = (key) => {
      panel.replaceChildren();
      const back = el('button', `${ITEM} text-foreground-secondary`);
      back.type = 'button';
      back.append(icon('chevron-left', 'size-icon-sm'), el('span', '', FILTER_FIELDS[key].label));
      back.addEventListener('click', fields);
      panel.append(back);
      const options = FILTER_FIELDS[key].values();
      if (options.length === 0) panel.append(el('p', 'px-2 py-2 type-meta', 'No values to filter by.'));
      options.forEach(([value, label]) => {
        const has = state.filters.some((filter) => filter.field === key && filter.value === value);
        menuItem(panel, api, label, () => {
          state.filters = has ? state.filters.filter((filter) => !(filter.field === key && filter.value === value)) : [...state.filters, { field: key, value, label: `${FILTER_FIELDS[key].label}: ${label}` }];
          refresh();
        }, { checked: has });
      });
    };
    fields();
  }, { label: 'Add a filter' });
}

function columnsMenu(trigger) {
  popover(trigger, (panel) => {
    panel.classList.add('p-2', 'flex', 'flex-col');
    COLUMNS.filter((column) => column.optional).forEach((column) => panel.append(checkRow(column.label, !state.hidden.has(column.id), (on) => {
      if (on) state.hidden.delete(column.id);
      else state.hidden.add(column.id);
      refresh();
    })));
  }, { label: 'Columns' });
}

function toolButton(label, iconName, attach) {
  const node = el('button', 'size-control-sm rounded-md flex items-center justify-center text-foreground-secondary hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-selected');
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  node.append(icon(iconName, 'size-icon'));
  attach(node);
  return node;
}

function filterRow() {
  const row = el('div', 'flex flex-wrap items-center gap-2');
  const add = el('button', 'h-control-sm px-2 rounded-md flex items-center gap-1.5 whitespace-nowrap type-body text-foreground-secondary hover:bg-surface-hover aria-expanded:bg-surface-selected');
  add.type = 'button';
  add.append(icon('plus', 'size-icon-sm'), el('span', '', 'Filter'));
  filterMenu(add);
  row.append(add);
  state.filters.forEach((filter) => {
    const chip = el('button', 'h-control-sm pl-2 pr-1 rounded-md border border-border bg-surface flex items-center gap-1 whitespace-nowrap type-body text-foreground hover:bg-surface-hover');
    chip.type = 'button';
    chip.dataset.removeFilter = `${filter.field}:${filter.value}`;
    // Built when drawn, so a renamed or reordered tier shows its current name
    const label = `${FILTER_FIELDS[filter.field].label}: ${FILTER_FIELDS[filter.field].values().find(([value]) => value === filter.value)?.[1] ?? filter.value}`;
    chip.setAttribute('aria-label', `Remove filter ${label}`);
    chip.append(el('span', '', label), icon('x', 'size-icon-sm text-foreground-tertiary'));
    row.append(chip);
  });
  if (state.filters.length > 0) {
    const clear = el('button', 'type-body text-link hover:underline');
    clear.type = 'button';
    clear.dataset.clearFilters = '';
    clear.textContent = 'Clear filters';
    row.append(clear);
  }
  return row;
}

function toolbar(items) {
  const bar = el('div', 'flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border-subtle');
  const search = el('label', 'relative flex items-center');
  const field = el('input', 'h-control-sm w-64 max-w-full pl-8 pr-2 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary');
  field.type = 'search';
  field.placeholder = 'Search pages';
  field.setAttribute('aria-label', 'Search pages');
  field.value = state.search;
  field.dataset.search = '';
  search.append(icon('search', 'size-icon-sm absolute left-2.5 text-foreground-tertiary pointer-events-none'), field);
  const count = el('span', 'type-meta num', plural(items.length, 'page'));
  const scope = menuSelect('Links', SCOPE_MENU, state.scope, (value) => {
    state.scope = value;
    refresh();
  }, 'Link scope');
  const right = el('div', 'ml-auto flex flex-wrap items-center gap-2');
  right.append(toolButton('Columns', 'columns-3', columnsMenu));
  bar.append(search, count, scope, filterRow(), right);
  const wrap = el('div', '');
  wrap.append(viewChips(), bar);
  return wrap;
}

const CHIP = 'h-control-sm shrink-0 px-2 rounded-md border flex items-center gap-1.5 whitespace-nowrap';
const CHIP_OFF = `${CHIP} border-border bg-surface type-body text-foreground-secondary hover:bg-surface-hover`;
const CHIP_ON = `${CHIP} border-primary-border bg-primary-subtle type-body-strong text-primary-text`;

/** The saved views as a visible row of chips with their counts; views with nothing in them are left out. */
function viewChips() {
  // One line that scrolls sideways below lg (seven chips stacked to 260 px on a phone); it wraps from lg up
  const row = el('div', 'flex items-center gap-2 overflow-x-auto px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-visible');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'View');
  const chip = (key, label, count) => {
    const active = (state.worklist ?? '') === key;
    const node = el('button', active ? CHIP_ON : CHIP_OFF);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(active));
    node.dataset.restore = `chip:${key}`;
    node.append(el('span', '', label));
    if (count !== null) node.append(el('span', 'num', number(count)));
    node.addEventListener('click', () => {
      state.worklist = key || null;
      setRestore(`chip:${key}`);
      state.selected.clear();
      refresh();
    });
    row.append(node);
  };
  chip('', 'All pages', null);
  const counted = WORKLISTS.map((list) => [list, worklistCount(list.key)]);
  counted.filter(([list, count]) => count > 0 || list.key === state.worklist).forEach(([list, count]) => chip(list.key, list.label, count));
  if (counted.every(([, count]) => count === 0)) row.append(el('span', 'type-meta text-foreground-tertiary', 'No issues'));
  const suggested = tierSuggestions().length;
  if (suggested > 0) {
    const node = el('button', CHIP_OFF);
    node.type = 'button';
    node.dataset.restore = 'chip:tiers';
    node.append(icon('sparkles', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Tier suggestions'), el('span', 'num', number(suggested)));
    node.addEventListener('click', openSuggestions);
    row.append(node);
  }
  return row;
}

/** The dialog behind the "Tier suggestions" chip: accept or dismiss one by one, or accept them all. */
function openSuggestions() {
  const frame = openDialog({
    title: 'Suggested tiers',
    description: 'idraft suggests a tier from Search Console clicks and tracked keyword ranks. Nothing changes until you accept.',
    width: 'lg',
    // Accepting every suggestion removes the Tier suggestions chip: focus the first view chip, or the search field
    onClose: () => (document.querySelector('[data-restore="chip:tiers"]') ?? document.querySelector('[data-restore^="chip:"]') ?? document.querySelector('input[aria-label="Search pages"]'))?.focus(),
  });
  const th = (label, align = 'text-left') => {
    const node = el('th', `border-b border-border bg-surface-subtle px-3 py-2 type-table-header text-foreground-tertiary font-normal ${align}`, label);
    node.scope = 'col';
    return node;
  };
  const cell = (...content) => {
    const node = el('td', 'border-b border-border-subtle px-3 py-2 align-top');
    node.append(...content);
    return node;
  };
  const draw = () => {
    const rows = tierSuggestions();
    frame.body.replaceChildren();
    frame.footer.replaceChildren();
    if (rows.length === 0) {
      frame.body.append(el('p', 'type-body text-foreground-secondary py-6 text-center', 'No suggestions: every page that looks important already has a tier.'));
    } else {
      const table = el('table', 'w-full border-collapse');
      table.setAttribute('aria-label', 'Suggested tiers');
      const head = el('tr');
      head.append(th('Page'), th('Now'), th('Suggested'), th('Why'), th('Actions', 'text-right'));
      const thead = el('thead');
      thead.append(head);
      const tbody = el('tbody');
      rows.forEach((row) => {
        const page = pageById(row.id);
        const tr = el('tr');
        const name = el('th', 'border-b border-border-subtle px-3 py-2 text-left align-top font-normal');
        name.scope = 'row';
        name.append(el('span', 'block type-table text-foreground', page.path), el('span', 'block type-label text-foreground-tertiary', page.title));
        const accept = el('button', BUTTON_SM, 'Accept');
        accept.type = 'button';
        accept.setAttribute('aria-label', `Accept ${tierCode(row.to)} for ${page.path}`);
        accept.addEventListener('click', () => {
          applyTierSuggestion(row.id);
          refresh();
          toast({ title: 'Tier set', description: `${page.path} is now ${tierCode(row.to)}`, tone: 'success' });
          draw();
        });
        const dismiss = el('button', BUTTON_SM, 'Dismiss');
        dismiss.type = 'button';
        dismiss.setAttribute('aria-label', `Dismiss the suggestion for ${page.path}`);
        dismiss.addEventListener('click', () => {
          dismissTierSuggestion(row.id);
          refresh();
          draw();
        });
        const actions = el('span', 'flex items-center justify-end gap-1');
        actions.append(accept, dismiss);
        tr.append(name, cell(tierBadge(row.from)), cell(tierBadge(row.to)), cell(el('span', 'type-body text-foreground-secondary', row.reasons.join('; '))), cell(actions));
        tbody.append(tr);
      });
      table.append(thead, tbody);
      frame.body.append(table);
      const all = el('button', BUTTON_PRIMARY, 'Accept all');
      all.type = 'button';
      all.addEventListener('click', () => {
        rows.forEach((row) => applyTierSuggestion(row.id));
        refresh();
        toast({ title: 'Tiers set', description: `${plural(rows.length, 'page')} got the suggested tier.`, tone: 'success' });
        frame.close();
      });
      frame.footer.append(all);
    }
    const close = el('button', BUTTON, 'Close');
    close.type = 'button';
    close.addEventListener('click', frame.close);
    frame.footer.append(close);
    (frame.body.querySelector('table button') ?? close).focus();
  };
  draw();
}

function bulkBar(items) {
  const chosen = items.filter((page) => state.selected.has(page.id));
  const ids = chosen.map((page) => page.id);
  const bar = el('div', 'flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-b border-border-subtle bg-primary-subtle');
  bar.append(el('span', 'type-body-strong text-primary-text', `${plural(chosen.length, 'page')} selected`));
  const trigger = (label, iconName, restoreKey) => {
    const node = el('button', `${BUTTON_SM} aria-expanded:bg-surface-selected`);
    node.type = 'button';
    if (restoreKey) node.dataset.restore = restoreKey;
    node.append(icon(iconName, 'size-icon-sm text-foreground-tertiary'), el('span', '', label));
    bar.append(node);
    return node;
  };
  const tierDone = (message) => {
    state.selected.clear();
    refresh();
    toast({ title: 'Tier set', description: message, tone: 'success' });
  };
  popover(trigger('Set tier', 'layers'), (panel, api) => {
    panel.classList.add('p-1', 'flex', 'flex-col');
    tiers.forEach((tier) => menuItem(panel, api, tierLabel(tier.id), () => {
      setTier(ids, tier.id);
      tierDone(`${plural(ids.length, 'page')} ${ids.length === 1 ? 'is' : 'are'} now ${tierLabel(tier.id)}.`);
    }, { detail: String(tierPosition(tier.id)) }));
    menuItem(panel, api, 'Untiered', () => {
      setTier(ids, null);
      tierDone(`${plural(ids.length, 'page')} ${ids.length === 1 ? 'is' : 'are'} now untiered.`);
    }, { detail: '0' });
    menuItem(panel, api, 'Reset to rule', () => {
      resetToRule(ids);
      tierDone(`${plural(ids.length, 'page')} went back to the tier their rule gives.`);
    });
  }, { label: 'Set tier' });
  const tagMenu = (label, iconName, add) => popover(trigger(label, iconName, add ? 'add-tag' : 'remove-tag'), (panel, api) => {
    panel.classList.add('p-1', 'flex', 'flex-col');
    const apply = (tag) => {
      api.close();
      chosen.forEach((page) => {
        page.tags = add ? [...new Set([...page.tags, tag])] : page.tags.filter((candidate) => candidate !== tag);
      });
      setRestore(add ? 'add-tag' : 'remove-tag');
      refresh();
      toast({ title: add ? 'Tag added' : 'Tag removed', description: `${tag} ${add ? 'added to' : 'removed from'} ${plural(ids.length, 'page')}.`, tone: 'success' });
    };
    allTags().forEach((tag) => menuItem(panel, { close: () => {} }, tag, () => apply(tag)));
    if (add) newTagForm(panel, apply);
  }, { label });
  tagMenu('Add tag', 'tag', true);
  tagMenu('Remove tag', 'tags', false);
  const journey = trigger('Open in journey', 'workflow');
  journey.disabled = ids.length !== 1;
  if (ids.length !== 1) journey.title = 'Select one page to open its journey';
  journey.addEventListener('click', () => {
    setFocus(ids[0]);
  });
  trigger('Export', 'download').addEventListener('click', () => {
    downloadCsv('internal-links-pages-selected.csv', csvRows(chosen));
  });
  const clear = el('button', 'ml-auto size-control-sm rounded-md flex items-center justify-center text-primary-text hover:bg-surface-hover');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear selection');
  clear.append(icon('x', 'size-icon'));
  clear.addEventListener('click', () => {
    state.selected.clear();
    refresh();
  });
  bar.append(clear);
  const note = allMatchingNote(items, chosen);
  if (note) bar.append(note);
  return bar;
}

/** "All 25 shown pages are selected. Select all 40 matching", then "All 40 matching pages are selected. Clear selection". */
function allMatchingNote(items, chosen) {
  if (items.length <= shownList.length) return null;
  const link = (label, run) => {
    const node = el('button', 'type-body-strong text-link hover:underline', label);
    node.type = 'button';
    node.addEventListener('click', run);
    return node;
  };
  const line = el('p', 'basis-full flex flex-wrap items-baseline gap-x-2 type-body text-primary-text');
  if (chosen.length === items.length) {
    line.append(`All ${number(items.length)} matching pages are selected.`, link('Clear selection', () => {
      state.selected.clear();
      refresh();
    }));
  } else if (shownList.every((id) => state.selected.has(id))) {
    line.append(`All ${number(shownList.length)} shown pages are selected.`, link(`Select all ${number(items.length)} matching`, () => {
      currentList.forEach((id) => state.selected.add(id));
      refresh();
    }));
  } else return null;
  return line;
}

// -------------------------------------------------------------------------------------------------
// Render and events

export function render(host) {
  const items = visiblePages();
  currentList = items.map((page) => page.id);
  // A new search, view, filter or link scope starts again at the first 25 rows
  const key = JSON.stringify([state.search, state.worklist, state.filters]);
  if (key !== viewKey) {
    viewKey = key;
    limit = PAGE_STEP;
  }
  shownList = currentList.slice(0, limit);
  // Selection only keeps pages that are still in the table
  state.selected.forEach((id) => {
    if (!currentList.includes(id)) state.selected.delete(id);
  });
  const columns = COLUMNS.filter((column) => !state.hidden.has(column.id));
  const chosen = items.filter((page) => state.selected.has(page.id));
  const panel = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  panel.append(chosen.length > 0 ? bulkBar(items) : toolbar(items));
  const scroller = el('div', 'overflow-x-auto');
  if (items.length === 0) {
    const list = state.worklist && state.filters.length === 0 && state.search === '' ? EMPTY_WORKLIST[state.worklist] : null;
    scroller.append(list
      ? emptyState(list[0], list[1], actionButton('Show all pages', () => {
          state.worklist = null;
          refresh();
        }))
      : emptyState('No pages match', 'Change the search, the view or the filters.', actionButton('Clear filters', () => {
          state.search = '';
          state.filters = [];
          state.worklist = null;
          refresh();
        })));
  } else {
    const table = el('table', 'table-fixed border-separate border-spacing-0 type-table w-full');
    table.style.minWidth = `${40 + PAGE_MIN + columns.reduce((total, column) => total + column.width, 0)}px`;
    table.setAttribute('aria-label', 'Pages');
    const widths = el('colgroup', '');
    [40, null, ...columns.map((column) => column.width)].forEach((width) => {
      const col = el('col', '');
      if (width) col.style.width = `${width}px`;
      widths.append(col);
    });
    const head = el('thead', '');
    const row = el('tr', 'h-row-header');
    const all = el('th', 'sticky top-0 left-0 z-(--z-sticky) border-b border-border bg-surface-subtle px-0 text-center font-normal');
    const shownChosen = shownList.filter((id) => state.selected.has(id)).length;
    const box = checkbox('Select all shown pages', shownChosen === shownList.length, shownChosen > 0 && shownChosen < shownList.length);
    box.dataset.pick = 'all';
    all.append(box);
    const identity = el('th', 'sticky top-0 left-10 z-(--z-sticky) border-b border-border border-r border-r-border-subtle bg-surface-subtle px-3 text-left font-normal');
    identity.scope = 'col';
    identity.setAttribute('aria-sort', state.sort.key === 'page' ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const sortPage = el('button', 'flex items-center gap-1 w-full rounded-sm text-left');
    sortPage.type = 'button';
    sortPage.dataset.sort = 'page';
    sortPage.append(el('span', 'truncate type-table-header text-foreground-tertiary', 'Page'));
    if (state.sort.key === 'page') sortPage.append(icon(state.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down', 'size-icon-sm shrink-0 text-foreground'));
    identity.append(sortPage);
    row.append(all, identity, ...columns.map(headerCell));
    head.append(row);
    const body = el('tbody', '');
    items.slice(0, limit).forEach((page) => body.append(pageRow(page, columns)));
    if (items.length > limit) {
      const more = el('tr', 'bg-surface');
      const cell = el('td', `${CELL} h-row`);
      cell.colSpan = columns.length + 2;
      const button = el('button', 'type-table text-link hover:underline', `Show ${Math.min(PAGE_STEP, items.length - limit)} more`);
      button.type = 'button';
      button.dataset.more = '';
      cell.append(button);
      more.append(cell);
      body.append(more);
    }
    table.append(widths, head, body);
    scroller.append(table);
  }
  const foot = el('div', 'px-4 py-2 border-t border-border-subtle type-meta');
  const countText = items.length > limit ? `Showing ${number(limit)} of ${plural(items.length, 'page')}` : plural(items.length, 'page');
  foot.textContent = `${countText}. Link counts use ${state.scope === 'all' ? 'every link' : `${SCOPES.find(([key]) => key === state.scope)[1].toLowerCase()}`}; depth uses every link.`;
  panel.append(scroller, foot);
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  panel.addEventListener('keydown', onKey);
  host.append(panel);
  if (typing) {
    typing = false;
    const input = panel.querySelector('[data-search]');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  applyRestore(panel);
}

function onInput(event) {
  if (event.target.dataset.search === undefined) return;
  typing = true;
  state.search = event.target.value;
  refresh();
}

function pick(box, shift) {
  const target = box.dataset.pick;
  if (target === 'all') {
    // Unticking clears the whole selection, including rows that "Select all matching" added beyond the shown ones
    if (box.checked) shownList.forEach((id) => state.selected.add(id));
    else state.selected.clear();
  } else if (shift && lastPicked && currentList.includes(lastPicked)) {
    const [from, to] = [currentList.indexOf(lastPicked), currentList.indexOf(target)].sort((a, b) => a - b);
    currentList.slice(from, to + 1).forEach((id) => (box.checked ? state.selected.add(id) : state.selected.delete(id)));
  } else if (box.checked) state.selected.add(target);
  else state.selected.delete(target);
  if (target !== 'all') lastPicked = target;
  refresh();
}

function onClick(event) {
  const target = event.target.closest('button, a, input, tr[data-page]');
  if (!target) return;
  if (target.matches('input[data-pick]')) return pick(target, event.shiftKey);
  const data = target.dataset;
  if (data.more !== undefined) {
    setRestore(`more:${limit}`);
    limit += PAGE_STEP;
    refresh();
  } else if (data.sort) {
    const same = state.sort.key === data.sort;
    const smaller = ['page', 'tier', 'depth', 'status', 'avgRank'].includes(data.sort);
    state.sort = { key: data.sort, dir: same ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : smaller ? 'asc' : 'desc' };
    refresh();
  } else if (data.removeFilter) {
    state.filters = state.filters.filter((filter) => `${filter.field}:${filter.value}` !== data.removeFilter);
    refresh();
  } else if (data.clearFilters !== undefined) {
    state.filters = [];
    refresh();
  } else if (data.journey) {
    setFocus(data.journey);
  } else if (target.matches('tr[data-page]')) {
    openInspector(data.page);
  }
}

// Keys 1 to 8 set that tier on the selection and 0 clears it (spec 5.2)
function onKey(event) {
  if (state.selected.size === 0 || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!/^[0-8]$/.test(event.key) || event.target.closest('input[type="search"], select, [role="dialog"]')) return;
  const tier = event.key === '0' ? null : tiers[Number(event.key) - 1];
  if (event.key !== '0' && !tier) return;
  event.preventDefault();
  const ids = [...state.selected];
  setTier(ids, tier ? tier.id : null);
  state.selected.clear();
  refresh();
  toast({ title: 'Tier set', description: `${plural(ids.length, 'page')} ${ids.length === 1 ? 'is' : 'are'} now ${tier ? tierLabel(tier.id) : 'untiered'}.`, tone: 'success' });
}
