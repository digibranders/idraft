/* global location */
/**
 * Internal links, Tier flow tab (spec 7.6): a summary strip per tier, one sentence that reads the data, and a table
 * heatmap of unique links from each tier (rows) to each tier (columns). A cell opens the Links tab on that pair.
 * The table is the accessible version; no chart library.
 */
import { el } from './prompts-parts.js';
import { SCOPE_MENU, SCOPE_WORD, activePages, crawls, currentCrawl, equity, ins, number, pct, plural, refresh, state, tierBadge, tierCode, tierFlow, tierLabel, tiers } from './il-model.js';
import { applyRestore, menuSelect } from './il-pages.js';

const PANEL = 'rounded-lg border border-border bg-surface';
const CELL_PAD = 'px-3 py-2';
// Whole class names so Tailwind compiles them; the share of the matrix maximum picks one of seven steps
const FILL = ['bg-seq-1', 'bg-seq-2', 'bg-seq-3', 'bg-seq-4', 'bg-seq-5', 'bg-seq-6', 'bg-seq-7'];
const INK = ['text-foreground', 'text-foreground', 'text-foreground', 'text-foreground', 'text-surface', 'text-surface', 'text-surface'];

const scopeWord = (scope) => SCOPE_WORD[scope] ?? 'internal';
const keyName = (key) => (key ? tierLabel(key) : 'Untiered pages');

function summaryStrip(flow) {
  const strip = el('div', `${PANEL} flex flex-wrap`);
  strip.setAttribute('role', 'list');
  flow.strip.forEach((item) => {
    const cell = el('div', 'flex min-w-48 flex-1 flex-col gap-1.5 border-r border-border-subtle px-4 py-3 last:border-r-0');
    cell.setAttribute('role', 'listitem');
    const badge = tierBadge(item.key);
    badge.classList.add('self-start');
    cell.append(
      badge,
      el('p', 'type-body-strong num text-foreground', `${pct(item.equity)} of equity`),
      el('p', 'type-meta text-foreground-secondary', `from ${pct(item.pages / Math.max(1, activePages().length))} of pages, ${item.depth === null ? 'depth n/a' : `average depth ${item.depth.toFixed(1)}`}`),
    );
    strip.append(cell);
  });
  return strip;
}

function sentence(flow) {
  const top = tiers[0];
  if (!top) return 'No tiers are set up yet. Add tiers in Workspace settings to see how equity flows between them.';
  const topShare = flow.strip.find((item) => item.key === top.id)?.equity ?? 0;
  const text = `${tierCode(top.id)} pages hold ${pct(topShare)} of internal equity.`;
  // The tier (other than the top one) that sends the most links to the top tier in this scope
  const senders = flow.keys.filter((key) => key !== top.id).map((key) => ({ key, count: flow.matrix.get(key).get(top.id) }));
  const best = senders.reduce((a, b) => (b.count > (a?.count ?? -1) ? b : a), null);
  if (!best) return text;
  const from = best.key ? `${tierLabel(best.key).replace(/^T\d+ /, '')} (${tierCode(best.key)})` : 'Untiered pages';
  return `${text} ${from} send ${plural(best.count, `${scopeWord(state.scope)} link`)} to ${tierCode(top.id)}.`;
}

function openPair(from, to) {
  state.links.pair = { from, to, scope: state.scope };
  state.links.search = '';
  location.hash = '#/internal-links/links';
}

function heatCell(flow, from, to, max) {
  const value = flow.matrix.get(from).get(to);
  const td = el('td', 'border-b border-border-subtle p-0 text-right');
  const noun = `${scopeWord(state.scope)} ${value === 1 ? 'link' : 'links'}`;
  const level = value === 0 || max === 0 ? -1 : Math.min(FILL.length - 1, Math.ceil((value / max) * FILL.length) - 1);
  const cell = el('button', `block h-row w-full ${CELL_PAD} type-table num ${level < 0 ? 'text-foreground-tertiary hover:bg-surface-hover' : `${FILL[level]} ${INK[level]}`}`, String(value));
  cell.type = 'button';
  cell.setAttribute('aria-label', `${number(value)} ${noun} from ${keyName(from)} to ${keyName(to)}, show them`);
  cell.addEventListener('click', () => openPair(from, to));
  td.append(cell);
  return td;
}

function headCell(content, className = '') {
  const th = el('th', `border-b border-border bg-surface-subtle ${CELL_PAD} type-table-header text-foreground-tertiary font-normal ${className}`);
  th.scope = 'col';
  th.append(content);
  return th;
}

function heatmap(flow) {
  const table = el('table', 'w-full border-collapse');
  const rowTotals = new Map(flow.keys.map((from) => [from, [...flow.matrix.get(from).values()].reduce((sum, value) => sum + value, 0)]));
  const max = Math.max(0, ...flow.keys.flatMap((from) => [...flow.matrix.get(from).values()]));
  const headRow = el('tr');
  headRow.append(headCell('From', 'text-left'));
  flow.keys.forEach((key) => {
    const label = el('span', 'inline-flex items-center justify-end gap-1.5', 'To ');
    label.append(tierBadge(key));
    headRow.append(headCell(label, 'text-right'));
  });
  headRow.append(headCell('Total', 'text-right'));
  const head = el('thead');
  head.append(headRow);
  const body = el('tbody');
  flow.keys.forEach((from) => {
    const row = el('tr');
    const th = el('th', `border-b border-border-subtle border-r border-r-border-subtle ${CELL_PAD} text-left font-normal`);
    th.scope = 'row';
    th.append(tierBadge(from, { withName: true }));
    row.append(th);
    flow.keys.forEach((to) => row.append(heatCell(flow, from, to, max)));
    row.append(el('td', `border-b border-border-subtle ${CELL_PAD} text-right type-table num text-foreground font-medium`, number(rowTotals.get(from))));
    body.append(row);
  });
  table.append(head, body);
  const wrap = el('div', 'overflow-x-auto');
  wrap.append(table);
  return wrap;
}

/** Pages that hold equity without passing it to a page that ranks: errors and non-indexable pages. Redirects pass it on. */
function lostRows() {
  return activePages()
    .filter((page) => page.status >= 400 || (page.status === 200 && !page.indexable))
    .map((page) => ({ page, share: equity[page.id], linking: ins(page.id, 'all').length }))
    .sort((a, b) => b.share - a.share);
}

const KIND = (page) => (page.status >= 400 ? `Error (${page.status})` : page.reason || 'Not indexable');

function lostPanel() {
  const panel = el('section', PANEL);
  panel.setAttribute('aria-labelledby', 'il-flow-lost-title');
  const head = el('div', 'px-4 pt-3 pb-2 flex flex-col gap-1');
  const title = el('h2', 'type-subsection-title', 'Equity held by errors and non-indexable pages');
  title.id = 'il-flow-lost-title';
  head.append(title, el('p', 'type-meta text-foreground-secondary', 'Links to these pages do not help a page that can rank. Counts include every kind of link. Redirects pass equity to their target but cost a hop.'));
  panel.append(head);
  const rows = lostRows();
  if (rows.length === 0) {
    panel.append(el('p', 'px-4 pb-4 type-body text-foreground-secondary', 'No error or non-indexable pages in this crawl.'));
    return panel;
  }
  const table = el('table', 'w-full border-collapse');
  const headRow = el('tr');
  [['Page', 'text-left'], ['Why', 'text-left'], ['Equity', 'text-right'], ['Pages linking to it', 'text-right']].forEach(([label, align]) => headRow.append(headCell(label, align)));
  const thead = el('thead');
  thead.append(headRow);
  const body = el('tbody');
  rows.forEach(({ page, share, linking }) => {
    const row = el('tr');
    const th = el('th', `border-b border-border-subtle ${CELL_PAD} text-left font-normal`);
    th.scope = 'row';
    th.append(el('span', 'block truncate type-table text-foreground', page.path));
    row.append(
      th,
      el('td', `border-b border-border-subtle ${CELL_PAD} type-table text-foreground-secondary`, KIND(page)),
      el('td', `border-b border-border-subtle ${CELL_PAD} text-right type-table num text-foreground`, pct(share)),
      el('td', `border-b border-border-subtle ${CELL_PAD} text-right type-table num text-foreground`, number(linking)),
    );
    body.append(row);
  });
  table.append(thead, body);
  const wrap = el('div', 'overflow-x-auto');
  wrap.append(table);
  panel.append(wrap);
  return panel;
}

export function render(host) {
  const flow = tierFlow(state.scope);
  const note = el('p', 'type-body text-foreground-secondary', sentence(flow));
  const toolbar = el('div', 'flex flex-wrap items-center gap-3 border-b border-border px-4 py-3');
  toolbar.append(
    menuSelect('Links', SCOPE_MENU, state.scope, (value) => {
      state.scope = value;
      refresh();
    }, 'Link scope'),
    el('span', 'type-meta text-foreground-tertiary', 'Rows link to columns'),
  );
  const matrix = el('section', PANEL);
  matrix.setAttribute('aria-label', 'Links between tiers');
  matrix.append(toolbar, heatmap(flow));
  host.replaceChildren(el('div', 'flex flex-col gap-4', ''));
  host.firstChild.append(summaryStrip(flow));
  // The crawl in view decides every number here; say so when it is not the newest
  if (currentCrawl().id !== crawls[0].id) host.firstChild.append(el('p', 'type-meta text-foreground-tertiary', `Showing the crawl of ${currentCrawl().short}.`));
  host.firstChild.append(note, matrix, lostPanel());
  applyRestore(host);
}

export function exportRows() {
  const flow = tierFlow(state.scope);
  return [
    ['From', ...flow.keys.map((key) => `To ${keyName(key)}`), 'Total'],
    ...flow.keys.map((from) => {
      const values = flow.keys.map((to) => flow.matrix.get(from).get(to));
      return [keyName(from), ...values, values.reduce((sum, value) => sum + value, 0)];
    }),
  ];
}
