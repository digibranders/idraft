/* global URLSearchParams */
/**
 * Page Performance: the one filter state (kept in the query string, docs/32 section 5.4) and the numbers every
 * screen derives from it. The list and the detail read the same state, so a filter is set once (principle S3).
 * No DOM here.
 */
import {
  CORE_METRICS, DEFAULT_COMPARE, DEFAULT_PERIOD, METRICS, buildVerdict, describeChange, healthOf, reduceRange, resolveCompare, resolvePeriod,
} from './perf-calc.js';
import { COUNTRIES, DEVICES, accOf, breakdownOf, countryName, dailyOf, deviceName, getPage, indexingOf, seriesOf } from './perf-data.js';

// -------------------------------------------------------------------------------------------------
// State

export const DEFAULT_STATE = {
  period: DEFAULT_PERIOD,
  compare: DEFAULT_COMPARE,
  provisional: false,
  countries: new Set(),
  devices: new Set(),
  type: 'web',
  group: '',
  query: null, // { op: 'contains' | 'excludes' | 'equals' | 'regex', value }
  metrics: ['clicks', 'impressions'],
  extras: new Set(), // optional metrics shown as tiles
  layout: 'stack',
  view: 'chart',
  sort: 'attention',
  page: null,
  shell: 'drawer',
  health: '',
  tab: 'countries',
  mode: 'losers',
  review: 'connected',
};

const list = (value) => (value ? value.split(',').filter(Boolean) : []);

export function readState(search) {
  const params = new URLSearchParams(search);
  const metrics = list(params.get('metrics')).filter((key) => METRICS[key]);
  const queryValue = params.get('qv');
  return {
    ...DEFAULT_STATE,
    period: params.get('period') ?? DEFAULT_STATE.period,
    compare: params.get('compare') ?? DEFAULT_STATE.compare,
    provisional: params.get('prov') === '1',
    countries: new Set(list(params.get('country')).filter((code) => COUNTRIES.some((country) => country.code === code))),
    devices: new Set(list(params.get('device')).filter((code) => DEVICES.some((device) => device.code === code))),
    type: params.get('type') ?? DEFAULT_STATE.type,
    group: params.get('group') ?? '',
    query: queryValue ? { op: params.get('qop') ?? 'contains', value: queryValue } : null,
    metrics: metrics.length > 0 ? metrics.slice(0, 4) : [...DEFAULT_STATE.metrics],
    extras: new Set(list(params.get('more')).filter((key) => METRICS[key]?.optional)),
    layout: params.get('layout') === 'overlay' ? 'overlay' : 'stack',
    view: params.get('view') === 'table' ? 'table' : 'chart',
    sort: params.get('sort') ?? DEFAULT_STATE.sort,
    page: params.get('page') ? Number(params.get('page')) : null,
    shell: params.get('shell') === 'page' ? 'page' : 'drawer',
    health: params.get('health') ?? '',
    tab: params.get('tab') ?? DEFAULT_STATE.tab,
    mode: params.get('mode') ?? DEFAULT_STATE.mode,
    review: params.get('state') ?? DEFAULT_STATE.review,
  };
}

/** The query string for a state; values equal to their default are left out. */
export function writeState(state) {
  const params = new URLSearchParams();
  const put = (key, value, fallback = '') => {
    if (value !== undefined && value !== null && value !== '' && value !== fallback) params.set(key, String(value));
  };
  put('period', state.period, DEFAULT_STATE.period);
  put('compare', state.compare, DEFAULT_STATE.compare);
  if (state.provisional) params.set('prov', '1');
  if (state.countries.size > 0) params.set('country', [...state.countries].join(','));
  if (state.devices.size > 0) params.set('device', [...state.devices].join(','));
  put('type', state.type, DEFAULT_STATE.type);
  put('group', state.group);
  if (state.query?.value) {
    params.set('qop', state.query.op);
    params.set('qv', state.query.value);
  }
  if (state.metrics.join() !== DEFAULT_STATE.metrics.join()) params.set('metrics', state.metrics.join(','));
  if (state.extras.size > 0) params.set('more', [...state.extras].join(','));
  put('layout', state.layout, DEFAULT_STATE.layout);
  put('view', state.view, DEFAULT_STATE.view);
  put('sort', state.sort, DEFAULT_STATE.sort);
  if (state.page) params.set('page', String(state.page));
  put('shell', state.shell, DEFAULT_STATE.shell);
  put('health', state.health);
  put('tab', state.tab, DEFAULT_STATE.tab);
  put('mode', state.mode, DEFAULT_STATE.mode);
  put('state', state.review, DEFAULT_STATE.review);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const filtersOf = (state, { query = true } = {}) => ({ countries: state.countries, devices: state.devices, query: query ? state.query : null });
export const contextOf = (state, options) => ({ type: state.type, filters: filtersOf(state, options) });

export function rangesOf(state) {
  const current = resolvePeriod(state.period, state.provisional);
  return { current, compare: resolveCompare(state.compare, current) };
}

export const comparable = (ranges) => Boolean(ranges.compare) && !ranges.compare.unavailable;

// -------------------------------------------------------------------------------------------------
// Series and tiles

/** `{ cur, prev }` series of one metric for a page, or `null` when the page has no data for it. */
export function metricSeries(pageId, key, state, ranges = rangesOf(state), options) {
  const context = contextOf(state, options);
  const cur = seriesOf(pageId, key, ranges.current.from, ranges.current.to, context);
  if (!cur) return null;
  const prev = comparable(ranges) ? seriesOf(pageId, key, ranges.compare.from, ranges.compare.to, context) : null;
  return { cur, prev };
}

/** What a tile shows: values now and before, and the change between them. */
export function tileOf(pageId, key, state, ranges = rangesOf(state), options) {
  const series = metricSeries(pageId, key, state, ranges, options);
  if (!series) return null;
  const value = (part) => reduceRange(key, part.num, part.den);
  const cur = value(series.cur);
  const prev = series.prev ? value(series.prev) : null;
  const impressions = (part) => (part ? dailyOf(pageId, state.type, part.days[0], part.days[part.days.length - 1], filtersOf(state, options)).impressions.reduce((sum, v) => sum + v, 0) : 0);
  const change = series.prev
    ? describeChange(key, cur, prev, {
        curDays: ranges.current.days,
        prevDays: ranges.compare.days,
        curImpressions: key === 'position' || key === 'ctr' ? impressions(series.cur) : undefined,
        prevImpressions: key === 'position' || key === 'ctr' ? impressions(series.prev) : undefined,
      })
    : null;
  return { key, cur, prev, change, series };
}

// -------------------------------------------------------------------------------------------------
// The page as a whole: health, verdict and the segment behind a change

/** The country, device or pair that explains at least half of the net change in clicks (docs/32 section 6.2). */
export function driverOf(pageId, state, ranges, options) {
  if (!comparable(ranges)) return null;
  const filters = filtersOf(state, options);
  const scale = ranges.current.days / ranges.compare.days;
  for (const dimension of ['pair', 'country', 'device']) {
    const now = breakdownOf(pageId, state.type, ranges.current.from, ranges.current.to, dimension, filters);
    const before = breakdownOf(pageId, state.type, ranges.compare.from, ranges.compare.to, dimension, filters);
    const deltas = [];
    let net = 0;
    for (const key of new Set([...now.keys(), ...before.keys()])) {
      const delta = (now.get(key)?.clicks ?? 0) - (before.get(key)?.clicks ?? 0) * scale;
      deltas.push([key, delta]);
      net += delta;
    }
    if (Math.abs(net) < 25) return null;
    const [key, delta] = deltas.filter(([, value]) => Math.sign(value) === Math.sign(net)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] ?? [];
    // A segment explains the change only if it carries at least half of it and far more than its usual share of
    // clicks. Otherwise the biggest segment would "explain" every change on a page that is mostly desktop.
    const totalBefore = [...before.values()].reduce((sum, entry) => sum + entry.clicks, 0) * scale;
    const usualShare = totalBefore > 0 ? ((before.get(key)?.clicks ?? 0) * scale) / totalBefore : 0;
    if (key && delta / net >= 0.5 && delta / net >= 1.5 * usualShare) {
      const name = dimension === 'pair' ? `${deviceName(key.split('|')[1])} in ${countryName(key.split('|')[0])}` : dimension === 'country' ? countryName(key) : deviceName(key);
      return { name, share: delta / net, dimension, key };
    }
  }
  return null;
}

export function pageModel(pageId, state, { query = false, full = false } = {}) {
  const page = getPage(pageId);
  const ranges = rangesOf(state);
  const options = { query };
  const filters = filtersOf(state, options);
  const cur = accOf(pageId, state.type, ranges.current.from, ranges.current.to, filters);
  const prev = comparable(ranges) ? accOf(pageId, state.type, ranges.compare.from, ranges.compare.to, filters) : null;
  const health = healthOf(cur, prev, ranges.current.days, ranges.compare?.days ?? ranges.current.days);
  const model = { page, ranges, cur, prev, health, index: indexingOf(pageId) };
  model.tiles = Object.fromEntries(CORE_METRICS.map((key) => [key, tileOf(pageId, key, state, ranges, options)]));
  if (full) {
    model.driver = driverOf(pageId, state, ranges, options);
    model.verdict = buildVerdict({
      health, cur, prev, ranges, driver: model.driver, index: model.index,
      provisionalExcluded: !state.provisional, urlFormChanged: Boolean(page?.urlFormChanged),
    });
  }
  return model;
}

/** Daily clicks for the list sparkline (current period, day by day). */
export function sparkOf(pageId, state, ranges = rangesOf(state)) {
  const daily = dailyOf(pageId, state.type, ranges.current.from, ranges.current.to, filtersOf(state, { query: false }));
  return daily.clicks;
}
