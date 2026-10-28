/* global document, window, history, location, setTimeout */
/**
 * Pages > Performance for the static preview (docs/32-page-performance.md). The watchlist, its filters, the
 * health verdicts and the page detail, all on one illustrative Search Console world (perf-data.js).
 *
 * The state lives in the query string, so a link reproduces a view. "Preview state" at the top right switches the
 * screen through the states of section 5.10 (not connected, empty, first sync, reconnect, Google busy).
 */
import { FINAL_THROUGH, HEALTH, attentionKey, compareName, formatDay, formatMetric, rangeText } from './perf-calc.js';
import { createDetail, changeSpan, healthBadge } from './perf-detail.js';
import { build as buildFilters } from './perf-filters.js';
import { openAddDialog, WATCH_LIMIT } from './perf-add.js';
import { sparkline } from './perf-chart.js';
import { GROUP_NAMES, HOST_NAME, listPages, removePages, setGroup } from './perf-data.js';
import { pageModel, readState, rangesOf, sparkOf, writeState } from './perf-model.js';
import { BUTTON, BUTTON_PRIMARY, BUTTON_SM, badge, button, closePopovers, downloadCsv, icon, popoverOpen, resizeHandle, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';

const view = document.querySelector('[data-view="pages"]');

const REVIEW_STATES = [
  ['connected', 'Connected'],
  ['notconnected', 'Not connected'],
  ['nopages', 'Connected, no pages'],
  ['syncing', 'First sync running'],
  ['reauth', 'Reconnect needed'],
  ['quota', 'Google busy (live tabs)'],
];
const INDEX_LABEL = { indexed: ['Indexed', 'positive'], not_indexed: ['Not indexed', 'negative'], warning: ['Canonical differs', 'warning'] };

let state = readState(location.search);
let tab = 'performance';
let mounted = false;
let selected = new Set();
let loadingIds = new Set();
let detail = null;
let detailKey = '';
let drawerHost = null;
let lastFocus = null;
let filters = null;
const refs = {};

// -------------------------------------------------------------------------------------------------
// State

const get = () => state;
function set(patch) {
  state = { ...state, ...patch };
  history.replaceState(null, '', `${location.pathname}${writeState(state)}${location.hash}`);
  render();
}

// -------------------------------------------------------------------------------------------------
// Rows

function sortValue(row, key) {
  if (key === 'attention') return attentionKey(row.model.health);
  if (key === 'path') return row.page.path;
  if (key === 'clicksChange') return row.model.tiles.clicks.change?.pct ?? 0;
  const tile = row.model.tiles[key];
  return tile?.cur ?? 0;
}

function visibleRows() {
  const ranges = rangesOf(state);
  const rows = listPages()
    .filter((page) => state.group === '' || page.group === state.group)
    .map((page) => ({ page, model: pageModel(page.id, state), loading: loadingIds.has(page.id) }))
    .filter((row) => state.health === '' || row.model.health.verdict === state.health);
  const descending = state.sort.startsWith('-');
  const key = state.sort.replace(/^-/, '');
  rows.sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return descending ? -order : order;
  });
  return { rows, ranges };
}

// -------------------------------------------------------------------------------------------------
// Pieces of the list

function metricCell(row, key) {
  const td = el('td', 'px-3 text-right whitespace-nowrap');
  if (row.loading || state.review === 'syncing') {
    td.append(el('span', 'inline-block h-3 w-16 rounded-sm bg-surface-hover animate-skeleton-pulse'));
    return td;
  }
  const tile = row.model.tiles[key];
  td.append(el('span', 'num type-table text-foreground', tile.cur === null ? 'No data' : formatMetric(key, tile.cur)));
  if (tile.change && tile.cur !== null && tile.change.text !== 'No data') td.append(' ', changeSpan(tile.change, 'ml-1'));
  return td;
}

function headerCell(label, key, align = 'left') {
  const th = el('th', `px-1 border-r border-border-subtle ${key === 'path' ? '' : ''}`);
  th.setAttribute('aria-sort', state.sort === key ? 'ascending' : state.sort === `-${key}` ? 'descending' : 'none');
  const active = state.sort === key || state.sort === `-${key}`;
  const node = el('button', `w-full h-8 px-2 rounded-md flex items-center gap-1 type-label hover:bg-surface-hover hover:text-foreground ${align === 'right' ? 'justify-end' : ''}`);
  node.type = 'button';
  node.append(label, icon(!active ? 'arrow-up-down' : state.sort.startsWith('-') ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide', `size-icon-xs ${active ? '' : 'text-foreground-muted'}`));
  node.addEventListener('click', () => {
    const first = key === 'path' ? key : `-${key}`;
    set({ sort: state.sort === first ? (first.startsWith('-') ? key : `-${key}`) : first });
  });
  th.append(node);
  return th;
}

function renderTable(rows, ranges) {
  const wrap = el('div', 'rounded-lg border border-border bg-surface overflow-x-auto');
  const table = el('table', 'w-full border-collapse type-table min-w-240');
  const thead = el('thead', 'bg-surface-subtle');
  const head = el('tr', 'h-row-header text-left');
  const all = el('th', 'w-10 pl-4 pr-2 border-r border-border-subtle');
  const allBox = el('input', 'size-4 rounded-sm accent-primary align-middle');
  allBox.type = 'checkbox';
  allBox.setAttribute('aria-label', 'Select all pages');
  allBox.checked = rows.length > 0 && rows.every(({ page }) => selected.has(page.id));
  allBox.addEventListener('change', () => {
    selected = allBox.checked ? new Set(rows.map(({ page }) => page.id)) : new Set();
    render();
  });
  all.append(allBox);
  head.append(all, headerCell('Page', 'path'));
  head.append(el('th', 'hidden xl:table-cell px-3 type-label border-r border-border-subtle', 'Group'));
  head.append(headerCell('Health', 'attention'));
  head.append(el('th', 'hidden 2xl:table-cell px-3 type-label border-r border-border-subtle', 'Indexing'));
  head.append(headerCell('Clicks', 'clicks', 'right'), headerCell('Impressions', 'impressions', 'right'), headerCell('CTR', 'ctr', 'right'), headerCell('Position', 'position', 'right'));
  head.append(el('th', 'hidden xl:table-cell px-3 type-label', 'Trend'));
  thead.append(head);
  const tbody = el('tbody');
  if (rows.length === 0) {
    const empty = el('tr');
    const cell = el('td', 'px-4 py-8 text-center type-body text-foreground-secondary', 'No watched pages match these filters.');
    cell.colSpan = 10;
    empty.append(cell);
    tbody.append(empty);
  }
  rows.forEach((row) => {
    const { page, model } = row;
    const tr = el('tr', `h-row border-t border-border-subtle hover:bg-surface-hover ${state.page === page.id ? 'bg-surface-selected' : ''}`);
    const boxCell = el('td', 'w-10 pl-4 pr-2');
    const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
    box.type = 'checkbox';
    box.checked = selected.has(page.id);
    box.setAttribute('aria-label', `Select ${page.path}`);
    box.addEventListener('change', () => {
      if (box.checked) selected.add(page.id); else selected.delete(page.id);
      render();
    });
    boxCell.append(box);
    const pathCell = el('td', 'px-3 min-w-60');
    const open = el('button', 'type-body-strong text-link hover:underline text-left break-all');
    open.type = 'button';
    open.dataset.pageId = String(page.id);
    open.textContent = page.path;
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      lastFocus = open;
      set({ page: page.id, shell: 'drawer' });
    });
    pathCell.append(open, el('span', 'block type-meta', HOST_NAME));
    const group = el('td', 'hidden xl:table-cell px-3 type-body text-foreground-secondary', page.group ?? '');
    const health = el('td', 'px-3');
    if (row.loading || state.review === 'syncing') health.append(el('span', 'inline-block h-3 w-16 rounded-sm bg-surface-hover animate-skeleton-pulse'));
    else health.append(healthBadge(model.health.verdict));
    const indexCell = el('td', 'hidden 2xl:table-cell px-3');
    const [indexText, indexTone] = INDEX_LABEL[model.index.state];
    indexCell.append(badge(indexText, indexTone));
    const trend = el('td', 'hidden xl:table-cell px-3');
    if (!row.loading && state.review !== 'syncing') trend.append(sparkline(sparkOf(page.id, state, ranges)));
    tr.append(boxCell, pathCell, group, health, indexCell, metricCell(row, 'clicks'), metricCell(row, 'impressions'), metricCell(row, 'ctr'), metricCell(row, 'position'), trend);
    tr.addEventListener('click', (event) => {
      if (event.target.closest('input, button, a')) return;
      lastFocus = open;
      set({ page: page.id, shell: 'drawer' });
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderSummary(allRows) {
  const counts = {};
  allRows.forEach(({ model }) => { counts[model.health.verdict] = (counts[model.health.verdict] ?? 0) + 1; });
  const line = el('div', 'flex items-center gap-2 flex-wrap');
  line.append(el('span', 'type-body-strong', `${allRows.length} pages`));
  const order = ['lost', 'sharp_drop', 'declining', 'stable', 'growing', 'new', 'low_data', 'no_data'];
  order.filter((key) => counts[key]).forEach((key) => {
    const node = el('button', `h-badge px-2 rounded-sm type-micro flex items-center gap-1 whitespace-nowrap border ${state.health === key ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle bg-surface text-foreground-secondary hover:bg-surface-hover'}`);
    node.type = 'button';
    node.append(HEALTH[key].label, el('span', 'num type-micro', String(counts[key])));
    node.setAttribute('aria-pressed', String(state.health === key));
    node.addEventListener('click', () => set({ health: state.health === key ? '' : key }));
    line.append(node);
  });
  if (state.health) line.append(button('Show all', { className: `${BUTTON_SM} text-foreground-secondary`, onClick: () => set({ health: '' }) }));
  return line;
}

function renderBulk(rows) {
  const bar = el('div', 'rounded-lg border border-border bg-surface-subtle px-3 py-2 flex items-center gap-3 flex-wrap');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Bulk actions');
  bar.append(el('span', 'type-body-strong', `${selected.size} selected`));
  const group = selectField([['', 'Set group...'], ...GROUP_NAMES.map((name) => [name, name]), ['__none', 'No group']], '', (value) => {
    if (!value) return;
    setGroup([...selected], value === '__none' ? null : value);
    toast({ title: `Group set for ${selected.size} pages`, tone: 'success' });
    render();
  }, 'Set group for the selected pages');
  bar.append(group);
  bar.append(button('Export selection', { className: BUTTON_SM, iconName: 'download', onClick: () => exportRows(rows.filter(({ page }) => selected.has(page.id))) }));
  bar.append(button('Remove from watchlist', { className: `${BUTTON_SM} text-negative-text`, onClick: () => {
    const count = selected.size;
    removePages([...selected]);
    if (state.page && selected.has(state.page)) state = { ...state, page: null };
    selected = new Set();
    toast({ title: `Removed ${count} pages`, description: 'Their history is kept, so adding them again restores it.', tone: 'success' });
    set({});
  } }));
  bar.append(button('Clear', { className: `${BUTTON_SM} ml-auto`, onClick: () => { selected = new Set(); render(); } }));
  return bar;
}

function exportRows(rows) {
  const ranges = rangesOf(state);
  const out = [['Page', 'Group', 'Health', 'Index status', 'Clicks', 'Clicks before', 'Impressions', 'Impressions before', 'CTR', 'CTR before', 'Position', 'Position before']];
  rows.forEach(({ page, model }) => {
    const t = model.tiles;
    const cell = (key, which) => (t[key]?.[which] === null || t[key]?.[which] === undefined ? '' : key === 'ctr' ? Number(t[key][which].toFixed(4)) : key === 'position' ? Number(t[key][which].toFixed(1)) : Math.round(t[key][which]));
    out.push([page.path, page.group ?? '', HEALTH[model.health.verdict].label, INDEX_LABEL[model.index.state][0], cell('clicks', 'cur'), cell('clicks', 'prev'), cell('impressions', 'cur'), cell('impressions', 'prev'), cell('ctr', 'cur'), cell('ctr', 'prev'), cell('position', 'cur'), cell('position', 'prev')]);
  });
  downloadCsv(`page-performance-${ranges.current.from}-${ranges.current.to}.csv`, out);
}

// -------------------------------------------------------------------------------------------------
// States (docs/32 section 5.10)

function emptyState({ heading, text, actions }) {
  const box = el('section', 'rounded-lg border border-border bg-surface px-6 py-12 flex flex-col items-center gap-3 text-center');
  box.append(icon('chart-line', 'size-icon-md text-foreground-tertiary'), el('h2', 'type-section-title', heading), el('p', 'type-body text-foreground-secondary max-w-reading', text));
  const row = el('div', 'flex items-center gap-2 flex-wrap justify-center pt-1');
  actions.forEach((node) => row.append(node));
  box.append(row);
  return box;
}

function openAdd() {
  openAddDialog({
    onAdded: (outcomes) => {
      const added = outcomes.filter((item) => item.outcome === 'added');
      if (added.length === 0) return;
      added.forEach((item) => loadingIds.add(item.id));
      toast({ title: `Added ${added.length} ${added.length === 1 ? 'page' : 'pages'}`, description: 'Loading their history, the last 28 days first.', tone: 'success' });
      render();
      setTimeout(() => { added.forEach((item) => loadingIds.delete(item.id)); render(); }, 1800);
    },
  });
}

// -------------------------------------------------------------------------------------------------
// Detail: a drawer next to the list, or the whole page

function stepOrder() {
  return visibleRows().rows.map(({ page }) => page.id);
}
function step(delta) {
  const order = stepOrder();
  const at = order.indexOf(state.page);
  const target = order[at + delta];
  if (target !== undefined) set({ page: target });
}
function closeDetail() {
  const back = lastFocus;
  set({ page: null, shell: 'drawer' });
  back?.focus?.();
}

function mountDetail() {
  const key = `${state.page}|${state.shell}`;
  if (!state.page || !listPages().some((page) => page.id === state.page)) {
    unmountDetail();
    return;
  }
  if (detail && detailKey === key) {
    detail.update();
    return;
  }
  unmountDetail();
  detailKey = key;
  const order = stepOrder();
  const api = {
    get, set, shell: state.shell, pageId: state.page, onClose: closeDetail, onStep: step,
    canStep: (delta) => order[order.indexOf(state.page) + delta] !== undefined,
  };
  detail = createDetail(api);
  if (state.shell === 'drawer') {
    drawerHost = el('div', 'fixed inset-0 z-(--z-drawer) flex justify-end');
    const scrim = el('div', 'absolute inset-0 bg-(--scrim) md:bg-transparent');
    scrim.addEventListener('click', closeDetail);
    const panel = el('aside', 'relative w-(--drawer-w) max-md:w-full h-full bg-background border-l border-border shadow-inspector flex flex-col');
    panel.setAttribute('aria-labelledby', 'perf-detail-title-drawer');
    // Wide by default, because the charts and the What changed tables want room; the width is remembered
    panel.append(detail.root, resizeHandle(panel, { min: 480, fallback: 720, gutter: 56, key: 'preview.pages.drawer-width' }));
    drawerHost.append(scrim, panel);
    document.body.append(drawerHost);
    detail.focusTitle();
  } else {
    refs.pageSlot.replaceChildren(detail.root);
    window.scrollTo(0, 0);
    detail.focusTitle();
  }
}
function unmountDetail() {
  detail?.dispose();
  detail = null;
  detailKey = '';
  drawerHost?.remove();
  drawerHost = null;
  refs.pageSlot?.replaceChildren();
}

// -------------------------------------------------------------------------------------------------
// Frame

function frame() {
  view.replaceChildren();
  view.className = 'flex flex-col gap-4 px-3 md:px-4 lg:px-5 pt-5 pb-8';
  const header = el('section', 'flex flex-wrap items-start gap-x-4 gap-y-3');
  const titleBlock = el('div', 'flex min-w-0 flex-col gap-1 basis-full md:basis-auto md:flex-1');
  titleBlock.append(el('h1', 'type-page-title', 'Pages'));
  refs.meta = el('p', 'type-meta');
  titleBlock.append(refs.meta);
  const actions = el('div', 'flex items-center gap-3 md:ml-auto');
  refs.export = button('Export CSV', { className: `${BUTTON} hidden lg:flex`, iconName: 'download', onClick: () => exportRows(visibleRows().rows) });
  refs.add = button('Add pages', { className: BUTTON_PRIMARY, iconName: 'plus', onClick: openAdd });
  refs.add.querySelector('svg').setAttribute('class', 'size-icon');
  actions.append(refs.export, refs.add);
  header.append(titleBlock, actions);

  const tabsRow = el('div', 'flex items-end gap-4 border-b border-border -mt-1');
  const nav = el('nav', 'h-tab flex items-end gap-6');
  nav.setAttribute('aria-label', 'Pages sections');
  [['performance', 'Performance', '#/pages'], ['landing', 'Landing pages', '#/pages/landing']].forEach(([value, text, href]) => {
    const link = el('a', 'h-tab px-0.5 border-b-2 flex items-center', text);
    link.href = href;
    link.dataset.pagesTab = value;
    nav.append(link);
  });
  refs.tabs = nav;
  const review = el('label', 'ml-auto mb-2 flex items-center gap-2 type-meta');
  review.append(el('span', '', 'Preview state'));
  refs.review = selectField(REVIEW_STATES, state.review, (value) => set({ review: value }), 'Preview state');
  refs.review.classList.add('border-dashed');
  review.append(refs.review);
  tabsRow.append(nav, review);

  refs.banner = el('div', 'flex flex-col gap-2');
  filters = buildFilters({ get, set, scope: 'list' });
  refs.body = el('div', 'flex flex-col gap-3');
  refs.pageSlot = el('div', 'flex flex-col');
  view.append(header, tabsRow, refs.banner, refs.pageSlot, filters.root, refs.body);
}

function renderTabs() {
  refs.tabs.querySelectorAll('a').forEach((link) => {
    const on = link.dataset.pagesTab === tab;
    link.className = `h-tab px-0.5 border-b-2 flex items-center ${on ? 'border-primary type-body-strong text-primary-text' : 'border-transparent type-body text-foreground-secondary hover:text-foreground'}`;
    if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}

function banner(text, tone, extra) {
  const row = el('div', `rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap border ${tone === 'warning' ? 'border-warning-border bg-warning-subtle' : 'border-info-border bg-info-subtle'}`);
  row.append(icon(tone === 'warning' ? 'triangle-alert' : 'info', `size-icon shrink-0 ${tone === 'warning' ? 'text-warning-text' : 'text-info-text'}`), el('span', 'type-body text-foreground flex-1 min-w-0', text));
  if (extra) row.append(extra);
  return row;
}

function render() {
  if (!mounted) return;
  renderTabs();
  refs.banner.replaceChildren();
  refs.body.replaceChildren();
  refs.review.value = state.review;
  const connected = state.review !== 'notconnected';
  const pages = state.review === 'nopages' ? [] : listPages();
  const wholePage = state.shell === 'page' && state.page && tab === 'performance' && connected && pages.length > 0;
  refs.meta.textContent = connected ? `Search Console property ${HOST_NAME}. Final data through ${formatDay(FINAL_THROUGH, true)} (Pacific Time).` : 'Search Console is not connected.';
  refs.export.hidden = !connected || pages.length === 0;
  refs.add.hidden = !connected;
  filters.root.hidden = wholePage || !connected || pages.length === 0 || tab !== 'performance';
  refs.pageSlot.hidden = !wholePage;
  refs.body.hidden = wholePage;

  if (tab === 'landing') {
    filters.root.hidden = true;
    refs.add.hidden = true;
    refs.export.hidden = true;
    unmountDetail();
    refs.body.append(emptyState({ heading: 'Landing pages are not part of this preview', text: 'Page Intelligence (rankings, AI citations and Search Console numbers per page) keeps its own screen. The Performance tab is the part under review.', actions: [button('Open Performance', { className: BUTTON, onClick: () => { location.hash = '#/pages'; } })] }));
    return;
  }

  if (!connected) {
    unmountDetail();
    const connect = button('Connect Search Console', { className: BUTTON_PRIMARY, onClick: () => { toast({ title: 'Preview: connected', description: 'In the product this opens Google sign-in for an owner or admin.', tone: 'info' }); set({ review: 'connected' }); } });
    refs.body.append(emptyState({
      heading: 'Connect Search Console to see how your pages perform',
      text: 'Pick the pages that matter and see clicks, impressions, CTR and position for each one, compared with the previous month, with the country, device and query that explain every change. Owners and admins can connect.',
      actions: [connect],
    }));
    return;
  }

  if (state.review === 'reauth') {
    refs.banner.append(banner('Sync paused since Oct 20. Google asked us to sign in again. The numbers below stay visible.', 'warning', button('Reconnect', { className: BUTTON_SM, onClick: () => set({ review: 'connected' }) })));
  }
  if (state.review === 'syncing') {
    const bar = el('div', 'flex items-center gap-3 flex-1 min-w-48');
    const track = el('span', 'block h-1.5 flex-1 rounded-full bg-border-subtle overflow-hidden');
    const fill = el('span', 'block h-1.5 bg-primary');
    fill.style.width = '12%';
    track.append(fill);
    bar.append(track, el('span', 'type-meta num whitespace-nowrap', '58 of 487 days'));
    refs.banner.append(banner('Loading your history. The last 28 days load first, so you can already look around.', 'info', bar));
  }

  if (pages.length === 0) {
    unmountDetail();
    refs.body.append(emptyState({
      heading: 'Add the pages that matter',
      text: `Paste URLs, pick the pages that get the most clicks, or read a sitemap. You can watch up to ${WATCH_LIMIT} pages per project.`,
      actions: [button('Add pages', { className: BUTTON_PRIMARY, iconName: 'plus', onClick: openAdd })],
    }));
    return;
  }

  filters.sync();
  const { rows, ranges } = visibleRows();
  const ranged = el('p', 'type-meta');
  ranged.textContent = ranges.compare ? `${ranges.current.label} (${rangeText(ranges.current)}) against ${ranges.compare.label}. ${compareName(state.compare, ranges.current)}. Changes in clicks and impressions are per day when the ranges differ in length.` : `${ranges.current.label}. No comparison.`;

  const all = listPages().filter((page) => state.group === '' || page.group === state.group).map((page) => ({ page, model: pageModel(page.id, state) }));
  refs.body.append(renderSummary(all));
  if (selected.size > 0) refs.body.append(renderBulk(rows));
  refs.body.append(renderTable(rows, ranges), ranged);
  mountDetail();
}

// -------------------------------------------------------------------------------------------------
// Keyboard and routing

document.addEventListener('keydown', (event) => {
  if (!mounted || tab !== 'performance' || !state.page || popoverOpen()) return;
  const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    closeDetail();
    return;
  }
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'j') step(1);
  else if (event.key === 'k') step(-1);
  else if (event.key === 'e') document.querySelector('[aria-label="Export this page as CSV"]')?.click();
  else if (event.key === '[' || event.key === ']') {
    const order = ['prev', 'year', 'none'];
    const at = order.indexOf(state.compare);
    set({ compare: order[(Math.max(0, at) + (event.key === ']' ? 1 : order.length - 1)) % order.length] });
  }
});

function show(section) {
  tab = section === 'landing' ? 'landing' : 'performance';
  if (!mounted) {
    mounted = true;
    frame();
  }
  state = readState(location.search);
  render();
}
function hide() {
  unmountDetail();
  closePopovers();
  // The Pages query stays with Pages. The next page to open must not read its sort, page or filters.
  if (location.search !== '') history.replaceState(null, '', `${location.pathname}${location.hash}`);
}

window.addEventListener('preview-route', (event) => {
  if (event.detail.view === 'pages') show(event.detail.section);
  else if (mounted) hide();
});
if (location.hash.startsWith('#/pages')) show(location.hash.split('/')[2]);

