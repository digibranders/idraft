/* global document, window */
/**
 * Small pieces the Prompts page and the prompt inspector both render with.
 */
import { formatInteger, formatInterval, formatPercent, formatPointsDelta } from './vendor/format/number.js';
import { wilsonInterval } from './vendor/stats/index.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const percent0 = (ratio) => formatPercent(ratio, { decimals: 0 });
const plural = (count, noun) => `${formatInteger(count)} ${noun}${count === 1 ? '' : 's'}`;

// What the change is read against: the Compare menu of the Prompts page sets it (the mock has no other data for the year back)
let comparedWith = 'the previous period';
export function setComparedWithYear(year) {
  comparedWith = year ? 'the same period last year' : 'the previous period';
}

const TREND_TONE = { positive: 'text-positive-text', negative: 'text-negative-text', neutral: 'text-foreground-secondary' };

/**
 * The change of a rate as a trend icon, as price tables show it: a green line trending up, a red line trending down, and
 * a grey dash when the change rounds to nothing. Every rate here is better when higher, so up is always green. The
 * hover carries the figures: the change in points and whether it is detectable (a verdict, not a condition of the
 * color), and, when given in `detail`, the rate now (`value`), the sample and the weekly rates (`trend`). `change` is
 * { value, detectable } in ratio points. A difference between two things rather than a change over time (you against a
 * competitor, a group against all groups) passes `say`, the sentence of its hover, which also reads aloud.
 */
function trendIcon(change, { value, sample, trend, say } = {}) {
  const flat = Math.abs(change.value) < 0.0005;
  const tone = flat ? 'neutral' : change.value > 0 ? 'positive' : 'negative';
  const words = flat ? 'No change' : change.value > 0 ? 'Up' : 'Down';
  // "Up 20.8 pts", not "Up +20.8 pts": the word already says the sign
  const points = flat ? '' : ` ${formatPointsDelta(Math.abs(change.value), { decimals: 1 }).replace(/^\+/, '')}`;
  // A small change can round to the same whole percent on both sides: then one decimal tells them apart
  const decimals = value !== undefined && percent0(value - change.value) === percent0(value) ? 1 : 0;
  const range = value === undefined ? '' : `, from ${formatPercent(value - change.value, { decimals })} to ${formatPercent(value, { decimals })}`;
  const verdict = change.detectable ? 'Detectable: its 95% interval excludes zero.' : 'Within normal variation.';
  const weekly = trend?.some((point) => point !== null) ? ` Weekly rates: ${trend.map((point) => (point === null ? 'n/a' : percent0(point))).join(', ')}.` : '';
  const node = el('span', `inline-flex shrink-0 self-center ${TREND_TONE[tone]}`);
  node.append(window.PreviewUI.icon(flat ? 'minus' : change.value > 0 ? 'trending-up' : 'trending-down', 'size-icon-sm'));
  node.dataset.tip = say ?? `${words}${points} against ${comparedWith}${range}. ${verdict}${sample ? ` ${sample}.` : ''}${weekly}`;
  // Shape, color and the tooltip are not enough: the same is said in text for people who get none of them
  node.append(el('span', 'sr-only', say ?? `${words}${points}${change.detectable ? ', detectable change' : ', within normal variation'}`));
  return node;
}

/** A neutral badge (14 section 2) without its display, for badges that are shown only from some width. */
const NEUTRAL_BADGE_LOOK = 'h-badge items-center px-2 rounded-sm border border-neutral-border bg-neutral-subtle text-neutral-text type-micro whitespace-nowrap';
const NEUTRAL_BADGE = `inline-flex ${NEUTRAL_BADGE_LOOK}`;

/**
 * The table checkbox of the app (Checkbox in components/ui): a 16 px box in a 24 px target. The input stays a real
 * checkbox, so its `change` event and `checked` and `indeterminate` properties work as before.
 */
function checkbox(label) {
  const { icon } = window.PreviewUI;
  const wrap = el('label', 'relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center');
  const input = el('input', 'peer size-4 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary focus-visible:focus-ring');
  input.type = 'checkbox';
  input.setAttribute('aria-label', label);
  wrap.append(input, icon('check', 'pointer-events-none absolute hidden size-icon-xs text-primary-foreground peer-checked:block'), icon('minus', 'pointer-events-none absolute hidden size-icon-xs text-primary-foreground peer-indeterminate:block'));
  return { wrap, input };
}

/** InsufficientData (12 section 7.3): hatched, with the observation count where the column is narrow. */
function insufficient(text) {
  return el('span', 'inline-flex h-6 px-1.5 items-center rounded-xs bg-insufficient type-label text-foreground-tertiary whitespace-nowrap', text);
}

function intervalText(counts) {
  const interval = wilsonInterval(counts.k, counts.n);
  return interval ? formatInterval(interval.low, interval.high) : null;
}

/**
 * One related keyword in an inspector table: keyword, rank, and whether the AI Overview cites the site.
 * `linked` marks the keyword a prompt's AI Overview is read from.
 */
function keywordRow({ keyword, rank, overview, cited, linked = false }) {
  const row = el('tr', 'h-row-compact border-t border-border-subtle');
  const status = el('td', 'pr-4 pl-3');
  status.append(el('span', cited ? 'h-badge inline-flex items-center px-2 rounded-sm bg-positive-subtle text-positive-text type-micro whitespace-nowrap' : NEUTRAL_BADGE, overview));
  const name = el('td', 'pl-4 max-w-40');
  const line = el('span', 'flex items-center gap-2 min-w-0');
  line.append(el('span', 'truncate', keyword));
  if (linked) {
    const badge = el('span', `${NEUTRAL_BADGE} shrink-0`, 'Linked');
    badge.dataset.tip = 'The Google AI Overview of this prompt is taken from the rank checks of this keyword';
    line.append(badge);
  }
  name.append(line);
  row.append(name, el('td', 'num', rank), status);
  return row;
}

export { NEUTRAL_BADGE, NEUTRAL_BADGE_LOOK, checkbox, el, insufficient, intervalText, keywordRow, percent0, plural, trendIcon };
