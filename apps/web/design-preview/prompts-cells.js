/* global window, document, matchMedia */
/**
 * Table cells the Topics tab and the Prompts tab both render: a rate with its change and sample, a trend,
 * the text of a prompt with its marks, the engine that does best. Values come from prompts-data.js; what is
 * in scope and whether changes show comes from prompts-state.js.
 */
import { formatInteger, formatSampleCount } from './vendor/format/number.js';
import { MIN_OBSERVATIONS, pooledCounts } from './vendor/stats/index.js';
import { TYPE_LABEL, averageFor, changeFor, countsOf, engineOf, rateFor, trendOf, updatedOf } from './prompts-data.js';
import { NEUTRAL_BADGE, NEUTRAL_BADGE_LOOK, el, insufficient, percent0, plural } from './prompts-parts.js';
import { deltaNode, scopeCodes } from './prompts-state.js';

const { $, icon, engineLogo } = window.PreviewUI;

/**
 * MetricCell at Default density (12 section 6): the rate, its change beside it, the sample below.
 * `value` null renders InsufficientData with `gap.text` and `gap.tip`.
 */
export function rateCell({ value, change, sample, tip, gap }) {
  const cell = el('td', 'px-3 text-right');
  if (value === null) {
    const pill = insufficient(gap.text);
    pill.dataset.tip = gap.tip;
    cell.append(pill);
    return cell;
  }
  const line = el('span', 'flex items-baseline justify-end gap-1.5');
  line.append(el('span', 'num text-foreground', percent0(value)));
  const delta = deltaNode(change);
  if (delta) {
    delta.classList.add('type-label');
    line.append(delta);
  }
  cell.append(line, el('span', 'block type-label num whitespace-nowrap', sample));
  if (tip) cell.dataset.tip = tip;
  return cell;
}

/** A value with its sample below, for numbers that are not AI rates (a count, an SEO share). */
export function valueCell({ text, sample, tip }, className = '') {
  const cell = el('td', `${className} px-3 text-right`.trim());
  cell.append(el('span', 'block num text-foreground', text), el('span', 'block type-label num whitespace-nowrap', sample));
  if (tip) cell.dataset.tip = tip;
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
  return rateCell({
    value,
    change: withChange ? changeFor(prompt, scope, metric) : null,
    sample: `${formatSampleCount(pooled.k, pooled.n)} ${metric === 'sov' ? 'mentions' : 'obs'}`,
    tip: used === 1 ? `${names} only` : `Equal-weight average of ${names}`,
    gap: {
      text: observed === 0 ? 'n/a' : 'Insufficient',
      tip: observed === 0 ? 'Not observed in this window' : `${plural(observed, 'observation')} in scope. A rate needs at least ${MIN_OBSERVATIONS} on an engine.`,
    },
  });
}

/** A sparkline of weekly rates (0 to 1). Null points are gaps. An empty series renders "n/a". */
export function sparkCell(points, className) {
  const cell = el('td', `${className} px-3`);
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
  const cell = el('td', `${className} px-3 whitespace-nowrap text-foreground-tertiary`);
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

/** The engine with the highest rate among `rates` ([{ engine, rate }]), with its logo. "n/a" when none has a rate. */
export function topEngineCell(rates, className) {
  const cell = el('td', `${className} px-3`);
  const best = rates.filter((entry) => entry.rate !== null).sort((a, b) => b.rate - a.rate)[0];
  if (!best) {
    cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
    return cell;
  }
  const line = el('span', 'flex items-center gap-2 min-w-0');
  line.append(engineLogo(best.engine.name), el('span', 'truncate', best.engine.name), el('span', 'ml-auto num text-foreground-secondary', percent0(best.rate)));
  cell.append(line);
  cell.dataset.tip = `${best.engine.name} has the highest mention rate: ${rates.map((entry) => `${entry.engine.name} ${entry.rate === null ? 'n/a' : percent0(entry.rate)}`).join(', ')}`;
  return cell;
}

const HEADER = 'px-3 whitespace-nowrap type-label border-r border-border-subtle';

/**
 * A sortable column header (12 section 7). `sort` is the { key, dir } in force and `attr` the data attribute
 * the table listens for, so each table keeps its own sort.
 */
export function sortHeaderCell({ key, label, className, note, align = 'justify-end', rowSpan, sort, attr }) {
  const active = sort.key === key;
  const th = el('th', className);
  th.scope = 'col';
  th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  if (rowSpan) th.rowSpan = rowSpan;
  const button = el('button', `w-full min-h-8 px-2 py-1 rounded-md flex items-center ${align} gap-1 type-label hover:bg-surface-hover hover:text-foreground${active ? ' text-foreground' : ''}`);
  button.type = 'button';
  button.dataset[attr] = key;
  const text = el('span', `flex flex-col whitespace-nowrap ${align === 'justify-end' ? 'items-end' : 'items-start'}`);
  text.append(el('span', '', label));
  if (note) text.append(el('span', 'font-normal text-foreground-tertiary', note));
  const arrow = !active ? 'arrow-up-down' : sort.dir === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow';
  button.append(text, icon(arrow, `size-icon-xs shrink-0${active ? '' : ' text-foreground-muted'}`));
  th.append(button);
  return th;
}

export function plainHeaderCell(label, className, rowSpan) {
  const th = el('th', `${HEADER} ${className}`, label);
  th.scope = 'col';
  if (rowSpan) th.rowSpan = rowSpan;
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
  const cell = el('td', 'w-10 pr-2 text-right');
  const more = el('button', 'size-6 rounded-md inline-flex items-center justify-center text-foreground-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-surface-hover hover:text-foreground');
  more.type = 'button';
  // Not data-row-menu: that attribute opens the keyword menu of the Rankings table
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
      ...columns.map((column) => {
        const row = el('label', 'h-control-sm px-2 rounded-md flex items-center gap-2 type-body hover:bg-surface-hover cursor-pointer');
        const input = el('input', 'size-4 rounded-sm accent-primary');
        input.type = 'checkbox';
        input.value = column.key;
        input.checked = shown().has(column.key);
        row.append(input, el('span', 'truncate', column.label));
        if (input.checked && !matchMedia(`(width >= ${column.from / 16}rem)`).matches) row.append(el('span', 'ml-auto pl-4 type-meta whitespace-nowrap', `From ${formatInteger(column.from)} px`));
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
