/**
 * Internal links, Opportunities tab (spec slice 3): a page mentions a topic of another page but does not link to it.
 * One row per mention with the source, the target, the suggested anchor and a decision (Accept plans the fix, Dismiss
 * hides it, Undo reopens it). Exports `render(host)` and `exportRows()`.
 */
import { BUTTON_SM, copyText, downloadCsv, icon, iconButton, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import {
  number, opportunities, opportunityCounts, pageById, pct, plural, refresh, setOpportunityStatus, tierBadge, tierCode, tierIdOf, tierPosition, tiers,
} from './il-model.js';
import { openInspector } from './il-drawer.js';
import { applyRestore as applyMenuRestore, menuSelect } from './il-pages.js';

const HOST_URL = 'https://eventussecurity.com';
const CELL = 'border-b border-border-subtle px-3 py-2 align-middle';
const COLUMNS = [
  { id: 'select', width: 40 },
  { id: 'source', label: 'Source page', width: 240 },
  { id: 'sourceTier', label: 'Source tier', width: 96 },
  { id: 'mentions', label: 'Mentions', width: 380 },
  { id: 'target', label: 'Target page', width: 240 },
  { id: 'targetTier', label: 'Target tier', width: 96 },
  { id: 'anchor', label: 'Suggested anchor', width: 200 },
  { id: 'equity', label: 'Source equity share', width: 120, align: 'text-right' },
  { id: 'status', label: 'Status', width: 100 },
  { id: 'actions', label: 'Actions', width: 230 },
];
const STATUS_CHIPS = [['', 'All'], ['open', 'Open'], ['accepted', 'Accepted'], ['dismissed', 'Dismissed']];
const STATUS_BADGE = {
  open: ['Open', 'bg-surface-subtle text-foreground-secondary'],
  accepted: ['Accepted', 'bg-positive-subtle text-positive-text'],
  dismissed: ['Dismissed', 'bg-surface-subtle text-foreground-tertiary'],
};
const CHIP = 'h-control-sm px-2 rounded-md border flex items-center gap-1.5 whitespace-nowrap';
const CHIP_OFF = `${CHIP} border-border bg-surface type-body text-foreground-secondary hover:bg-surface-hover`;
const CHIP_ON = `${CHIP} border-primary-border bg-primary-subtle type-body-strong text-primary-text`;
const SMALL = 'h-control-sm px-2 rounded-md border flex items-center gap-1.5 whitespace-nowrap type-body-strong';
const SMALL_PRIMARY = `${SMALL} border-primary-border bg-surface text-primary-text hover:bg-primary-subtle`;
const SMALL_PLAIN = `${SMALL} border-border bg-surface text-foreground hover:bg-surface-hover`;

// Own view state: the shell does not know these filters
const view = { search: '', status: '', tier: '' };
const selected = new Set();
let typing = false;
// { chip } of a status chip, or { key, index } of the row to refocus after the next render: its action button, else the row now in its place
let restore = null;
let shown = [];

const path = (id) => pageById(id).path;
const url = (id) => `${HOST_URL}${path(id)}`;

function visible() {
  const query = view.search.trim().toLowerCase();
  return opportunities().filter((row) => {
    if (view.status && row.status !== view.status) return false;
    if (view.tier && tierPosition(tierIdOf(pageById(row.to))) !== Number(view.tier)) return false;
    return !query || path(row.from).toLowerCase().includes(query) || path(row.to).toLowerCase().includes(query);
  });
}

/** Planned fixes (accepted rows), or every open row when nothing is accepted yet. */
export function exportRows() {
  const all = opportunities();
  const accepted = all.filter((row) => row.status === 'accepted');
  const rows = accepted.length > 0 ? accepted : all.filter((row) => row.status === 'open');
  return [['Source URL', 'Target URL', 'Anchor', 'Context', 'Status'], ...rows.map((row) => [url(row.from), url(row.to), row.anchor, row.context, row.status])];
}

const instruction = (row) => `On ${url(row.from)} link the words "${row.phrase}" to ${url(row.to)}.`;

// -------------------------------------------------------------------------------------------------
// Cells

function pageCell(id) {
  const button = el('button', 'flex w-full min-w-0 flex-col text-left leading-tight hover:underline');
  button.type = 'button';
  button.dataset.open = id;
  button.append(el('span', 'truncate type-table text-foreground', path(id)), el('span', 'truncate type-label text-foreground-tertiary', pageById(id).title));
  return button;
}

/** The context sentence with the phrase marked; the phrase is found without regard to case. */
function mention(row) {
  const wrap = el('p', 'type-meta text-foreground-secondary');
  const at = row.context.toLowerCase().indexOf(row.phrase.toLowerCase());
  if (at < 0) {
    wrap.append(el('span', 'type-body-strong text-foreground rounded-sm bg-primary-subtle px-0.5', row.phrase), ` ${row.context}`);
    return wrap;
  }
  wrap.append(row.context.slice(0, at), el('span', 'type-body-strong text-foreground rounded-sm bg-primary-subtle px-0.5', row.context.slice(at, at + row.phrase.length)), row.context.slice(at + row.phrase.length));
  return wrap;
}

function action(label, row, status, className) {
  const node = el('button', className, label);
  node.type = 'button';
  node.dataset.decide = status === null ? 'undo' : status;
  node.dataset.key = row.key;
  node.setAttribute('aria-label', `${label}: ${path(row.from)} to ${path(row.to)}`);
  return node;
}

function actionsCell(row) {
  const wrap = el('div', 'flex items-center gap-1.5');
  if (row.status === 'open') wrap.append(action('Accept', row, 'accepted', SMALL_PRIMARY), action('Dismiss', row, 'dismissed', SMALL_PLAIN));
  else wrap.append(action('Undo', row, null, SMALL_PLAIN));
  const copy = iconButton('copy', `Copy instruction for ${path(row.from)}`, null, 'size-control-sm shrink-0');
  copy.dataset.copy = row.key;
  wrap.append(copy);
  return wrap;
}

function checkbox(label, checked, indeterminate = false) {
  const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
  box.type = 'checkbox';
  box.checked = checked;
  box.indeterminate = indeterminate;
  box.setAttribute('aria-label', label);
  return box;
}

function oppRow(row) {
  const chosen = selected.has(row.key);
  const tr = el('tr', `${chosen ? 'bg-surface-selected' : 'bg-surface'} hover:bg-surface-hover`);
  tr.dataset.key = row.key;
  const select = el('td', `${CELL} w-10 px-0 text-center`);
  const box = checkbox(`Select ${path(row.from)} to ${path(row.to)}`, chosen);
  box.dataset.pick = row.key;
  select.append(box);
  const source = el('th', `${CELL} text-left font-normal`);
  source.scope = 'row';
  source.append(pageCell(row.from));
  const badge = el('span', `inline-flex h-badge items-center rounded-sm px-1.5 type-label whitespace-nowrap ${STATUS_BADGE[row.status][1]}`, STATUS_BADGE[row.status][0]);
  const cells = [
    [select],
    [source],
    [tierBadge(tierIdOf(pageById(row.from)))],
    [mention(row)],
    [pageCell(row.to)],
    [tierBadge(tierIdOf(pageById(row.to)))],
    [el('span', 'block truncate type-table text-foreground', `"${row.anchor}"`)],
    [el('span', 'type-table num text-foreground', pct(row.sourceEquity))],
    [badge],
    [actionsCell(row)],
  ];
  tr.append(select, source);
  cells.slice(2).forEach(([node], index) => {
    const cell = el('td', `${CELL} ${COLUMNS[index + 2].align ?? ''}`);
    cell.append(node);
    tr.append(cell);
  });
  return tr;
}

// -------------------------------------------------------------------------------------------------
// Toolbar, chips, bulk bar, empty states

function statusChips(counts) {
  const row = el('div', 'flex flex-wrap items-center gap-2 px-3 pt-2');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Status');
  STATUS_CHIPS.forEach(([key, label]) => {
    const active = view.status === key;
    const node = el('button', active ? CHIP_ON : CHIP_OFF);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(active));
    node.dataset.chip = key;
    node.dataset.restore = `opp-chip:${key}`;
    node.append(el('span', '', label), el('span', 'num', number(key ? counts[key] : counts.open + counts.accepted + counts.dismissed)));
    row.append(node);
  });
  return row;
}

function toolbar(items, total) {
  const bar = el('div', 'flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border-subtle');
  const search = el('label', 'relative flex items-center');
  const field = el('input', 'h-control-sm w-64 max-w-full pl-8 pr-2 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary');
  field.type = 'search';
  field.placeholder = 'Search source or target';
  field.setAttribute('aria-label', 'Search source or target');
  field.value = view.search;
  field.dataset.search = '';
  search.append(icon('search', 'size-icon-sm absolute left-2.5 text-foreground-tertiary pointer-events-none'), field);
  const tierOptions = [['', 'All'], ...tiers.map((tier) => [String(tierPosition(tier.id)), tierCode(tier.id)])];
  const planned = el('button', `${BUTTON_SM} ml-auto`);
  planned.type = 'button';
  planned.dataset.export = '';
  planned.append(icon('download', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Planned fixes'));
  planned.title = 'Download the accepted opportunities as CSV, or every open one when nothing is accepted yet';
  bar.append(
    search,
    el('span', 'type-meta num', total === items.length ? plural(items.length, 'opportunity') : `${number(items.length)} of ${plural(total, 'opportunity')}`),
    menuSelect('Target tier', tierOptions, view.tier, (value) => {
      view.tier = value;
      selected.clear();
      refresh();
    }, 'Target tier'),
    planned,
  );
  return { bar, field };
}

function bulkBar(chosen) {
  const bar = el('div', 'flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-b border-border-subtle bg-primary-subtle');
  bar.append(el('span', 'type-body-strong text-primary-text', `${plural(chosen.length, 'opportunity')} selected`));
  const accept = el('button', SMALL_PRIMARY, 'Accept');
  accept.type = 'button';
  accept.dataset.bulk = 'accepted';
  const dismiss = el('button', SMALL_PLAIN, 'Dismiss');
  dismiss.type = 'button';
  dismiss.dataset.bulk = 'dismissed';
  const clear = el('button', `${SMALL_PLAIN} ml-auto`);
  clear.type = 'button';
  clear.dataset.clear = '';
  clear.append(icon('x', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Clear selection'));
  bar.append(accept, dismiss, clear);
  return bar;
}

function emptyState(title, text, label, run) {
  const box = el('div', 'flex flex-col items-center gap-2 px-6 py-14 text-center');
  box.append(el('h3', 'type-section-title', title), el('p', 'type-body text-foreground-secondary max-w-md', text));
  if (label) {
    const node = el('button', 'h-control px-3 rounded-md border border-border bg-surface type-body-strong hover:bg-surface-hover', label);
    node.type = 'button';
    node.addEventListener('click', run);
    box.append(node);
  }
  return box;
}

function headerCell(column) {
  const th = el('th', `sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle ${column.align ?? ''}`);
  th.scope = 'col';
  th.append(el('span', 'truncate type-table-header text-foreground-tertiary', column.label));
  return th;
}

// -------------------------------------------------------------------------------------------------

function decide(keys, status, message) {
  keys.forEach((key) => setOpportunityStatus(key, status));
  refresh();
  toast({ title: status === 'accepted' ? 'Planned' : status === 'dismissed' ? 'Dismissed' : 'Reopened', description: message, tone: status === 'accepted' ? 'success' : 'info' });
}

function onClick(event) {
  const target = event.target.closest('button');
  if (!target) return;
  const data = target.dataset;
  const rows = opportunities();
  if (data.open) openInspector(data.open);
  else if (data.chip !== undefined) {
    view.status = data.chip;
    selected.clear();
    restore = { chip: data.chip };
    refresh();
  } else if (data.decide) {
    const row = rows.find((candidate) => candidate.key === data.key);
    if (!row) return;
    restore = { key: row.key, index: shown.findIndex((candidate) => candidate.key === row.key) };
    const where = `${path(row.from)} to ${path(row.to)}`;
    if (data.decide === 'accepted') decide([row.key], 'accepted', `Add a link on ${path(row.from)} to ${path(row.to)}`);
    else if (data.decide === 'dismissed') decide([row.key], 'dismissed', `No link from ${where}`);
    else decide([row.key], null, `${where} is open again`);
  } else if (data.copy) {
    const row = rows.find((candidate) => candidate.key === data.copy);
    if (row) copyText(instruction(row), 'Instruction copied');
  } else if (data.bulk) {
    const keys = shown.filter((row) => selected.has(row.key)).map((row) => row.key);
    selected.clear();
    restore = { chip: view.status };
    decide(keys, data.bulk, `${plural(keys.length, 'opportunity')} ${data.bulk === 'accepted' ? 'planned' : 'dismissed'}`);
  } else if (data.clear !== undefined) {
    selected.clear();
    refresh();
  } else if (data.export !== undefined) {
    const out = exportRows();
    if (out.length === 1) toast({ title: 'Nothing to export', description: 'There are no accepted or open opportunities.', tone: 'info' });
    else downloadCsv('internal-links-planned-fixes.csv', out);
  }
}

function onChange(event) {
  const pick = event.target.dataset.pick;
  if (!pick) return;
  if (pick === 'all') shown.forEach((row) => (event.target.checked ? selected.add(row.key) : selected.delete(row.key)));
  else if (event.target.checked) selected.add(pick);
  else selected.delete(pick);
  refresh();
}

function applyRestore(panel) {
  applyMenuRestore(panel);
  if (!restore) return;
  const { key, index, chip } = restore;
  restore = null;
  if (chip !== undefined) {
    panel.querySelector(`[data-restore="opp-chip:${chip}"]`)?.focus();
    return;
  }
  const rows = [...panel.querySelectorAll('tbody tr[data-key]')];
  const row = rows.find((candidate) => candidate.dataset.key === key) ?? rows[Math.min(index, rows.length - 1)];
  (row?.querySelector('button[data-decide]') ?? panel.querySelector('[data-search]')).focus();
}

export function render(host) {
  const counts = opportunityCounts();
  const total = counts.open + counts.accepted + counts.dismissed;
  const items = visible();
  shown = items;
  [...selected].forEach((key) => !items.some((row) => row.key === key) && selected.delete(key));
  const chosen = items.filter((row) => selected.has(row.key));
  const panel = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  const { bar, field } = toolbar(items, total);
  panel.append(statusChips(counts), ...(chosen.length > 0 ? [bulkBar(chosen)] : []), bar);
  const scroller = el('div', 'overflow-x-auto');
  if (counts.open === 0 && total === 0) {
    scroller.append(emptyState('No opportunities', 'Every mention of an important page already links to it.'));
  } else if (items.length === 0) {
    const none = view.status === 'open' && !view.search && !view.tier;
    scroller.append(none
      ? emptyState('No open opportunities', 'Every open opportunity has been accepted or dismissed. Choose All to review those decisions.', 'Show all', () => {
        view.status = '';
        refresh();
      })
      : emptyState('No opportunities match', 'Nothing matches this search, status and target tier. Clear the filters to see every opportunity.', 'Clear filters', () => {
        Object.assign(view, { search: '', status: '', tier: '' });
        refresh();
      }));
  } else {
    const table = el('table', 'table-fixed border-separate border-spacing-0 type-table w-full');
    table.style.minWidth = `${COLUMNS.reduce((sum, column) => sum + column.width, 0)}px`;
    table.setAttribute('aria-label', 'Link opportunities');
    const widths = el('colgroup', '');
    COLUMNS.forEach((column) => {
      const col = el('col', '');
      col.style.width = `${column.width}px`;
      widths.append(col);
    });
    const head = el('thead', '');
    const headRow = el('tr', 'h-row-header');
    const all = el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-0 text-center font-normal');
    const box = checkbox('Select all shown opportunities', chosen.length === items.length, chosen.length > 0 && chosen.length < items.length);
    box.dataset.pick = 'all';
    all.append(box);
    headRow.append(all, ...COLUMNS.slice(1).map(headerCell));
    head.append(headRow);
    const body = el('tbody', '');
    items.forEach((row) => body.append(oppRow(row)));
    table.append(widths, head, body);
    scroller.append(table);
  }
  const foot = el('div', 'px-4 py-2 border-t border-border-subtle type-meta');
  foot.textContent = 'Opportunities come from pages that mention a topic of another page without linking to it. In this preview the mentions are sample data; the real feature reads page text and tracked keywords.';
  panel.append(scroller, foot);
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  panel.addEventListener('input', (event) => {
    if (event.target.dataset.search === undefined) return;
    typing = true;
    view.search = event.target.value;
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
