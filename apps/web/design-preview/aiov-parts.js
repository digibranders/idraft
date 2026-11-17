/* global document, window, Node */
/**
 * Small pieces the AI visibility Overview is drawn with: formatted values and changes, the card frame, a headline
 * tile, a sparkline, a bar list and stacked share bars. Plain DOM, tokens only (14, 15, 12 in docs/design-system).
 */
import { formatInteger, formatPercent } from './vendor/format/number.js';
import { MEASURES, platformOf } from './aiov-data.js';
import { CARD_INFO, infoText } from './aiov-info.js';
import { NEUTRAL_BADGE, el, insufficient, plural, trendIcon } from './prompts-parts.js';

export { NEUTRAL_BADGE, el, insufficient, plural };

const ui = window.PreviewUI;
export const icon = (name, size = 'size-icon') => ui.icon(name, size);

export const pct0 = (ratio) => formatPercent(ratio, { decimals: 0 });
export const pct1 = (ratio) => formatPercent(ratio, { decimals: 1 });
export const orderText = (value) => (Math.round(value * 10) / 10).toFixed(1);

/** The value of a cell as text: a rate, an order, or why there is none. */
export function valueText(cell) {
  if (!cell || cell.state === 'unavailable') return 'n/a';
  if (cell.state === 'insufficient') return 'n/a';
  if (cell.state === 'none') return 'n/a';
  return MEASURES[cell.measure].unit === 'order' ? orderText(cell.value) : pct0(cell.value);
}

/** The unit a measure counts: answers for a rate, brand mentions for share of voice (R11). */
export const nounOf = (cell) => MEASURES[cell?.measure]?.noun ?? 'answers';

/** "612 of 1,800 answers", the counts every rate shows (R1). An order has no ratio: "62 mentions". */
export function countsText(cell, noun) {
  if (!cell?.counts) return '';
  const unit = noun ?? nounOf(cell);
  if (MEASURES[cell.measure]?.unit === 'order') return `${formatInteger(cell.counts.n)} ${unit}`;
  return `${formatInteger(cell.counts.k)} of ${formatInteger(cell.counts.n)} ${unit}`;
}

/** Why a rate is not shown: the count that fell under the floor of 4 (R2), never a made-up zero (R6). */
export function insufficientText(cell) {
  const n = cell?.counts?.n ?? cell?.observations;
  if (typeof n === 'number' && n > 0 && n < 4) return `${n} ${nounOf(cell)}`;
  return 'Too few';
}

/**
 * The difference between two rates, in points, as the trend icon of the Prompts page: green when the first is higher and
 * red when it is lower, only when the difference is detectable (`isDetectableDifference`, the test of every change icon,
 * on the counts of both); otherwise a grey dash. `say` is the sentence of its hover.
 */
export const gapIcon = (difference, say, detectable) => trendIcon({ value: detectable === true ? difference : 0, detectable: detectable === true }, { say });

/** The sentence of a gap's hover: "Pricing is 10 pts below all groups", with the two figures and the verdict. */
export function gapSentence(subject, difference, other, ours, theirs, detectable) {
  const points = `${(Math.abs(difference) * 100).toFixed(1)}`;
  if (detectable !== true || difference === 0) return `${subject} ${subject === 'You' ? 'are' : 'is'} level with ${other}: the difference of ${points} pts is not detectable, small sample: ${pct0(ours)} against ${pct0(theirs)}.`;
  return `${subject} ${subject === 'You' ? 'are' : 'is'} ${points} pts ${difference > 0 ? 'above' : 'below'} ${other}: ${pct0(ours)} against ${pct0(theirs)}. Detectable: its 95% interval excludes zero.`;
}

export function engineName(code) {
  return code === 'all' ? 'All platforms' : platformOf(code).name;
}

/** The platform's mark and name, one line. */
export function platformLabel(code, { strong = false } = {}) {
  const wrap = el('span', 'inline-flex items-center gap-2 min-w-0');
  if (code !== 'all') wrap.append(ui.engineLogo(platformOf(code).name));
  wrap.append(el('span', `truncate ${strong ? 'type-subsection-title' : ''}`, engineName(code)));
  return wrap;
}

/** "average of 3" beside a value that is an equal-weight average (R3). */
export const averageBadge = (used) => {
  const badge = el('span', NEUTRAL_BADGE, `average of ${used}`);
  badge.dataset.tip = 'The equal-weight average of the platforms that have this measure. Platforms are never pooled';
  return badge;
};

// -------------------------------------------------------------------------------------------------
// Card frame

let cardSeed = 0;

/** The shared popover an info button opens, for touch and keyboard people who have no hover. */
let infoPanel = null;

/**
 * An "i" button that explains a card or a number. Hover or keyboard focus shows the text in a tooltip; a click opens
 * the same text in a small popover, which is how touch reaches it. The text is also in the button for screen readers.
 */
export function infoButton(title, info) {
  const text = infoText(info);
  const button = el('button', 'size-control-sm shrink-0 rounded-md flex items-center justify-center self-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover aria-expanded:text-foreground');
  button.type = 'button';
  button.dataset.tip = text;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `About ${title}`);
  button.append(icon('info', 'size-icon-sm'), el('span', 'sr-only', text));
  button.addEventListener('click', () => {
    if (!infoPanel) {
      infoPanel = el('div', 'hidden fixed z-(--z-dropdown) w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface-elevated shadow-popover p-3 type-body text-foreground-secondary');
      infoPanel.setAttribute('role', 'dialog');
      document.body.append(infoPanel);
    }
    if (button.getAttribute('aria-expanded') === 'true') return ui.closePopup();
    infoPanel.setAttribute('aria-label', title);
    // A definition first, then how it is counted, as two short paragraphs
    const paragraphs = typeof info === 'string' ? [el('p', '', info)] : [el('p', 'text-foreground', info.what), el('p', 'mt-2')];
    if (typeof info !== 'string') paragraphs[1].append(el('span', 'type-body-strong text-foreground', 'How it’s counted: '), info.how);
    infoPanel.replaceChildren(...paragraphs);
    // The tooltip would repeat the popover while it is open
    delete button.dataset.tip;
    ui.openPopup(infoPanel, button, {
      align: 'end',
      focus: button,
      onClose: () => {
        button.dataset.tip = text;
      },
    });
  });
  return button;
}

/**
 * A card of the dashboard: title row, optional meta and tools, a body. The card's definition and method sit behind
 * its info button, read from `CARD_INFO` by key. Cards read the same scope, so a card says what it covers in its
 * meta line.
 */
export function cardFrame({ key, title, meta, tools = [], body, flush = false }) {
  cardSeed += 1;
  const id = `aiov-card-${cardSeed}`;
  // `relative` keeps the screen-reader-only text of a wide table inside the card, so it cannot widen the page
  const section = el('section', 'relative min-w-0 @container bg-surface border border-border rounded-lg overflow-hidden flex flex-col');
  section.dataset.card = key;
  section.setAttribute('aria-labelledby', id);
  // A two-column grid: the title and its meta on the left, the info button on the right, so the button never wraps
  // away from the title or leaves the card. The tools (metric tabs, buttons) sit on a second row, and move up beside
  // the title when the card is wide enough for them (a container query on the card).
  const head = el('div', 'min-h-12 px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] @2xl:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2');
  const text = el('div', 'min-w-0 col-start-1 row-start-1 flex flex-wrap items-baseline gap-x-2 gap-y-0');
  const heading = el('h2', 'type-section-title min-w-0 wrap-anywhere', title);
  heading.id = id;
  text.append(heading);
  if (meta) text.append(el('span', 'type-meta min-w-0 wrap-anywhere', meta));
  head.append(text);
  if (CARD_INFO[key]) {
    const info = infoButton(title, CARD_INFO[key]);
    info.classList.add('col-start-2', 'row-start-1', '@2xl:col-start-3', '-my-1', '-mr-1.5');
    head.append(info);
  }
  if (tools.length > 0) {
    const holder = el('div', 'min-w-0 col-span-2 row-start-2 justify-self-start @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1 @2xl:justify-self-end flex flex-wrap items-center gap-2');
    holder.append(...tools);
    head.append(holder);
  }
  section.append(head);
  const content = el('div', flush ? 'flex-1 min-h-0 flex flex-col' : 'flex-1 min-h-0 px-4 pb-4 flex flex-col');
  content.append(...(Array.isArray(body) ? body : [body]));
  section.append(content);
  return section;
}

/** A card that cannot be drawn for this scope: says why, and what to do. */
export function emptyBody(title, text) {
  // `my-auto` centres the message in a card that is taller than it, so a card without data keeps its size
  const box = el('div', 'min-h-24 py-6 my-auto flex flex-col items-center justify-center gap-1 text-center');
  box.append(el('p', 'type-body-strong text-foreground', title), el('p', 'type-meta max-w-md', text));
  return box;
}

/** A small "Sample" badge for numbers the backend does not collect yet (D7). */
export function sampleBadge(text = 'Sample data') {
  const badge = el('span', NEUTRAL_BADGE, text);
  badge.dataset.tip = 'Drawn from sample data until this measure is collected';
  return badge;
}

// -------------------------------------------------------------------------------------------------
// Sparkline: a plain SVG polyline that follows the theme through its color token

export function sparkline(points, { token = 'chart-1', height = 28, label } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'w-full block overflow-visible');
  svg.style.height = `${height}px`;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  const values = points.filter((value) => value !== null);
  if (values.length < 2) return svg;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const coordinates = points
    .map((value, index) => (value === null ? null : `${((index / (points.length - 1)) * 100).toFixed(2)},${(height - 3 - ((value - low) / span) * (height - 6)).toFixed(2)}`))
    .filter(Boolean);
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', coordinates.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', `var(--${token})`);
  line.setAttribute('stroke-width', '1.75');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return svg;
}

// -------------------------------------------------------------------------------------------------
// Bar list: one row per entity, the value as a bar

export function barList(rows, { max, valueText: text = pct0, always = false } = {}) {
  const top = max ?? Math.max(...rows.map((row) => row.value ?? 0), 0.0001);
  const table = el('table', 'w-full');
  const body = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr', 'h-10');
    const label = el('th', `pr-3 text-left min-w-0 ${row.strong ? 'type-subsection-title' : 'type-body font-normal text-foreground-secondary'}`);
    label.scope = 'row';
    const name = el('span', 'inline-flex items-center gap-2 min-w-0 max-w-full');
    if (row.token) {
      const dot = el('span', 'size-2 shrink-0 rounded-full');
      dot.style.background = `var(--${row.token})`;
      dot.setAttribute('aria-hidden', 'true');
      name.append(dot);
    }
    if (row.onClick) {
      // A row that leads somewhere is a button (the competitor rows open the competitor drawer)
      const open = el('button', 'truncate text-left rounded-sm hover:underline focus-visible:underline outline-none', row.label);
      open.type = 'button';
      open.setAttribute('aria-label', `Open ${row.label}`);
      open.addEventListener('click', () => row.onClick(open));
      name.append(open);
    } else name.append(el('span', 'truncate', row.label));
    if (row.badge) name.append(row.badge);
    label.append(name);
    const barCell = el('td', `w-full pr-2 ${always ? '' : 'hidden @sm:table-cell'}`);
    const bar = el('div', 'h-5 rounded-2xs');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.width = `${Math.max(1, Math.round(((row.value ?? 0) / top) * 100))}%`;
    bar.style.background = row.value === null ? 'transparent' : `var(--${row.barToken ?? (row.strong ? 'chart-1' : 'chart-bar-neutral')})`;
    barCell.append(bar);
    const value = el('td', 'w-24 text-right type-label num whitespace-nowrap');
    value.append(row.value === null ? el('span', 'text-foreground-tertiary', 'n/a') : el('span', '', text(row.value)));
    if (row.note) value.append(el('span', 'ml-1.5 type-meta', row.note));
    tr.append(label, barCell, value);
    if (row.tip) tr.dataset.tip = row.tip;
    body.append(tr);
  });
  table.append(body);
  return table;
}

// -------------------------------------------------------------------------------------------------
// Stacked share bars: one 100% bar per row, with a legend table of the shares and their counts

export function stackedRows({ rows, segments, empty = 'No answers yet' }) {
  const wrap = el('div', 'flex flex-col gap-3');
  const legend = el('div', 'flex flex-wrap gap-x-4 gap-y-1');
  segments.forEach((segment) => {
    const item = el('span', 'inline-flex items-center gap-1.5 type-meta');
    const dot = el('span', 'size-2 shrink-0 rounded-2xs');
    dot.style.background = `var(--${segment.token})`;
    dot.setAttribute('aria-hidden', 'true');
    item.append(dot, segment.label);
    legend.append(item);
  });
  wrap.append(legend);
  rows.forEach((row) => {
    const line = el('div', 'flex flex-col gap-1');
    const label = el('div', 'flex items-baseline gap-2 min-w-0');
    label.append(row.label instanceof Node ? row.label : el('span', 'type-body text-foreground', row.label));
    if (row.note) label.append(el('span', 'ml-auto type-meta num whitespace-nowrap', row.note));
    line.append(label);
    if (row.shares === null) {
      line.append(insufficient(empty));
    } else {
      const bar = el('div', 'h-5 flex gap-0.5 overflow-hidden rounded-xs');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', segments.map((segment, index) => `${segment.label} ${pct0(row.shares[index])}`).join(', '));
      const total = row.counts ? row.counts.reduce((a, b) => a + b, 0) : 0;
      segments.forEach((segment, index) => {
        const share = row.shares[index];
        if (share <= 0) return;
        const part = el('div', 'h-full min-w-0');
        part.style.width = `${share * 100}%`;
        part.style.background = `var(--${segment.token})`;
        part.dataset.tip = `${segment.label}: ${pct0(share)}${total ? `, ${formatInteger(row.counts[index])} of ${formatInteger(total)} answers` : ''}`;
        part.setAttribute('aria-hidden', 'true');
        bar.append(part);
      });
      // The exact shares sit under the bar: color alone never carries them
      const values = el('div', 'flex flex-wrap gap-x-3 gap-y-0.5 type-table num text-foreground-secondary');
      segments.forEach((segment, index) => {
        const item = el('span', 'inline-flex items-center gap-1');
        const dot = el('span', 'size-1.5 rounded-full');
        dot.style.background = `var(--${segment.token})`;
        dot.setAttribute('aria-hidden', 'true');
        item.append(dot, pct0(row.shares[index]));
        item.title = segment.label;
        values.append(item);
      });
      line.append(bar, values);
    }
    wrap.append(line);
  });
  return wrap;
}

/** A heat-map bin from a rate, on the shared seven bins of the sequential scale (inventory CH-04). */
export function heatBin(ratio) {
  const edges = [0.1, 0.2, 0.3, 0.4, 0.5, 0.65];
  return 1 + edges.filter((edge) => ratio >= edge).length;
}
