/**
 * The keyword table (12-tables.md, 24 section 9.3 as built in docs/20 section 5.3). The keyword column is pinned.
 * Below 768 px the table keeps the columns that matter most and scrolls sideways inside its own box.
 */
import { DEVICES, INTENTS, LANGUAGES, labelOf, locationName } from './kw-data.js';
import { COLUMNS, changeOf, formatCpc, formatDate, formatInt, rankOf, relativeTime } from './kw-model.js';
import { badge, icon } from './perf-ui.js';
import { el } from './prompts-parts.js';

/** Columns the narrow screens leave out (the chooser still lists them). */
const WIDE_ONLY = new Set(['url', 'kd', 'cpc', 'intent', 'group', 'tags', 'best', 'updated', 'added']);
const CHANGE_COLOUR_FROM = 3;
/** The preview's one project (kw-data.js); a ranking URL is a path on it. */
const PROJECT_HOST = 'fynix.digital';

export const cellText = (text, className = '') => el('span', className, text);

/** The tooltip of the keyword: where and how it is tracked (docs/20 section 5.3). */
export function keywordTip(kw) {
  return [locationName(kw.location), labelOf(DEVICES, kw.device), 'Google', labelOf(LANGUAGES, kw.language)].join(' · ');
}

/** The change since the previous check as a small slot after the rank: arrow and places, New, Lost, or nothing. */
function changeSlot(kw) {
  const slot = el('span', 'inline-flex items-center gap-0.5 w-12 shrink-0 text-left whitespace-nowrap num');
  const change = changeOf(kw);
  if (!change) return { slot, tip: '' };
  if (change.kind === 'entered') {
    slot.append(cellText('New', 'type-meta text-positive-text'));
    return { slot, tip: 'New in the tracked depth since the previous check' };
  }
  if (change.kind === 'lost') {
    slot.append(cellText('Lost', 'type-meta text-negative-text'));
    return { slot, tip: 'Dropped out of the tracked depth since the previous check' };
  }
  const moved = Math.abs(change.value);
  if (moved === 0) {
    slot.append(cellText('0', 'type-meta text-foreground-tertiary'));
    return { slot, tip: 'No change since the previous check' };
  }
  const colour = moved < CHANGE_COLOUR_FROM ? 'text-foreground-secondary' : change.value > 0 ? 'text-positive-text' : 'text-negative-text';
  slot.append(icon(change.value > 0 ? 'arrow-up' : 'arrow-down', `size-icon-xs ${colour}`), cellText(String(moved), `type-body-strong ${colour}`));
  return { slot, tip: `${change.value > 0 ? 'Up' : 'Down'} ${moved} ${moved === 1 ? 'place' : 'places'} since the previous check` };
}

function rankCell(kw) {
  const td = el('td', 'px-3 whitespace-nowrap');
  const line = el('span', 'flex items-center justify-end gap-2');
  td.append(line);
  const rank = rankOf(kw);
  const { slot, tip } = changeSlot(kw);
  if (rank.kind === 'ranked' || rank.kind === 'beyond') {
    const ranked = rank.kind === 'ranked';
    line.append(cellText(ranked ? String(rank.value) : '>100', `num ${ranked ? 'type-body-strong text-foreground' : 'type-body text-foreground-tertiary'}`), slot);
    const checked = ranked ? `Checked ${relativeTime(kw.checkedAt)}` : `Not in the top 100, checked ${relativeTime(kw.checkedAt)}`;
    td.dataset.tip = tip ? `${checked}. ${tip}` : checked;
  } else if (rank.kind === 'failed') {
    line.append(icon('triangle-alert', 'size-icon-sm text-warning-text'), cellText('Check failed', 'type-meta text-warning-text'), slot);
    td.dataset.tip = 'The last check did not finish. It is retried on the next run';
  } else {
    line.append(cellText('Pending', 'type-meta text-foreground-tertiary'), slot);
    td.dataset.tip = 'The first rank check has not run yet';
  }
  return td;
}

function urlCell(kw) {
  const td = el('td', 'px-3 min-w-0 max-w-64');
  if (kw.urls.length === 0) {
    td.append(cellText('No URL', 'type-meta text-foreground-tertiary'));
    return td;
  }
  const line = el('span', 'flex items-center gap-2 min-w-0');
  line.append(cellText(kw.urls[0], 'type-body truncate min-w-0'));
  if (kw.urls.length > 1) {
    line.append(badge('+1', 'info'));
    td.dataset.tip = kw.urls.join(', ');
  }
  td.append(line);
  return td;
}

function metricCell(kw, text, { pendingLabel = false } = {}) {
  const td = el('td', 'px-3 text-right whitespace-nowrap');
  if (text === null) td.append(cellText(pendingLabel && kw.cur === 'p' ? 'Pending' : 'No data', 'type-meta text-foreground-tertiary'));
  else td.append(cellText(text, 'num type-body text-foreground'));
  return td;
}

function groupCell(kw) {
  const td = el('td', 'px-3 min-w-0 max-w-48');
  if (kw.group === null) {
    td.append(cellText('No group', 'type-meta text-foreground-tertiary'));
    return td;
  }
  td.dataset.tip = kw.group;
  td.append(cellText(kw.group.split(' / ').at(-1), 'type-body truncate block'));
  return td;
}

function tagsCell(kw) {
  const td = el('td', 'px-3 min-w-0 max-w-64');
  if (kw.tags.length === 0) return td;
  const line = el('span', 'flex items-center gap-2 min-w-0');
  line.append(cellText(kw.tags[0], 'type-body truncate min-w-0'));
  if (kw.tags.length > 1) line.append(badge(`+${kw.tags.length - 1}`, 'neutral'));
  td.append(line);
  td.dataset.tip = kw.tags.join(', ');
  return td;
}

const CELL = {
  rank: rankCell,
  url: urlCell,
  volume: (kw) => metricCell(kw, kw.volume === null ? null : formatInt(kw.volume), { pendingLabel: true }),
  kd: (kw) => metricCell(kw, kw.kd === null ? null : String(kw.kd), { pendingLabel: true }),
  cpc: (kw) => metricCell(kw, kw.cpc === null ? null : formatCpc(kw.cpc), { pendingLabel: true }),
  intent: (kw) => {
    const td = el('td', 'px-3 whitespace-nowrap');
    td.append(cellText(labelOf(INTENTS, kw.intent), 'type-body text-foreground'));
    return td;
  },
  priority: (kw) => {
    const td = el('td', 'px-3 text-right num type-body text-foreground', String(kw.priority));
    return td;
  },
  group: groupCell,
  tags: tagsCell,
  best: (kw) => metricCell(kw, kw.best === null ? null : String(kw.best)),
  updated: (kw) => {
    const td = el('td', 'px-3 whitespace-nowrap type-body text-foreground-secondary');
    td.textContent = kw.metricsAt === null ? 'Pending' : relativeTime(kw.metricsAt);
    return td;
  },
  added: (kw) => el('td', 'px-3 whitespace-nowrap type-body text-foreground-secondary', formatDate(kw.added)),
};

function keywordCell(kw, ctx) {
  const td = el('td', 'sticky left-10 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover px-3 min-w-64 max-w-96');
  const line = el('span', 'flex items-center gap-1 min-w-0');
  const open = el('button', 'type-body-strong text-foreground hover:underline text-left truncate min-w-0');
  open.type = 'button';
  open.textContent = kw.keyword;
  open.dataset.tip = keywordTip(kw);
  open.dataset.kwOpen = String(kw.id);
  open.addEventListener('click', () => ctx.open(kw.id));
  line.append(open);
  if (kw.urls.length > 0) {
    // The page that ranks, one click away; the tooltip names it (and says how many more own pages rank).
    const target = `${PROJECT_HOST}${kw.urls[0]}`;
    const more = kw.urls.length > 1 ? ` (+${kw.urls.length - 1} more ranking pages)` : '';
    const link = el('a', 'size-7 shrink-0 rounded-md flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-hover');
    link.href = `https://${target}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `Open the ranking page of ${kw.keyword}: ${target}`);
    link.dataset.tip = `${target}${more}`;
    link.append(icon('arrow-up-right', 'size-icon'));
    line.append(link);
  }
  td.append(line);
  return td;
}

function headerCell(label, key, state, ctx, extraClass) {
  const th = el('th', `px-1 type-label text-foreground-secondary text-left ${extraClass}`.trim());
  if (!key) {
    th.append(el('span', 'px-2 block', label));
    return th;
  }
  const active = state.sort === key || state.sort === `-${key}`;
  th.setAttribute('aria-sort', state.sort === key ? 'ascending' : state.sort === `-${key}` ? 'descending' : 'none');
  const node = el('button', `h-8 px-2 rounded-md flex items-center gap-1 whitespace-nowrap type-label hover:bg-surface-hover hover:text-foreground ${key === 'rank' || key === 'volume' || key === 'kd' || key === 'cpc' || key === 'best' || key === 'priority' ? 'justify-end w-full' : ''}`);
  node.type = 'button';
  const direction = !active ? 'arrow-up-down' : state.sort.startsWith('-') ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide';
  node.append(label, icon(direction, `size-icon-xs ${active ? 'text-foreground' : 'text-foreground-muted'}`));
  node.addEventListener('click', () => ctx.sort(key));
  th.append(node);
  // The rank number ends before the change slot (3rem) and its gap (0.5rem), so the header ends there too.
  if (key === 'rank') th.style.paddingRight = '3.75rem';
  return th;
}

/**
 * @param {{rows: object[], state: object, selected: Set<number>, ctx: object}} options
 * `ctx` supplies sort(key), select(id, on), selectPage(rows, on) and open(id).
 */
export function renderTable({ rows, state, selected, ctx }) {
  const visible = COLUMNS.filter(([key]) => state.cols.includes(key));
  const wrap = el('div', 'rounded-lg border border-border bg-surface overflow-x-auto');
  const table = el('table', 'w-full border-collapse type-table min-w-200');
  const thead = el('thead', 'bg-surface-subtle');
  const head = el('tr', 'h-row-header');
  const all = el('th', 'sticky left-0 z-(--z-table-header) bg-surface-subtle w-10 pl-3 pr-1');
  const allBox = el('input', 'size-4 rounded-sm accent-primary align-middle');
  allBox.type = 'checkbox';
  allBox.setAttribute('aria-label', 'Select all keywords on this page');
  allBox.checked = rows.length > 0 && rows.every((kw) => selected.has(kw.id));
  allBox.addEventListener('change', () => ctx.selectPage(rows, allBox.checked));
  all.append(allBox);
  const keyHead = el('th', 'sticky left-10 z-(--z-table-header) bg-surface-subtle px-1 text-left min-w-64');
  keyHead.append(el('span', 'px-2 type-label text-foreground-secondary', 'Keyword'));
  head.append(all, keyHead);
  visible.forEach(([key, label, sortKey]) => {
    head.append(headerCell(label, sortKey, state, ctx, `${WIDE_ONLY.has(key) ? 'hidden md:table-cell' : ''} ${['rank', 'volume', 'kd', 'cpc', 'priority', 'best'].includes(key) ? 'text-right' : ''}`));
  });
  thead.append(head);

  const tbody = el('tbody');
  rows.forEach((kw) => {
    const on = selected.has(kw.id);
    const tr = el('tr', `group ${state.density === 'compact' ? 'h-row-compact' : 'h-row'} border-t border-border-subtle hover:bg-surface-hover ${on || state.inspect === kw.id ? 'bg-surface-selected' : ''}`);
    const boxCell = el('td', 'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover w-10 pl-3 pr-1');
    const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
    box.type = 'checkbox';
    box.checked = on;
    box.setAttribute('aria-label', `Select ${kw.keyword}`);
    box.addEventListener('change', () => ctx.select(kw.id, box.checked));
    boxCell.append(box);
    tr.append(boxCell, keywordCell(kw, ctx));
    visible.forEach(([key]) => {
      const cell = CELL[key](kw);
      if (WIDE_ONLY.has(key)) cell.classList.add('hidden', 'md:table-cell');
      tr.append(cell);
    });
    tr.addEventListener('click', (event) => {
      if (event.target.closest('input, button, a')) return;
      ctx.open(kw.id);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

export const footerText = (from, to, total) => `Showing ${from} to ${to} of ${total} keywords`;
