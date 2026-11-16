/* global document, window, Node */
/**
 * Small pieces the AI visibility Overview is drawn with: formatted values and changes, the card frame, a headline
 * tile, a sparkline, a bar list and stacked share bars. Plain DOM, tokens only (14, 15, 12 in docs/design-system).
 */
import { formatMetricDelta } from './vendor/format/delta.js';
import { MINUS, formatInteger, formatPercent, formatPointsDelta } from './vendor/format/number.js';
import { MEASURES, platformOf } from './aiov-data.js';
import { NEUTRAL_BADGE, el, insufficient, plural } from './prompts-parts.js';

export { NEUTRAL_BADGE, el, insufficient, plural };

const ui = window.PreviewUI;
export const icon = (name, size = 'size-icon') => ui.icon(name, size);

export const pct0 = (ratio) => formatPercent(ratio, { decimals: 0 });
export const pct1 = (ratio) => formatPercent(ratio, { decimals: 1 });
export const orderText = (value) => (Math.round(value * 10) / 10).toFixed(1);

const TONE = { positive: 'text-positive-text', negative: 'text-negative-text', neutral: 'text-foreground-secondary' };

/** The value of a cell as text: a rate, an order, or why there is none. */
export function valueText(cell) {
  if (!cell || cell.state === 'unavailable') return 'n/a';
  if (cell.state === 'insufficient') return 'n/a';
  if (cell.state === 'none') return 'No data';
  return MEASURES[cell.measure].unit === 'order' ? orderText(cell.value) : pct0(cell.value);
}

/** "612 of 1,800 answers", the counts every rate shows (R1). */
export function countsText(cell, noun = 'answers') {
  if (!cell?.counts) return '';
  return `${formatInteger(cell.counts.k)} of ${formatInteger(cell.counts.n)} ${noun}`;
}

/**
 * A change against the previous period, in points (R5), colored only when detectable. An order (mention position)
 * changes in places, and a lower number is better, so it is never colored. Null when there is nothing to compare.
 */
export function deltaNode(cell, compare, { decimals = 1 } = {}) {
  if (!compare || !cell?.change || cell.state !== 'ok') return null;
  const { value, detectable } = cell.change;
  if (MEASURES[cell.measure].unit === 'order') {
    const sign = value > 0 ? '+' : value < 0 ? MINUS : '';
    const node = el('span', `num shrink-0 whitespace-nowrap ${TONE.neutral}`, `${sign}${Math.abs(value).toFixed(2)}`);
    node.dataset.tip = 'A lower number means named earlier. Not tested for detectability';
    node.append(el('span', 'sr-only', ', not tested for detectability'));
    return node;
  }
  const display = formatMetricDelta({ value, unit: 'points', polarity: 'higher_is_better', isDetectable: detectable });
  const node = el('span', `num shrink-0 whitespace-nowrap ${TONE[display.tone]}`, formatPointsDelta(value, { decimals }));
  node.dataset.tip = detectable ? 'Detectable change: its 95% interval excludes zero' : 'Within normal variation';
  node.append(el('span', 'sr-only', detectable ? ', detectable change' : ', within normal variation'));
  return node;
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

/** "avg of 3" beside a value that is an equal-weight average (R3). */
export const averageBadge = (used) => {
  const badge = el('span', NEUTRAL_BADGE, `avg of ${used}`);
  badge.dataset.tip = 'The equal-weight average of the platforms that have this measure. Platforms are never pooled';
  return badge;
};

// -------------------------------------------------------------------------------------------------
// Card frame

let cardSeed = 0;

/**
 * A card of the dashboard: title row, optional meta and tools, a body, an optional footnote. Cards read the same
 * scope, so a card says what it covers in its meta line.
 */
export function cardFrame({ key, title, meta, tools = [], body, footnote, flush = false }) {
  cardSeed += 1;
  const id = `aiov-card-${cardSeed}`;
  // `relative` keeps the screen-reader-only text of a wide table inside the card, so it cannot widen the page
  const section = el('section', 'relative min-w-0 @container bg-surface border border-border rounded-lg overflow-hidden flex flex-col');
  section.dataset.card = key;
  section.setAttribute('aria-labelledby', id);
  const head = el('div', 'min-h-12 px-4 py-3 flex flex-wrap items-baseline gap-x-2 gap-y-1');
  const heading = el('h2', 'type-section-title', title);
  heading.id = id;
  head.append(heading);
  if (meta) head.append(el('span', 'type-meta', meta));
  if (tools.length > 0) {
    const holder = el('span', 'ml-auto flex items-center gap-2');
    holder.append(...tools);
    head.append(holder);
  }
  section.append(head);
  const content = el('div', flush ? 'flex-1 min-h-0' : 'flex-1 min-h-0 px-4 pb-4');
  content.append(...(Array.isArray(body) ? body : [body]));
  section.append(content);
  if (footnote) section.append(el('p', 'px-4 py-3 border-t border-border-subtle type-meta', footnote));
  return section;
}

/** A card that cannot be drawn for this scope: says why, and what to do. */
export function emptyBody(title, text) {
  const box = el('div', 'min-h-24 py-6 flex flex-col items-center justify-center gap-1 text-center');
  box.append(el('p', 'type-body-strong text-foreground', title), el('p', 'type-meta max-w-prose', text));
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
    name.append(el('span', 'truncate', row.label));
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
