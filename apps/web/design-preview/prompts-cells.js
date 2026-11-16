/* global window, document */
/**
 * Table cells the Topics tab and the Prompts tab both render: a rate with its change and sample, a trend,
 * the text of a prompt with its marks, the engine that does best. Values come from prompts-data.js; what is
 * in scope and whether changes show comes from prompts-state.js.
 */
import { formatSampleCount } from './vendor/format/number.js';
import { MIN_OBSERVATIONS, pooledCounts } from './vendor/stats/index.js';
import { TYPE_LABEL, absenceOf, averageFor, changeFor, countsOf, engineOf, rateFor, trendOf, updatedOf } from './prompts-data.js';
import { NEUTRAL_BADGE, NEUTRAL_BADGE_LOOK, checkbox, el, insufficient, percent0, plural } from './prompts-parts.js';
import { deltaNode, scopeCodes } from './prompts-state.js';

const { $, icon, engineLogo } = window.PreviewUI;

/** What every body cell of the tables shares: the hairline under it and the 12 px gutters. */
export const CELL = 'border-b border-border-subtle px-3';

/**
 * MetricCell in Compact density, the default (12 section 6): the rate, "avg of N" where it is an average, and the
 * change beside it on one line, so the row stays 32 px; the sample ("612 of 1,296 obs") is in the tooltip. Left aligned
 * like every table column. `value` null renders InsufficientData with `gap.text` and `gap.tip`.
 */
export function rateCell({ value, change, sample, tip, gap, average = '' }) {
  const cell = el('td', CELL);
  if (value === null) {
    const pill = insufficient(gap.text);
    pill.dataset.tip = gap.tip;
    cell.append(pill);
    return cell;
  }
  const line = el('span', 'inline-flex items-baseline gap-1 whitespace-nowrap');
  line.append(el('span', 'num', percent0(value)));
  if (average) line.append(' ', el('span', 'type-label text-foreground-tertiary', average));
  const delta = deltaNode(change, 1);
  if (delta) {
    delta.classList.add('type-meta');
    line.append(delta);
  }
  cell.append(line);
  cell.dataset.tip = tip ? `${sample}. ${tip}` : sample;
  return cell;
}

/** A value for numbers that are not AI rates (a count, an SEO share); its sample is in the tooltip, as in rateCell. */
export function valueCell({ text, sample, tip }, className = '') {
  const cell = el('td', `${className} ${CELL}`.trim());
  cell.append(el('span', 'block num text-foreground', text));
  cell.dataset.tip = tip ? `${sample}. ${tip}` : sample;
  return cell;
}

/** The equal-weight rate of one prompt over the engines in scope. The change shows on the row's primary value only. */
export function promptRateCell(prompt, metric, withChange) {
  const scope = scopeCodes();
  const { value, used } = averageFor(prompt, scope, metric);
  const observed = scope.reduce((sum, code) => sum + prompt.engines[code].n, 0);
  const usable = scope.filter((code) => rateFor(prompt, code, metric) !== null);
  const pooled = pooledCounts(usable.map((code) => countsOf(prompt, code, metric)));
  const names = usable.map((code) => engineOf(code).name).join(', ');
  // With one engine in scope the reason is that engine's own: AI Overview says whether a keyword is linked
  const only = scope.length === 1 ? absenceOf(prompt, scope[0]) : null;
  const absent = only ? { text: only.text, tip: `${engineOf(scope[0]).name}: ${only.reason}` } : { text: 'n/a', tip: 'Not observed in this window' };
  return rateCell({
    value,
    average: used > 1 ? `avg of ${used}` : '',
    change: withChange ? changeFor(prompt, scope, metric) : null,
    sample: `${formatSampleCount(pooled.k, pooled.n)} ${metric === 'sov' ? 'mentions' : 'obs'}`,
    tip: used === 1 ? `${names} only` : `Equal-weight average of ${names}`,
    gap: {
      text: observed === 0 ? absent.text : 'Insufficient',
      tip: observed === 0 ? absent.tip : `${plural(observed, 'observation')} in scope. A rate needs at least ${MIN_OBSERVATIONS} on an engine.`,
    },
  });
}

/** A sparkline of weekly rates (0 to 1). Null points are gaps. An empty series renders "n/a". */
export function sparkCell(points, className) {
  const cell = el('td', `${className} ${CELL}`);
  if (points.length === 0) {
    cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
    return cell;
  }
  const canvas = el('canvas');
  canvas.dataset.spark = points.map((point) => (point === null ? '' : Math.round(point * 100))).join(',');
  canvas.dataset.kind = 'rate';
  canvas.setAttribute('role', 'img');
  const latest = points.at(-1);
  canvas.setAttribute('aria-label', `Mention rate over 8 weeks${latest === null ? '' : `, now ${percent0(latest)}`}`);
  cell.append(canvas);
  return cell;
}

export const promptTrendCell = (prompt, className) => sparkCell(trendOf(prompt, scopeCodes()), className);

export function updatedCell(updated, className, stale = false) {
  const cell = el('td', `${className} ${CELL} whitespace-nowrap text-foreground-tertiary`);
  const line = el('span', 'flex items-center gap-2');
  line.append(el('span', 'num', updated.text));
  if (stale) {
    const badge = el('span', 'h-badge inline-flex items-center px-2 rounded-sm bg-warning-subtle text-warning-text type-micro', 'Stale');
    badge.dataset.tip = 'The latest weekly run has no valid observation for this prompt';
    line.append(badge);
  }
  cell.append(line);
  return cell;
}

export const promptUpdatedCell = (prompt, className) => updatedCell(updatedOf(prompt), className, prompt.stale);

/**
 * PromptCell content (25 section 8.2): one line of text, the lock of a locked core panel, and the type badge
 * while the cell is wide enough for both (a container query: the cell narrows when the drawer docks).
 */
export function promptLine(prompt) {
  const box = el('span', '@container block min-w-0');
  const line = el('span', 'flex items-center gap-2 min-w-0');
  box.append(line);
  const text = el('span', 'block truncate text-foreground', prompt.text);
  text.dataset.keyCell = '';
  text.dataset.tip = prompt.text;
  line.append(text);
  if (prompt.locked) {
    const lock = icon('lock', 'size-icon-xs shrink-0 text-foreground-tertiary');
    lock.setAttribute('aria-label', 'Locked core panel');
    lock.setAttribute('role', 'img');
    lock.removeAttribute('aria-hidden');
    line.append(lock);
  }
  if (prompt.branded) line.append(el('span', `${NEUTRAL_BADGE} shrink-0 group-aria-selected:bg-surface`, 'Branded'));
  line.append(el('span', `hidden @sm:inline-flex shrink-0 ${NEUTRAL_BADGE_LOOK} group-aria-selected:bg-surface`, TYPE_LABEL[prompt.type]));
  return box;
}

/**
 * The engine with the highest rate among `rates` ([{ engine, rate }]): its logo in colour, then its name (the app's
 * EngineLogo, 07 section 5). "n/a" when none has a rate. The tooltip lists every engine's rate.
 */
export function topEngineCell(rates, className = '') {
  const cell = el('td', `${className} ${CELL}`.trim());
  const best = rates.filter((entry) => entry.rate !== null).sort((a, b) => b.rate - a.rate)[0];
  if (!best) {
    cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
    return cell;
  }
  const line = el('span', 'inline-flex min-w-0 items-center gap-2');
  line.append(engineLogo(best.engine.name), el('span', 'block min-w-0 truncate', best.engine.name));
  cell.append(el('span', 'flex min-w-0', ''));
  cell.firstChild.append(line);
  cell.dataset.tip = `${rates.map((entry) => `${entry.engine.name} ${entry.rate === null ? 'n/a' : percent0(entry.rate)}`).join(', ')}. The engine with the highest mention rate. A pointer, not a ranking.`;
  return cell;
}

/** A header cell of the app's DataTable: pinned to the top of the scrolling panel, one line, hairline between columns. */
const HEADER = 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle';

/**
 * A sortable column header (12 section 7). `sort` is the { key, dir } in force and `attr` the data attribute
 * the table listens for, so each table keeps its own sort. The arrow shows on the column that sorts.
 */
export function sortHeaderCell({ key, label, className = '', sort, attr, tip }) {
  const active = sort.key === key;
  const th = el('th', `${HEADER} ${className}`.trim());
  th.scope = 'col';
  th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  if (tip) th.dataset.tip = tip;
  const button = el('button', 'flex min-w-0 items-center gap-1 rounded-sm');
  button.type = 'button';
  button.dataset[attr] = key;
  button.append(el('span', `truncate type-table-header${active ? ' text-foreground' : ''}`, label));
  if (active) button.append(icon(sort.dir === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow', 'size-icon-sm shrink-0 text-foreground'));
  th.append(el('span', 'relative flex min-w-0 items-center gap-1'));
  th.firstChild.append(button);
  return th;
}

export function plainHeaderCell(label, className = '', tip) {
  const th = el('th', `${HEADER} ${className}`.trim());
  th.scope = 'col';
  if (tip) th.dataset.tip = tip;
  th.append(el('span', 'flex min-w-0 items-center gap-1'));
  th.firstChild.append(el('span', 'truncate type-table-header', label));
  return th;
}

/** "/" moves to a table's search field while that field is on screen (12 section 1). */
export function focusSearchOnSlash(search) {
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || search.offsetParent === null) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if ([...document.querySelectorAll('[aria-modal="true"]')].some((dialog) => !dialog.hidden)) return;
    event.preventDefault();
    search.focus();
  });
}

/** The More button of a row. `kind` is "prompt" or "topic"; the table that owns the row opens the menu. */
export function rowMenuCell(kind, name) {
  const cell = el('td', 'border-b border-border-subtle pr-2 text-center');
  const more = el('button', 'size-6 rounded-md inline-flex items-center justify-center text-foreground-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-surface-hover hover:text-foreground');
  more.type = 'button';
  more.dataset.recordMenu = kind;
  more.dataset.tip = 'More actions';
  more.setAttribute('aria-label', `More actions for ${name}`);
  more.append(icon('ellipsis', 'size-icon-sm'));
  cell.append(more);
  return cell;
}

/**
 * The column chooser of a table (19 section 6.4): a popover of checkboxes that apply at once. `columns` is
 * [{ key, label, from, extra }], `shown()` returns the Set in force, `change(key, on)` and `reset()` update it.
 * A column that is on but hidden by the window's width says from which width it shows.
 */
export function wireColumnChooser({ popover, columns, shown, change, reset }) {
  const options = $('[data-options]', popover);
  const render = () => {
    options.replaceChildren(
      ...(typeof columns === 'function' ? columns() : columns).map((column) => {
        const row = el('label', 'h-control-sm px-2 rounded-md flex items-center gap-2 type-body hover:bg-surface-hover cursor-pointer');
        const { wrap, input } = checkbox(column.label);
        input.removeAttribute('aria-label');
        input.value = column.key;
        input.checked = column.locked === true || shown().has(column.key);
        if (column.locked) input.disabled = true;
        row.append(wrap, el('span', `truncate${column.locked ? ' text-foreground-disabled' : ''}`, column.label));
        return row;
      }),
    );
  };
  // Filled when its button is pressed, before the popup opens
  document.addEventListener('click', (event) => {
    if (event.target.closest(`[data-popup="${popover.id}"]`)) render();
  }, true);
  options.addEventListener('change', (event) => {
    const { value, checked } = event.target;
    change(value, checked);
    render();
    $(`input[value="${value}"]`, popover)?.focus();
  });
  $('[data-columns-reset]', popover).addEventListener('click', () => {
    reset();
    render();
  });
}
