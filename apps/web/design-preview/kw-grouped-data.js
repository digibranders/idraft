/**
 * Eventus Security for the grouped Rankings mock: 55 keywords tracked on desktop and mobile in India, in three
 * keyword groups. The ranks and metrics are illustrative (a mock, not the project's real readings); the keywords and
 * the groups are the owner's. A rank is a number up to 100 or 'b' (beyond the top 100).
 */

export const PROVIDERS = 'Providers and vendors';
export const SERVICE = 'Service, pricing and technology';
export const INDIA = 'India';

/** The groups in the order the owner listed them, each with the sentence the group row says it by. */
export const GROUPS = [
  { name: PROVIDERS, note: 'Shopping for a supplier: provider, vendor, companies, best, top.' },
  { name: SERVICE, note: 'Learning what the service is, what it costs and how it works.' },
  { name: INDIA, note: 'Local intent: any search that says “in india”.' },
];

// [keyword, group, volume, kd, cpc, intent, desktop rank, mobile rank, desktop before, mobile before]
const ROWS = [
  ['soc vendors', PROVIDERS, 20, 54, 14.28, 'commercial', 34, 8, 36, 8],
  ['soc managed service providers', PROVIDERS, 50, 41, 7.9, 'commercial', 41, 38, 40, 45],
  ['top soc as a service providers', PROVIDERS, 20, 36, 3.2, 'commercial', 23, 'b', 25, 'b'],
  ['soc providers', PROVIDERS, 40, 54, 2.81, 'navigational', 7, 2, 7, 4],
  ['soc as a service vendor', PROVIDERS, 30, 33, 6.2, 'commercial', 26, 22, 24, 22],
  ['soc provider', PROVIDERS, 40, 54, 2.81, 'navigational', 31, 27, 29, 27],
  ['soc as a service vendors', PROVIDERS, 30, 33, 6.2, 'commercial', 28, 24, 28, 25],
  ['soc solution provider', PROVIDERS, 20, 29, 4.4, 'commercial', 52, 47, 55, 47],
  ['best soc as a service', PROVIDERS, 20, 35, 5.1, 'commercial', 18, 15, 21, 15],
  ['managed soc provider', PROVIDERS, 50, 25, 7.12, 'navigational', 28, 12, 30, 14],
  ['soc as a service providers', PROVIDERS, 50, 38, 1.81, 'navigational', 44, 39, 44, 41],
  ['soc service provider', PROVIDERS, 90, 31, 4.59, 'navigational', 8, 8, 9, 8],
  ['best soc service provider', PROVIDERS, 30, 38, 8.4, 'commercial', 5, 13, 6, 14],
  ['soc managed services providers', PROVIDERS, 30, 44, 5.6, 'commercial', 'b', 62, 'b', 60],
  ['soc service providers', PROVIDERS, 20, 40, 8.98, 'navigational', 21, 17, 19, 17],
  ['managed soc providers', PROVIDERS, 70, 28, 12.58, 'navigational', 35, 26, 38, 26],
  ['managed soc as a service solution provider', PROVIDERS, 20, 22, 6.1, 'commercial', 46, 51, 49, 51],
  ['managed soc service providers', PROVIDERS, 20, 27, 1.28, 'navigational', 25, 21, 27, 21],
  ['top soc service provider', PROVIDERS, 30, 34, 9.3, 'commercial', 14, 12, 15, 12],
  ['soc as a service companies', PROVIDERS, 20, 30, 7.17, 'commercial', 6, 6, 6, 7],
  ['managed soc service provider', PROVIDERS, 20, 26, 6.4, 'navigational', 24, 20, 24, 23],
  ['socaas provider', PROVIDERS, 10, 12, 5.3, 'commercial', 12, 9, 15, 9],
  ['soc as a service mssp', PROVIDERS, 20, 31, 6.9, 'commercial', 33, 29, 33, 31],
  ['best managed security service provider', PROVIDERS, 90, 52, 11.2, 'commercial', 'b', 'b', 'b', 'b'],
  ['soc as a service provider', PROVIDERS, 40, 36, 1.81, 'navigational', 37, 30, 40, 30],
  ['managed security service provider', PROVIDERS, 2400, 64, 13.4, 'commercial', 'b', 'b', 'b', 'b'],
  ['security service provider', PROVIDERS, 1600, 58, 5.9, 'commercial', 'b', 'b', 'b', 'b'],
  ['managed security service provider solutions', PROVIDERS, 70, 47, 9.8, 'commercial', 'b', 79, 'b', 83],
  ['soc as a service pricing', SERVICE, 10, 9, 4.1, 'commercial', 15, 11, 17, 13],
  ['managed soc pricing', SERVICE, 50, 17, 3.5, 'commercial', 22, 18, 22, 21],
  ['managed soc service', SERVICE, 210, 47, 9.73, 'navigational', 'b', 'b', 'b', 'b'],
  ['managed soc services', SERVICE, 210, 'b', 5.71, 'navigational', 63, 'b', 61, 'b'],
  ['managed soc as a service', SERVICE, 210, 37, 5.71, 'navigational', 'b', 'b', 'b', 'b'],
  ['ai driven soc', SERVICE, 20, 11, 6.06, 'informational', 14, 13, 18, 16],
  ['managed xdr', SERVICE, 20, 5, 6.06, 'informational', 'b', 'b', 'b', 'b'],
  ['security operations center as a service', SERVICE, 320, 34, 0.34, 'commercial', 9, 7, 11, 7],
  ['soc security services', SERVICE, 1000, 27, 0, 'navigational', 'b', 'b', 'b', 'b'],
  ['soc service organization', SERVICE, 590, 0, 1.3, 'navigational', 'b', 'b', 'b', 'b'],
  ['soc as service', SERVICE, 210, 8, 0.76, 'informational', 'b', 'b', 'b', 'b'],
  ['soc managed services', SERVICE, 210, 47, 9.73, 'navigational', 'b', 'b', 'b', 'b'],
  ['soc-as-a-service', SERVICE, 320, 8, 0.76, 'informational', 64, 58, 70, 61],
  ['soc as a service', SERVICE, 880, 13, 1.1, 'informational', 'b', 'b', 'b', 'b'],
  ['soc service', SERVICE, 8100, 13, 2.66, 'informational', 'b', 'b', 'b', 'b'],
  ['24/7 managed soc', SERVICE, 20, 13, 1.7, 'informational', 38, 32, 41, 32],
  ['fully managed soc', SERVICE, 30, 21, 2.2, 'informational', 27, 23, 27, 25],
  ['soc as a service solutions', SERVICE, 20, 28, 1.28, 'navigational', 'b', 'b', 'b', 'b'],
  ['24/7 soc', SERVICE, 20, 16, 1.5, 'informational', 20, 18, 22, 20],
  ['managed soc', SERVICE, 90, 0, 7.96, 'informational', 'b', 'b', 'b', 'b'],
  ['ai driven soc as a service', SERVICE, 20, 10, 4.2, 'informational', 17, 16, 17, 19],
  ['managed soc services in india', INDIA, 50, 24, 4.79, 'navigational', 1, 1, 1, 1],
  ['soc as a service vendors in india', INDIA, 30, 19, 6.8, 'commercial', 13, 12, 13, 14],
  ['soc services in india', INDIA, 20, 'b', 5.4, 'informational', 'b', 'b', 'b', 'b'],
  ['soc services companies in india', INDIA, 20, 20, 7.1, 'commercial', 11, 10, 12, 10],
  ['soc companies in india', INDIA, 20, 12, 1.38, 'navigational', 10, 8, 10, 8],
  ['soc service providers in india', INDIA, 140, 41, 1.33, 'navigational', 7, 'b', 7, 'b'],
];

const BASE = ROWS.map(([keyword, group, volume, kd, cpc, intent, desktop, mobile, desktopBefore, mobileBefore], index) => ({
  id: `kw${index}`,
  keyword,
  group,
  country: 'India',
  archived: false,
  priority: 3,
  volume,
  kd: typeof kd === 'number' ? kd : null,
  cpc,
  intent,
  ranks: { desktop, mobile },
  before: { desktop: desktopBefore, mobile: mobileBefore },
}));

// Two keywords that were archived, so the archived view has something to show
const ARCHIVED = [
  ['soc dashboard software', SERVICE, 480, 22, 3.4, 'commercial', 'b', 'b', 'b', 'b'],
  ['soc audit checklist', SERVICE, 170, 15, 1.2, 'informational', 'b', 'b', 'b', 'b'],
].map(([keyword, group, volume, kd, cpc, intent, desktop, mobile, desktopBefore, mobileBefore], index) => ({
  id: `ar${index}`,
  keyword,
  group,
  country: 'India',
  archived: true,
  priority: 3,
  volume,
  kd,
  cpc,
  intent,
  ranks: { desktop, mobile },
  before: { desktop: desktopBefore, mobile: mobileBefore },
}));

/** Everything the page shows and changes. A reload starts from these fixtures again, as in the rest of the preview. */
export const store = {
  keywords: [...BASE, ...ARCHIVED],
  groups: GROUPS.map((group) => ({ ...group })),
  updated: 'Updated 2h ago',
  next: 1,
};

/** Keywords that belong to no group (a group was deleted, or one was never picked) are listed under this name. */
export const UNGROUPED = 'Not grouped';
/** The countries a keyword can be tracked in (the app offers every country the provider has). */
export const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Germany', 'Australia', 'Canada', 'United Arab Emirates', 'Singapore'];

/** The countries the project has active keywords in, the one with most keywords first: what the country choices list. */
export function usedCountries() {
  const counts = new Map();
  store.keywords.filter((keyword) => !keyword.archived).forEach((keyword) => counts.set(keyword.country, (counts.get(keyword.country) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/** The demo plan's room for tracked keywords (a keyword in a country on a device is one). The product's limit is higher. */
export const PLAN_LIMIT = 500;

/** The tracked keywords in use: each keyword in a country counts once for each device it is tracked on. */
export const trackedCount = () =>
  store.keywords.filter((keyword) => !keyword.archived).reduce((total, keyword) => total + ['desktop', 'mobile'].filter((device) => keyword.ranks[device] !== 'n').length, 0);

/** The cost of one check through the standard queue at depth 100, with the asynchronous AI Overview (docs/27). */
export const CHECK_COST_USD = 0.0066;

export const groupNames = () => store.groups.map((group) => group.name);
export const byIds = (ids) => store.keywords.filter((keyword) => ids.has(keyword.id));

/** A deterministic 30-point series that ends near `end`, for a trend (a rank, or the average rank of a group). */
export function series(end, seed) {
  let value = end + 6;
  return Array.from({ length: 30 }, (_, index) => {
    const wobble = Math.sin((index + seed) * 1.7) * 1.4 + Math.cos((index * seed) / 5) * 0.8;
    value += (end - value) / (30 - index) + wobble * 0.15;
    return Math.max(1, value);
  });
}

/**
 * Adds keywords typed one to a line. A keyword already tracked in the country is skipped; the rest wait for their
 * first check on the devices chosen.
 * @returns {{added: number, skipped: number}}
 */
export function addKeywords(text, { group, country, devices }) {
  const known = new Set(store.keywords.filter((keyword) => keyword.country === country).map((keyword) => keyword.keyword));
  let added = 0;
  let skipped = 0;
  text
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
    .forEach((keyword) => {
      if (known.has(keyword)) {
        skipped += 1;
        return;
      }
      known.add(keyword);
      added += 1;
      const rank = (device) => (devices.includes(device) ? 'p' : 'n');
      store.keywords.push({
        id: `new${store.next++}`,
        keyword,
        group: group === UNGROUPED ? null : group,
        country,
        archived: false,
        priority: 3,
        volume: 0,
        kd: null,
        cpc: 0,
        intent: 'unknown',
        ranks: { desktop: rank('desktop'), mobile: rank('mobile') },
        before: { desktop: rank('desktop'), mobile: rank('mobile') },
      });
    });
  return { added, skipped };
}

/**
 * Adds keywords typed one to a line in every country chosen: a keyword is tracked once in each country, and each
 * of those is checked on each device chosen, so 12 keywords in 2 countries on 2 devices are 48 checks a day.
 * @returns {{keywords: number, added: number, skipped: number, countries: number, checks: number}}
 */
export function addTracked(text, { group, countries, devices }) {
  let added = 0;
  let skipped = 0;
  countries.forEach((country) => {
    const result = addKeywords(text, { group, country, devices });
    added += result.added;
    skipped += result.skipped;
  });
  const keywords = new Set(text.split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean)).size;
  return { keywords, added, skipped, countries: countries.length, devices: devices.length, checks: added * devices.length };
}

export function moveKeywords(ids, group) {
  byIds(ids).forEach((keyword) => {
    keyword.group = group === UNGROUPED ? null : group;
  });
}

export function archiveKeywords(ids, archived) {
  byIds(ids).forEach((keyword) => {
    keyword.archived = archived;
  });
}

export function deleteKeywords(ids) {
  store.keywords = store.keywords.filter((keyword) => !ids.has(keyword.id));
}

export function addGroup(name) {
  store.groups.push({ name, note: 'A group you made.' });
}

export function renameGroup(from, to) {
  store.groups.find((group) => group.name === from).name = to;
  store.keywords.forEach((keyword) => {
    if (keyword.group === from) keyword.group = to;
  });
}

/** Deleting a group keeps its keywords: they are listed as not grouped. */
export function deleteGroup(name) {
  store.groups = store.groups.filter((group) => group.name !== name);
  store.keywords.forEach((keyword) => {
    if (keyword.group === name) keyword.group = null;
  });
}

/** A check now: each rank on a device that is tracked moves a little, and the ranks before are kept for the arrows. */
export function recheck(ids) {
  const tick = store.next++;
  byIds(ids).forEach((keyword, index) => {
    ['desktop', 'mobile'].forEach((device) => {
      const rank = keyword.ranks[device];
      if (rank === 'n') return;
      keyword.before[device] = rank === 'p' ? 'b' : rank;
      if (rank === 'p') keyword.ranks[device] = ((index * 7 + tick * 3) % 40) + 20;
      else if (typeof rank === 'number') keyword.ranks[device] = Math.max(1, rank + ((index + tick + (device === 'mobile' ? 1 : 0)) % 5) - 2);
    });
    if (keyword.volume === 0) {
      keyword.volume = 20 + ((index * 13) % 90);
      keyword.kd = 8 + ((index * 5) % 40);
      keyword.cpc = 1 + (index % 6);
      keyword.intent = 'commercial';
    }
  });
  store.updated = 'Updated just now';
}
