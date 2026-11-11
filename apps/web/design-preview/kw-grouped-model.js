/* global document, URL, Blob, setTimeout */
/**
 * What the grouped Rankings mock shares between its parts: the page state, the columns of the table (as the real
 * Rankings table has them, with their widths), the numbers of a set of keywords for the devices chosen, the filters,
 * and the two export formats.
 */
import { UNGROUPED, groupNames, store, usedCountries } from './kw-grouped-data.js';

export const GROUP_LABELS = { order: 'Order of the groups' };
export const ALL_COUNTRIES = 'All countries';

/** The countries a new keyword is added to by default: the one the page shows, or the first of those in use. */
export const addScope = () => (state.country === ALL_COUNTRIES ? usedCountries().slice(0, 1) : [state.country]);

// -------------------------------------------------------------------------------------------------
// Columns. Widths are pixels (lib/tables/column-types.ts and keyword-columns.tsx); `on` is the column's state in the
// default view, `grouped` is where it exists: both views, only in the grouped one, or only in the flat one.

/** What the Clicks column says it is, in its header. */
export const CLICKS_TIP = 'Clicks from Google Search Console in the last 28 days, for this keyword in this country and on the devices chosen. Not an estimate.';

// The mock has no Search Console behind it: the clicks of a keyword are made up from its volume and rank. In the app
// they are read from Search Console (docs/18 section 4.9), and no estimate is shown.
const CLICK_RATE = [0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const clickRate = (rank) => (rank <= 10 ? CLICK_RATE[rank - 1] : rank <= 20 ? 0.01 : 0.002);
const DEVICE_SHARE = { desktop: 0.35, mobile: 0.65 };

/** What the Impressions column says it is, in its header. */
export const IMPRESSIONS_TIP = 'Impressions from Google Search Console in the last 28 days: how often this keyword showed a page of the site in results, in this country and on the devices chosen. Not an estimate.';

/** Illustrative impressions in 28 days: a keyword is seen even when it ranks far down, and more the higher it ranks. */
export function impressions(keyword) {
  const seen = (rank) => (rank <= 10 ? 0.9 : rank <= 30 ? 0.6 : 0.35);
  return Math.round(sum(devicesIn().map((device) => (isRank(keyword.ranks[device]) ? keyword.volume * DEVICE_SHARE[device] * seen(keyword.ranks[device]) : keyword.ranks[device] === 'b' ? keyword.volume * DEVICE_SHARE[device] * 0.08 : 0))));
}

/** Illustrative clicks in 28 days from a keyword on the devices chosen. */
export function clicks(keyword) {
  return Math.round(sum(devicesIn().map((device) => (isRank(keyword.ranks[device]) ? keyword.volume * DEVICE_SHARE[device] * clickRate(keyword.ranks[device]) : 0))));
}

export const COLUMNS = [
  { id: 'country', label: 'Country', width: 120, on: true },
  { id: 'rank', label: 'Rank', width: 128, on: true, sort: 'rank' },
  { id: 'url', label: 'Ranking URL', width: 180, on: false },
  { id: 'volume', label: 'Volume', width: 96, on: true, sort: 'volume' },
  { id: 'clicks', label: 'Clicks', width: 112, on: true, sort: 'clicks', tip: CLICKS_TIP },
  { id: 'impressions', label: 'Impressions', width: 120, on: true, sort: 'impressions', tip: IMPRESSIONS_TIP },
  { id: 'kd', label: 'KD', width: 72, on: true, sort: 'kd', not: 'groups' },
  { id: 'intent', label: 'Intent', width: 112, on: true, not: 'groups' },
  { id: 'features', label: 'SERP features', width: 128, on: true, not: 'groups' },
  { id: 'aio', label: 'AI Overview', width: 112, on: true },
  { id: 'cpc', label: 'CPC (USD)', width: 112, on: true, sort: 'cpc' },
  { id: 'trend', label: 'Trend', width: 96, on: true, not: 'groups' },
  { id: 'priority', label: 'Priority', width: 100, on: false, sort: 'priority' },
  { id: 'group', label: 'Group', width: 160, on: true, only: 'flat' },
  { id: 'tags', label: 'Tags', width: 104, on: true, not: 'groups' },
  { id: 'best', label: 'Best rank', width: 112, on: false, sort: 'best' },
  { id: 'updated', label: 'Updated', width: 144, on: true, sort: 'updated' },
  { id: 'added', label: 'Added', width: 112, on: true },
];

export const state = {
  mode: 'groups',
  device: 'desktop',
  country: 'India',
  search: '',
  filters: [],
  sort: { key: 'order', dir: 'asc' },
  expanded: new Set([store.groups[0].name]),
  showAll: new Set(),
  selected: new Set(),
  archived: false,
  columns: new Set(COLUMNS.filter((column) => column.on).map((column) => column.id)),
  open: null,
};

let renderer = () => {};
export const setRenderer = (fn) => {
  renderer = fn;
};
export const refresh = () => renderer();

/** The columns the page shows: the ones chosen for the view, and a device's rank only when that device is. */
export const columnsFor = (items = []) =>
  COLUMNS.filter(
    (column) =>
      state.columns.has(column.id) &&
      (column.id !== 'country' || new Set(items.map((keyword) => keyword.country)).size > 1) &&
      (column.only === undefined || column.only === state.mode) &&
      column.not !== state.mode,
  );

// -------------------------------------------------------------------------------------------------
// Ranks

/** The page shows one device at a time: its rank, clicks, impressions, SERP features and AI Overview are its own. */
export const devicesIn = () => [state.device];
export const isRank = (rank) => typeof rank === 'number';
export const isTracked = (rank) => rank !== 'n';
export const rankText = (rank) => (isRank(rank) ? String(rank) : { b: '>100', p: 'Pending', n: 'Not tracked' }[rank]);
export const sum = (list) => list.reduce((total, value) => total + value, 0);
export const plural = (count, noun) => `${count.toLocaleString('en-US')} ${count === 1 ? noun : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
export const volumeText = (value) => (value === 0 ? 'No data' : value.toLocaleString('en-US'));

/** Places gained since the previous check; positive is better. A rank that was beyond the depth counts as a gain. */
export function gained(keyword, device) {
  const before = keyword.before[device];
  const now = keyword.ranks[device];
  if (isRank(before) && isRank(now)) return before - now;
  if (!isRank(before) && isRank(now) && before === 'b') return 100 - now;
  if (isRank(before) && !isRank(now) && now === 'b') return -(100 - before);
  return 0;
}

export const best = (keyword, devices = devicesIn()) =>
  Math.min(...devices.map((device) => (isRank(keyword.ranks[device]) ? keyword.ranks[device] : Infinity)));

const hash = (text) => [...text].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);

/** What a keyword shows that the preview does not store: derived from its text, so it is the same on every visit. */
export function derived(keyword) {
  // Desktop and mobile see different results, so what a keyword shows is its own for each device
  const device = state.device;
  const seed = hash(`${keyword.keyword}|${device}`);
  const pending = !isTracked(keyword.ranks[device]) || keyword.ranks[device] === 'p';
  const pool = ['sparkles', 'circle-help', 'map-pin', 'search', 'image', 'link'];
  const count = 2 + (seed % 3);
  const features = pending ? [] : pool.filter((_, index) => (seed >> index) % 2 === 0 || index === 0).slice(0, count);
  const ranked = best(keyword, [device]);
  let aio = { kind: 'none' };
  if (pending) aio = { kind: 'pending' };
  else if (features.includes('sparkles')) aio = ranked <= 3 ? { kind: 'cited', position: 1 + (seed % 3) } : { kind: 'present' };
  const day = 4 - (seed % 3);
  const updated = pending ? 'Pending' : `Nov ${day}, ${String(2 + (seed % 6)).padStart(2, '0')}:${String(seed % 60).padStart(2, '0')}`;
  const added = keyword.id.startsWith('new') ? 'Nov 4, 14:10' : 'Oct 31, 20:48';
  const slug = keyword.keyword.replace(/[^a-z0-9]+/g, '-');
  const url = pending || ranked === Infinity ? null : `https://eventussecurity.com/${slug}`;
  return { features, aio, updated, added, url, seed };
}

/** The numbers of a set of keywords for the devices chosen: a keyword tracked on two devices counts twice. */
export function measures(items) {
  const devices = devicesIn();
  const ranks = items.flatMap((keyword) => devices.map((device) => keyword.ranks[device])).filter(isTracked);
  const within = (limit) => ranks.filter((rank) => isRank(rank) && rank <= limit).length;
  const average = (device) => {
    const found = items.map((keyword) => keyword.ranks[device]).filter(isRank);
    return { value: found.length === 0 ? null : sum(found) / found.length, ranked: found.length, top10: found.filter((rank) => rank <= 10).length };
  };
  const volume = sum(items.map((keyword) => keyword.volume));
  const kds = items.map((keyword) => keyword.kd).filter((kd) => kd !== null);
  const cpcs = items.map((keyword) => keyword.cpc).filter((cpc) => cpc > 0);
  const moves = items.flatMap((keyword) => devices.map((device) => gained(keyword, device)));
  return {
    count: new Set(items.map((keyword) => keyword.keyword)).size,
    countries: new Set(items.map((keyword) => keyword.country)).size,
    tracked: ranks.length,
    top3: within(3),
    top10: within(10),
    top20: within(20),
    desktop: average('desktop'),
    mobile: average('mobile'),
    volume,
    clicks: sum(items.map(clicks)),
    impressions: sum(items.map(impressions)),
    reach: volume === 0 ? 0 : sum(items.filter((keyword) => best(keyword) <= 10).map((keyword) => keyword.volume)) / volume,
    kd: kds.length === 0 ? null : Math.round(sum(kds) / kds.length),
    cpc: cpcs.length === 0 ? null : sum(cpcs) / cpcs.length,
    up: moves.filter((move) => move > 0).length,
    down: moves.filter((move) => move < 0).length,
    cited: items.filter((keyword) => derived(keyword).aio.kind === 'cited').length,
    // The months of the group's search volume: the sum of its keywords' months
    trend: Array.from({ length: MONTHS }, (_, month) => sum(items.map((keyword) => monthly(keyword)[month]))),
  };
}

const MONTHS = 12;

/**
 * The last twelve months of a keyword's search volume, oldest first, averaging its volume: a gentle slope up or
 * down and, for about a quarter of the keywords, a season. Derived from the text, so it is the same on every visit.
 */
export function monthly(keyword) {
  const seed = hash(keyword.keyword) / 4294967295;
  const slope = (seed - 0.5) * 0.04;
  const swing = seed > 0.75 ? 0.6 : 0.12;
  const peak = Math.floor(seed * 1000) % MONTHS;
  return Array.from({ length: MONTHS }, (_, month) => {
    const season = 1 + swing * Math.cos(((month - peak) / MONTHS) * 2 * Math.PI);
    return Math.max(0, Math.round(keyword.volume * season * (1 + slope * (month - (MONTHS - 1) / 2))));
  });
}

// -------------------------------------------------------------------------------------------------
// Which keywords the page shows

export const FILTER_FIELDS = {
  country: { label: 'Country', multiple: true, values: () => usedCountries().map((name) => [name, name]) },
  group: { label: 'Group', values: () => [...groupNames(), UNGROUPED].map((name) => [name, name]) },
  intent: { label: 'Intent', values: () => [['commercial', 'Commercial'], ['navigational', 'Navigational'], ['informational', 'Informational'], ['unknown', 'Unknown']] },
  rank: { label: 'Rank', values: () => [['top3', 'Top 3'], ['top10', 'Top 10'], ['top20', 'Top 20'], ['top100', 'Top 100'], ['beyond', 'Over 100']] },
  volume: { label: 'Volume', values: () => [['100', '100 or more'], ['1000', '1,000 or more']] },
  kd: { label: 'KD', values: () => [['30', '30 or less'], ['50', '50 or less']] },
  moved: { label: 'Moved', values: () => [['up', 'Improved'], ['down', 'Declined']] },
};

function matchesFilter({ field, value }, keyword) {
  const devices = devicesIn();
  // Countries are one choice among several: the keyword's country is in the chosen ones (see `shown`)
  if (field === 'country') return true;
  if (field === 'group') return (keyword.group ?? UNGROUPED) === value;
  if (field === 'intent') return keyword.intent === value;
  if (field === 'volume') return keyword.volume >= Number(value);
  if (field === 'kd') return keyword.kd !== null && keyword.kd <= Number(value);
  if (field === 'moved') return devices.some((device) => (value === 'up' ? gained(keyword, device) > 0 : gained(keyword, device) < 0));
  const top = best(keyword);
  if (value === 'beyond') return devices.some((device) => keyword.ranks[device] === 'b') && top === Infinity;
  return top <= { top3: 3, top10: 10, top20: 20, top100: 100 }[value];
}

/** The keywords of the country, archived or active, that the search and the chips keep. */
export function shown() {
  const text = state.search.trim().toLowerCase();
  const countries = state.filters.filter((filter) => filter.field === 'country').map((filter) => filter.value);
  return store.keywords.filter(
    (keyword) =>
      keyword.archived === state.archived &&
      isTracked(keyword.ranks[state.device]) &&
      (state.country === ALL_COUNTRIES || keyword.country === state.country) &&
      keyword.keyword.includes(text) &&
      (countries.length === 0 || countries.includes(keyword.country)) &&
      state.filters.every((filter) => matchesFilter(filter, keyword)),
  );
}

export const groupOf = (keyword) => keyword.group ?? UNGROUPED;

// -------------------------------------------------------------------------------------------------
// Export: the numbers of the strip, then the table

export function tableRows(items) {
  const devices = devicesIn();
  const header = ['Keyword', 'Country', `Rank (${state.device})`, 'Ranking URL', 'Volume', 'Clicks (28 days)', 'Impressions (28 days)', 'KD', 'CPC (USD)', 'Intent', 'Group', 'Updated'];
  const body = items.map((keyword) => [
    keyword.keyword,
    keyword.country,
    ...devices.map((device) => (isRank(keyword.ranks[device]) ? keyword.ranks[device] : rankText(keyword.ranks[device]))),
    derived(keyword).url ?? '',
    keyword.volume,
    clicks(keyword),
    impressions(keyword),
    keyword.kd ?? '',
    keyword.cpc || '',
    keyword.intent,
    groupOf(keyword),
    derived(keyword).updated,
  ]);
  return [header, ...body];
}

export function kpiRows(items) {
  const m = measures(items);
  return [['Country', state.country], ['Device', state.device === 'desktop' ? 'Desktop' : 'Mobile'], ['Keywords', m.tracked], ['Top 3', m.top3], ['Top 10', m.top10], ['Top 20', m.top20]];
}

const escapeXml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An Excel workbook in the XML Spreadsheet 2003 format, which Excel opens: the counts above the table, one sheet. */
export function workbookXml(items) {
  const cell = (value) => (typeof value === 'number' ? `<Cell><Data ss:Type="Number">${value}</Data></Cell>` : `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`);
  const row = (values) => `<Row>${values.map(cell).join('')}</Row>`;
  const rows = [...kpiRows(items).map(row), '<Row/>', ...tableRows(items).map(row)];
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Keywords"><Table>${rows.join('')}</Table></Worksheet></Workbook>`;
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function csvText(rows) {
  const field = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value));
  return `${String.fromCharCode(0xfeff)}${rows.map((row) => row.map(field).join(',')).join('\r\n')}\r\n`;
}

/**
 * A line of a series on a scale of its own lowest and highest point. By default up is better (a smaller rank is
 * higher); with `higherIsUp` a larger value is higher, as for a search volume.
 */
export function sparkline(points, label, className = 'w-18 h-5.5 text-primary', higherIsUp = false) {
  const width = 72;
  const height = 22;
  const high = Math.max(...points);
  const low = Math.min(...points);
  const span = high - low || 1;
  // A series that never moves sits in the middle
  const share = (point) => (high === low ? 0.5 : (higherIsUp ? high - point : point - low) / span);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${((index / (points.length - 1)) * width).toFixed(1)} ${(share(point) * (height - 4) + 2).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', className);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return svg;
}
