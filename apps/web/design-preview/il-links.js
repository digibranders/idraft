/**
 * Internal links, Links tab (spec 7.3): one row per link of the crawl (the edge list), with the tiers of both ends,
 * the anchor, where the link sits, its rel and the state of its target. A Tier flow cell can narrow it to one pair of
 * tiers (`state.links.pair`). Exports `render(host)` and `exportRows()`.
 */
import { icon } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { PLACEMENT_LABEL, SCOPE_MENU, SCOPE_WORD, links, pageById, plural, refresh, scopeOf, state, statusBadge, tierBadge, tierCode, tierIdOf } from './il-model.js';
import { openInspector } from './il-drawer.js';
import { applyRestore, menuSelect } from './il-pages.js';

const CELL = 'border-b border-border-subtle px-3 align-middle';
const COLUMNS = [
  { id: 'source', label: 'Source page', width: 240, sort: 'source' },
  { id: 'sourceTier', label: 'Source tier', width: 96 },
  { id: 'target', label: 'Target page', width: 240, sort: 'target' },
  { id: 'targetTier', label: 'Target tier', width: 96 },
  { id: 'anchor', label: 'Anchor text', width: 240 },
  { id: 'placement', label: 'Placement', width: 130, sort: 'placement' },
  { id: 'rel', label: 'Rel', width: 80 },
  { id: 'status', label: 'Target status', width: 200, sort: 'status' },
  { id: 'indexable', label: 'Target indexable', width: 130 },
];

let typing = false;
const scopeName = (scope) => SCOPE_MENU.find(([key]) => key === scope)[1];

const path = (id) => pageById(id).path;

function visibleLinks() {
  const { search, sort, placement, pair } = state.links;
  const query = search.trim().toLowerCase();
  const items = links.filter((link) => {
    if (!pair && state.scope !== 'all' && scopeOf(link) !== state.scope) return false;
    if (placement && link.placement !== placement) return false;
    if (pair && (tierIdOf(pageById(link.from)) !== pair.from || tierIdOf(pageById(link.to)) !== pair.to || (pair.scope !== 'all' && scopeOf(link) !== pair.scope))) return false;
    return !query || path(link.from).toLowerCase().includes(query) || path(link.to).toLowerCase().includes(query);
  });
  const read = {
    source: (link) => path(link.from),
    target: (link) => path(link.to),
    placement: (link) => PLACEMENT_LABEL[link.placement],
    status: (link) => pageById(link.to).status,
  }[sort.key] ?? ((link) => path(link.from));
  const sign = sort.dir === 'asc' ? 1 : -1;
  return items.sort((a, b) => (read(a) > read(b) ? sign : read(a) < read(b) ? -sign : 0));
}

const targetStatus = (link) => {
  const target = pageById(link.to);
  const wrap = el('span', 'flex items-center gap-2 min-w-0');
  wrap.append(statusBadge(target));
  if (target.status === 301 && target.redirect) wrap.append(el('span', 'truncate type-label text-foreground-tertiary', `301 to ${path(target.redirect)}`));
  return wrap;
};

export function exportRows() {
  return [
    ['Source', 'Source tier', 'Target', 'Target tier', 'Anchor', 'Placement', 'Rel', 'Target status', 'Target indexable'],
    ...visibleLinks().map((link) => {
      const target = pageById(link.to);
      return [path(link.from), tierCode(tierIdOf(pageById(link.from))), path(link.to), tierCode(tierIdOf(target)), link.anchor, PLACEMENT_LABEL[link.placement], link.rel, target.status, target.indexable ? 'Yes' : `No: ${target.reason}`];
    }),
  ];
}

function pageButton(id) {
  const node = el('button', 'block w-full truncate type-table text-foreground text-left hover:underline');
  node.type = 'button';
  node.dataset.open = id;
  node.textContent = path(id);
  node.title = pageById(id).title;
  return node;
}

function linkRow(link) {
  const target = pageById(link.to);
  const row = el('tr', 'h-row bg-surface hover:bg-surface-hover');
  const cells = {
    source: () => pageButton(link.from),
    sourceTier: () => tierBadge(tierIdOf(pageById(link.from))),
    target: () => pageButton(link.to),
    targetTier: () => tierBadge(tierIdOf(target)),
    anchor: () => el('span', 'block truncate type-table text-foreground', `"${link.anchor}"`),
    placement: () => el('span', 'type-table text-foreground', PLACEMENT_LABEL[link.placement]),
    rel: () => el('span', `type-table ${link.rel === 'nofollow' ? 'text-warning-text' : 'text-foreground'}`, link.rel),
    status: () => targetStatus(link),
    indexable: () => {
      const text = el('span', `type-table ${target.indexable ? 'text-foreground' : 'text-foreground-tertiary'}`, target.indexable ? 'Yes' : 'No');
      if (!target.indexable) text.title = target.reason;
      return text;
    },
  };
  COLUMNS.forEach((column) => {
    const cell = el(column.id === 'source' ? 'th' : 'td', `${CELL} ${column.id === 'source' ? 'text-left font-normal' : ''}`);
    if (column.id === 'source') cell.scope = 'row';
    cell.append(cells[column.id]());
    row.append(cell);
  });
  return row;
}

function headerCell(column) {
  const th = el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle');
  th.scope = 'col';
  const label = el('span', 'truncate type-table-header text-foreground-tertiary', column.label);
  if (!column.sort) {
    th.append(label);
    return th;
  }
  const active = state.links.sort.key === column.sort;
  th.setAttribute('aria-sort', active ? (state.links.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const button = el('button', `flex items-center gap-1 min-w-0 w-full rounded-sm text-left ${active ? 'text-foreground' : ''}`);
  button.type = 'button';
  button.dataset.sort = column.sort;
  button.append(label);
  if (active) button.append(icon(state.links.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down', 'size-icon-sm shrink-0 text-foreground'));
  th.append(button);
  return th;
}

function emptyState(title, text, label, run) {
  const box = el('div', 'flex flex-col items-center gap-2 px-6 py-14 text-center');
  const action = el('button', 'h-control px-3 rounded-md border border-border bg-surface type-body-strong hover:bg-surface-hover', label);
  action.type = 'button';
  action.addEventListener('click', run);
  box.append(el('h3', 'type-section-title', title), el('p', 'type-body text-foreground-secondary max-w-md', text), action);
  return box;
}

function pairChip() {
  const { pair } = state.links;
  const chip = el('button', 'h-control-sm pl-2 pr-1 rounded-md border border-border bg-surface flex items-center gap-1 whitespace-nowrap type-body text-foreground hover:bg-surface-hover');
  chip.type = 'button';
  chip.dataset.clearPair = '';
  const word = pair.scope === 'all' ? 'all links' : SCOPE_WORD[pair.scope];
  const text = `From ${tierCode(pair.from)} to ${tierCode(pair.to)}, ${word}`;
  chip.setAttribute('aria-label', `Remove filter ${text}`);
  chip.append(el('span', '', text), icon('x', 'size-icon-sm text-foreground-tertiary'));
  return chip;
}

export function render(host) {
  const items = visibleLinks();
  const shownCount = Math.min(items.length, state.links.limit);
  const panel = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  const bar = el('div', 'flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border-subtle');
  const search = el('label', 'relative flex items-center');
  const field = el('input', 'h-control-sm w-64 max-w-full pl-8 pr-2 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary');
  field.type = 'search';
  field.placeholder = 'Search source or target';
  field.setAttribute('aria-label', 'Search source or target');
  field.value = state.links.search;
  field.dataset.search = '';
  search.append(icon('search', 'size-icon-sm absolute left-2.5 text-foreground-tertiary pointer-events-none'), field);
  const placements = [['', 'All'], ...Object.entries(PLACEMENT_LABEL).filter(([key]) => links.some((link) => link.placement === key))];
  bar.append(
    search,
    el('span', 'type-meta num', plural(items.length, 'link')),
    menuSelect('Links', SCOPE_MENU, state.scope, (value) => {
      state.scope = value;
      if (state.links.pair) state.links.pair.scope = value;
      state.links.limit = 200;
      refresh();
    }, 'Link scope'),
    menuSelect('Placement', placements, state.links.placement, (value) => {
      state.links.placement = value;
      state.links.limit = 200;
      refresh();
    }, 'Placement'),
  );
  if (state.links.pair) bar.append(pairChip());
  const scroller = el('div', 'overflow-x-auto');
  if (items.length === 0) {
    scroller.append(emptyState('No links match', `Nothing matches ${scopeName(state.scope)} with this search and placement. Try Links: All links, Placement: All or another search.`, 'Clear filters', () => {
      Object.assign(state.links, { search: '', placement: '', pair: null, limit: 200 });
      state.scope = 'all';
      refresh();
    }));
  } else {
    const table = el('table', 'table-fixed border-separate border-spacing-0 type-table w-full');
    table.style.minWidth = `${COLUMNS.reduce((total, column) => total + column.width, 0)}px`;
    table.setAttribute('aria-label', 'Links');
    const widths = el('colgroup', '');
    COLUMNS.forEach((column) => {
      const col = el('col', '');
      col.style.width = `${column.width}px`;
      widths.append(col);
    });
    const head = el('thead', '');
    const row = el('tr', 'h-row-header');
    row.append(...COLUMNS.map(headerCell));
    head.append(row);
    const body = el('tbody', '');
    items.slice(0, shownCount).forEach((link) => body.append(linkRow(link)));
    table.append(widths, head, body);
    scroller.append(table);
  }
  const foot = el('div', 'flex flex-wrap items-center gap-3 px-4 py-2 border-t border-border-subtle type-meta');
  foot.append(el('span', '', `${plural(items.length, 'link')} in ${state.links.pair ? 'this pair of tiers' : scopeName(state.scope)}, one row per link. Menu and footer links repeat on every page.`));
  if (items.length > shownCount) {
    const more = el('button', 'type-table text-link hover:underline', `Show ${Math.min(200, items.length - shownCount)} more`);
    more.type = 'button';
    more.dataset.more = '';
    foot.append(more);
  }
  panel.append(bar, scroller, foot);
  panel.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const data = target.dataset;
    if (data.sort) {
      const same = state.links.sort.key === data.sort;
      state.links.sort = { key: data.sort, dir: same ? (state.links.sort.dir === 'asc' ? 'desc' : 'asc') : 'asc' };
      refresh();
    } else if (data.open) openInspector(data.open);
    else if (data.more !== undefined) {
      state.links.limit += 200;
      refresh();
    } else if (data.clearPair !== undefined) {
      state.links.pair = null;
      refresh();
    }
  });
  panel.addEventListener('input', (event) => {
    if (event.target.dataset.search === undefined) return;
    typing = true;
    state.links.search = event.target.value;
    state.links.limit = 200;
    refresh();
  });
  host.append(panel);
  if (typing) {
    typing = false;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
  applyRestore(panel);
}
