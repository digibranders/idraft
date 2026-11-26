/* global document, Node */
/** The plain table and the n/a cell the preview's short lists share (Insights, Competitors). */
import { el } from './aiov-parts.js';

export const na = (reason) => {
  const span = el('span', 'text-foreground-secondary', 'n/a');
  span.title = reason;
  span.append(el('span', 'sr-only', ` ${reason}`));
  return span;
};

export function table(columns, rows) {
  const wrap = el('div', 'relative overflow-x-auto rounded-lg border border-border bg-surface');
  const t = el('table', 'w-full');
  const head = el('thead', 'bg-surface-subtle');
  const tr = el('tr');
  columns.forEach((c) => tr.append(el('th', `h-row-header px-4 type-label font-normal ${c.actions ? 'text-right' : 'text-left'} text-foreground-secondary`, c.header)));
  head.append(tr);
  const body = el('tbody');
  rows.forEach((row) => {
    const r = el('tr', 'h-row-compact border-t border-border-subtle');
    columns.forEach((c, i) => {
      const cell = el(i === 0 ? 'th' : 'td', `px-4 type-table ${i === 0 ? 'font-normal text-left' : ''} ${c.actions ? 'text-right' : 'text-left'} text-foreground`);
      const content = c.cell(row);
      cell.append(content instanceof Node ? content : document.createTextNode(String(content)));
      r.append(cell);
    });
    body.append(r);
  });
  t.append(head, body);
  wrap.append(t);
  return wrap;
}

