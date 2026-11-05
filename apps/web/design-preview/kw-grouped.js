/* global document, window, location, CSS */
/**
 * Rankings, grouped (a mock for the owner's review): the Eventus Security keywords in the table of the Rankings
 * page, with the columns and widths of the app, and a view switch in the table toolbar between "By group" (a group is
 * a row with its own numbers, the chevron opens its keywords in place, as the Topics tab shows topics) and "All
 * keywords". Everything on the page works: country, filter, columns, export, More, Add keywords and Import,
 * selection with bulk actions, the menus of rows and groups, and the drawers. A reload starts from the fixtures
 * again. Reached at #/keywords, the page the sidebar's Keywords links to.
 */
import { UNGROUPED, archiveKeywords, deleteKeywords, store, usedCountries } from './kw-grouped-data.js';
import { BUTTON_SM, icon } from './perf-ui.js';
import { confirmDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { ALL_COUNTRIES, addScope, best, columnsFor, clicks, impressions, derived, gained, groupOf, isRank, measures, monthly, plural, rankText, refresh, setRenderer, shown, sparkline, state, volumeText } from './kw-grouped-model.js';
import { openAdd, openMove } from './kw-grouped-dialogs.js';
import { openGroup, openKeyword, redrawDrawer } from './kw-grouped-drawer.js';
import { bindPages, closePages, pagesOf } from './kw-grouped-pages.js';
import { addMenu, checkNow, columnsMenu, countryMenu, exportItems, exportMenu, filterMenu, groupMenu, keywordMenu, moreMenu } from './kw-grouped-menus.js';

const view = document.querySelector('[data-view="keywords"]');

/** How many keywords open under a group before "Show all": the rest are one click away. */
const CHILD_LIMIT = 8;
const KEYWORD_MIN = 280;
const DEVICES = [
  ['desktop', 'Desktop', 'monitor'],
  ['mobile', 'Mobile', 'smartphone'],
];
const CELL = 'border-b border-border-subtle px-3 align-middle';

// -------------------------------------------------------------------------------------------------
// Cells

const muted = (text) => el('span', 'type-table text-foreground-tertiary', text);
const num = (text) => el('span', 'type-table num text-foreground', text);

function td(content, className = '') {
  const cell = el('td', `${CELL} ${className}`);
  if (content !== null && content !== undefined) cell.append(content);
  return cell;
}

function twoLine(top, bottom) {
  const wrap = el('span', 'flex flex-col leading-tight');
  wrap.append(num(top));
  if (bottom) wrap.append(el('span', 'type-label text-foreground-tertiary', bottom));
  return wrap;
}

/** A rank on one device with the places it moved since the last check beside it, as the app's rank cell shows it. */
function rankCell(keyword, device) {
  const rank = keyword.ranks[device];
  const line = el('span', 'flex items-baseline gap-2');
  line.append(el('span', `type-table num ${isRank(rank) ? 'text-foreground' : 'text-foreground-tertiary'}`, rankText(rank)));
  const move = gained(keyword, device);
  if (move !== 0 && isRank(rank)) line.append(el('span', `type-label num ${move > 0 ? 'text-positive-text' : 'text-negative-text'}`, `${move > 0 ? '↑' : '↓'}${Math.abs(move)}`));
  return line;
}

const pending = (keyword) => keyword.ranks[state.device] === 'p';

function aioCell(info) {
  if (info.aio.kind === 'cited') return el('span', 'inline-flex h-6 items-center gap-1 rounded-sm bg-positive-subtle px-1.5 type-label text-positive-text', `✓ Cited #${info.aio.position}`);
  if (info.aio.kind === 'present') return icon('check', 'size-icon-sm text-primary-text');
  return muted(info.aio.kind === 'pending' ? 'Pending' : 'No AIO');
}

function featuresCell(info) {
  if (info.features.length === 0) return muted('Pending');
  const row = el('span', 'flex items-center gap-1.5');
  info.features.forEach((name) => row.append(icon(name, 'size-icon-sm text-foreground-tertiary')));
  return row;
}

/** The keyword's search volume over the last 12 months, whatever its rank: the column is about demand, not position. */
function trendCell(keyword) {
  if (keyword.volume === 0) {
    const line = el('span', 'block h-px w-16 border-t border-dashed border-border-strong');
    line.setAttribute('aria-label', 'Search volume trend: no monthly volumes yet');
    return line;
  }
  const months = monthly(keyword);
  const text = (value) => value.toLocaleString('en-US');
  return sparkline(months, `Search volume trend, last 12 months: from ${text(months[0])} to ${text(months.at(-1))}, peak ${text(Math.max(...months))}`, undefined, true);
}

function menuButton(label, attach) {
  const button = el('button', 'size-control-sm rounded-md flex items-center justify-center text-foreground-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 hover:bg-surface-hover hover:text-foreground');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(icon('ellipsis', 'size-icon'));
  attach(button);
  return button;
}

function checkbox(label, checked, indeterminate = false) {
  const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
  box.type = 'checkbox';
  box.checked = checked;
  box.indeterminate = indeterminate;
  box.setAttribute('aria-label', label);
  return box;
}

// -------------------------------------------------------------------------------------------------
// Rows

function selectCell(label, ids) {
  const chosen = ids.filter((id) => state.selected.has(id)).length;
  const cell = el('td', `${CELL} sticky left-0 z-(--z-pinned-cell) w-10 bg-inherit px-0 text-center`);
  const box = checkbox(label, ids.length > 0 && chosen === ids.length, chosen > 0 && chosen < ids.length);
  box.dataset.pick = ids.join(',');
  cell.append(box);
  return cell;
}

function keywordRow(keyword, columns, grouped) {
  const info = derived(keyword);
  const chosen = state.selected.has(keyword.id);
  const row = el('tr', `group h-row cursor-default ${chosen ? 'bg-surface-selected' : 'bg-surface'} hover:bg-surface-hover`);
  row.dataset.keyword = keyword.id;
  const name = el('th', `${CELL} sticky left-10 z-(--z-pinned-cell) bg-inherit ${grouped ? 'pl-9' : ''} pr-3 text-left font-normal border-r border-r-border-subtle`);
  name.scope = 'row';
  const line = el('span', 'flex items-center gap-2 min-w-0');
  line.append(el('span', 'truncate type-table text-foreground', keyword.keyword));
  if (info.url) {
    const count = pagesOf(keyword).length;
    const link = el('a', 'h-6 min-w-6 shrink-0 rounded-md px-1 flex items-center justify-center gap-0.5 text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
    link.href = info.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.dataset.pages = keyword.id;
    link.setAttribute('aria-label', `Open ${info.url}${count > 1 ? `. ${count} pages rank for this keyword` : ''}`);
    link.append(icon('arrow-up-right', 'size-icon-sm'));
    if (count > 1) link.append(el('span', 'type-micro num text-warning-text', String(count)));
    line.append(link);
  }
  name.append(line);
  const top = best(keyword);
  const cells = {
    country: () => td(el('span', 'type-table text-foreground', keyword.country)),
    rank: () => td(rankCell(keyword, state.device)),
    url: () => td(info.url ? el('span', 'block truncate type-table text-link', info.url.replace('https://', '')) : muted('n/a')),
    volume: () => td(pending(keyword) ? muted('Pending') : keyword.volume === 0 ? muted('No data') : num(volumeText(keyword.volume))),
    impressions: () => td(pending(keyword) || keyword.volume === 0 ? muted(pending(keyword) ? 'Pending' : 'No data') : num(impressions(keyword).toLocaleString('en-US'))),
    clicks: () => td(pending(keyword) || keyword.volume === 0 ? muted(pending(keyword) ? 'Pending' : 'No data') : num(clicks(keyword).toLocaleString('en-US'))),
    kd: () => td(pending(keyword) ? muted('Pending') : keyword.kd === null ? muted('No data') : num(String(keyword.kd))),
    cpc: () => td(keyword.cpc ? num(`$${keyword.cpc.toFixed(2)}`) : muted(pending(keyword) ? 'Pending' : 'No data')),
    intent: () => td(pending(keyword) ? muted('Pending') : el('span', 'type-table text-foreground', keyword.intent[0].toUpperCase() + keyword.intent.slice(1))),
    features: () => td(featuresCell(info)),
    aio: () => td(aioCell(info)),
    trend: () => td(trendCell(keyword)),
    priority: () => td(num(String(keyword.priority))),
    group: () => td(keyword.group ? el('span', 'block truncate type-table text-foreground', keyword.group) : muted('None')),
    tags: () => td(muted('None')),
    best: () => td(top === Infinity ? muted('n/a') : num(String(top))),
    updated: () => td(el('span', 'type-table text-foreground', info.updated)),
    added: () => td(el('span', 'type-table text-foreground-secondary', info.added)),
  };
  row.append(selectCell(`Select ${keyword.keyword}`, [keyword.id]), name, ...columns.map((column) => cells[column.id]()), td(menuButton(`Actions for ${keyword.keyword}`, (button) => keywordMenu(button, keyword)), 'px-1'));
  return row;
}

function groupRow(group, items, columns) {
  const open = state.expanded.has(group.name) || state.search !== '';
  const m = measures(items);
  const ids = items.map((keyword) => keyword.id);
  const row = el('tr', 'group h-row cursor-default bg-surface-subtle hover:bg-surface-hover');
  row.dataset.group = group.name;
  const name = el('th', `${CELL} sticky left-10 z-(--z-pinned-cell) bg-inherit px-3 text-left font-normal border-r border-r-border-subtle`);
  name.scope = 'row';
  const line = el('span', 'flex items-center gap-2 min-w-0');
  const toggle = el('button', 'size-6 shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
  toggle.type = 'button';
  toggle.dataset.toggle = group.name;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the ${plural(items.length, 'keyword')} in ${group.name}`);
  toggle.append(icon(open ? 'chevron-down' : 'chevron-right', 'size-icon'));
  const text = el('span', 'min-w-0 flex flex-col');
  text.append(el('span', 'truncate type-body-strong text-foreground', group.name));
  const movers = [m.up > 0 ? `↑${m.up}` : '', m.down > 0 ? `↓${m.down}` : ''].filter(Boolean).join(' ');
  text.append(el('span', 'truncate type-label text-foreground-tertiary', `${plural(m.count, 'keyword')}${m.countries > 1 ? ` · ${m.countries} countries` : ''}${movers ? ` · ${movers}` : ''}`));
  line.append(toggle, text);
  name.append(line);
  const rankOf = (device) => td(num(`${m[device].top10} in top 10`));
  const cells = {
    country: () => td(),
    rank: () => rankOf(state.device),
    url: () => td(),
    volume: () => td(twoLine(m.volume.toLocaleString('en-US'), 'a month')),
    impressions: () => td(twoLine(m.impressions.toLocaleString('en-US'), '28 days')),
    clicks: () => td(twoLine(m.clicks.toLocaleString('en-US'), '28 days')),
    kd: () => td(twoLine(m.kd === null ? 'n/a' : String(m.kd), 'average')),
    cpc: () => td(twoLine(m.cpc === null ? 'n/a' : `$${m.cpc.toFixed(2)}`, 'average')),
    intent: () => td(),
    features: () => td(),
    aio: () => td(m.cited > 0 ? twoLine(String(m.cited), 'cited') : muted('n/a')),
    trend: () => td(sparkline(m.trend, `Search volume of ${group.name}, last 12 months`, undefined, true)),
    priority: () => td(),
    group: () => td(),
    tags: () => td(),
    best: () => td(),
    updated: () => td(el('span', 'type-table text-foreground', store.updated === 'Updated just now' ? 'Nov 4, 14:30' : 'Nov 4, 06:12')),
    added: () => td(),
  };
  row.append(selectCell(`Select ${group.name}`, ids), name, ...columns.map((column) => cells[column.id]()), td(menuButton(`Actions for ${group.name}`, (button) => groupMenu(button, group.name)), 'px-1'));
  return row;
}

// -------------------------------------------------------------------------------------------------
// Order

const rankValue = (keyword, device) => (isRank(keyword.ranks[device]) ? keyword.ranks[device] : 1000);
const bestValue = (keyword) => (best(keyword) === Infinity ? 1000 : best(keyword));
const keywordKey = {
  name: (keyword) => keyword.keyword,
  rank: (keyword) => rankValue(keyword, state.device),
  volume: (keyword) => keyword.volume,
  clicks,
  impressions,
  kd: (keyword) => keyword.kd ?? -1,
  cpc: (keyword) => keyword.cpc,
  priority: (keyword) => keyword.priority,
  best: bestValue,
  updated: (keyword) => derived(keyword).updated,
};

function sortKeywords(items) {
  const { key, dir } = state.sort;
  const read = keywordKey[key];
  const sign = !read ? -1 : dir === 'asc' ? 1 : -1;
  const by = read ?? keywordKey.volume;
  return [...items].sort((a, b) => (by(a) > by(b) ? sign : by(a) < by(b) ? -sign : 0));
}

function sortGroups(entries) {
  const { key, dir } = state.sort;
  const value = {
    name: ([group]) => group.name,
    rank: ([, , m]) => m[state.device].value ?? 1000,
    volume: ([, , m]) => m.volume,
    clicks: ([, , m]) => m.clicks,
    impressions: ([, , m]) => m.impressions,
    kd: ([, , m]) => m.kd ?? -1,
    cpc: ([, , m]) => m.cpc ?? -1,
  }[key];
  if (!value) return entries;
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => (value(a) > value(b) ? sign : value(a) < value(b) ? -sign : 0));
}

// -------------------------------------------------------------------------------------------------
// Table

function headerContent(column, grouped) {
  const words = el('span', 'flex flex-col items-start leading-tight min-w-0');
  words.append(el('span', 'truncate type-table-header text-foreground-tertiary', column.label));
  if (grouped && column.note) words.append(el('span', 'type-micro text-foreground-tertiary', column.note));
  if (!column.sort) return words;
  const active = state.sort.key === column.sort;
  const button = el('button', `flex items-center gap-1 min-w-0 w-full rounded-sm text-left ${active ? 'text-foreground' : ''}`);
  button.type = 'button';
  button.dataset.sort = column.sort;
  button.append(words);
  if (active) button.append(icon(state.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down', 'size-icon-sm shrink-0 text-foreground'));
  return button;
}

function headerCell(column, grouped) {
  const th = el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle');
  if (column.tip) th.title = column.tip;
  if (column.sort) th.setAttribute('aria-sort', state.sort.key === column.sort ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  th.append(headerContent(column, grouped));
  return th;
}

function emptyState(title, text, action) {
  const box = el('div', 'flex flex-col items-center gap-2 px-6 py-14 text-center');
  box.append(el('h3', 'type-section-title', title), el('p', 'type-body text-foreground-secondary max-w-md', text));
  if (action) box.append(action);
  return box;
}

function actionButton(label, run, primary = false) {
  const node = el('button', primary ? 'h-control px-3 rounded-md bg-primary text-primary-foreground type-body-strong hover:bg-primary-hover' : 'h-control px-3 rounded-md border border-border bg-surface type-body-strong hover:bg-surface-hover');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', run);
  return node;
}

function tableBody(grouped, columns, items) {
  const body = el('tbody', '');
  if (!grouped) {
    sortKeywords(items).forEach((keyword) => body.append(keywordRow(keyword, columns, false)));
    return body;
  }
  const names = [...store.groups.map((group) => group.name), UNGROUPED];
  const entries = names
    .map((name) => [store.groups.find((group) => group.name === name) ?? { name, note: '' }, items.filter((keyword) => groupOf(keyword) === name)])
    .filter(([, members]) => members.length > 0)
    .map(([group, members]) => [group, members, measures(members)]);
  const span = columns.length + 3;
  sortGroups(entries).forEach(([group, members]) => {
    body.append(groupRow(group, members, columns));
    if (!(state.expanded.has(group.name) || state.search !== '')) return;
    const ordered = sortKeywords(members);
    const visible = state.showAll.has(group.name) || state.search !== '' ? ordered : ordered.slice(0, CHILD_LIMIT);
    visible.forEach((keyword) => body.append(keywordRow(keyword, columns, true)));
    if (ordered.length > CHILD_LIMIT && state.search === '') {
      const row = el('tr', 'bg-surface');
      const cell = el('td', `${CELL} pl-14`);
      cell.colSpan = span;
      const more = el('button', 'type-table text-link hover:underline', state.showAll.has(group.name) ? 'Show fewer' : `Show all ${plural(ordered.length, 'keyword')}`);
      more.type = 'button';
      more.dataset.more = group.name;
      cell.append(more);
      row.append(cell);
      body.append(row);
    }
  });
  return body;
}

function bulkBar(items) {
  const chosen = items.filter((keyword) => state.selected.has(keyword.id));
  const ids = new Set(chosen.map((keyword) => keyword.id));
  const bar = el('div', 'flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border-subtle bg-primary-subtle');
  bar.append(el('span', 'type-body-strong text-primary-text', `${plural(chosen.length, 'keyword')} selected`));
  const add = (label, iconName, run, danger = false) => {
    const node = el('button', `${BUTTON_SM} ${danger ? 'text-negative-text' : ''}`);
    node.type = 'button';
    node.append(icon(iconName, 'size-icon-sm'), el('span', '', label));
    node.addEventListener('click', run);
    bar.append(node);
  };
  add('Move to group', 'folder', () => openMove(ids, () => state.selected.clear()));
  add('Check now', 'refresh-cw', () => checkNow(chosen));
  add(state.archived ? 'Restore' : 'Archive', state.archived ? 'archive-restore' : 'archive', () => {
    archiveKeywords(ids, !state.archived);
    state.selected.clear();
    refresh();
  });
  add('Export', 'download', exportItems(chosen, 'selected').csv);
  add('Delete', 'trash-2', () => confirmDialog({ title: `Delete ${plural(ids.size, 'keyword')}?`, description: 'Their history is deleted with them.', confirmLabel: 'Delete', danger: true, onConfirm: () => {
    deleteKeywords(ids);
    state.selected.clear();
    refresh();
  } }), true);
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

function viewSwitch() {
  const group = el('div', 'inline-flex h-control-sm p-0.5 rounded-md border border-border bg-surface-subtle gap-0.5');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'View');
  [['groups', 'By group', 'layers'], ['flat', 'All keywords', 'list']].forEach(([value, label, name]) => {
    const node = el('button', `px-2.5 rounded-sm flex items-center gap-1.5 whitespace-nowrap type-body ${state.mode === value ? 'bg-surface border border-border-strong type-body-strong text-foreground' : 'text-foreground-secondary hover:text-foreground'}`);
    node.type = 'button';
    node.dataset.mode = value;
    node.setAttribute('aria-pressed', String(state.mode === value));
    node.append(icon(name, 'size-icon-sm'), el('span', '', label));
    group.append(node);
  });
  return group;
}

function toolButton(label, iconName, attach) {
  const node = el('button', 'size-control-sm rounded-md flex items-center justify-center text-foreground-secondary hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-selected');
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.dataset.tip = label;
  node.append(icon(iconName, 'size-icon'));
  attach?.(node);
  return node;
}

function tableToolbar(grouped, items) {
  const bar = el('div', 'flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border-subtle');
  const search = el('label', 'relative flex items-center');
  const field = el('input', 'h-control-sm w-64 max-w-full pl-8 pr-2 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary');
  field.type = 'search';
  field.placeholder = 'Search keywords';
  field.setAttribute('aria-label', 'Search keywords');
  field.value = state.search;
  field.dataset.search = '';
  search.append(icon('search', 'size-icon-sm absolute left-2.5 text-foreground-tertiary pointer-events-none'), field);
  const groups = new Set(items.map(groupOf)).size;
  const count = el('span', 'type-meta num', grouped ? `${plural(groups, 'group')} · ${plural(items.length, 'keyword')}` : plural(items.length, 'keyword'));
  const right = el('div', 'ml-auto flex flex-wrap items-center gap-2');
  if (grouped && state.search === '') {
    const all = store.groups.every((group) => state.expanded.has(group.name));
    const toggle = el('button', BUTTON_SM);
    toggle.type = 'button';
    toggle.dataset.expandAll = String(!all);
    toggle.append(icon(all ? 'chevrons-down-up' : 'chevrons-up-down', 'size-icon-sm text-foreground-tertiary'), el('span', '', all ? 'Collapse all' : 'Expand all'));
    right.append(toggle);
  }
  right.append(viewSwitch(), toolButton('Columns', 'columns-3', columnsMenu));
  bar.append(search, count, right);
  return bar;
}

function render() {
  const grouped = state.mode === 'groups';
  // The country shown is one the project has keywords in, or all of them
  const used = usedCountries();
  if (state.country !== ALL_COUNTRIES && !used.includes(state.country)) state.country = used.length > 1 ? ALL_COUNTRIES : (used[0] ?? ALL_COUNTRIES);
  const items = shown();
  const columns = columnsFor(items);
  const panel = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  const chosen = items.filter((keyword) => state.selected.has(keyword.id));
  panel.append(chosen.length > 0 ? bulkBar(items) : tableToolbar(grouped, items));
  const scroller = el('div', 'overflow-x-auto');
  if (items.length === 0) {
    const none = state.archived
      ? emptyState('No archived keywords', 'Keywords you archive are listed here. Restore one to track it again.')
      : state.country !== 'India' && state.country !== 'All countries'
        ? emptyState(`No keywords tracked in ${state.country}`, 'Add keywords for this country to start tracking them.', actionButton('Add keywords', () => openAdd({ countries: [state.country] }), true))
        : emptyState('No keywords match', 'Change the search or the filters.', actionButton('Clear filters', () => {
            state.search = '';
            state.filters = [];
            refresh();
          }));
    scroller.append(none);
  } else {
    const table = el('table', 'table-fixed border-separate border-spacing-0 type-table w-full');
    table.style.minWidth = `${80 + KEYWORD_MIN + columns.reduce((total, column) => total + column.width, 0)}px`;
    table.setAttribute('aria-label', grouped ? 'Keyword groups' : 'Keywords');
    const widths = el('colgroup', '');
    [40, null, ...columns.map((column) => column.width), 40].forEach((width) => {
      const col = el('col', '');
      if (width) col.style.width = `${width}px`;
      widths.append(col);
    });
    const head = el('thead', '');
    const row = el('tr', 'h-row-header');
    const all = el('th', 'sticky top-0 left-0 z-(--z-sticky) border-b border-border bg-surface-subtle px-0 text-center font-normal');
    const box = checkbox('Select all keywords', items.length > 0 && chosen.length === items.length, chosen.length > 0 && chosen.length < items.length);
    box.dataset.pick = items.map((keyword) => keyword.id).join(',');
    all.append(box);
    const identity = el('th', 'sticky top-0 left-10 z-(--z-sticky) border-b border-border border-r border-r-border-subtle bg-surface-subtle px-3 text-left font-normal');
    identity.append(headerContent({ id: 'name', label: grouped ? 'Group' : 'Keyword', sort: 'name' }, grouped));
    row.append(all, identity, ...columns.map((column) => headerCell(column, grouped)), el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle'));
    head.append(row);
    table.append(widths, head, tableBody(grouped, columns, items));
    scroller.append(table);
  }
  const m = measures(items);
  const foot = el('div', 'px-4 py-2 border-t border-border-subtle type-meta');
  foot.textContent = grouped ? `${plural(items.length, 'keyword')}. Numbers are for the devices chosen.` : `${plural(items.length, 'keyword')}, ${m.tracked} tracked on the devices chosen.`;
  panel.append(scroller, foot);
  closePages();
  const typing = document.activeElement?.dataset?.search !== undefined;
  view.replaceChildren(pageRow(items), panel);
  if (typing) {
    const input = view.querySelector('[data-search]');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  syncCountry();
  redrawDrawer();
}

// -------------------------------------------------------------------------------------------------
// The row above the table: the strip, the scope, the filters and the page's actions

function strip(items) {
  const m = measures(items);
  const wrap = el('div', 'flex h-control-sm items-center gap-4');
  [['Keywords', m.tracked], ['Top 3', m.top3], ['Top 10', m.top10], ['Top 20', m.top20]].forEach(([label, value]) => {
    const item = el('span', 'flex items-baseline gap-1.5');
    item.append(el('span', 'type-meta text-foreground-secondary', label), el('span', 'type-body-strong num text-foreground', value.toLocaleString('en-US')));
    wrap.append(item);
  });
  return wrap;
}

function deviceControl() {
  const group = el('div', 'inline-flex');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Device');
  DEVICES.forEach(([value, label, name], index) => {
    const checked = state.device === value;
    const node = el('button', `size-control-sm flex items-center justify-center border ${index > 0 ? '-ml-px' : ''} ${index === 0 ? 'rounded-l-md' : ''} ${index === DEVICES.length - 1 ? 'rounded-r-md' : ''} ${checked ? 'relative border-primary-border bg-primary-subtle text-primary-text' : 'border-border bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground'}`);
    node.type = 'button';
    node.setAttribute('role', 'radio');
    node.setAttribute('aria-checked', String(checked));
    node.setAttribute('aria-label', label);
    node.dataset.tip = label;
    node.dataset.device = value;
    node.append(icon(name, 'size-icon-sm'));
    group.append(node);
  });
  return group;
}

function labelled(label, iconName, trailing = true) {
  const node = el('button', BUTTON_SM);
  node.type = 'button';
  node.append(icon(iconName, 'size-icon-sm text-foreground-tertiary'), el('span', '', label));
  if (trailing) node.append(icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
  return node;
}

function chips() {
  return state.filters.map((filter) => {
    const chip = el('button', 'h-control-sm pl-2 pr-1 rounded-md border border-border bg-surface flex items-center gap-1 whitespace-nowrap type-body text-foreground hover:bg-surface-hover');
    chip.type = 'button';
    chip.dataset.removeFilter = `${filter.field}:${filter.value}`;
    chip.setAttribute('aria-label', `Remove filter ${filter.label}`);
    chip.append(el('span', '', filter.label), icon('x', 'size-icon-sm text-foreground-tertiary'));
    return chip;
  });
}

function pageRow(items) {
  const row = el('div', 'flex flex-wrap items-start gap-x-4 gap-y-2');
  const left = el('div', 'order-1 min-w-0 flex-1 basis-96 flex flex-wrap items-center gap-x-4 gap-y-2');
  const filter = el('button', 'h-control-sm px-2 rounded-md flex items-center gap-1.5 whitespace-nowrap type-body text-foreground-secondary hover:bg-surface-hover');
  filter.type = 'button';
  filter.append(icon('plus', 'size-icon-sm'), el('span', '', 'Filter'));
  filterMenu(filter);
  left.append(strip(items), deviceControl(), filter, ...chips());
  if (state.archived) {
    const archived = el('button', BUTTON_SM);
    archived.type = 'button';
    archived.dataset.leaveArchived = '';
    archived.setAttribute('aria-label', 'Show active keywords');
    archived.append(icon('x', 'size-icon-sm'), el('span', '', 'Archived keywords'));
    left.append(archived);
  }
  if (state.filters.length > 0) {
    const clear = el('button', 'type-body text-link hover:underline');
    clear.type = 'button';
    clear.dataset.clearFilters = '';
    clear.textContent = 'Clear filters';
    left.append(clear);
  }
  const right = el('div', 'order-2 ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2');
  const more = el('button', 'size-control-sm rounded-md border border-border bg-surface flex items-center justify-center text-foreground-secondary hover:bg-surface-hover aria-expanded:bg-surface-selected');
  more.type = 'button';
  more.setAttribute('aria-label', 'More actions');
  more.append(icon('ellipsis', 'size-icon'));
  moreMenu(more);
  const exportButton = labelled('Export', 'download', false);
  exportMenu(exportButton);
  const add = el('button', 'h-control-sm px-2 rounded-l-md bg-primary text-primary-foreground type-body-strong flex items-center gap-1.5 whitespace-nowrap hover:bg-primary-hover');
  add.type = 'button';
  add.dataset.add = '';
  add.append(icon('plus', 'size-icon-sm'), el('span', '', 'Add keywords'));
  const arrow = el('button', 'size-control-sm -ml-px rounded-r-md border-l border-l-primary-hover bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary-hover');
  arrow.type = 'button';
  arrow.setAttribute('aria-label', 'More ways to add keywords');
  arrow.append(icon('chevron-down', 'size-icon-sm'));
  addMenu(arrow);
  const split = el('div', 'inline-flex shrink-0');
  split.append(add, arrow);
  right.append(el('span', 'type-meta whitespace-nowrap', store.updated), more, exportButton, split);
  row.append(left, right);
  return row;
}

// -------------------------------------------------------------------------------------------------
// Events

function toggleGroup(name, open) {
  if (open === undefined ? state.expanded.has(name) : !open) state.expanded.delete(name);
  else state.expanded.add(name);
  refresh();
}

view.addEventListener('change', (event) => {
  const box = event.target.closest('input[data-pick]');
  if (!box) return;
  const ids = box.dataset.pick.split(',').filter(Boolean);
  ids.forEach((id) => (box.checked ? state.selected.add(id) : state.selected.delete(id)));
  refresh();
});

view.addEventListener('click', (event) => {
  const target = event.target.closest('button, a, input, tr[data-group], tr[data-keyword]');
  if (!target || target.matches('input[data-pick]')) return;
  const data = target.dataset;
  if (data.mode) {
    state.mode = data.mode;
    state.sort = { key: 'order', dir: 'asc' };
    refresh();
  } else if (data.device) {
    state.device = data.device;
    refresh();
  } else if (data.sort) {
    const same = state.sort.key === data.sort;
    const smaller = ['rank', 'name', 'best'].includes(data.sort);
    state.sort = { key: data.sort, dir: same ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : smaller ? 'asc' : 'desc' };
    refresh();
  } else if (data.expandAll) {
    state.expanded = new Set(data.expandAll === 'true' ? store.groups.map((group) => group.name).concat(UNGROUPED) : []);
    refresh();
  } else if (data.more) {
    if (!state.showAll.delete(data.more)) state.showAll.add(data.more);
    refresh();
  } else if (data.removeFilter) {
    state.filters = state.filters.filter((filter) => `${filter.field}:${filter.value}` !== data.removeFilter);
    refresh();
  } else if (data.clearFilters !== undefined) {
    state.filters = [];
    refresh();
  } else if (data.leaveArchived !== undefined) {
    state.archived = false;
    refresh();
  } else if (data.add !== undefined) {
    openAdd({ countries: addScope() });
  } else if (data.toggle) {
    toggleGroup(data.toggle);
  } else if (target.closest('a, [aria-haspopup]')) {
    // A link opens its page, and a menu button its menu: neither opens a drawer
  } else if (target.matches('tr[data-group]')) {
    openGroup(data.group);
  } else if (target.matches('tr[data-keyword]')) {
    openKeyword(data.keyword);
  }
});

view.addEventListener('input', (event) => {
  if (event.target.dataset.search === undefined) return;
  state.search = event.target.value;
  refresh();
});

// Right Arrow opens a group and Left Arrow closes it, from its chevron (12-tables.md section 16)
view.addEventListener('keydown', (event) => {
  const toggle = event.target.closest?.('[data-toggle]');
  if (!toggle || !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
  event.preventDefault();
  const name = toggle.dataset.toggle;
  toggleGroup(name, event.key === 'ArrowRight');
  view.querySelector(`[data-toggle="${CSS.escape(name)}"]`)?.focus();
});

/**
 * The top bar of the app, as the real Rankings page has it: a breadcrumb of the workspace, the project and the page,
 * then the theme switch, help and the account. The preview's own top bar also has a search, a date range, a location
 * and notifications, which the app does not show here; they come back when the page is left.
 */
const WORKSPACE = 'Fynix Digital';
const PROJECT = 'Eventus Security';
const crumb = document.querySelector('button.truncate[data-popup="menu-project"]');
const sidebarName = document.querySelector('[data-project-name]');
const theme = document.querySelector('[data-theme-toggle]');
const account = document.querySelector('[data-popup="menu-user"]');
const topbarExtras = [...document.querySelectorAll('#date-button, #location-button, [data-popup="pop-notifications"]')];
const original = { crumb: crumb?.firstChild?.textContent, sidebar: sidebarName?.textContent, account: account?.textContent };
let workspaceCrumb = null;
let countryButton = null;

/**
 * The country button of the top bar says the country the table shows, and lists only the countries the project has
 * keywords in. With one country it is a label, since there is nothing to choose.
 */
function syncCountry() {
  if (!countryButton) return;
  const several = usedCountries().length > 1;
  countryButton.replaceChildren(icon('map-pin', 'size-icon text-foreground-tertiary'), el('span', '', state.country), ...(several ? [icon('chevron-down', 'size-icon-sm text-foreground-tertiary')] : []));
  countryButton.setAttribute('aria-label', `Country: ${state.country}`);
  countryButton.disabled = !several;
}

function appChrome(on) {
  topbarExtras.forEach((node) => {
    node.hidden = on;
  });
  if (theme) theme.style.display = on ? 'flex' : '';
  if (crumb?.firstChild) crumb.firstChild.textContent = on ? PROJECT : original.crumb;
  if (sidebarName) sidebarName.textContent = on ? PROJECT : original.sidebar;
  if (account) account.textContent = on ? 'G' : original.account;
  workspaceCrumb?.remove();
  workspaceCrumb = null;
  countryButton?.remove();
  countryButton = null;
  if (on) {
    // The country is a choice of the top bar, as in the preview's own: its button takes the place of the location one
    countryButton = el('button', 'hidden md:flex h-control shrink-0 whitespace-nowrap px-3 rounded-md border border-border bg-surface items-center gap-2 type-body text-foreground hover:bg-surface-hover');
    countryButton.type = 'button';
    countryButton.dataset.country = '';
    topbarExtras[1]?.before(countryButton);
    countryMenu(countryButton);
    syncCountry();
  }
  const projectItem = crumb?.closest('li');
  if (on && projectItem) {
    workspaceCrumb = el('li', 'hidden lg:flex shrink-0 items-center gap-2');
    workspaceCrumb.append(el('span', 'type-body text-foreground-tertiary', WORKSPACE));
    projectItem.before(workspaceCrumb);
  }
}

bindPages(view, (id) => store.keywords.find((keyword) => keyword.id === id));
setRenderer(render);
render();
window.addEventListener('preview-route', (event) => {
  if (event.detail.view !== 'keywords') return;
  appChrome(true);
  render();
});
window.addEventListener('preview-leave', (event) => {
  if (event.detail.from === 'keywords') appChrome(false);
});
// Keywords is the page shown when there is no route
if (!location.hash || /^#\/(keywords|rankings)(\/|$)/.test(location.hash)) appChrome(true);
window.addEventListener('kw-add', () => openAdd({ countries: addScope() }));
