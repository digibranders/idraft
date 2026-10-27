/* global setTimeout */
/**
 * Page Performance: an illustrative Search Console world for the preview (docs/32-page-performance.md).
 *
 * Every number is generated from fixed seeds, so it does not change between reloads. Each page has a base
 * level, a weekday rhythm, a country mix, a device mix and a few "events" (a drop that starts on a date, in one
 * country and device, and so on) that give the screens something real to explain. The shape mirrors the stored
 * table of section 7.3: one row per day, country and device for each watched page and search type.
 *
 * No DOM here, so Node can run it.
 */
import { EARLIEST, PROVISIONAL_DAYS, TODAY, addDays, dayFromNumber, dayNumber, daysInclusive, weekdayIndex } from './perf-calc.js';

// -------------------------------------------------------------------------------------------------
// Dimensions

export const COUNTRIES = [
  { code: 'USA', name: 'United States', share: 0.4, ctr: 1.1, pos: 1 },
  { code: 'IND', name: 'India', share: 0.14, ctr: 0.8, pos: 1.25 },
  { code: 'GBR', name: 'United Kingdom', share: 0.09, ctr: 1.05, pos: 0.95 },
  { code: 'CAN', name: 'Canada', share: 0.07, ctr: 1.05, pos: 0.98 },
  { code: 'AUS', name: 'Australia', share: 0.06, ctr: 1.0, pos: 1.02 },
  { code: 'DEU', name: 'Germany', share: 0.04, ctr: 0.9, pos: 1.2 },
  { code: 'PHL', name: 'Philippines', share: 0.04, ctr: 0.85, pos: 1.3 },
  { code: 'SGP', name: 'Singapore', share: 0.03, ctr: 0.95, pos: 1.1 },
  { code: 'ARE', name: 'United Arab Emirates', share: 0.03, ctr: 0.95, pos: 1.15 },
  { code: 'OTH', name: 'Other countries', share: 0.1, ctr: 0.8, pos: 1.4 },
];
export const DEVICES = [
  { code: 'DESKTOP', name: 'Desktop', share: 0.52, ctr: 1.15, pos: 0.95 },
  { code: 'MOBILE', name: 'Mobile', share: 0.45, ctr: 0.85, pos: 1.05 },
  { code: 'TABLET', name: 'Tablet', share: 0.03, ctr: 0.95, pos: 1.0 },
];
export const SEARCH_TYPES = [
  { code: 'web', name: 'Web', ctr: 1, pos: 0 },
  { code: 'image', name: 'Image', ctr: 0.55, pos: 2 },
  { code: 'video', name: 'Video', ctr: 0.8, pos: 1 },
  { code: 'discover', name: 'Discover', ctr: 2.2, pos: 0 },
];
export const GROUP_NAMES = ['Money pages', 'Product', 'Blog', 'Integrations', 'Resources'];

const COUNTRY_COUNT = COUNTRIES.length;
const DEVICE_COUNT = DEVICES.length;
const CELLS = COUNTRY_COUNT * DEVICE_COUNT;
const HISTORY_END = addDays(TODAY, -1);
const DAY_COUNT = daysInclusive(EARLIEST, HISTORY_END);
const EARLIEST_NUMBER = dayNumber(EARLIEST);
const dayIndexOf = (iso) => dayNumber(iso) - EARLIEST_NUMBER;

// -------------------------------------------------------------------------------------------------
// Deterministic noise

function rnd(...parts) {
  let h = 2166136261;
  for (const part of parts) {
    h ^= part | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519);
  }
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
function stringSeed(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h, 33) ^ text.charCodeAt(i);
  return h | 0;
}

// -------------------------------------------------------------------------------------------------
// The watched pages. `events` change a page from a date on, optionally in one country and device only:
// clicks and impr are multipliers, pos is added to the average position.

const HOST = 'northwind.com';

const PAGE_DEFS = [
  {
    id: 101, path: '/pricing', group: 'Money pages', topic: 'crm pricing', c0: 34, ctr: 0.034, pos: 3.8, growth: 1.1, mix: 'india', deviceMix: 'mobile',
    tracked: 6, ai: 1.6, cvr: 0.046, brand: ['northwind pricing', 'northwind crm cost'],
    events: [
      { from: '2026-09-03', c: 'IND', d: 'MOBILE', clicks: 0.18, impr: 0.92, pos: 4.2 },
      { from: '2026-09-03', clicks: 0.84, impr: 0.97, pos: 0.5 },
    ],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-25' },
  },
  {
    id: 102, path: '/compare/hubspot-alternatives', group: 'Money pages', topic: 'hubspot alternatives', c0: 26, ctr: 0.031, pos: 5.2, growth: 1.15, mix: 'us', deviceMix: 'desktop',
    tracked: 4, ai: 1.1, cvr: 0.038,
    events: [{ from: '2026-09-12', clicks: 0.26, impr: 0.38, pos: 6.5 }],
    index: { state: 'not_indexed', detail: 'Crawled, currently not indexed', lastCrawl: '2026-10-02', changedOn: '2026-09-12' },
  },
  {
    id: 103, path: '/blog/best-crm-for-startups', group: 'Blog', topic: 'crm for startups', c0: 41, ctr: 0.021, pos: 7.4, growth: 1.2, mix: 'global', deviceMix: 'mobile',
    tracked: 8, ai: 2.4, cvr: 0.017, imageScale: 0.05, discoverScale: 0.07,
    events: [{ from: '2026-08-20', clicks: 1.38, impr: 1.2, pos: -1.6 }],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-26' },
  },
  {
    id: 104, path: '/features/pipeline-management', group: 'Product', topic: 'sales pipeline management', c0: 19, ctr: 0.026, pos: 6.1, growth: 1.05, mix: 'us', deviceMix: 'desktop',
    tracked: 5, ai: 0.7, cvr: 0.033, events: [],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-23' },
  },
  {
    id: 105, path: '/blog/crm-vs-spreadsheet', group: 'Blog', topic: 'crm vs spreadsheet', c0: 22, ctr: 0.024, pos: 8.8, growth: 1.0, mix: 'global', deviceMix: 'mobile',
    tracked: 3, ai: 1.3, cvr: 0.015,
    events: [{ from: '2026-09-01', clicks: 1.0, impr: 1.55, pos: 0.3 }],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-24' },
  },
  {
    id: 106, path: '/product/contact-management', group: 'Product', topic: 'contact management software', c0: 14, ctr: 0.022, pos: 9.6, growth: 1.02, mix: 'us', deviceMix: 'desktop',
    tracked: 4, ai: 0, cvr: 0.028, events: [],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-21' },
  },
  {
    id: 107, path: '/integrations/slack', group: 'Integrations', topic: 'slack crm integration', c0: 9, ctr: 0.045, pos: 3.2, growth: 1.25, mix: 'us', deviceMix: 'desktop',
    tracked: 2, ai: 0.5, cvr: 0.024, events: [{ from: '2026-08-25', clicks: 1.15, impr: 1.1, pos: -0.3 }],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-22' },
  },
  {
    id: 108, path: '/integrations/gmail', group: 'Integrations', topic: 'gmail crm integration', c0: 6.5, ctr: 0.04, pos: 4.4, growth: 1.0, mix: 'global', deviceMix: 'desktop',
    tracked: 2, ai: 0, cvr: 0.02, events: [],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-20' },
  },
  {
    id: 109, path: '/blog/sales-forecasting-guide', group: 'Blog', topic: 'sales forecasting', c0: 17, ctr: 0.017, pos: 10.9, growth: 1.1, mix: 'global', deviceMix: 'mobile',
    tracked: 3, ai: 1.8, cvr: 0.012, imageScale: 0.04, events: [],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-26' },
  },
  {
    id: 110, path: '/customers/brightpath-logistics', group: 'Resources', topic: 'brightpath logistics crm', c0: 7, ctr: 0.05, pos: 4.1, growth: 1.0, mix: 'us', deviceMix: 'desktop',
    tracked: 0, ai: 0, cvr: 0.03, events: [{ from: '2026-09-05', clicks: 0.84, impr: 0.9, pos: 0.7 }],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-19' },
  },
  {
    id: 111, path: '/templates/sales-pipeline-template', group: 'Resources', topic: 'sales pipeline template', c0: 12, ctr: 0.028, pos: 6.8, growth: 1.3, mix: 'global', deviceMix: 'mobile',
    tracked: 3, ai: 0.9, cvr: 0.021, discoverScale: 0.04, events: [{ from: '2026-08-28', clicks: 1.3, impr: 1.15, pos: -0.8 }],
    index: { state: 'warning', detail: 'Indexed, but Google chose a different canonical', lastCrawl: '2026-10-22', canonical: `https://${HOST}/templates/sales-pipeline` },
  },
  {
    id: 112, path: '/blog/crm-for-real-estate', group: 'Blog', topic: 'crm for real estate', c0: 11, ctr: 0.03, pos: 12.2, growth: 1.0, mix: 'us', deviceMix: 'mobile', first: '2026-09-12',
    tracked: 2, ai: 0.4, cvr: 0.014, events: [{ from: '2026-09-12', clicks: 1.0, impr: 1.0, pos: 0 }],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-25' },
  },
  {
    id: 113, path: '/resources/crm-implementation-checklist', group: 'Resources', topic: 'crm implementation checklist', c0: 4.5, ctr: 0.033, pos: 6.6, growth: 1.0, mix: 'global', deviceMix: 'desktop',
    tracked: 1, ai: 0.3, cvr: 0.025, urlFormChanged: true,
    events: [{ from: '2026-09-01', clicks: 0, impr: 0.04, pos: 0 }],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-17' },
  },
  {
    id: 114, path: '/demo', group: 'Money pages', topic: 'crm demo', c0: 15, ctr: 0.092, pos: 2.4, growth: 1.04, mix: 'us', deviceMix: 'desktop',
    tracked: 3, ai: 0.2, cvr: 0.085, brand: ['northwind demo', 'northwind crm demo'], events: [],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-26' },
  },
  {
    id: 115, path: '/changelog/2026-q3', group: 'Resources', topic: 'northwind release notes', c0: 0.13, ctr: 0.03, pos: 14.5, growth: 1.0, mix: 'us', deviceMix: 'desktop',
    tracked: 0, ai: 0, cvr: 0.01, events: [],
    index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-09' },
  },
];

/** Pages the add dialog offers from "Suggested from Search Console", with their clicks over the last 28 days. */
export const SUGGESTED = [
  { path: '/features/lead-scoring', clicks28: 212, impressions28: 9400 },
  { path: '/blog/crm-data-migration', clicks28: 188, impressions28: 12100 },
  { path: '/integrations/outlook', clicks28: 151, impressions28: 4300 },
  { path: '/use-cases/agencies', clicks28: 129, impressions28: 6900 },
  { path: '/blog/how-to-write-a-sales-plan', clicks28: 118, impressions28: 15800 },
  { path: '/templates/follow-up-email-templates', clicks28: 97, impressions28: 8800 },
];

const MIXES = {
  us: { USA: 1, IND: 0.55, GBR: 1, CAN: 1, AUS: 1, DEU: 1, PHL: 0.7, SGP: 1, ARE: 1, OTH: 1 },
  global: { USA: 0.7, IND: 1.5, GBR: 1.1, CAN: 0.9, AUS: 1, DEU: 1.3, PHL: 1.6, SGP: 1.2, ARE: 1.3, OTH: 1.3 },
  india: { USA: 0.75, IND: 2.5, GBR: 0.9, CAN: 0.8, AUS: 0.9, DEU: 0.7, PHL: 1.4, SGP: 1.1, ARE: 1.3, OTH: 1 },
};
const DEVICE_MIXES = {
  desktop: { DESKTOP: 1.15, MOBILE: 0.8, TABLET: 1 },
  mobile: { DESKTOP: 0.8, MOBILE: 1.25, TABLET: 1 },
};
const WEEKDAY = [1.08, 1.1, 1.08, 1.04, 0.95, 0.68, 0.7];

function normalizedShares(list, tweak) {
  const raw = list.map((item) => item.share * (tweak?.[item.code] ?? 1));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

// -------------------------------------------------------------------------------------------------
// Watchlist state

let watchlist = PAGE_DEFS.map((definition) => ({ ...definition }));
const generated = new Map();
const webTotals = new Map();
const queryCache = new Map();

export const listPages = () => watchlist;
export const getPage = (id) => watchlist.find((page) => page.id === id) ?? null;
export const pathOf = (page) => page.path;
export const urlOf = (page) => `https://${HOST}${page.path}`;
export const HOST_NAME = HOST;

function definitionFor(path, hint) {
  const seed = stringSeed(path);
  const c0 = hint?.clicks28 ? hint.clicks28 / 28 : 3 + rnd(seed, 1) * 18;
  const ctr = hint?.clicks28 && hint?.impressions28 ? hint.clicks28 / hint.impressions28 : 0.015 + rnd(seed, 2) * 0.03;
  const slug = path.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? 'home';
  return {
    id: 200 + (Math.abs(seed) % 9000), path, group: null, topic: slug, c0, ctr, pos: 4 + rnd(seed, 3) * 9, growth: 1 + rnd(seed, 4) * 0.2,
    mix: rnd(seed, 5) > 0.5 ? 'global' : 'us', deviceMix: rnd(seed, 6) > 0.5 ? 'mobile' : 'desktop',
    tracked: Math.floor(rnd(seed, 7) * 5), ai: rnd(seed, 8) > 0.6 ? 0.6 : 0, cvr: 0.015 + rnd(seed, 9) * 0.02,
    events: [], index: { state: 'indexed', detail: 'Submitted and indexed', lastCrawl: '2026-10-24' },
  };
}

/** Adds pages by path. Returns one outcome per path (docs/32 section 8, POST watchlist). */
export function addPages(entries, group = null) {
  return entries.map(({ path, hint }) => {
    if (watchlist.some((page) => page.path === path)) return { path, outcome: 'already_watched' };
    const definition = { ...definitionFor(path, hint), group };
    while (watchlist.some((page) => page.id === definition.id)) definition.id += 1;
    watchlist = [...watchlist, definition];
    return { path, outcome: 'added', id: definition.id };
  });
}
export function removePages(ids) {
  const gone = new Set(ids);
  watchlist = watchlist.filter((page) => !gone.has(page.id));
}
export function setGroup(ids, group) {
  const chosen = new Set(ids);
  watchlist = watchlist.map((page) => (chosen.has(page.id) ? { ...page, group } : page));
}
export function resetWatchlist() {
  watchlist = PAGE_DEFS.map((definition) => ({ ...definition }));
}

/** Probe for the add dialog: what Search Console reports for a pasted URL (docs/32 section 5.9). */
export function probePath(path) {
  const known = SUGGESTED.find((item) => item.path === path);
  if (known) return { found: true, forms: 1, clicks28: known.clicks28 };
  if (path.endsWith('/') && path.length > 1) return { found: true, forms: 2, clicks28: 40 + (Math.abs(stringSeed(path)) % 200) };
  if (/(missing|draft|test|noindex)/.test(path)) return { found: false, forms: 0, clicks28: 0 };
  return { found: true, forms: 1, clicks28: 20 + (Math.abs(stringSeed(path)) % 260) };
}

// -------------------------------------------------------------------------------------------------
// The daily rows of one page and search type: clicks, impressions and position x impressions per
// (day, country, device). Provisional days carry about 60 to 80% of their final value, which is why the
// default window leaves them out.

function typeScale(page, code) {
  if (code === 'web') return 1;
  if (code === 'image') return page.imageScale ?? 0;
  if (code === 'video') return page.videoScale ?? (page.path === '/demo' ? 0.05 : 0);
  return page.discoverScale ?? 0;
}

function eventFactors(page, iso, country, device) {
  let clicks = 1;
  let impressions = 1;
  let position = 0;
  for (const event of page.events) {
    if (iso < event.from || (event.to && iso > event.to)) continue;
    if (event.c && event.c !== country) continue;
    if (event.d && event.d !== device) continue;
    clicks *= event.clicks;
    impressions *= event.impr;
    position += event.pos;
  }
  return { clicks, impressions, position };
}

function generate(page, code) {
  const key = `${page.id}:${code}`;
  if (generated.has(key)) return generated.get(key);
  const scale = typeScale(page, code);
  const type = SEARCH_TYPES.find((item) => item.code === code);
  const rows = { clicks: new Float64Array(DAY_COUNT * CELLS), impressions: new Float64Array(DAY_COUNT * CELLS), posSum: new Float64Array(DAY_COUNT * CELLS) };
  if (scale > 0) {
    const countryShares = normalizedShares(COUNTRIES, MIXES[page.mix]);
    const deviceShares = normalizedShares(DEVICES, DEVICE_MIXES[page.deviceMix]);
    const seed = stringSeed(page.path) + stringSeed(code);
    const first = page.first ?? EARLIEST;
    for (let day = 0; day < DAY_COUNT; day += 1) {
      const iso = dayFromNumber(EARLIEST_NUMBER + day);
      if (iso < first) continue;
      const month = Number(iso.slice(5, 7));
      const dom = Number(iso.slice(8, 10));
      const holiday = (month === 12 && dom >= 22) || (month === 1 && dom <= 3) ? 0.78 : month === 8 ? 0.95 : 1;
      const level = page.c0 * scale * WEEKDAY[weekdayIndex(iso)] * page.growth ** (day / 365) * holiday;
      const provisional = PROVISIONAL_DAYS.includes(iso) ? 0.6 + 0.2 * rnd(seed, day) : 1;
      for (let c = 0; c < COUNTRY_COUNT; c += 1) {
        for (let d = 0; d < DEVICE_COUNT; d += 1) {
          const cell = day * CELLS + c * DEVICE_COUNT + d;
          const events = eventFactors(page, iso, COUNTRIES[c].code, DEVICES[d].code);
          const baseClicks = level * countryShares[c] * deviceShares[d] * (0.75 + 0.5 * rnd(seed, day, c, d));
          const cellCtr = page.ctr * type.ctr * COUNTRIES[c].ctr * DEVICES[d].ctr * (0.92 + 0.16 * rnd(seed, day, c, d, 9));
          const baseImpressions = baseClicks / cellCtr;
          const clicks = Math.floor(baseClicks * events.clicks * provisional + rnd(seed, day, c, d, 3));
          const impressions = Math.max(clicks, Math.floor(baseImpressions * events.impressions * provisional + rnd(seed, day, c, d, 4)));
          if (impressions === 0) continue;
          const position = Math.max(1, (page.pos + type.pos) * COUNTRIES[c].pos * DEVICES[d].pos + events.position + (rnd(seed, day, c, d, 5) - 0.5) * 0.8);
          rows.clicks[cell] = clicks;
          rows.impressions[cell] = impressions;
          rows.posSum[cell] = position * impressions;
        }
      }
    }
  }
  generated.set(key, rows);
  return rows;
}

export const hasType = (page, code) => typeScale(page, code) > 0;

// -------------------------------------------------------------------------------------------------
// Queries (live in the real app). Weights are shares of the page's clicks and impressions; modifiers make a
// query appear, vanish, rise or fall on a date.

const TEMPLATES = ['{t}', '{t} software', 'best {t}', '{t} free', '{t} for small business', '{t} examples', 'how to choose {t}', '{t} 2026', '{t} tools', '{t} india', '{t} for agencies', '{t} comparison', 'what is {t}', '{t} reviews', 'cheap {t}', '{t} for saas'];

function queriesOf(page) {
  if (queryCache.has(page.id)) return queryCache.get(page.id);
  const seed = stringSeed(page.path);
  const names = [...(page.brand ?? []), ...TEMPLATES.map((template) => template.replace('{t}', page.topic))];
  const raw = names.map((_, index) => 1 / (index + 1) ** 0.85);
  const total = raw.reduce((sum, value) => sum + value, 0);
  const list = names.map((text, index) => {
    const weight = (raw[index] / total) * 0.88;
    const impressionWeight = (raw[(index * 7) % names.length] / total) * 0.9;
    const pick = rnd(seed, index, 11);
    let modifier = { kind: 'steady' };
    if (text.endsWith(' india') && page.events.some((event) => event.c === 'IND')) modifier = { kind: 'fall', date: page.events[0].from, factor: 0.2 };
    else if (pick < 0.1) modifier = { kind: 'new', date: addDays('2026-09-04', Math.floor(rnd(seed, index, 12) * 18)) };
    else if (pick < 0.18) modifier = { kind: 'lost', date: addDays('2026-09-02', Math.floor(rnd(seed, index, 13) * 20)) };
    else if (pick < 0.3) modifier = { kind: 'rise', date: addDays('2026-08-20', Math.floor(rnd(seed, index, 14) * 20)), factor: 1.7 };
    else if (pick < 0.42) modifier = { kind: 'fall', date: addDays('2026-09-01', Math.floor(rnd(seed, index, 15) * 20)), factor: 0.45 };
    return { text, weight, impressionWeight, position: Math.max(1, page.pos + (index % 5) * 1.4 - 1.2), modifier };
  });
  queryCache.set(page.id, list);
  return list;
}

function modifierFactor(modifier, iso) {
  if (modifier.kind === 'steady') return 1;
  if (modifier.kind === 'new') return iso >= modifier.date ? 1 : 0;
  if (modifier.kind === 'lost') return iso < modifier.date ? 1 : 0;
  const ramp = Math.min(1, Math.max(0, (dayNumber(iso) - dayNumber(modifier.date) + 7) / 14));
  return 1 + (modifier.factor - 1) * ramp;
}

function matchesQuery(text, filter) {
  if (!filter?.value) return true;
  const value = filter.value.toLowerCase();
  if (filter.op === 'contains') return text.includes(value);
  if (filter.op === 'excludes') return !text.includes(value);
  if (filter.op === 'equals') return text === value;
  try {
    return new RegExp(filter.value, 'i').test(text);
  } catch {
    return false;
  }
}

export function isValidRegex(value) {
  try {
    new RegExp(value);
    return value.length <= 200;
  } catch {
    return false;
  }
}

/** Per-day shares of clicks and impressions that a query filter keeps (docs/32 section 7.5, point 4). */
function queryFactors(page, filter, days) {
  const queries = queriesOf(page).filter((query) => matchesQuery(query.text, filter));
  const clicks = new Float64Array(days.length);
  const impressions = new Float64Array(days.length);
  days.forEach((iso, index) => {
    for (const query of queries) {
      const factor = modifierFactor(query.modifier, iso);
      clicks[index] += query.weight * factor;
      impressions[index] += query.impressionWeight * factor;
    }
  });
  return { clicks, impressions };
}

// -------------------------------------------------------------------------------------------------
// Aggregation over a range with the stored filters (country, device, search type) and the live query filter.

function cellSelection(filters) {
  const countries = COUNTRIES.map((country, index) => (!filters?.countries || filters.countries.size === 0 || filters.countries.has(country.code) ? index : -1)).filter((i) => i >= 0);
  const devices = DEVICES.map((device, index) => (!filters?.devices || filters.devices.size === 0 || filters.devices.has(device.code) ? index : -1)).filter((i) => i >= 0);
  return { countries, devices };
}

/** Daily sums for a page: `{ days, clicks, impressions, posSum }` arrays aligned with `days`. */
export function dailyOf(pageId, code, from, to, filters = {}) {
  const page = getPage(pageId);
  const days = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n += 1) days.push(dayFromNumber(n));
  const out = { days, clicks: new Array(days.length).fill(0), impressions: new Array(days.length).fill(0), posSum: new Array(days.length).fill(0) };
  if (!page) return out;
  const rows = generate(page, code);
  const { countries, devices } = cellSelection(filters);
  const query = filters.query?.value ? queryFactors(page, filters.query, days) : null;
  days.forEach((iso, index) => {
    const day = dayIndexOf(iso);
    if (day < 0 || day >= DAY_COUNT) return;
    let clicks = 0;
    let impressions = 0;
    let posSum = 0;
    for (const c of countries) {
      for (const d of devices) {
        const cell = day * CELLS + c * DEVICE_COUNT + d;
        clicks += rows.clicks[cell];
        impressions += rows.impressions[cell];
        posSum += rows.posSum[cell];
      }
    }
    if (query) {
      const keptClicks = query.clicks[index] / 0.88;
      const keptImpressions = query.impressions[index] / 0.9;
      const posPerImpression = impressions > 0 ? posSum / impressions : 0;
      clicks *= keptClicks;
      impressions *= keptImpressions;
      posSum = posPerImpression * impressions;
    }
    out.clicks[index] = clicks;
    out.impressions[index] = impressions;
    out.posSum[index] = posSum;
  });
  return out;
}

export function accOf(pageId, code, from, to, filters = {}) {
  const daily = dailyOf(pageId, code, from, to, filters);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return { clicks: Math.round(sum(daily.clicks)), impressions: Math.round(sum(daily.impressions)), posSum: sum(daily.posSum) };
}

/** Totals per country, device or country and device pair, for the What changed tables. */
export function breakdownOf(pageId, code, from, to, dimension, filters = {}) {
  const page = getPage(pageId);
  const result = new Map();
  if (!page) return result;
  const rows = generate(page, code);
  const { countries, devices } = cellSelection(filters);
  const days = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n += 1) days.push(dayFromNumber(n));
  const query = filters.query?.value ? queryFactors(page, filters.query, days) : null;
  days.forEach((iso, index) => {
    const day = dayIndexOf(iso);
    if (day < 0 || day >= DAY_COUNT) return;
    for (const c of countries) {
      for (const d of devices) {
        const cell = day * CELLS + c * DEVICE_COUNT + d;
        const keyName = dimension === 'country' ? COUNTRIES[c].code : dimension === 'device' ? DEVICES[d].code : `${COUNTRIES[c].code}|${DEVICES[d].code}`;
        const entry = result.get(keyName) ?? { clicks: 0, impressions: 0, posSum: 0 };
        const keptClicks = query ? query.clicks[index] / 0.88 : 1;
        const keptImpressions = query ? query.impressions[index] / 0.9 : 1;
        const impressions = rows.impressions[cell] * keptImpressions;
        entry.clicks += rows.clicks[cell] * keptClicks;
        entry.impressions += impressions;
        entry.posSum += rows.impressions[cell] > 0 ? (rows.posSum[cell] / rows.impressions[cell]) * impressions : 0;
        result.set(keyName, entry);
      }
    }
  });
  return result;
}

export const countryName = (code) => COUNTRIES.find((country) => country.code === code)?.name ?? code;
export const deviceName = (code) => DEVICES.find((device) => device.code === code)?.name ?? code;

// -------------------------------------------------------------------------------------------------
// Other metrics: the site's clicks (for the share), our rank tracking, AI citations and Google Analytics.
// `series` returns { num, den, days } so a range can be reduced the same way for every metric.

const SITE_SCALE = 2.9;
const BASE_PAGES = PAGE_DEFS.map((page) => page.id);

function totalsOf(pageId) {
  if (webTotals.has(pageId)) return webTotals.get(pageId);
  const daily = dailyOf(pageId, 'web', EARLIEST, HISTORY_END, {});
  webTotals.set(pageId, daily);
  return daily;
}

export function seriesOf(pageId, metric, from, to, context) {
  const code = context?.type ?? 'web';
  const filters = context?.filters ?? {};
  const page = getPage(pageId);
  const base = dailyOf(pageId, code, from, to, filters);
  const { days } = base;
  if (metric === 'clicks') return { days, num: base.clicks, den: null };
  if (metric === 'impressions') return { days, num: base.impressions, den: null };
  if (metric === 'ctr') return { days, num: base.clicks, den: base.impressions };
  if (metric === 'position') return { days, num: base.posSum, den: base.impressions };
  if (metric === 'share') {
    const site = days.map(() => 0);
    for (const id of BASE_PAGES) {
      const daily = dailyOf(id, code, from, to, { ...filters, query: null });
      daily.clicks.forEach((value, index) => (site[index] += value));
    }
    return { days, num: base.clicks, den: site.map((value) => value * SITE_SCALE) };
  }
  const seed = stringSeed(page?.path ?? '') + stringSeed(metric);
  const totals = totalsOf(pageId);
  const first = dayIndexOf(from);
  if (metric === 'rank') {
    if (!page || page.tracked === 0) return null;
    const num = days.map((_, index) => {
      const day = first + index;
      const impressions = totals.impressions[day];
      if (!(impressions > 0)) return 0;
      return Math.max(1, (totals.posSum[day] / impressions) * 0.82 + (rnd(seed, day) - 0.5) * 1.2);
    });
    return { days, num, den: num.map((value) => (value > 0 ? 1 : 0)) };
  }
  if (metric === 'aiCitations') {
    if (!page || page.ai === 0) return null;
    const num = days.map((_, index) => {
      const day = first + index;
      const level = totals.clicks[day] / Math.max(1, page.c0);
      return Math.floor(page.ai * Math.min(1.8, Math.max(0.2, level)) * (0.5 + rnd(seed, day)) + rnd(seed, day, 1));
    });
    return { days, num, den: null };
  }
  const sessions = base.clicks.map((clicks, index) => Math.floor(clicks * 1.22 * (0.92 + 0.16 * rnd(seed, first + index)) + rnd(seed, first + index, 2)));
  if (metric === 'sessions') return { days, num: sessions, den: null };
  if (metric === 'conversions') {
    return { days, num: sessions.map((count, index) => Math.floor(count * (page?.cvr ?? 0.02) + rnd(seed, first + index, 3))), den: null };
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// Indexing status (URL Inspection API, one check a day per page)

export function indexingOf(pageId) {
  const page = getPage(pageId);
  if (!page) return null;
  return { ...page.index, checkedAt: '2026-10-27 06:10 PT', history: page.index.changedOn ? [{ date: page.index.changedOn, state: page.index.state }] : [] };
}

// -------------------------------------------------------------------------------------------------
// Live data. These resolve after a short delay, as the real call to Google would.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rows of the Queries tab: each query's clicks, impressions and position now and before, with the coverage note. */
export async function queryRows(pageId, code, current, compare, filters, { latency = true } = {}) {
  if (latency) await wait(650 + Math.floor(Math.random() * 450));
  const page = getPage(pageId);
  if (!page) return { rows: [], coverage: 0 };
  const stored = { ...filters, query: null };
  const reduce = (range) => {
    if (!range) return null;
    const daily = dailyOf(pageId, code, range.from, range.to, stored);
    const total = daily.clicks.reduce((sum, value) => sum + value, 0);
    const rows = new Map();
    for (const query of queriesOf(page)) {
      if (!matchesQuery(query.text, filters.query)) continue;
      let clicks = 0;
      let impressions = 0;
      let posSum = 0;
      daily.days.forEach((iso, index) => {
        const factor = modifierFactor(query.modifier, iso);
        const q = Math.floor(daily.clicks[index] * query.weight * factor + rnd(stringSeed(query.text), index, 1));
        const i = Math.floor(daily.impressions[index] * query.impressionWeight * factor + rnd(stringSeed(query.text), index, 2));
        const pageAverage = daily.impressions[index] > 0 ? daily.posSum[index] / daily.impressions[index] : 0;
        clicks += q;
        impressions += Math.max(i, q);
        posSum += Math.max(i, q) * Math.max(1, query.position + (pageAverage - page.pos) * 0.9);
      });
      rows.set(query.text, { clicks, impressions, position: impressions > 0 ? posSum / impressions : null });
    }
    return { total, rows };
  };
  const now = reduce(current);
  const before = reduce(compare && !compare.unavailable ? compare : null);
  const names = new Set([...now.rows.keys(), ...(before ? before.rows.keys() : [])]);
  const rows = [...names]
    .map((text) => ({ text, now: now.rows.get(text) ?? { clicks: 0, impressions: 0, position: null }, before: before?.rows.get(text) ?? null }))
    .filter((row) => row.now.clicks > 0 || row.now.impressions > 0 || (row.before && (row.before.clicks > 0 || row.before.impressions > 0)));
  const covered = [...now.rows.values()].reduce((sum, row) => sum + row.clicks, 0);
  return { rows, coverage: now.total > 0 ? Math.min(1, covered / now.total) : 0 };
}

const APPEARANCES = [
  { name: 'FAQ rich results', weight: 0.14, pages: [101, 103, 105, 109] },
  { name: 'Video', weight: 0.05, pages: [114, 103] },
  { name: 'Review snippets', weight: 0.04, pages: [101, 102, 110] },
];
export async function appearanceRows(pageId, code, current, compare, filters, { latency = true } = {}) {
  if (latency) await wait(500 + Math.floor(Math.random() * 400));
  const stored = { ...filters, query: null };
  const parts = APPEARANCES.filter((item) => item.pages.includes(pageId));
  const reduce = (range) => {
    if (!range) return null;
    const acc = accOf(pageId, code, range.from, range.to, stored);
    return Object.fromEntries(parts.map((item) => [item.name, { clicks: Math.round(acc.clicks * item.weight), impressions: Math.round(acc.impressions * item.weight * 0.9) }]));
  };
  const now = reduce(current);
  const before = reduce(compare && !compare.unavailable ? compare : null);
  return parts.map((item) => ({ text: item.name, now: now[item.name], before: before?.[item.name] ?? null }));
}
