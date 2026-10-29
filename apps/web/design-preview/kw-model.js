/* global URLSearchParams */
/**
 * The Rankings state (kept in the query string, so a link reproduces a view) and the pure functions every
 * screen derives from it: filtering, sorting, what a rank and a change read as, and the number formats.
 * No DOM here.
 */
import { DAY, DEPTHS, DEVICES, INTENTS, LANGUAGES, LOCATIONS, PAGE_SIZE, SOURCES, STAGES, allTags, groupList, labelOf } from './kw-data.js';

/** Rank carries the change since the previous check; the ranking URL is the arrow beside the keyword, and its column is opt-in. */
export const DEFAULT_COLUMNS = ['rank', 'volume', 'kd', 'cpc', 'intent', 'group', 'tags', 'updated', 'added'];
/** Columns the chooser offers (the keyword column is always shown and pinned). */
export const COLUMNS = [
  ['rank', 'Rank', 'rank'],
  ['url', 'Ranking URL', null],
  ['volume', 'Volume', 'volume'],
  ['kd', 'KD', 'kd'],
  ['cpc', 'CPC (USD)', 'cpc'],
  ['intent', 'Intent', null],
  ['priority', 'Priority', 'priority'],
  ['group', 'Group', null],
  ['tags', 'Tags', null],
  ['best', 'Best rank', 'best'],
  ['updated', 'Updated', 'updated'],
  ['added', 'Added', 'added'],
];
const SORT_DEFAULT_ASC = new Set(['rank', 'priority', 'best']);
const SORT_KEYS = new Set(COLUMNS.map(([, , key]) => key).filter(Boolean));
export const DEFAULT_SORT = '-volume';

export const RANK_OPTIONS = [
  ['top3', 'Top 3'],
  ['4-10', '4 to 10'],
  ['11-20', '11 to 20'],
  ['21-50', '21 to 50'],
  ['51-100', '51 to 100'],
  ['beyond', 'Over 100'],
];
export const CHANGE_OPTIONS = [
  ['improved', 'Improved'],
  ['declined', 'Declined'],
  ['entered', 'Entered'],
  ['lost', 'Lost'],
];
const RANK_BOUNDS = { top3: [1, 3], '4-10': [4, 10], '11-20': [11, 20], '21-50': [21, 50], '51-100': [51, 100] };

/**
 * Every filter key of the URL, with its kind: `single` (one choice), `multi` (several), or `min` / `max` (a number).
 */
export const FILTERS = {
  grp: { label: 'Group', kind: 'single' },
  tag: { label: 'Tag', kind: 'multi' },
  rank: { label: 'Rank', kind: 'single' },
  chg: { label: 'Change', kind: 'single' },
  dev: { label: 'Device', kind: 'single' },
  loc: { label: 'Location', kind: 'single' },
  lang: { label: 'Language', kind: 'single' },
  intent: { label: 'Intent', kind: 'multi' },
  stage: { label: 'Funnel', kind: 'multi' },
  prio: { label: 'Priority', kind: 'max' },
  src: { label: 'Source', kind: 'multi' },
  depth: { label: 'Depth', kind: 'multi' },
  vol: { label: 'Volume', kind: 'min' },
  kd: { label: 'Difficulty', kind: 'max' },
  stale: { label: 'Freshness', kind: 'single' },
};
const EMPTY_FILTERS = { grp: '', tag: [], rank: '', chg: '', dev: '', loc: '', lang: '', intent: [], stage: [], prio: '', src: [], depth: [], vol: '', kd: '', stale: '' };

export const DEFAULT_STATE = { q: '', sort: DEFAULT_SORT, cols: DEFAULT_COLUMNS, density: 'compact', archived: false, inspect: null, page: 1, filters: EMPTY_FILTERS };

const multiOptions = {
  intent: INTENTS.map(([code]) => code),
  stage: STAGES.map(([code]) => code),
  src: SOURCES.map(([code]) => code),
  depth: DEPTHS.map(([code]) => code),
};
const singleOptions = {
  rank: RANK_OPTIONS.map(([code]) => code),
  chg: CHANGE_OPTIONS.map(([code]) => code),
  dev: DEVICES.map(([code]) => code),
  lang: LANGUAGES.map(([code]) => code),
  stale: ['stale'],
};
const within = (raw, min, max) => /^\d+$/.test(raw) && Number(raw) >= min && Number(raw) <= max;

/**
 * Reads the query string. A value that does not read is dropped, and its key is listed in `dropped`, so the page
 * can say which filter a link left out.
 */
export function readState(search) {
  const params = new URLSearchParams(search);
  const dropped = [];
  const filters = { ...EMPTY_FILTERS };
  const groups = groupList();
  const tags = allTags();
  const list = (key) => (params.get(key) ?? '').split(',').filter(Boolean);

  for (const [key, def] of Object.entries(FILTERS)) {
    const raw = params.get(key);
    if (raw === null || raw === '') continue;
    if (key === 'grp') {
      if (groups.includes(raw)) filters.grp = raw;
      else dropped.push(key);
    } else if (key === 'tag' || multiOptions[key]) {
      const valid = key === 'tag' ? list('tag').filter((value) => tags.includes(value)) : list(key).filter((value) => multiOptions[key].includes(value));
      filters[key] = [...new Set(valid)];
      if (valid.length !== list(key).length) dropped.push(key);
    } else if (def.kind === 'single') {
      const values = key === 'loc' ? [] : list(key);
      const first = key === 'loc' ? (LOCATIONS.some(([code]) => String(code) === raw) ? raw : '') : values.find((value) => singleOptions[key].includes(value)) ?? '';
      filters[key] = first;
      if (key === 'loc') {
        if (!first) dropped.push(key);
      } else if (!first || values.length > 1) dropped.push(key);
    } else if (key === 'prio') {
      if (within(raw, 1, 5)) filters.prio = raw;
      else dropped.push(key);
    } else if (key === 'vol') {
      if (within(raw, 0, 10000000)) filters.vol = raw;
      else dropped.push(key);
    } else if (key === 'kd') {
      if (within(raw, 0, 100)) filters.kd = raw;
      else dropped.push(key);
    }
  }

  const sort = params.get('sort') ?? DEFAULT_SORT;
  const sortKey = sort.replace(/^-/, '');
  const requestedCols = list('cols');
  const cols = params.get('cols') === null ? DEFAULT_COLUMNS : requestedCols.filter((key) => COLUMNS.some(([id]) => id === key));
  if (params.get('cols') !== null && cols.length !== requestedCols.length) dropped.push('cols');
  const page = Number(params.get('page') ?? 1);
  const inspect = /^keyword:\d+$/.test(params.get('inspect') ?? '') ? Number(params.get('inspect').slice(8)) : null;
  if ((params.get('inspect') ?? '') !== '' && inspect === null) dropped.push('inspect');
  return {
    dropped,
    state: {
      q: (params.get('q') ?? '').slice(0, 200),
      sort: SORT_KEYS.has(sortKey) ? sort : DEFAULT_SORT,
      cols: cols.length > 0 ? cols : DEFAULT_COLUMNS,
      density: params.get('density') === 'default' ? 'default' : 'compact',
      archived: params.get('archived') === 'true',
      inspect,
      page: Number.isInteger(page) && page >= 1 ? page : 1,
      filters,
    },
  };
}

/** The query string for a state. Values that equal their default are left out. */
export function writeState(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.cols.join(',') !== DEFAULT_COLUMNS.join(',')) params.set('cols', state.cols.join(','));
  if (state.density === 'default') params.set('density', 'default');
  if (state.archived) params.set('archived', 'true');
  if (state.inspect) params.set('inspect', `keyword:${state.inspect}`);
  if (state.page > 1) params.set('page', String(state.page));
  for (const [key, value] of Object.entries(state.filters)) {
    if (Array.isArray(value) ? value.length > 0 : value !== '') params.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The text of a filter's value, for its chip and its editor. */
export function valueLabel(key, value) {
  if (key === 'grp') return value;
  if (key === 'loc') return labelOf(LOCATIONS.map(([code, name]) => [String(code), name]), value);
  if (key === 'rank') return labelOf(RANK_OPTIONS, value);
  if (key === 'chg') return labelOf(CHANGE_OPTIONS, value);
  if (key === 'dev') return labelOf(DEVICES, value);
  if (key === 'lang') return labelOf(LANGUAGES, value);
  if (key === 'intent') return labelOf(INTENTS, value);
  if (key === 'stage') return labelOf(STAGES, value);
  if (key === 'src') return labelOf(SOURCES, value);
  if (key === 'depth') return labelOf(DEPTHS, value);
  if (key === 'stale') return 'Stale';
  if (key === 'prio') return `${value} or higher`;
  if (key === 'vol') return `${Number(value).toLocaleString('en-US')} or more`;
  if (key === 'kd') return `${value} or less`;
  return value;
}

export function activeFilterChips(state) {
  const chips = [];
  for (const [key, def] of Object.entries(FILTERS)) {
    const value = state.filters[key];
    if (Array.isArray(value)) {
      if (value.length > 0) chips.push({ key, text: `${def.label}: ${value.length <= 2 ? value.map((item) => valueLabel(key, item)).join(', ') : `${value.length} selected`}` });
    } else if (value !== '') {
      const text = key === 'stale' ? 'Freshness: Stale' : `${def.label}: ${valueLabel(key, value)}`;
      chips.push({ key, text });
    }
  }
  return chips;
}

// -------------------------------------------------------------------------------------------------
// What a row says

/** Rank now: a number when ranked, or the state of the last check. */
export function rankOf(kw) {
  if (typeof kw.cur === 'number') return { kind: 'ranked', value: kw.cur };
  if (kw.cur === 'b') return { kind: 'beyond' };
  if (kw.cur === 'f') return { kind: 'failed' };
  return { kind: 'pending' };
}

/** Change against the previous check: a number of places, or a categorical label where one side is beyond the depth. */
export function changeOf(kw) {
  const now = kw.cur;
  if (typeof now === 'number' && typeof kw.prev === 'number') return { kind: 'delta', value: kw.prev - now };
  if (typeof now === 'number' && kw.prev === 'b') return { kind: 'entered' };
  if (now === 'b' && typeof kw.prev === 'number') return { kind: 'lost' };
  return null;
}

export const isStale = (kw) => kw.metricsAt === null || Date.now() - kw.metricsAt > 25 * DAY;

function matches(kw, state) {
  const f = state.filters;
  if (state.archived !== kw.archived) return false;
  if (state.q && !kw.keyword.toLowerCase().includes(state.q.toLowerCase())) return false;
  if (f.grp && !(kw.group !== null && (kw.group === f.grp || kw.group.startsWith(`${f.grp} / `)))) return false;
  if (f.tag.length > 0 && !f.tag.some((tag) => kw.tags.includes(tag))) return false;
  if (f.rank) {
    const rank = rankOf(kw);
    if (f.rank === 'beyond' ? rank.kind !== 'beyond' : rank.kind !== 'ranked' || rank.value < RANK_BOUNDS[f.rank][0] || rank.value > RANK_BOUNDS[f.rank][1]) return false;
  }
  if (f.chg) {
    const change = changeOf(kw);
    const ok = { improved: change?.kind === 'delta' && change.value > 0, declined: change?.kind === 'delta' && change.value < 0, entered: change?.kind === 'entered', lost: change?.kind === 'lost' }[f.chg];
    if (!ok) return false;
  }
  if (f.dev && kw.device !== f.dev) return false;
  if (f.loc && String(kw.location) !== f.loc) return false;
  if (f.lang && kw.language !== f.lang) return false;
  if (f.intent.length > 0 && !f.intent.includes(kw.intent)) return false;
  if (f.stage.length > 0 && !f.stage.includes(kw.stage)) return false;
  if (f.src.length > 0 && !f.src.includes(kw.source)) return false;
  if (f.depth.length > 0 && !f.depth.includes(kw.depth)) return false;
  if (f.prio && kw.priority > Number(f.prio)) return false;
  if (f.vol && (kw.volume === null || kw.volume < Number(f.vol))) return false;
  if (f.kd && (kw.kd === null || kw.kd > Number(f.kd))) return false;
  if (f.stale === 'stale' && !isStale(kw)) return false;
  return true;
}

/** The rows the table shows, before paging, in the current sort. */
export function visibleRows(records, state) {
  const rows = records.filter((kw) => matches(kw, state));
  const descending = state.sort.startsWith('-');
  const key = state.sort.replace(/^-/, '');
  return rows.sort((a, b) => compareBy(a, b, key, descending));
}

/** Missing values sort last in both directions; ties fall back to the keyword id. */
function compareBy(a, b, key, descending) {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  if (x === null && y === null) return a.id - b.id;
  if (x === null) return 1;
  if (y === null) return -1;
  const order = x === y ? a.id - b.id : x < y ? -1 : 1;
  return descending ? -order : order;
}

function sortValue(kw, key) {
  if (key === 'rank') {
    const rank = rankOf(kw);
    if (rank.kind === 'ranked') return rank.value;
    return rank.kind === 'beyond' ? 1000 : null;
  }
  if (key === 'updated') return kw.metricsAt;
  if (key === 'added') return kw.added;
  return kw[{ volume: 'volume', kd: 'kd', cpc: 'cpc', priority: 'priority', best: 'best' }[key]] ?? null;
}

/** The sort a header click gives: the same column flips, a new one starts in its natural direction. */
export function nextSort(current, key) {
  const bare = current.replace(/^-/, '');
  if (bare === key) return current.startsWith('-') ? key : `-${key}`;
  return SORT_DEFAULT_ASC.has(key) ? key : `-${key}`;
}

// -------------------------------------------------------------------------------------------------
// Formats

export const formatInt = (value) => (value === null ? 'No data' : value.toLocaleString('en-US'));
export const formatCpc = (value) => (value === null ? 'No data' : `$${value.toFixed(2)}`);
export const competitionLabel = (kd) => (kd < 30 ? 'Low' : kd < 60 ? 'Medium' : 'High');

export function relativeTime(ms, now = Date.now()) {
  if (ms === null || ms === undefined) return 'Never';
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export const formatDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const monthLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const pageCount = (total) => Math.max(1, Math.ceil(total / PAGE_SIZE));
