/* global document */
/**
 * Small pieces the Prompts page and the prompt inspector both render with.
 */
import { formatInteger, formatInterval, formatPercent } from './vendor/format/number.js';
import { wilsonInterval } from './vendor/stats/index.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const percent0 = (ratio) => formatPercent(ratio, { decimals: 0 });
const plural = (count, noun) => `${formatInteger(count)} ${noun}${count === 1 ? '' : 's'}`;

/** A neutral badge (14 section 2) without its display, for badges that are shown only from some width. */
const NEUTRAL_BADGE_LOOK = 'h-badge items-center px-2 rounded-sm border border-neutral-border bg-neutral-subtle text-neutral-text type-micro whitespace-nowrap';
const NEUTRAL_BADGE = `inline-flex ${NEUTRAL_BADGE_LOOK}`;

/** InsufficientData (12 section 7.3): hatched, with the observation count where the column is narrow. */
function insufficient(text) {
  return el('span', 'inline-flex h-6 px-1.5 items-center rounded-xs bg-insufficient type-label text-foreground-tertiary whitespace-nowrap', text);
}

function intervalText(counts) {
  const interval = wilsonInterval(counts.k, counts.n);
  return interval ? formatInterval(interval.low, interval.high) : null;
}

/** One related keyword in an inspector table: keyword, rank, and whether the AI Overview cites the site. */
function keywordRow([keyword, rank, overview, cited]) {
  const row = el('tr', 'h-row-compact border-t border-border-subtle');
  const status = el('td', 'pr-4 pl-3');
  status.append(el('span', cited ? 'h-badge inline-flex items-center px-2 rounded-sm bg-positive-subtle text-positive-text type-micro whitespace-nowrap' : NEUTRAL_BADGE, overview));
  row.append(el('td', 'pl-4 truncate max-w-40', keyword), el('td', 'text-right num', rank), status);
  return row;
}

export { NEUTRAL_BADGE, NEUTRAL_BADGE_LOOK, el, insufficient, intervalText, keywordRow, percent0, plural };
