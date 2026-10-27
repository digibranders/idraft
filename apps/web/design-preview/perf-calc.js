/**
 * Page Performance: dates, periods, comparison, number formats and the health rules (page_health_v1 of
 * docs/32-page-performance.md section 6). Pure code with no DOM, so Node can run it.
 *
 * Search Console dates are Pacific Time calendar dates ("YYYY-MM-DD" strings). Google finalizes a day about
 * two to three days later, so the default window ends on the last final day and provisional days are
 * excluded unless the person switches them on (docs/32 section 5.5).
 */

export const TODAY = '2026-10-27';
export const FINAL_THROUGH = '2026-10-24';
export const EARLIEST = '2025-06-27';
export const PROVISIONAL_DAYS = ['2026-10-25', '2026-10-26'];

// -------------------------------------------------------------------------------------------------
// Dates

const DAY_MS = 86_400_000;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
export const dayFromNumber = (number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
export const addDays = (iso, count) => dayFromNumber(dayNumber(iso) + count);
export const daysInclusive = (from, to) => dayNumber(to) - dayNumber(from) + 1;

export function eachDay(from, to) {
  const days = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n += 1) days.push(dayFromNumber(n));
  return days;
}

/** Same calendar date one year earlier; 29 February becomes 28 February. */
export function yearEarlier(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export const monthKey = (iso) => iso.slice(0, 7);
export const monthStart = (ym) => `${ym}-01`;
export function monthEnd(ym) {
  const [year, month] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
}
export function shiftMonth(ym, count) {
  const [year, month] = ym.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "Sep 3", or "Sep 3, 2026" when `withYear`. */
export function formatDay(iso, withYear = false) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTH_SHORT[month - 1]} ${day}${withYear ? `, ${year}` : ''}`;
}
export function monthName(ym) {
  const [year, month] = ym.split('-').map(Number);
  return `${MONTH_LONG[month - 1]} ${year}`;
}
export function weekdayIndex(iso) {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday is 0
}

/** The complete months inside our history, newest first, for the month picker. */
export function availableMonths() {
  const months = [];
  let ym = monthKey(FINAL_THROUGH);
  if (monthEnd(ym) > FINAL_THROUGH) ym = shiftMonth(ym, -1);
  while (monthStart(ym) >= EARLIEST) {
    months.push(ym);
    ym = shiftMonth(ym, -1);
  }
  return months;
}

// -------------------------------------------------------------------------------------------------
// Periods and comparison
//
// A period is a string: "m:2026-09" (one month), "d:28" (the last 28 days) or "r:2026-09-03_2026-09-30".
// A comparison is "prev", "year", "none" or "c:2026-08-01_2026-08-31".

export const DEFAULT_PERIOD = `m:${availableMonths()[0]}`;
export const DEFAULT_COMPARE = 'prev';

function span(from, to, label, extra = {}) {
  return { from, to, days: daysInclusive(from, to), label, ...extra };
}

export function rangeText(range) {
  if (range.kind === 'month') return range.label;
  const crossYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
  return `${formatDay(range.from, crossYear)} to ${formatDay(range.to, true)}`;
}

export function resolvePeriod(period, includeProvisional = false) {
  const end = includeProvisional ? addDays(TODAY, -1) : FINAL_THROUGH;
  if (period.startsWith('m:')) {
    const ym = period.slice(2);
    return span(monthStart(ym), monthEnd(ym) < end ? monthEnd(ym) : end, monthName(ym), { kind: 'month', ym });
  }
  if (period.startsWith('d:')) {
    const count = Number(period.slice(2));
    return span(addDays(end, -(count - 1)), end, `Last ${count} days`, { kind: 'rolling', count });
  }
  const [from, to] = period.slice(2).split('_');
  const clampedTo = to > end ? end : to;
  return span(from, clampedTo, `${formatDay(from)} to ${formatDay(clampedTo, true)}`, { kind: 'custom' });
}

/** Returns the comparison range, `null` for none, with `unavailable` set when it starts before our history. */
export function resolveCompare(compare, current) {
  if (compare === 'none') return null;
  let range;
  if (compare === 'year') {
    const from = yearEarlier(current.from);
    const to = yearEarlier(current.to);
    range = span(from, to, current.kind === 'month' ? monthName(monthKey(from)) : `${formatDay(from, true)} to ${formatDay(to, true)}`, {
      kind: current.kind === 'month' ? 'month' : 'custom',
      ym: current.kind === 'month' ? monthKey(from) : undefined,
    });
  } else if (compare.startsWith('c:')) {
    const [from, to] = compare.slice(2).split('_');
    range = span(from, to, `${formatDay(from)} to ${formatDay(to, true)}`, { kind: 'custom' });
  } else if (current.kind === 'month') {
    const ym = shiftMonth(current.ym, -1);
    range = span(monthStart(ym), monthEnd(ym), monthName(ym), { kind: 'month', ym });
  } else {
    const to = addDays(current.from, -1);
    const from = addDays(to, -(current.days - 1));
    range = span(from, to, `${formatDay(from)} to ${formatDay(to, true)}`, { kind: 'custom' });
  }
  return { ...range, unavailable: range.from < EARLIEST };
}

export function compareName(compare, current) {
  if (compare === 'none') return 'No comparison';
  if (compare === 'year') return 'Same period last year';
  if (compare.startsWith('c:')) return 'Custom range';
  return current.kind === 'month' ? 'Previous month' : 'Previous period';
}

// -------------------------------------------------------------------------------------------------
// Number formats

const integerFormat = new Intl.NumberFormat('en-US');
export const formatInt = (n) => integerFormat.format(Math.round(n));

export function formatCompact(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return formatInt(n);
}

const MINUS = '−';
export const signed = (n, text) => (n > 0 ? `+${text}` : n < 0 ? `${MINUS}${text}` : text);
export const formatPercent1 = (ratio) => `${(ratio * 100).toFixed(1)}%`;
export const formatPosition = (value) => value.toFixed(1);

// -------------------------------------------------------------------------------------------------
// Metrics. `kind` says how a range is reduced to one number; `better` says which direction is good.

export const SOURCES = {
  gsc: 'Google Search Console',
  rank: 'Our rank tracking',
  ai: 'Our AI tracking',
  ga4: 'Google Analytics 4',
};

export const METRICS = {
  clicks: { label: 'Clicks', source: 'gsc', kind: 'sum', better: 'up', minAbs: 25 },
  impressions: { label: 'Impressions', source: 'gsc', kind: 'sum', better: 'up', minAbs: 500 },
  ctr: { label: 'CTR', source: 'gsc', kind: 'ratio', better: 'up' },
  position: { label: 'Average position', source: 'gsc', kind: 'position', better: 'down', minShift: 1.5 },
  share: { label: 'Share of site clicks', source: 'gsc', kind: 'ratio', better: 'up', optional: true },
  rank: { label: 'Tracked keyword rank', source: 'rank', kind: 'position', better: 'down', minShift: 1, optional: true },
  aiCitations: { label: 'AI citations', source: 'ai', kind: 'sum', better: 'up', minAbs: 3, optional: true },
  sessions: { label: 'Sessions', source: 'ga4', kind: 'sum', better: 'up', minAbs: 30, optional: true },
  conversions: { label: 'Conversions', source: 'ga4', kind: 'sum', better: 'up', minAbs: 3, optional: true },
};
export const CORE_METRICS = ['clicks', 'impressions', 'ctr', 'position'];
export const OPTIONAL_METRICS = Object.keys(METRICS).filter((key) => METRICS[key].optional);

export function formatMetric(key, value) {
  if (value === null || Number.isNaN(value)) return 'No data';
  if (key === 'ctr' || key === 'share') return formatPercent1(value);
  if (key === 'position' || key === 'rank') return formatPosition(value);
  return formatCompact(value);
}

/** The accumulator the data layer returns for a range: sums of clicks, impressions and position times impressions. */
export const emptyAcc = () => ({ clicks: 0, impressions: 0, posSum: 0 });
export function addAcc(target, clicks, impressions, posSum) {
  target.clicks += clicks;
  target.impressions += impressions;
  target.posSum += posSum;
  return target;
}
export const ctrOf = (acc) => (acc.impressions > 0 ? acc.clicks / acc.impressions : null);
export const positionOf = (acc) => (acc.impressions > 0 ? acc.posSum / acc.impressions : null);

/**
 * Reduces a slice of a series to one number. Sums add, ratios and averages divide by the weights, and a
 * slice with nothing to divide by has no value (`null`), which a chart draws as a gap.
 */
export function reduceRange(key, num, den, start = 0, end = num.length) {
  let top = 0;
  let bottom = 0;
  for (let i = start; i < end; i += 1) {
    top += num[i];
    if (den) bottom += den[i];
  }
  if (METRICS[key].kind === 'sum') return top;
  return bottom > 0 ? top / bottom : null;
}

// -------------------------------------------------------------------------------------------------
// Change: what a tile or a table cell shows beside a value. Colors only for material changes (S5).

export const LOW_IMPRESSIONS = 20; // position below this many impressions is "Insufficient data"
const ENOUGH_IMPRESSIONS = 100; // CTR and position changes need this many in both periods

/**
 * @param {string} key a METRICS key
 * @param {number|null} cur value in the current range (a sum for "sum" kinds)
 * @param {number|null} prev value in the comparison range
 * @param {{curDays:number, prevDays:number, curImpressions?:number, prevImpressions?:number}} context
 */
export function describeChange(key, cur, prev, context) {
  const metric = METRICS[key];
  const none = { text: 'No data', tone: 'neutral', note: null, material: false, direction: 0, pct: null };
  if (cur === null || prev === null || Number.isNaN(cur) || Number.isNaN(prev)) return none;

  if (metric.kind === 'sum') {
    if (prev === 0 && cur === 0) return { ...none, text: 'No change' };
    if (prev === 0) return { text: 'New', tone: 'positive', note: null, material: true, direction: 1, pct: null };
    const perDayRatio = cur / context.curDays / (prev / context.prevDays);
    const pct = perDayRatio - 1;
    const absoluteAdjusted = cur - (prev * context.curDays) / context.prevDays;
    const material = Math.abs(pct) >= 0.1 && Math.abs(absoluteAdjusted) >= metric.minAbs;
    const good = pct > 0;
    return {
      text: signed(pct, `${Math.abs(pct * 100).toFixed(1)}%`),
      tone: material ? (good ? 'positive' : 'negative') : 'neutral',
      note: material ? null : 'Within normal range',
      material,
      direction: Math.sign(pct),
      pct,
      absolute: absoluteAdjusted,
    };
  }

  if (metric.kind === 'ratio') {
    const points = (cur - prev) * 100;
    const relative = prev > 0 ? (cur - prev) / prev : 0;
    const enough = key !== 'ctr' || ((context.curImpressions ?? 0) >= ENOUGH_IMPRESSIONS && (context.prevImpressions ?? 0) >= ENOUGH_IMPRESSIONS);
    if (!enough) return { text: signed(points, `${Math.abs(points).toFixed(1)} pts`), tone: 'neutral', note: 'Low data', material: false, direction: 0, pct: relative };
    const material = Math.abs(relative) >= 0.15 && Math.abs(points) >= 0.1;
    const flat = Math.abs(points) < 0.05;
    return {
      text: flat ? 'No change' : signed(points, `${Math.abs(points).toFixed(1)} pts`),
      tone: material ? (points > 0 ? 'positive' : 'negative') : 'neutral',
      note: material ? null : 'Within normal range',
      material,
      direction: Math.sign(points),
      pct: relative,
    };
  }

  // Position and rank: a lower number is better, and the words follow the direction of improvement (S4).
  const shift = cur - prev;
  const lowData = key === 'position' && ((context.curImpressions ?? 0) < LOW_IMPRESSIONS || (context.prevImpressions ?? 0) < LOW_IMPRESSIONS);
  if (lowData) return { text: 'Insufficient data', tone: 'neutral', note: 'Low data', material: false, direction: 0, pct: null, shift };
  const enough = key !== 'position' || ((context.curImpressions ?? 0) >= ENOUGH_IMPRESSIONS && (context.prevImpressions ?? 0) >= ENOUGH_IMPRESSIONS);
  const material = enough && Math.abs(shift) >= metric.minShift;
  const word = shift < 0 ? 'improved' : 'slipped';
  return {
    text: Math.abs(shift) < 0.05 ? 'No change' : `${word} ${Math.abs(shift).toFixed(1)}`,
    tone: material ? (shift < 0 ? 'positive' : 'negative') : 'neutral',
    note: material ? null : enough ? 'Within normal range' : 'Low data',
    material,
    direction: shift < 0 ? 1 : shift > 0 ? -1 : 0,
    pct: null,
    shift,
  };
}

// -------------------------------------------------------------------------------------------------
// Health (page_health_v1)

export const HEALTH_VERSION = 'page_health_v1';
export const HEALTH = {
  no_data: { label: 'No data', tone: 'neutral', rank: 6 },
  new: { label: 'New', tone: 'info', rank: 5 },
  lost: { label: 'Lost traffic', tone: 'negative', rank: 0 },
  low_data: { label: 'Low data', tone: 'insufficient', rank: 7 },
  sharp_drop: { label: 'Sharp drop', tone: 'negative', rank: 1 },
  declining: { label: 'Declining', tone: 'warning', rank: 2 },
  growing: { label: 'Growing', tone: 'positive', rank: 4 },
  stable: { label: 'Stable', tone: 'neutral', rank: 3 },
};

/** Verdict rules in the order of docs/32 section 6.1. `cur` and `prev` are accumulators. */
export function healthOf(cur, prev, curDays, prevDays) {
  if (!prev) return { verdict: cur.impressions > 0 ? 'stable' : 'no_data', basis: 'clicks', pct: null, absolute: 0 };
  if (cur.impressions === 0 && prev.impressions === 0) return { verdict: 'no_data', basis: 'clicks', pct: null, absolute: 0 };
  if (prev.impressions === 0 && cur.impressions > 0) return { verdict: 'new', basis: 'clicks', pct: null, absolute: cur.clicks };
  if (prev.clicks >= 25 && cur.clicks === 0) return { verdict: 'lost', basis: 'clicks', pct: -1, absolute: -prev.clicks };
  if (cur.clicks + prev.clicks < 30 && cur.impressions + prev.impressions < 300) return { verdict: 'low_data', basis: 'clicks', pct: null, absolute: 0 };

  const basis = cur.clicks + prev.clicks >= 30 ? 'clicks' : 'impressions';
  const minAbs = basis === 'clicks' ? 25 : 500;
  const now = cur[basis];
  const before = prev[basis];
  const pct = before > 0 ? now / curDays / (before / prevDays) - 1 : 0;
  const absolute = now - (before * curDays) / prevDays;
  const material = Math.abs(absolute) >= minAbs;
  let verdict = 'stable';
  let small = false;
  if (material && pct <= -0.4) verdict = 'sharp_drop';
  else if (material && pct <= -0.1) verdict = 'declining';
  else if (material && pct >= 0.1) verdict = 'growing';
  else if (!material && Math.abs(pct) >= 0.1) {
    // A big percentage on a few clicks is noise, and "steady" would be wrong for a fall from 27 to 4
    verdict = 'low_data';
    small = true;
  }
  return { verdict, basis, pct, absolute, small, minAbs };
}

const BASIS_WORD = { clicks: 'Clicks', impressions: 'Impressions' };
const percentWhole = (pct) => `${Math.round(Math.abs(pct) * 100)}%`;

/**
 * The verdict sentence and its flags, from numbers only (docs/32 section 6.3). The real app returns message
 * keys with parameters; the preview shows the English the catalog would produce.
 *
 * @param {object} input
 * @param {{verdict:string, basis:string, pct:number|null, absolute:number}} input.health
 * @param {object} input.cur current accumulator
 * @param {object|null} input.prev comparison accumulator
 * @param {object} input.ranges `{ current, compare }` resolved ranges
 * @param {{name:string, share:number}|null} input.driver the segment that explains most of the change
 * @param {object|null} input.index indexing status of the page
 * @param {boolean} input.provisionalExcluded
 * @param {boolean} input.urlFormChanged
 */
export function buildVerdict({ health, cur, prev, ranges, driver, index, provisionalExcluded, urlFormChanged }) {
  const { verdict, basis, pct } = health;
  const versus = ranges.compare ? rangeText(ranges.compare) : '';
  const perDay = ranges.compare && ranges.current.days !== ranges.compare.days ? ' per day' : '';
  const word = BASIS_WORD[basis];
  const numbers = !prev
    ? ''
    : perDay
      ? `(${formatCompact(prev[basis] / ranges.compare.days)} to ${formatCompact(cur[basis] / ranges.current.days)} a day)`
      : `(${formatCompact(prev[basis])} to ${formatCompact(cur[basis])})`;
  const headline = {
    no_data: 'Google reported no impressions for this page with these filters.',
    new: `New in search: ${formatInt(cur.clicks)} clicks, none in ${versus}.`,
    lost: `Lost all search traffic: no clicks, against ${formatInt(prev?.clicks ?? 0)} in ${versus}.`,
    low_data: health.small
      ? `Small numbers: ${word.toLowerCase()}${perDay} went from ${formatCompact(prev[basis] / (perDay ? ranges.compare.days : 1))} to ${formatCompact(cur[basis] / (perDay ? ranges.current.days : 1))}${perDay ? ' a day' : ''}. That is under ${health.minAbs} ${basis} of difference, so it is not treated as a real change.`
      : `Too little traffic to judge: ${formatInt((prev?.clicks ?? 0) + cur.clicks)} clicks and ${formatInt((prev?.impressions ?? 0) + cur.impressions)} impressions over both periods.`,
    sharp_drop: `${word}${perDay} are down ${percentWhole(pct ?? 0)} ${numbers} against ${versus}.`,
    declining: `${word}${perDay} are down ${percentWhole(pct ?? 0)} ${numbers} against ${versus}.`,
    growing: `${word}${perDay} are up ${percentWhole(pct ?? 0)} ${numbers} against ${versus}.`,
    stable: prev ? `${word}${perDay} are steady ${numbers} against ${versus}.` : `${formatInt(cur.clicks)} clicks and ${formatInt(cur.impressions)} impressions in ${rangeText(ranges.current)}.`,
  }[verdict];

  const flags = [];
  if (index?.changedOn && index.changedOn >= ranges.current.from && index.state !== 'indexed') {
    flags.push({ code: 'index_status_changed', text: `Google dropped this page from its index on ${formatDay(index.changedOn)}: ${index.detail.toLowerCase()}.` });
  }
  if (driver && ['sharp_drop', 'declining', 'growing', 'lost'].includes(verdict)) {
    flags.push({ code: 'segment_drives_change', text: `${driver.name} explains most of it (${Math.round(driver.share * 100)}% of the change).` });
  }
  if (prev && cur.impressions > 0 && prev.impressions > 0) {
    const ctrRel = cur.clicks / cur.impressions / (prev.clicks / prev.impressions || 1) - 1;
    const imprPerDay = cur.impressions / ranges.current.days / (prev.impressions / ranges.compare.days) - 1;
    if (prev.clicks > 0 && ctrRel <= -0.15 && imprPerDay >= 0.1) {
      flags.push({ code: 'ctr_fell_impressions_rose', text: 'Impressions rose but fewer people clicked. Check the title and snippet, and whether an AI answer now sits above the result.' });
    }
    const shift = cur.posSum / cur.impressions - prev.posSum / prev.impressions;
    if (cur.impressions >= 100 && prev.impressions >= 100 && Math.abs(shift) >= 1.5) {
      flags.push({ code: shift > 0 ? 'position_slipped' : 'position_improved', text: `Average position ${shift > 0 ? 'slipped' : 'improved'} ${Math.abs(shift).toFixed(1)} places.` });
    }
  }
  if (urlFormChanged) flags.push({ code: 'url_form_changed', text: 'Google now reports this page under a different URL form.' });
  if (provisionalExcluded) flags.push({ code: 'provisional_excluded', text: `${PROVISIONAL_DAYS.length} days are still provisional and left out.` });
  return { verdict, headline, flags, basis };
}

/** Attention order for the list: worst first (docs/32 section 5.2). */
export function attentionKey(health) {
  const rank = HEALTH[health.verdict].rank;
  return rank * 1e9 + (health.absolute ?? 0) + 5e8;
}
