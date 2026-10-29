/* global document, window, history, location, URLSearchParams */
/**
 * SEO > Rankings for the static preview (docs/20 section 5.3). One page: the keyword table, its filters and bulk
 * actions. Add keywords, Import, Manage groups and the keyword inspector are dialogs and drawers on this page.
 * Import is a route (#/keywords/import) that opens its dialog over the table. Schedules, Costs and Runs are not
 * part of this page.
 *
 * The state lives in the query string (kw-model.js), so a link reproduces a view. A reload drops an unconfirmed
 * import and any edit (the data is in memory), as the preview is a mock.
 */
import { DEFAULT_STATE, COLUMNS, nextSort, readState, relativeTime, visibleRows, writeState, pageCount, isStale, formatInt } from './kw-model.js';
import { PAGE_SIZE, RUNS_PER_DAY, PLAN_LIMIT, activeCount, all, byId, currentRun, subscribe } from './kw-data.js';
import { renderTable, footerText } from './kw-table.js';
import { filterNodes } from './kw-filters.js';
import { openAddDialog } from './kw-add.js';
import { importProgress, onImportProgress, openImportDialog } from './kw-import.js';
import { openGroups } from './kw-groups.js';
import { archiveKeywords, deleteKeywords, openMoveGroup, openPriority, openRefresh, openTags, openTargetUrl } from './kw-bulk.js';
import { createInspector } from './kw-inspector.js';
import { BUTTON, BUTTON_PRIMARY, BUTTON_SM, FIELD, button, checkRow, closePopovers, icon, iconButton, popover, popoverOpen, resizeHandle, segmented, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';

const view = document.querySelector('[data-view="keywords"]');
const DRAWER_KEY = 'preview.rankings.drawer-width';
const IMPORT_HASH = '#/keywords/import';

let state = DEFAULT_STATE;
let mounted = false;
let selected = new Set();
let allMatching = false;
let runsLeft = RUNS_PER_DAY;
let loadError = false;
let inspector = null;
let inspectorId = null;
let drawerHost = null;
let importFrame = null;
let lastFocus = null;
const refs = {};

// -------------------------------------------------------------------------------------------------
// State

const get = () => state;

/** Puts the state in the address bar, keeping the path and the route. */
function writeUrl() {
  history.replaceState(null, '', `${location.pathname}${writeState(state)}${location.hash}`);
}

/** Writes the state to the address bar. A change of search, filters or the active set starts again at page 1. */
function set(patch) {
  const narrowing = 'q' in patch || 'filters' in patch || 'archived' in patch || 'sort' in patch;
  if (narrowing) allMatching = false;
  state = { ...state, page: narrowing && !('page' in patch) ? 1 : state.page, ...patch };
  writeUrl();
  render();
}

const setFilter = (key, value) => set({ filters: { ...state.filters, [key]: value } });
const clearFilters = () => set({ filters: DEFAULT_STATE.filters });

// -------------------------------------------------------------------------------------------------
// Rows and selection

const liveIds = () => new Set(all().map((kw) => kw.id));

/** The ids a bulk action applies to: the chosen rows, or every row the filters match. */
function targetIds(rows) {
  if (allMatching) return rows.map((kw) => kw.id);
  const live = liveIds();
  return [...selected].filter((id) => live.has(id));
}

function clearSelection() {
  selected = new Set();
  allMatching = false;
  render();
}

// -------------------------------------------------------------------------------------------------
// Inspector drawer

/** Runs `proceed` now, or after the person has chosen to discard an unsaved draft in the open card. */
function leaveInspector(proceed) {
  if (inspector) inspector.confirmLeave(proceed);
  else proceed();
}

function closeInspector() {
  leaveInspector(() => {
    const back = lastFocus;
    set({ inspect: null });
    back?.focus?.();
  });
}

function step(delta) {
  leaveInspector(() => {
    const rows = visibleRows(all(), state);
    const at = rows.findIndex((kw) => kw.id === inspectorId);
    const target = rows[at + delta];
    if (!target) return;
    set({ inspect: target.id, page: Math.floor((at + delta) / PAGE_SIZE) + 1 });
  });
}

function canStep(delta) {
  const rows = visibleRows(all(), state);
  const at = rows.findIndex((kw) => kw.id === inspectorId);
  return rows[at + delta] !== undefined;
}

function unmountInspector() {
  inspector?.dispose();
  inspector = null;
  inspectorId = null;
  drawerHost?.remove();
  drawerHost = null;
}

function mountInspector(id) {
  unmountInspector();
  inspectorId = id;
  drawerHost = el('div', 'fixed inset-0 z-(--z-drawer) flex justify-end');
  const scrim = el('div', 'absolute inset-0 bg-(--scrim) md:bg-transparent');
  scrim.addEventListener('click', closeInspector);
  const panel = el('aside', 'relative w-(--drawer-w) max-md:w-full h-full bg-background border-l border-border shadow-inspector flex flex-col');
  panel.setAttribute('aria-labelledby', 'kw-inspector-title');
  inspector = createInspector({ id, onClose: closeInspector, onStep: step, canStep });
  panel.append(inspector.root, resizeHandle(panel, { min: 360, fallback: 400, gutter: 56, key: DRAWER_KEY }));
  drawerHost.append(scrim, panel);
  document.body.append(drawerHost);
  inspector.focusTitle();
}

function syncInspector() {
  if (state.inspect !== null && !byId(state.inspect)) {
    state = { ...state, inspect: null };
  }
  if (state.inspect === null) {
    if (inspector) unmountInspector();
    return;
  }
  if (inspectorId !== state.inspect) mountInspector(state.inspect);
}

// -------------------------------------------------------------------------------------------------
// Import route

function openImport() {
  importFrame = openImportDialog({
    onClose: () => {
      importFrame = null;
      if (location.hash === IMPORT_HASH) history.replaceState(null, '', `${location.pathname}${location.search}#/keywords`);
      render();
    },
    onKeep: keepImportRoute,
  });
}

/** "Keep importing" after Back or a route change: the address goes back to the import, and the router shows it. */
function keepImportRoute() {
  if (location.hash === IMPORT_HASH) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${IMPORT_HASH}`);
  // replaceState fires no hashchange of its own, so one is sent for the router to show Rankings again.
  window.dispatchEvent(new window.Event('hashchange'));
}

function syncImport() {
  const wanted = location.hash === IMPORT_HASH;
  if (wanted && !importFrame) openImport();
  // Leaving the import asks the Stop question first; the route stays put while it is open.
  else if (!wanted && importFrame) importFrame.dismiss();
}

// -------------------------------------------------------------------------------------------------
// Pieces

function emptyState({ heading, text, actions = [] }) {
  const box = el('section', 'rounded-lg border border-border bg-surface px-6 py-12 flex flex-col items-center gap-3 text-center');
  box.append(icon('list', 'size-icon-md text-foreground-tertiary'), el('h2', 'type-section-title', heading));
  if (text) box.append(el('p', 'type-body text-foreground-secondary max-w-reading', text));
  if (actions.length > 0) {
    const row = el('div', 'flex items-center gap-2 flex-wrap justify-center pt-1');
    row.append(...actions);
    box.append(row);
  }
  return box;
}

function bulkBar(rows) {
  const bar = el('div', 'rounded-lg border border-border bg-surface-subtle px-3 py-2 flex items-center gap-2 flex-wrap');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Bulk actions');
  const targets = targetIds(rows);
  const count = targets.length;
  bar.append(el('span', 'type-body-strong', allMatching ? `All ${formatInt(count)} matching keywords` : `${formatInt(count)} selected`));
  const onPage = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  if (!allMatching && onPage.length > 0 && onPage.every((kw) => selected.has(kw.id)) && rows.length > onPage.length) {
    bar.append(button(`Select all ${formatInt(rows.length)} matching`, { className: `${BUTTON_SM} text-link`, onClick: () => {
      allMatching = true;
      render();
    } }));
  }
  const refreshBlocked = state.archived ? 'Not for archived keywords' : currentRun() ? 'A refresh is already running' : runsLeft === 0 ? 'No manual runs left today' : '';
  const actions = [
    button('Add tags', { className: BUTTON_SM, iconName: 'tag', onClick: () => openTags({ ids: targets, count }, { onDone: render }) }),
    button('Move to group', { className: BUTTON_SM, iconName: 'folder', onClick: () => openMoveGroup({ ids: targets, count }, { onDone: render }) }),
    button('Set target URL', { className: BUTTON_SM, iconName: 'target', onClick: () => openTargetUrl({ ids: targets, count }, { onDone: render }) }),
    button('Set priority', { className: BUTTON_SM, iconName: 'flag', onClick: () => openPriority({ ids: targets, count }, { onDone: render }) }),
  ];
  const refresh = button('Refresh metrics', { className: BUTTON_SM, iconName: 'refresh-cw', onClick: () => openRefreshDialog(rows, targets) });
  refresh.disabled = refreshBlocked !== '';
  refresh.dataset.tip = refreshBlocked || 'Read the search volume, difficulty and CPC again';
  actions.push(refresh);
  actions.push(button(state.archived ? 'Unarchive' : 'Archive', {
    className: BUTTON_SM,
    iconName: state.archived ? 'archive-restore' : 'archive',
    onClick: () => archiveKeywords(targets, !state.archived, { byFilter: allMatching }, clearSelection),
  }));
  actions.push(button('Delete', { className: `${BUTTON_SM} text-negative-text`, iconName: 'trash-2', onClick: () => deleteKeywords(targets, clearSelection) }));
  bar.append(...actions, button('Clear', { className: `${BUTTON_SM} ml-auto text-foreground-secondary`, onClick: clearSelection }));
  return bar;
}

function openRefreshDialog(rows, targets) {
  const active = all().filter((kw) => !kw.archived);
  openRefresh({
    selected: targets,
    matching: rows.map((kw) => kw.id),
    stale: active.filter(isStale).map((kw) => kw.id),
    runsLeft,
  }, {
    onStarted: () => {
      runsLeft -= 1;
      render();
    },
  });
}

function refreshItem(panel, close) {
  const blocked = runsLeft === 0 ? 'No manual runs left today. The limit resets at 00:00 UTC.' : currentRun() ? 'A refresh is already running.' : '';
  const row = button('Refresh metrics', { className: 'min-h-8 px-2 rounded-md flex items-center justify-between gap-3 type-body text-foreground hover:bg-surface-hover disabled:text-foreground-disabled', onClick: () => {
    close();
    openRefreshDialog(visibleRows(all(), state), []);
  } });
  row.append(el('span', 'type-meta text-foreground-tertiary num', `${runsLeft} of ${RUNS_PER_DAY} left today`));
  row.disabled = blocked !== '';
  panel.append(row);
  if (blocked) panel.append(el('p', 'px-2 type-meta text-foreground-tertiary max-w-64', blocked));
}

function renderBody(rows, pageRows) {
  refs.body.replaceChildren();
  if (loadError) {
    refs.body.append(emptyState({
      heading: 'The keywords did not load',
      text: 'Your filters are kept. Try again in a moment.',
      actions: [button('Try again', { className: BUTTON, iconName: 'refresh-cw', onClick: () => {
        loadError = false;
        render();
      } })],
    }));
    return;
  }
  const archivedCount = all().filter((kw) => kw.archived).length;
  if (state.archived && archivedCount === 0) {
    refs.body.append(emptyState({ heading: 'No archived keywords' }));
    return;
  }
  if (!state.archived && activeCount() === 0) {
    refs.body.append(emptyState({
      heading: 'No keywords tracked yet',
      text: 'Add keywords by hand or import a CSV file. Their metrics arrive within minutes.',
      actions: [
        button('Add keywords', { className: BUTTON_PRIMARY, iconName: 'plus', onClick: openAdd }),
        button('Import', { className: BUTTON, iconName: 'upload', onClick: () => { location.hash = IMPORT_HASH; } }),
      ],
    }));
    return;
  }
  if (rows.length === 0) {
    refs.body.append(state.q
      ? emptyState({ heading: `No keywords match “${state.q}”`, actions: [button('Clear search', { className: BUTTON, onClick: () => set({ q: '' }) })] })
      : emptyState({ heading: 'No keywords match these filters', actions: [button('Clear filters', { className: BUTTON, onClick: clearFilters })] }));
    return;
  }
  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(rows.length, state.page * PAGE_SIZE);
  const pages = pageCount(rows.length);
  const footer = el('div', 'flex items-center gap-2 flex-wrap');
  footer.append(el('span', 'type-meta num mr-auto', footerText(from, to, rows.length)));
  const prev = button('Previous', { className: BUTTON_SM, onClick: () => set({ page: state.page - 1 }) });
  prev.disabled = state.page <= 1;
  const next = button('Next', { className: BUTTON_SM, onClick: () => set({ page: state.page + 1 }) });
  next.disabled = state.page >= pages;
  footer.append(prev, el('span', 'type-meta num', `${state.page} of ${pages}`), next);
  refs.body.append(renderTable({ rows: pageRows, state, selected, ctx: tableContext() }), footer);
}

function tableContext() {
  return {
    sort: (key) => set({ sort: nextSort(state.sort, key) }),
    select: (id, on) => {
      if (on) selected.add(id);
      else selected.delete(id);
      allMatching = false;
      render();
    },
    selectPage: (rows, on) => {
      rows.forEach((kw) => (on ? selected.add(kw.id) : selected.delete(kw.id)));
      allMatching = false;
      render();
    },
    open: (id) => {
      lastFocus = document.activeElement;
      set({ inspect: id });
    },
  };
}

function openAdd() {
  lastFocus = document.activeElement;
  openAddDialog({ onInspect: (id) => set({ inspect: id }) });
}

function columnsPopover(trigger) {
  popover(trigger, (panel) => {
    panel.append(el('p', 'px-2 pt-1 type-label text-foreground-tertiary', 'Density'));
    panel.append(segmented([['default', 'Comfortable'], ['compact', 'Compact (default)']], state.density, (value) => set({ density: value }), 'Density'));
    panel.append(el('p', 'px-2 pt-2 type-label text-foreground-tertiary', 'Columns'));
    COLUMNS.forEach(([key, label]) => {
      panel.append(checkRow(label, state.cols.includes(key), (on) => {
        const keep = COLUMNS.map(([id]) => id).filter((id) => (id === key ? on : state.cols.includes(id)));
        set({ cols: keep.length > 0 ? keep : [key] });
      }));
    });
  }, { label: 'Columns' });
}

// -------------------------------------------------------------------------------------------------
// Frame and render

function frame() {
  view.replaceChildren();
  view.className = 'flex flex-col gap-4 px-3 md:px-4 lg:px-5 pt-5 pb-8';
  const header = el('section', 'flex flex-wrap items-start gap-x-4 gap-y-3');
  const titleBlock = el('div', 'flex min-w-0 flex-col gap-1 basis-full md:basis-auto md:flex-1');
  titleBlock.append(el('h1', 'type-page-title', 'Keywords'));
  refs.meta = el('p', 'type-meta');
  refs.progress = el('div', 'flex flex-col gap-1');
  titleBlock.append(refs.meta, refs.progress);

  const actions = el('div', 'flex items-center gap-3 md:ml-auto flex-wrap');
  const exportButton = button('Export', { className: `${BUTTON} hidden lg:flex`, iconName: 'download' });
  exportButton.disabled = true;
  exportButton.dataset.tip = 'Export is not in this preview';
  const more = iconButton('ellipsis-vertical', 'More actions', () => {});
  popover(more, (panel, { close }) => {
    refreshItem(panel, close);
    const item = 'min-h-8 px-2 rounded-md flex items-center text-left type-body text-foreground hover:bg-surface-hover';
    panel.append(
      button('Manage groups', { className: item, onClick: () => {
        close();
        openGroups();
      } }),
      button('Import keywords', { className: item, onClick: () => {
        close();
        location.hash = IMPORT_HASH;
      } }),
    );
  }, { label: 'More actions' });
  const add = button('Add keywords', { className: BUTTON_PRIMARY, iconName: 'plus', onClick: openAdd });
  actions.append(importButton(), exportButton, more, add);
  header.append(titleBlock, actions);

  const toolbar = el('section', 'flex items-center gap-2 flex-wrap');
  refs.search = el('input', `${FIELD} h-control w-56 max-w-full`);
  refs.search.type = 'search';
  refs.search.placeholder = 'Search keywords';
  refs.search.setAttribute('aria-label', 'Search keywords');
  refs.search.addEventListener('input', () => set({ q: refs.search.value.trim() }));
  refs.archivedSwitch = segmented([['active', 'Active'], ['archived', 'Archived']], 'active', (value) => set({ archived: value === 'archived' }), 'Keyword set');
  refs.filterSlot = el('div', 'flex items-center gap-2 flex-wrap');
  refs.columns = button('Columns', { className: `${BUTTON_SM} ml-auto`, iconName: 'list-ordered' });
  columnsPopover(refs.columns);
  toolbar.append(refs.search, refs.archivedSwitch, refs.filterSlot, refs.columns);

  refs.banner = el('div', 'flex flex-col gap-2');
  refs.bulk = el('div', 'flex flex-col');
  refs.body = el('div', 'flex flex-col gap-3');
  view.append(header, toolbar, refs.banner, refs.bulk, refs.body);
}

function importButton() {
  return button('Import', { className: BUTTON, iconName: 'upload', onClick: () => {
    location.hash = IMPORT_HASH;
  } });
}

function renderHeader() {
  const active = all().filter((kw) => !kw.archived);
  const latest = active.reduce((max, kw) => (kw.metricsAt !== null && kw.metricsAt > max ? kw.metricsAt : max), 0);
  refs.meta.textContent = `${latest ? `Updated ${relativeTime(latest)}` : 'Not updated yet'} · ${formatInt(active.length)} tracked keywords · ${formatInt(activeCount())} of ${formatInt(PLAN_LIMIT)} plan keywords used`;
  refs.progress.replaceChildren();
  const progress = importProgress();
  if (progress) {
    refs.progress.append(el('p', 'type-body-strong text-foreground', 'Importing keywords'), el('p', 'type-meta num text-foreground-secondary', `${formatInt(progress.done)} of ${formatInt(progress.total)} rows`));
  }
  const run = currentRun();
  if (run) refs.progress.append(el('p', 'type-meta num text-foreground-secondary', `Refreshing metrics: ${formatInt(run.done)} of ${formatInt(run.total)} read`));
}

function render() {
  if (!mounted) return;
  const records = all();
  const ids = liveIds();
  selected = new Set([...selected].filter((id) => ids.has(id)));
  const rows = visibleRows(records, state);
  const pages = pageCount(rows.length);
  const clamped = state.page > pages;
  if (clamped) state = { ...state, page: pages };
  const pageRows = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  // The clamped page goes back to the address, so a reload shows the page on screen. Not while Pages is shown.
  if (clamped && !view.hidden) writeUrl();

  renderHeader();
  // Not while typing: a trimmed value would drop the space the user has just typed.
  if (document.activeElement !== refs.search) refs.search.value = state.q;
  refs.archivedSwitch.sync(state.archived ? 'archived' : 'active');
  refs.filterSlot.replaceChildren(...filterNodes(state, { state: get, setFilter, clearFilters }));
  refs.bulk.replaceChildren(...(selected.size > 0 || allMatching ? [bulkBar(rows)] : []));
  renderBody(rows, pageRows);
  syncInspector();
}

// -------------------------------------------------------------------------------------------------
// Lifecycle

function show() {
  if (!mounted) {
    mounted = true;
    frame();
  }
  const parsed = readState(location.search);
  state = parsed.state;
  loadError = new URLSearchParams(location.search).get('load') === 'error';
  if (parsed.dropped.length > 0) toast({ title: 'A filter from the link was left out', tone: 'info' });
  render();
  syncImport();
  if (pendingAdd) {
    pendingAdd = false;
    openAdd();
  }
}

/** Drops the Rankings query from the address, so the page that opens next does not read its sort or page. */
function releaseAddress() {
  if (location.search !== '') history.replaceState(null, '', `${location.pathname}${location.hash}`);
}

function hide() {
  unmountInspector();
  closePopovers();
  releaseAddress();
}

// Pages reads the address when it opens, so Rankings lets go of its query before the next page is shown.
window.addEventListener('preview-leave', (event) => {
  if (mounted && event.detail.from === 'keywords') releaseAddress();
});
window.addEventListener('preview-route', (event) => {
  if (event.detail.view === 'keywords') show();
  else if (mounted) hide();
});
// Back, or any route change, while the import is open goes through the Stop question (syncImport).
window.addEventListener('hashchange', () => {
  if (mounted) syncImport();
});
// The palette's "Add keywords" sets the route first, so the page may not be on screen yet: open it once it is.
let pendingAdd = false;
window.addEventListener('kw-add', () => {
  if (mounted && !view.hidden) openAdd();
  else pendingAdd = true;
});

// Leaving the page through a route change asks before a card's unsaved draft is dropped (10 section 13.2).
window.PreviewUI.addLeaveGuard((kind) => (kind === 'route' && inspector?.dirty()
  ? { message: 'Your unsaved changes to this keyword will be lost.', onKeep: () => {}, onDiscard: () => {} }
  : null));
subscribe(() => render());
onImportProgress(() => render());

document.addEventListener('keydown', (event) => {
  if (!mounted || view.hidden) return;
  if (event.key === 'Escape') {
    if (inspector && !document.querySelector('dialog[open]') && !popoverOpen()) {
      event.preventDefault();
      closeInspector();
    }
    return;
  }
  const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
  if (typing || event.metaKey || event.ctrlKey || event.altKey || popoverOpen() || document.querySelector('dialog[open]')) return;
  if (event.key === '/') {
    event.preventDefault();
    refs.search.focus();
  } else if (inspector && event.key === 'j') step(1);
  else if (inspector && event.key === 'k') step(-1);
});

window.addEventListener('pagehide', () => closePopovers());

if (!location.hash || location.hash.startsWith('#/keywords') || location.hash.startsWith('#/rankings')) show();
