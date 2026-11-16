/**
 * Internal links, Pages tab (spec 7.2): one row per crawled page with its tier, status, depth, linking pages, the
 * tiers those pages sit in, outlinks, equity share, Search Console clicks and flags. It follows the Keywords table:
 * toolbar, sticky header and first columns, select column, bulk bar, sort buttons and a footer line. A row opens the
 * page inspector (il-drawer.js). Exports `render(host)`, `exportRows()` and `shownPageIds()`.
 */
import { checkRow, downloadCsv, icon, popover, selectField, toast, BUTTON_SM } from './perf-ui.js';
import { el } from './prompts-parts.js';
import {
  WORKLISTS, allTags, depth, equity, flagBadge, flags, ins, links, number, outs, pageCsvRows, pages, pct, pageById, plural,
  refresh, resetToRule, SCOPES, setFocus, setTier, sourceText, state, statusBadge, statusOf, tierBadge, tierBg, tierCode,
  tierIdOf, tierKeys, tierLabel, tierPosition, tiers, worklistCount,
} from './il-model.js';
import { openInspector } from './il-drawer.js';

const HOST_URL = 'https://eventussecurity.com';
const CELL = 'border-b border-border-subtle px-3 align-middle';
const PAGE_MIN = 300;

// id, label, width, sort key, header tooltip
const COLUMNS = [
  { id: 'tier', label: 'Tier', width: 96, sort: 'tier' },
  { id: 'status', label: 'Status', width: 80, sort: 'status' },
  { id: 'depth', label: 'Depth', width: 120, sort: 'depth', tip: 'Fewest clicks from the home page over every followed link' },
  { id: 'linking', label: 'Linking pages', width: 120, sort: 'linking', tip: 'Unique pages that link here, in the link scope chosen' },
  { id: 'fromTiers', label: 'Linked from tiers', width: 128, tip: 'Linking pages by tier, in the link scope chosen' },
  { id: 'outlinks', label: 'Outlinks', width: 96, sort: 'outlinks', tip: 'Unique pages this page links to, in the link scope chosen' },
  { id: 'equity', label: 'Equity share', width: 112, sort: 'equity', tip: 'Share of internal PageRank, counting every followed link' },
  { id: 'clicks', label: 'GSC clicks', width: 104, sort: 'clicks', tip: 'Google Search Console, last 28 days' },
  { id: 'flags', label: 'Flags', width: 240, sort: 'flags' },
  { id: 'tags', label: 'Tags', width: 180, optional: true },
  { id: 'reason', label: 'Indexability reason', width: 240, optional: true },
  { id: 'sitemap', label: 'In sitemap', width: 96, optional: true },
  { id: 'toT1', label: 'Outlinks to T1', width: 120, optional: true },
  { id: 'broken', label: 'Broken outlinks', width: 120, optional: true },
  { id: 'redirects', label: 'Links to redirects', width: 130, optional: true },
  { id: 'topAnchor', label: 'Top anchor', width: 200, optional: true },
  { id: 'impressions', label: 'GSC impressions', width: 128, optional: true, tip: 'Google Search Console, last 28 days' },
];

const EMPTY_WORKLIST = {
  underlinked: ['No under-linked T1 pages', 'Every T1 page has at least 3 editorial linking pages, sits within 3 clicks of the home page and holds more than the lowest quarter of equity share.'],
  orphans: ['No orphans', 'Every page has at least one internal link pointing to it.'],
  editorialOrphans: ['No editorial orphans', 'Every page is linked from at least one editorial link, not only from menus or related blocks.'],
  deepAuto: ['No pages deep only through previous and next', 'Every page can be reached without relying on previous and next links.'],
  brokenLinks: ['No broken or redirected links', 'No page links to a 4xx page or through a redirect.'],
  toNonIndexable: ['No links to non-indexable pages', 'Every internal link points to an indexable page.'],
};

let typing = false;
let lastPicked = null;
let currentList = [];

// -------------------------------------------------------------------------------------------------
// Filters

const FILTER_FIELDS = {
  tier: { label: 'Tier', values: () => [...tiers.map((tier) => [tier.id, tierLabel(tier.id)]), ['none', 'Untiered']], test: (page, value) => (value === 'none' ? tierIdOf(page) === null : tierIdOf(page) === value) },
  tag: { label: 'Tag', values: () => allTags().map((tag) => [tag, tag]), test: (page, value) => page.tags.includes(value) },
  status: { label: 'Status', values: () => [['200', '200'], ['301', '301'], ['404', '404']], test: (page, value) => String(page.status) === value },
  indexable: { label: 'Indexable', values: () => [['yes', 'Yes'], ['no', 'No']], test: (page, value) => (value === 'yes') === page.indexable },
  flag: {
    label: 'Flag',
    values: () => [...new Map(pages.flatMap((page) => flags(page)).map((flag) => [flag.key, flag.label]))],
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
  equity: (page) => equity[page.id],
  clicks: (page) => page.clicks,
  flags: (page) => flags(page).length,
};

function visiblePages() {
  const list = state.worklist ? WORKLISTS.find((candidate) => candidate.key === state.worklist) : null;
  const query = state.search.trim().toLowerCase();
  const items = pages
    .filter((page) => !list || list.test(page))
    .filter(matchesFilters)
    .filter((page) => !query || page.path.toLowerCase().includes(query) || page.title.toLowerCase().includes(query));
  const { key, dir } = state.sort;
  const read = SORT[key] ?? SORT.tier;
  const sign = dir === 'asc' ? 1 : -1;
  return items.sort((a, b) => (read(a) > read(b) ? sign : read(a) < read(b) ? -sign : equity[b.id] - equity[a.id]));
}

export const shownPageIds = () => visiblePages().map((page) => page.id);
export const exportRows = () => pageCsvRows(visiblePages(), state.scope);

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
  const counts = new Map();
  links.filter((link) => link.to === page.id && link.placement === 'content').forEach((link) => counts.set(link.anchor, (counts.get(link.anchor) ?? 0) + 1));
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? el('span', 'type-table text-foreground truncate', `"${top[0]}"`) : muted('n/a');
}

function chips(page) {
  if (page.tags.length === 0) return muted('None');
  const wrap = el('span', 'flex flex-wrap gap-1 py-1');
  page.tags.forEach((tag) => wrap.append(el('span', 'inline-flex h-badge items-center rounded-sm border border-border px-1.5 type-label text-foreground-secondary', tag)));
  return wrap;
}

function cellFor(column, page) {
  const out = outs(page.id, 'all');
  const builders = {
    tier: () => {
      const badge = tierBadge(tierIdOf(page));
      badge.title = `${tierLabel(tierIdOf(page))}. ${sourceText(page)}`;
      return badge;
    },
    status: () => statusBadge(page),
    depth: () => (depth[page.id] === undefined ? muted('Not reachable') : numeric(String(depth[page.id]))),
    linking: () => numeric(String(ins(page.id, state.scope).length)),
    fromTiers: () => fromTiers(page),
    outlinks: () => numeric(String(outs(page.id, state.scope).length)),
    equity: () => numeric(pct(equity[page.id])),
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
  text.append(el('span', 'truncate type-table text-foreground', page.path), el('span', 'truncate type-label text-foreground-tertiary', page.title));
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
  const views = [['', 'All pages'], ...WORKLISTS.map((list) => [list.key, `${list.label} (${worklistCount(list.key)})`])];
  const view = selectField(views, state.worklist ?? '', (value) => {
    state.worklist = value || null;
    state.selected.clear();
    refresh();
  }, 'View');
  const scope = selectField(SCOPES, state.scope, (value) => {
    state.scope = value;
    refresh();
  }, 'Link scope');
  const right = el('div', 'ml-auto flex flex-wrap items-center gap-2');
  right.append(toolButton('Columns', 'columns-3', columnsMenu));
  bar.append(search, count, view, scope, filterRow(), right);
  return bar;
}

function bulkBar(items) {
  const chosen = items.filter((page) => state.selected.has(page.id));
  const ids = chosen.map((page) => page.id);
  const bar = el('div', 'flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border-subtle bg-primary-subtle');
  bar.append(el('span', 'type-body-strong text-primary-text', `${plural(chosen.length, 'page')} selected`));
  const trigger = (label, iconName) => {
    const node = el('button', `${BUTTON_SM} aria-expanded:bg-surface-selected`);
    node.type = 'button';
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
  const tagMenu = (label, iconName, add) => popover(trigger(label, iconName), (panel, api) => {
    panel.classList.add('p-1', 'flex', 'flex-col');
    allTags().forEach((tag) => menuItem(panel, api, tag, () => {
      chosen.forEach((page) => {
        page.tags = add ? [...new Set([...page.tags, tag])] : page.tags.filter((candidate) => candidate !== tag);
      });
      refresh();
      toast({ title: add ? 'Tag added' : 'Tag removed', description: `${tag} ${add ? 'added to' : 'removed from'} ${plural(ids.length, 'page')}.`, tone: 'success' });
    }));
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
    downloadCsv('internal-links-pages-selected.csv', pageCsvRows(chosen, state.scope));
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
  return bar;
}

// -------------------------------------------------------------------------------------------------
// Render and events

export function render(host) {
  const items = visiblePages();
  currentList = items.map((page) => page.id);
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
    const box = checkbox('Select all pages', chosen.length === items.length, chosen.length > 0 && chosen.length < items.length);
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
    items.forEach((page) => body.append(pageRow(page, columns)));
    table.append(widths, head, body);
    scroller.append(table);
  }
  const foot = el('div', 'px-4 py-2 border-t border-border-subtle type-meta');
  foot.textContent = `${plural(items.length, 'page')}. Link counts use ${state.scope === 'all' ? 'every link' : `${SCOPES.find(([key]) => key === state.scope)[1].toLowerCase()}`}; depth and equity use every link.`;
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
    currentList.forEach((id) => (box.checked ? state.selected.add(id) : state.selected.delete(id)));
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
  if (data.sort) {
    const same = state.sort.key === data.sort;
    const smaller = ['page', 'tier', 'depth', 'status'].includes(data.sort);
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
