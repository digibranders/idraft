/* global setTimeout, setInterval, clearInterval */
/**
 * Rankings for the static preview: one illustrative project, Fynix (fynix.digital, a German agency), with 62
 * keywords (56 with metrics, 3 pending, 3 archived), its groups, tag vocabularies, the plan room and the manual
 * refresh allowance. Everything lives in memory: a reload starts from these fixtures again. Edits, imports and
 * refreshes behave as the product does, but nothing is saved.
 */

export const DAY = 86400000;
export const MINUTE = 60000;
/** The demo's room. The product's plan limit is 5,000 active keywords. */
export const PLAN_LIMIT = 120;
export const RUNS_PER_DAY = 20;
export const PAGE_SIZE = 50;
export const GROUP_SEP = ' / ';
/** Pending keywords get their metrics this long after they were added. */
const METRICS_DELAY = 2 * MINUTE;
const REFRESH_TICK = 5000;

export const LOCATIONS = [
  [2276, 'Germany'],
  [2840, 'United States'],
];
export const DEVICES = [
  ['desktop', 'Desktop'],
  ['mobile', 'Mobile'],
];
export const LANGUAGES = [
  ['en', 'English'],
  ['de', 'German'],
];
export const INTENTS = [
  ['informational', 'Informational'],
  ['navigational', 'Navigational'],
  ['commercial', 'Commercial'],
  ['transactional', 'Transactional'],
  ['local', 'Local'],
  ['unknown', 'Unknown'],
];
export const STAGES = [
  ['tofu', 'TOFU'],
  ['mofu', 'MOFU'],
  ['bofu', 'BOFU'],
  ['retention', 'Retention'],
  ['unknown', 'Unknown'],
];
export const DEPTHS = [
  ['light', 'Light'],
  ['standard', 'Standard'],
  ['deep', 'Deep'],
  ['full', 'Full'],
  ['weekly', 'Weekly'],
  ['weekly_light', 'Weekly light'],
];
export const SOURCES = [
  ['manual', 'Manual'],
  ['csv_import', 'CSV import'],
  ['paste', 'Paste'],
  ['api', 'API'],
  ['gsc_import', 'Search Console'],
  ['discovery', 'Discovery'],
];
export const TAG_VOCABULARIES = {
  Topics: ['SEO', 'SEO > Technical SEO', 'SEO > Local SEO', 'Content Marketing', 'Content Marketing > Blog Strategy', 'Paid Search'],
  Services: ['SEO Audit', 'Content Strategy', 'Link Building'],
};

export const labelOf = (list, code) => list.find(([value]) => value === code)?.[1] ?? code;
export const locationName = (code) => labelOf(LOCATIONS, code);
export const allTags = () => Object.entries(TAG_VOCABULARIES).flatMap(([vocab, terms]) => terms.map((term) => `${vocab}: ${term}`));

// -------------------------------------------------------------------------------------------------
// Fixtures. [keyword, location, device, language, volume, kd, cpc, intent, priority, group, tags,
//            rank now, rank before, best, overrides]. A rank is a number, 'b' (beyond the depth),
//            'p' (pending, first check not run) or 'f' (check failed).

const G_LOCAL = 'Local';
const G_BRAND = 'Brand';
const G_AUDIT = 'Services / SEO audits';
const G_CONTENT = 'Services / Content';
const T_TECH = 'Topics: SEO > Technical SEO';
const T_LOCAL = 'Topics: SEO > Local SEO';
const T_CONTENT = 'Topics: Content Marketing';
const T_SEO = 'Topics: SEO';

const FIXTURE = [
  ['seo agency berlin', 2276, 'desktop', 'de', 1900, 54, 18.4, 'commercial', 1, G_LOCAL, [], 3, 5, 2, { src: 'manual', stage: 'bofu', target: '/leistungen/seo-agentur-berlin' }],
  ['keyword research', 2276, 'desktop', 'de', 18100, 74, 5.9, 'informational', 2, G_CONTENT, [T_CONTENT], 9, 7, 6, { url: '/blog/keyword-recherche' }],
  ['fynix', 2276, 'desktop', 'de', 320, 8, 0.9, 'navigational', 4, G_BRAND, [], 1, 1, 1, { src: 'manual', stage: 'retention', url: '/' }],
  ['backlink checker', 2840, 'desktop', 'en', 22200, 81, 6.9, 'transactional', 3, G_AUDIT, ['Services: Link Building'], 'b', 'b', 17, { url: '/tools/backlink-checker' }],
  ['seo agency', 2840, 'desktop', 'en', 33100, 79, 24.1, 'commercial', 1, G_AUDIT, [], 14, 12, 11, { src: 'manual', depth: 'deep', url: '/' }],
  ['technische seo audit', 2276, 'desktop', 'de', 1300, 38, 9.2, 'commercial', 1, G_AUDIT, ['Services: SEO Audit', T_TECH], 6, 9, 6, { url: '/leistungen/technische-seo-audit' }],
  ['seo audit kosten', 2276, 'desktop', 'de', 880, 33, 12.4, 'commercial', 2, G_AUDIT, ['Services: SEO Audit'], 11, 'b', 11, { url: '/leistungen/seo-audit' }],
  ['seo beratung berlin', 2276, 'desktop', 'de', 720, 47, 15.6, 'commercial', 1, G_LOCAL, [], 4, 4, 3, { url: '/standorte/berlin' }],
  ['seo agentur münchen', 2276, 'desktop', 'de', 1600, 52, 16.2, 'commercial', 2, G_LOCAL, [], 'b', 14, 13, { url: '/standorte/muenchen' }],
  ['seo agentur hamburg', 2276, 'desktop', 'de', 480, 41, 14.8, 'commercial', 3, G_LOCAL, [], 8, 10, 8, { url: '/standorte/hamburg' }],
  ['seo agentur köln', 2276, 'desktop', 'de', 390, 38, 13.1, 'commercial', 3, G_LOCAL, [], 19, 22, 17, { url: '/standorte/koeln' }],
  ['content marketing agentur', 2276, 'desktop', 'de', 1900, 61, 11.3, 'commercial', 2, G_CONTENT, ['Services: Content Strategy'], 12, 15, 12, { url: '/leistungen/content-marketing' }],
  ['content strategie beispiel', 2276, 'desktop', 'de', 260, 22, 3.1, 'informational', 4, G_CONTENT, [T_CONTENT], 5, 5, 4, { src: 'paste', url: '/blog/content-strategie' }],
  ['blogartikel schreiben', 2276, 'desktop', 'de', 1000, 29, 2.4, 'informational', 3, G_CONTENT, ['Topics: Content Marketing > Blog Strategy'], 'b', 'b', 22, { url: '/blog/blogartikel' }],
  ['linkaufbau agentur', 2276, 'desktop', 'de', 590, 58, 19.7, 'commercial', 2, G_AUDIT, ['Services: Link Building'], 'b', 18, 16, { url: '/leistungen/linkaufbau' }],
  ['backlinks kaufen', 2276, 'desktop', 'de', 2400, 49, 4.2, 'transactional', 4, G_AUDIT, ['Services: Link Building'], 'b', 'b', 33, { url: '/leistungen/linkaufbau' }],
  ['seo tools vergleich', 2276, 'desktop', 'de', 1100, 44, 6.4, 'commercial', 3, G_CONTENT, [], 9, 10, 8, { url: '/blog/seo-tools-vergleich' }],
  ['seo checkliste', 2276, 'desktop', 'de', 2900, 27, 2.1, 'informational', 3, G_CONTENT, [T_SEO], 2, 3, 2, { url: '/blog/seo-checkliste', urls: ['/blog/seo-checkliste', '/leistungen/seo-audit'] }],
  ['core web vitals', 2276, 'desktop', 'de', 3600, 46, 3.8, 'informational', 2, G_AUDIT, [T_TECH], 8, 14, 7, { url: '/blog/core-web-vitals' }],
  ['lighthouse score verbessern', 2276, 'desktop', 'de', 320, 21, 1.9, 'informational', 4, G_AUDIT, [T_TECH], 'f', null, null, { url: '/blog/lighthouse' }],
  ['schema markup generator', 2840, 'desktop', 'en', 2400, 37, 4.5, 'informational', 4, G_AUDIT, [T_TECH], 'b', 'b', 24, { url: '/tools/schema-generator' }],
  ['robots txt erstellen', 2276, 'mobile', 'de', 1900, 18, 1.2, 'informational', 5, G_AUDIT, [T_TECH], 3, 3, 3, { url: '/blog/robots-txt' }],
  ['hreflang generator', 2276, 'desktop', 'de', 480, 14, 1.1, 'informational', 5, G_AUDIT, [T_TECH], 1, 2, 1, { url: '/tools/hreflang' }],
  ['lokale seo tipps', 2276, 'desktop', 'de', 210, 17, 2.3, 'informational', 4, G_LOCAL, [T_LOCAL], 7, 'b', 7, { url: '/blog/lokale-seo' }],
  ['google business profil optimieren', 2276, 'desktop', 'de', 1300, 26, 4.8, 'commercial', 3, G_LOCAL, [T_LOCAL], 12, 9, 9, { url: '/blog/google-business-profil' }],
  ['lokales seo berlin', 2276, 'desktop', 'de', 170, 31, 9.4, 'commercial', 3, G_LOCAL, [T_LOCAL], 2, 2, 2, { url: '/standorte/berlin' }],
  ['paid search agentur', 2276, 'desktop', 'de', 1000, 63, 17.9, 'commercial', 3, G_CONTENT, ['Topics: Paid Search'], 'b', 'b', 26, { url: '/leistungen/paid-search' }],
  ['google ads betreuung', 2276, 'desktop', 'de', 880, 55, 14.2, 'commercial', 4, G_CONTENT, ['Topics: Paid Search'], 'b', 'b', 19, { url: '/leistungen/google-ads' }],
  ['seo kosten', 2276, 'desktop', 'de', 1600, 48, 12.9, 'commercial', 1, G_AUDIT, ['Services: SEO Audit'], 10, 12, 10, { src: 'gsc_import', url: '/leistungen/seo-kosten' }],
  ['seo preis', 2276, 'desktop', 'de', 390, 43, 11.6, 'commercial', 2, G_AUDIT, [], 13, 13, 11, { url: '/leistungen/seo-kosten' }],
  ['was ist seo', 2276, 'desktop', 'de', 9900, 33, 1.6, 'informational', 4, G_CONTENT, [T_SEO], 'b', 'b', 16, { url: '/blog/was-ist-seo' }],
  ['was kostet seo', 2276, 'desktop', 'de', 1300, 29, 9.1, 'informational', 3, G_CONTENT, [], 16, 19, 15, { url: '/blog/was-kostet-seo' }],
  ['seo für startups', 2276, 'desktop', 'de', 210, 12, 6.2, 'commercial', 4, G_CONTENT, [], 4, 'b', 4, { url: '/blog/seo-startups' }],
  ['e-commerce seo', 2276, 'desktop', 'de', 1600, 56, 9.8, 'commercial', 2, G_AUDIT, ['Services: SEO Audit'], 'b', 'b', 31, { url: '/leistungen/ecommerce-seo' }],
  ['shopify seo', 2276, 'desktop', 'de', 2400, 39, 7.2, 'commercial', 3, G_AUDIT, [], 15, 17, 14, { url: '/blog/shopify-seo' }],
  ['seo für wordpress', 2276, 'desktop', 'de', 1900, 41, 4.9, 'informational', 3, G_CONTENT, [], 3, 4, 3, { url: '/blog/seo-wordpress' }],
  ['seo für wordpress', 2276, 'mobile', 'de', 1900, 41, 4.9, 'informational', 3, G_CONTENT, [], 5, 3, 3, { src: 'discovery', url: '/blog/seo-wordpress' }],
  ['interne verlinkung', 2276, 'desktop', 'de', 720, 19, 2, 'informational', 4, G_AUDIT, [T_TECH], 11, 8, 8, { url: '/blog/interne-verlinkung' }],
  ['hreflang tags', 2840, 'desktop', 'en', 2900, 22, 1.5, 'informational', 5, G_AUDIT, [T_TECH], 2, 2, 2, { url: '/blog/hreflang' }],
  ['seo agency new york', 2840, 'desktop', 'en', 880, 58, 22.4, 'commercial', 3, G_LOCAL, [], 'b', 'b', 28, { url: '/' }],
  ['seo consultant', 2840, 'desktop', 'en', 6600, 71, 19.8, 'commercial', 2, G_AUDIT, [], 18, 21, 18, { url: '/' }],
  ['technical seo checklist', 2840, 'desktop', 'en', 1300, 34, 5.6, 'informational', 3, G_AUDIT, [T_TECH], 7, 7, 5, { url: '/blog/technical-seo-checklist' }],
  ['local seo guide', 2840, 'desktop', 'en', 3600, 44, 6.1, 'informational', 3, G_LOCAL, [T_LOCAL], 9, 5, 5, { url: '/blog/local-seo-guide' }],
  ['content marketing strategy', 2840, 'desktop', 'en', 4400, 57, 11.4, 'commercial', 2, G_CONTENT, ['Services: Content Strategy'], 'b', 'b', 15, { url: '/leistungen/content-marketing' }],
  ['backlink audit', 2840, 'desktop', 'en', 1600, 52, 10.9, 'commercial', 3, G_AUDIT, ['Services: Link Building'], 16, 'b', 16, { url: '/leistungen/linkaufbau' }],
  ['keyword research tool', 2840, 'desktop', 'en', 27100, 83, 6.2, 'commercial', 3, G_CONTENT, [], 'f', null, null, { src: 'api', url: '/tools/keyword-research' }],
  ['seo agency usa', 2840, 'desktop', 'en', 1300, 60, 21.9, 'commercial', 3, G_LOCAL, [], 14, 13, 11, { url: '/' }],
  ['best seo agency', 2840, 'desktop', 'en', 2400, 66, 24.8, 'commercial', 2, G_AUDIT, [], 'b', 'b', 22, { url: '/' }],
  ['seo agency berlin', 2276, 'mobile', 'de', 1900, 54, 18.4, 'commercial', 1, G_LOCAL, [], 5, 7, 4, { src: 'discovery', url: '/leistungen/seo-agentur-berlin' }],
  ['fynix seo', 2276, 'desktop', 'de', 210, 9, 0.6, 'navigational', 5, G_BRAND, [], 1, 1, 1, { url: '/' }],
  ['fynix agentur', 2276, 'desktop', 'de', 40, 6, 0.4, 'navigational', 5, G_BRAND, [], 3, 2, 2, { url: '/' }],
  ['seo agentur für handwerk', 2276, 'desktop', 'de', 110, 15, 8.9, 'commercial', 4, G_LOCAL, [], 5, 9, 5, { url: '/branchen/handwerk' }],
  ['seo tools', 2276, 'desktop', 'de', 14800, 70, 7.6, 'commercial', 3, G_CONTENT, [], 18, 'b', 18, { url: '/blog/seo-tools' }],
  ['seo meta description', 2276, 'desktop', 'de', 2400, 23, 1.4, 'informational', 4, G_AUDIT, [T_SEO], 4, 4, 4, { url: '/blog/meta-description', age: 30 }],
  ['seo title tags', 2276, 'desktop', 'de', 1000, 21, 1.3, 'informational', 5, G_AUDIT, [T_SEO], 6, 8, 6, { url: '/blog/title-tags', age: 40 }],
  ['seo ranking', 2276, 'desktop', 'de', 1600, 42, 4, 'informational', 4, G_CONTENT, [], 6, 7, 6, { url: '/blog/seo-ranking' }],
  ['generative engine optimization', 2840, 'desktop', 'en', null, null, null, 'unknown', 3, G_CONTENT, [T_SEO], 'p', null, null, { added: 1, src: 'manual' }],
  ['llm seo', 2840, 'desktop', 'en', null, null, null, 'unknown', 3, G_CONTENT, [T_SEO], 'p', null, null, { added: 1, src: 'manual' }],
  ['chatgpt seo agency', 2840, 'desktop', 'en', null, null, null, 'unknown', 2, G_AUDIT, [], 'p', null, null, { added: 1, src: 'paste' }],
  ['seo newsletter', 2276, 'desktop', 'de', 90, 9, 0.8, 'informational', 5, G_BRAND, [], 'b', 'b', 40, { archived: true, age: 60, src: 'csv_import' }],
  ['seo meme', 2276, 'desktop', 'de', 40, 4, 0.2, 'informational', 5, G_BRAND, [], 'b', 'b', 50, { archived: true, age: 60, src: 'csv_import' }],
  ['wordpress seo plugin', 2840, 'desktop', 'en', 40500, 84, 13.5, 'commercial', 4, G_CONTENT, [], 'b', 'b', 30, { archived: true, age: 60, src: 'api' }],
];

const hash = (text) => {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
  return h;
};

/** Metrics for a keyword that has none yet (mock of Labs' answer). */
export function metricsFor(keyword) {
  const h = hash(keyword);
  return {
    volume: 40 + (h % 9000),
    kd: 5 + ((h >>> 5) % 80),
    cpc: Math.round((0.4 + ((h >>> 9) % 2200) / 100) * 100) / 100,
  };
}

/** Twelve months of volume, ending this month, with a mild seasonal shape. */
export function monthlyVolumes(kw) {
  const now = new Date();
  const base = kw.volume ?? 0;
  return Array.from({ length: 12 }, (_, index) => {
    const month = (now.getUTCMonth() - 11 + index + 12) % 12;
    const wave = 1 + 0.22 * Math.sin((month + (hash(kw.keyword) % 7)) * 0.52);
    return Math.round((base * wave) / 10) * 10;
  });
}

function create(fields) {
  const added = Date.now() - (fields.addedDays ?? 120) * DAY;
  return {
    id: 0,
    keyword: '',
    location: 2276,
    device: 'desktop',
    language: 'de',
    volume: null,
    kd: null,
    cpc: null,
    intent: 'unknown',
    intentManual: false,
    priority: 3,
    group: null,
    tags: [],
    target: null,
    urls: [],
    cur: 'p',
    prev: null,
    best: null,
    checkedAt: Date.now() - 6 * 3600000,
    stage: 'mofu',
    source: 'csv_import',
    depth: 'standard',
    added,
    metricsAt: null,
    archived: false,
    history: [{ version: 1, at: added, depth: 'standard', reason: null }],
    ...fields,
  };
}

let nextId = 1;
const keywords = FIXTURE.map(([keyword, location, device, language, volume, kd, cpc, intent, priority, group, tags, cur, prev, best, extra = {}]) => {
  const pending = volume === null;
  const urlPath = extra.url ?? `/blog/${keyword.replace(/\s+/g, '-')}`;
  const record = create({
    id: nextId,
    keyword,
    location,
    device,
    language,
    volume,
    kd,
    cpc,
    intent: pending ? 'unknown' : intent,
    priority,
    group,
    tags,
    target: extra.target ?? null,
    urls: pending || cur === 'f' ? [] : extra.urls ?? [urlPath],
    cur,
    prev,
    best,
    checkedAt: Date.now() - (nextId % 9 + 1) * 3600000,
    stage: extra.stage ?? 'mofu',
    source: extra.src ?? 'csv_import',
    depth: extra.depth ?? 'standard',
    addedDays: extra.added ?? 120,
    metricsAt: pending ? null : Date.now() - (extra.age ?? 2) * DAY,
    archived: Boolean(extra.archived),
  });
  nextId += 1;
  return record;
});

// Keywords that a fixture added recently still wait for metrics; the timer below brings them in.
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const all = () => keywords;
export const byId = (id) => keywords.find((kw) => kw.id === id) ?? null;
export const activeCount = () => keywords.filter((kw) => !kw.archived).length;
export const roomLeft = () => PLAN_LIMIT - activeCount();
export const dedupeKey = (keyword, location, device) => `${keyword.trim().toLowerCase()}|${location}|${device}`;
export const findTracked = (keyword, location, device) => keywords.find((kw) => dedupeKey(kw.keyword, kw.location, kw.device) === dedupeKey(keyword, location, device)) ?? null;

function arriveMetrics(id) {
  const kw = byId(id);
  if (!kw || kw.metricsAt !== null) return;
  Object.assign(kw, { ...metricsFor(kw.keyword), intent: 'informational', metricsAt: Date.now() });
  changed();
}
keywords.filter((kw) => kw.metricsAt === null).forEach((kw) => setTimeout(() => arriveMetrics(kw.id), METRICS_DELAY));

/** Adds keywords as pending rows; the caller has checked the plan room and duplicates. */
export function addRecords(entries, { source = 'manual', group = null } = {}) {
  const created = entries.map((entry) => {
    nextId += 1;
    const kw = create({
      id: nextId - 1,
      keyword: entry.keyword,
      location: entry.location,
      device: entry.device,
      language: entry.language ?? 'de',
      priority: entry.priority ?? 3,
      group: entry.group ?? group,
      tags: entry.tags ?? [],
      target: entry.target ?? null,
      intent: entry.intent ?? 'unknown',
      source,
      addedDays: 0,
    });
    keywords.push(kw);
    setTimeout(() => arriveMetrics(kw.id), METRICS_DELAY);
    return kw;
  });
  changed();
  return created;
}

export function updateRecords(ids, patch) {
  const set = new Set(ids);
  keywords.forEach((kw) => {
    if (set.has(kw.id)) Object.assign(kw, typeof patch === 'function' ? patch(kw) : patch);
  });
  changed();
}

/** Archives or unarchives, and returns what each keyword was, so an Undo can put it back. */
export function setArchived(ids, archived) {
  const set = new Set(ids);
  const before = keywords.filter((kw) => set.has(kw.id)).map((kw) => ({ id: kw.id, archived: kw.archived }));
  updateRecords(ids, { archived });
  return before;
}

export function restoreArchived(before) {
  before.forEach(({ id, archived }) => {
    const kw = byId(id);
    if (kw) kw.archived = archived;
  });
  changed();
}

/** Deleted keywords keep their history: adding one again brings it back with its settings (see takeDeleted). */
const deleted = [];

export function removeRecords(ids) {
  const set = new Set(ids);
  for (let index = keywords.length - 1; index >= 0; index -= 1) {
    if (set.has(keywords[index].id)) deleted.push(...keywords.splice(index, 1));
  }
  changed();
}

export function takeDeleted(keyword, location, device) {
  const key = dedupeKey(keyword, location, device);
  const index = deleted.findIndex((kw) => dedupeKey(kw.keyword, kw.location, kw.device) === key);
  if (index === -1) return null;
  const [kw] = deleted.splice(index, 1);
  kw.archived = false;
  keywords.push(kw);
  changed();
  return kw;
}

export function changeDepth(id, depth, reason) {
  const kw = byId(id);
  if (!kw) return;
  kw.history.push({ version: kw.history.length + 1, at: Date.now(), depth, reason });
  kw.depth = depth;
  changed();
}

// -------------------------------------------------------------------------------------------------
// Groups: paths such as "Services / SEO audits". Keywords sit in leaf groups only.

let groupPaths = ['Services', 'Services / SEO audits', 'Services / Content', 'Local', 'Brand'];
export const groupList = () => [...groupPaths];
export const hasGroup = (path) => groupPaths.includes(path);
export const groupDepth = (path) => path.split(GROUP_SEP).length;
export const childrenOf = (path) => groupPaths.filter((item) => item.startsWith(path === null ? '' : `${path}${GROUP_SEP}`) && item.split(GROUP_SEP).length === (path === null ? 1 : groupDepth(path) + 1));
export const isWithin = (path, ancestor) => path === ancestor || path.startsWith(`${ancestor}${GROUP_SEP}`);

/** Keywords in the group, subgroups included, that are not archived. */
export const keywordCountOf = (path) => keywords.filter((kw) => !kw.archived && kw.group !== null && isWithin(kw.group, path)).length;

export function addGroup(path) {
  groupPaths = [...groupPaths, path];
  changed();
}

export function renameGroup(path, name) {
  const parent = path.split(GROUP_SEP).slice(0, -1).join(GROUP_SEP);
  const next = parent ? `${parent}${GROUP_SEP}${name}` : name;
  const swap = (value) => (value === path || value.startsWith(`${path}${GROUP_SEP}`) ? next + value.slice(path.length) : value);
  groupPaths = groupPaths.map(swap);
  keywords.forEach((kw) => {
    if (kw.group !== null) kw.group = swap(kw.group);
  });
  changed();
}

export function moveGroup(path, target) {
  const name = path.split(GROUP_SEP).at(-1);
  const next = target === null ? name : `${target}${GROUP_SEP}${name}`;
  const swap = (value) => (value === path || value.startsWith(`${path}${GROUP_SEP}`) ? next + value.slice(path.length) : value);
  groupPaths = groupPaths.map(swap);
  keywords.forEach((kw) => {
    if (kw.group !== null) kw.group = swap(kw.group);
  });
  changed();
}

/** Deletes the group and its subgroups; their keywords stay tracked and leave the group. */
export function deleteGroup(path) {
  groupPaths = groupPaths.filter((item) => !isWithin(item, path));
  keywords.forEach((kw) => {
    if (kw.group !== null && isWithin(kw.group, path)) kw.group = null;
  });
  changed();
}

/** Height of the subtree under a group, counted from the group itself (1 for a leaf). */
export function subtreeHeight(path) {
  const below = groupPaths.filter((item) => isWithin(item, path)).map((item) => groupDepth(item) - groupDepth(path) + 1);
  return Math.max(0, ...below);
}

// -------------------------------------------------------------------------------------------------
// Manual metric refresh: one run at a time, progress polled every 5 seconds in the mock.

let run = null;
let runTimer = null;
export const currentRun = () => run;

export function startRefresh(ids, onDone) {
  if (run) return false;
  run = { total: ids.length, done: 0, ids };
  runTimer = setInterval(() => {
    run.done = Math.min(run.total, run.done + Math.max(1, Math.ceil(run.total / 3)));
    if (run.done >= run.total) {
      const finished = run;
      clearInterval(runTimer);
      runTimer = null;
      run = null;
      finished.ids.forEach((id) => {
        const kw = byId(id);
        if (kw && !kw.archived) Object.assign(kw, { ...metricsFor(`${kw.keyword}${Date.now()}`), metricsAt: Date.now() });
      });
      changed();
      onDone?.(finished.total);
    } else changed();
  }, REFRESH_TICK);
  changed();
  return true;
}
