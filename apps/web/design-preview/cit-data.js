/**
 * Data of the Citations page (route #/citations): which pages AI answers cite, for which prompts, and where competitors
 * are cited while the own site is not.
 *
 * No DOM: this module loads in Node, which is how its totals are checked (cit-data.check.mjs). Every answer is one
 * observation of the Prompts fixture (prompts-data.js), so "cited" and "named" agree with the Prompts page. The pages an
 * answer cites (own pages, competitor pages, third-party pages) are drawn here with seeded randomness, so they are the
 * same on every load. In the app these come from the citation routes (C13).
 *
 * Counting rules (the page's info texts say the same):
 * - A citation is one URL in one answer's source list, counted once per answer.
 * - Rates over All platforms are the equal-weight average of the platforms, never pooled (spec D2 of the Overview).
 * - "Runs" is the last 1, 2 or 4 weekly runs. The change compares them with the same number of runs before them.
 */
import { equalWeightAverage, isDetectableChange } from './vendor/stats/index.js';
import { COMPETITORS, OWN, observationsOf, seeded, shuffled } from './prompts-data.js';
import { competitorId, platformsIn, promptsIn } from './aiov-data.js';

export const OWN_DOMAIN = 'northwind.com';
export const OWN_NAME = OWN;
/** The weekly runs of the window (run index 0 to 3) and of the four runs before it. */
export const RUN_DAYS = ['Sep 7', 'Sep 14', 'Sep 21', 'Sep 28'];
const PREVIOUS_DAYS = ['Aug 10', 'Aug 17', 'Aug 24', 'Aug 31'];
export const RUN_CHOICES = [
  { id: 4, label: 'Last 4 runs' },
  { id: 2, label: 'Last 2 runs' },
  { id: 1, label: 'Last run' },
];
export const MAX_COMPETITORS = 5;
export const TRACKED = COMPETITORS.map((competitor) => ({ ...competitor, id: competitorId(competitor) }));
export const trackedOf = (id) => TRACKED.find((competitor) => competitor.id === id);
export const DEFAULT_COMPETITORS = TRACKED.slice(0, 3).map((competitor) => competitor.id);

const hashOf = (text) => [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7);
const rng = (text) => seeded(hashOf(text));
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// -------------------------------------------------------------------------------------------------
// Pages: own, competitor, third party

/** The own pages AI answers cite, and the topics each one answers. A page can serve several topics. */
const OWN_PAGES = [
  { path: '/pricing', title: 'Pricing and plans', topics: ['Pricing', 'Small business', 'Startups', 'Comparisons'] },
  { path: '/blog/best-crm-for-startups', title: 'The best CRM for startups in 2026', topics: ['Startups', 'Small business'] },
  { path: '/compare/hubspot-alternative', title: 'Northwind as a HubSpot alternative', topics: ['Comparisons', 'Pricing'] },
  { path: '/features/pipeline', title: 'Visual sales pipeline', topics: ['Pipeline', 'Forecasting', 'Small business'] },
  { path: '/guides/sales-forecasting', title: 'A practical guide to sales forecasting', topics: ['Forecasting', 'Reporting'] },
  { path: '/integrations', title: 'Integrations directory', topics: ['Integrations', 'Automation', 'Email tracking'] },
  { path: '/features/email-tracking', title: 'Email tracking and templates', topics: ['Email tracking', 'Automation'] },
  { path: '/features/lead-scoring', title: 'Lead capture and scoring', topics: ['Lead management', 'Automation'] },
  { path: '/mobile', title: 'CRM mobile app', topics: ['Mobile'] },
  { path: '/help/getting-started', title: 'Getting started with Northwind', topics: ['Onboarding', 'Small business'] },
  { path: '/features/reports', title: 'Sales reports and dashboards', topics: ['Reporting', 'Forecasting'] },
  { path: '/blog/crm-for-small-business', title: 'How to choose a CRM for a small business', topics: ['Small business', 'Onboarding', 'Startups'] },
  { path: '/features/automation', title: 'Workflow automation', topics: ['Automation', 'Lead management'] },
];

/** Third-party sites answers cite, with a base weight and how each platform leans towards them. */
const THIRD_PARTY = [
  { domain: 'g2.com', weight: 9, page: (t) => `categories/crm/${slug(t)}`, title: (t) => `Best ${t} CRM software, user reviews` },
  { domain: 'reddit.com', weight: 8, page: (t) => `r/sales/comments/which_crm_for_${slug(t).replace(/-/g, '_')}`, title: (t) => `Which CRM for ${t.toLowerCase()}? (r/sales)` },
  { domain: 'capterra.com', weight: 7, page: (t) => `crm-software/${slug(t)}`, title: (t) => `${t} CRM software compared` },
  { domain: 'techradar.com', weight: 6, page: (t) => `best/best-crm-for-${slug(t)}`, title: (t) => `The best CRM for ${t.toLowerCase()}` },
  { domain: 'forbes.com', weight: 6, page: (t) => `advisor/business/software/crm-${slug(t)}`, title: (t) => `Best CRM software for ${t.toLowerCase()}, Forbes Advisor` },
  { domain: 'zapier.com', weight: 5, page: (t) => `blog/crm-${slug(t)}`, title: (t) => `The best CRM apps for ${t.toLowerCase()}` },
  { domain: 'youtube.com', weight: 4, page: (t) => `watch/crm-${slug(t)}-review`, title: (t) => `${t} CRM review (video)` },
  { domain: 'quora.com', weight: 3, page: (t) => `What-is-the-best-CRM-for-${slug(t)}`, title: (t) => `What is the best CRM for ${t.toLowerCase()}?` },
  { domain: 'pcmag.com', weight: 3, page: () => 'picks/the-best-crm-software', title: () => 'The best CRM software for 2026' },
  { domain: 'wikipedia.org', weight: 3, page: () => 'wiki/Customer_relationship_management', title: () => 'Customer relationship management' },
  { domain: 'nerdwallet.com', weight: 3, page: (t) => `article/small-business/crm-${slug(t)}`, title: (t) => `CRM for ${t.toLowerCase()}, explained` },
  { domain: 'softwareadvice.com', weight: 3, page: (t) => `crm/${slug(t)}`, title: (t) => `${t} CRM buyer guide` },
  { domain: 'trustradius.com', weight: 2, page: (t) => `crm/${slug(t)}`, title: (t) => `${t} CRM reviews and ratings` },
  { domain: 'gartner.com', weight: 2, page: () => 'reviews/market/sales-force-automation', title: () => 'Sales force automation platforms, reviews' },
  { domain: 'getapp.com', weight: 2, page: (t) => `customer-management-software/crm/${slug(t)}`, title: (t) => `${t} CRM apps` },
  { domain: 'linkedin.com', weight: 2, page: (t) => `pulse/choosing-crm-${slug(t)}`, title: (t) => `Choosing a CRM: ${t.toLowerCase()}` },
  { domain: 'medium.com', weight: 2, page: (t) => `@salesops/crm-${slug(t)}`, title: (t) => `What we learned about ${t.toLowerCase()} CRMs` },
  { domain: 'businessnewsdaily.com', weight: 2, page: (t) => `crm-${slug(t)}`, title: (t) => `CRM for ${t.toLowerCase()}, reviewed` },
  { domain: 'hbr.org', weight: 1, page: () => '2025/03/what-crm-data-can-tell-you', title: () => 'What CRM data can tell you' },
  { domain: 'investopedia.com', weight: 1, page: () => 'terms/c/customer_relation_management.asp', title: () => 'Customer relationship management (CRM)' },
];
const PLATFORM_TILT = {
  chatgpt_web: { 'reddit.com': 1.6, 'g2.com': 1.3, 'quora.com': 1.5 },
  gemini_web: { 'youtube.com': 2.2, 'wikipedia.org': 1.8, 'forbes.com': 0.7 },
  google_ai_mode: { 'forbes.com': 1.5, 'techradar.com': 1.4, 'capterra.com': 1.3 },
  google_ai_overview: { 'zapier.com': 1.6, 'nerdwallet.com': 1.5, 'reddit.com': 1.3 },
};

/** A competitor page for a topic: their pricing or comparison page, or a page of their site about the topic. */
function competitorPage(competitor, topic) {
  const path = topic === 'Pricing' ? 'pricing' : topic === 'Comparisons' ? `compare/${slug(OWN)}` : topic === 'Integrations' ? 'marketplace' : `crm/${slug(topic)}`;
  return { url: `${competitor.domain}/${path}`, title: `${competitor.name}: ${topic === 'Comparisons' ? `${competitor.name} vs ${OWN}` : topic}` };
}

/** Every page any answer can cite, by URL, with its owner. Filled as answers are drawn. */
const PAGES = new Map();
function register(url, page) {
  if (!PAGES.has(url)) PAGES.set(url, { url, domain: url.split('/')[0], path: url.slice(url.indexOf('/')) || '/', ...page });
  return url;
}
OWN_PAGES.forEach((page) => register(`${OWN_DOMAIN}${page.path}`, { owner: 'own', brand: OWN, title: page.title }));
export const pageOf = (url) => PAGES.get(url);

const ownPagesFor = (topic) => {
  const pages = OWN_PAGES.filter((page) => page.topics.includes(topic));
  return pages.length > 0 ? pages : OWN_PAGES.slice(0, 1);
};

function weightedPick(items, weightOf, random) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let left = random() * total;
  for (const item of items) {
    left -= weightOf(item);
    if (left <= 0) return item;
  }
  return items[items.length - 1];
}

// -------------------------------------------------------------------------------------------------
// Answers: one per observation of the fixture, with the pages it cites

/**
 * The answers of one prompt in one period. The current period is the fixture's observations; the previous one has
 * the same runs and replicates, with "named" and "cited" redrawn to the fixture's previous counts.
 */
function draw(prompt, period) {
  const observations = observationsOf(prompt);
  const ownChoices = ownPagesFor(prompt.topic);
  // Each prompt leans towards one of its own pages, as a real prompt keeps citing the same page
  const preferred = ownChoices[Math.floor(rng(`own|${prompt.id}`)() * Math.min(2, ownChoices.length))];
  const flagsFor = (code, field) => {
    const counts = prompt.engines[code];
    const n = observations.filter((observation) => observation.engine.code === code).length;
    const k = Math.min(n, counts[field] ?? 0);
    return shuffled([...Array.from({ length: k }, () => true), ...Array.from({ length: n - k }, () => false)], rng(`${prompt.id}|${code}|${field}`));
  };
  const previousFlags = {};
  const seen = {};
  return observations.map((observation) => {
    const code = observation.engine.code;
    const counts = prompt.engines[code];
    const random = rng(`${prompt.id}|${period}|${code}|${observation.run}|${observation.replicate}`);
    let { mentioned, cited } = observation;
    if (period === 'previous') {
      previousFlags[code] ??= { mentioned: flagsFor(code, 'prevMention'), cited: flagsFor(code, 'prevCitation') };
      seen[code] = (seen[code] ?? -1) + 1;
      mentioned = previousFlags[code].mentioned[seen[code]];
      cited = previousFlags[code].cited[seen[code]];
    }
    const own = [];
    if (cited) {
      const first = random() < 0.7 ? preferred : ownChoices[Math.floor(random() * ownChoices.length)];
      own.push(`${OWN_DOMAIN}${first.path}`);
      const second = ownChoices[Math.floor(random() * ownChoices.length)];
      if (random() < 0.18 && second !== first) own.push(`${OWN_DOMAIN}${second.path}`);
    }
    // A competitor is named in about as many answers as the fixture counts, and cited in most of those
    const rivals = TRACKED.map((competitor, index) => {
      const rate = counts.n > 0 ? (counts.competitors?.[index] ?? 0) / counts.n : 0;
      const named = random() < rate * (period === 'previous' ? 0.94 + random() * 0.12 : 1);
      const linked = named && random() < 0.64;
      const page = competitorPage(competitor, prompt.topic);
      return { id: competitor.id, mentioned: named, cited: linked, url: linked ? register(page.url, { owner: 'competitor', brand: competitor.name, title: page.title }) : null };
    });
    const pool = [...THIRD_PARTY];
    const third = [];
    for (let i = 0, count = 2 + Math.floor(random() * 3); i < count; i += 1) {
      const site = weightedPick(pool, (entry) => entry.weight * (PLATFORM_TILT[code]?.[entry.domain] ?? 1), random);
      pool.splice(pool.indexOf(site), 1);
      third.push(register(`${site.domain}/${site.page(prompt.topic)}`, { owner: 'third', brand: site.domain, title: site.title(prompt.topic) }));
    }
    return {
      promptId: prompt.id,
      topic: prompt.topic,
      code,
      run: observation.run,
      day: (period === 'previous' ? PREVIOUS_DAYS : RUN_DAYS)[Math.max(0, observation.run)],
      mentioned,
      cited: own.length > 0,
      own,
      rivals,
      third,
      urls: [...own, ...rivals.filter((rival) => rival.cited).map((rival) => rival.url), ...third],
    };
  });
}

const cache = new Map();
function answersOf(prompt) {
  if (!cache.has(prompt.id)) cache.set(prompt.id, { current: draw(prompt, 'current'), previous: draw(prompt, 'previous') });
  return cache.get(prompt.id);
}

// -------------------------------------------------------------------------------------------------
// Scope

/** The prompts of the page: core, non-branded prompts of the group, as on the Overview. */
export const promptsInScope = (scope) => promptsIn({ branded: 'exclude', group: scope.group });

/**
 * The answers in scope. The current window is the last `runs` runs; the previous one is the same number of runs
 * before them, which for four runs is the previous period.
 */
export function answersIn(scope, period = 'current') {
  const codes = new Set(platformsIn(scope));
  const runs = scope.runs;
  const out = [];
  promptsInScope(scope).forEach((prompt) => {
    const { current, previous } = answersOf(prompt);
    const source = period === 'previous' && runs === 4 ? previous : current;
    const [from, to] = period === 'current' || runs === 4 ? [4 - runs, 4] : [4 - 2 * runs, 4 - runs];
    source.forEach((answer) => {
      if (codes.has(answer.code) && answer.run >= from && answer.run < to) out.push(answer);
    });
  });
  return out;
}

// -------------------------------------------------------------------------------------------------
// Headline measures

/** Rates per platform, then their equal-weight average. The pooled counts are for the tooltip and the change test. */
function rates(answers, codes) {
  const perCode = codes.map((code) => {
    const mine = answers.filter((answer) => answer.code === code);
    const prompts = new Set(mine.map((answer) => answer.promptId));
    const covered = new Set(mine.filter((answer) => answer.cited).map((answer) => answer.promptId));
    return { code, n: mine.length, k: mine.filter((answer) => answer.cited).length, prompts: prompts.size, covered: covered.size };
  });
  const frequency = equalWeightAverage(perCode.map((entry) => (entry.n > 0 ? entry.k / entry.n : null)));
  const coverage = equalWeightAverage(perCode.map((entry) => (entry.prompts > 0 ? entry.covered / entry.prompts : null)));
  const sum = (field) => perCode.reduce((total, entry) => total + entry[field], 0);
  return { perCode, frequency, coverage, answers: { k: sum('k'), n: sum('n') }, prompts: { k: sum('covered'), n: sum('prompts') } };
}

function counts(answers) {
  const ownUrls = new Set();
  const domains = new Set();
  let citations = 0;
  answers.forEach((answer) => {
    citations += answer.own.length;
    answer.own.forEach((url) => ownUrls.add(url));
    answer.urls.forEach((url) => domains.add(url.split('/')[0]));
  });
  return { citations, urls: ownUrls.size, domains: domains.size };
}

function change(current, previous) {
  if (current.value === null || previous.value === null) return null;
  return { value: current.value - previous.value, detectable: isDetectableChange(current.pooled, previous.pooled) };
}

/** The six measures of the strip, each with its previous value. */
export function headline(scope) {
  const codes = platformsIn(scope);
  const now = answersIn(scope);
  const before = answersIn(scope, 'previous');
  const a = rates(now, codes);
  const b = rates(before, codes);
  const c = counts(now);
  const d = counts(before);
  const rate = (current, previous, field) => {
    const cell = { value: current[field].value, used: current[field].used, pooled: field === 'frequency' ? current.answers : current.prompts };
    return { ...cell, change: change(cell, { value: previous[field].value, pooled: field === 'frequency' ? previous.answers : previous.prompts }) };
  };
  return {
    answers: now.length,
    prompts: new Set(now.map((answer) => answer.promptId)).size,
    citations: { value: c.citations, previous: d.citations },
    frequency: rate(a, b, 'frequency'),
    coverage: rate(a, b, 'coverage'),
    urls: { value: c.urls, previous: d.urls },
    domains: { value: c.domains, previous: d.domains },
    perCode: a.perCode,
  };
}

// -------------------------------------------------------------------------------------------------
// Cited pages

/** One row per URL cited in scope, with what the table and the page drawer show. */
export function pageRows(scope) {
  const now = answersIn(scope);
  const before = answersIn(scope, 'previous');
  const trendNow = answersIn({ ...scope, runs: 4 });
  const trendBefore = answersIn({ ...scope, runs: 4 }, 'previous');
  const rows = new Map();
  const rowOf = (url) => {
    if (!rows.has(url)) rows.set(url, { ...pageOf(url), id: url, citations: 0, previous: 0, prompts: new Map(), engines: {}, trend: Array(8).fill(0), lastRun: -1, topics: new Set() });
    return rows.get(url);
  };
  now.forEach((answer) => {
    answer.urls.forEach((url) => {
      const row = rowOf(url);
      row.citations += 1;
      row.engines[answer.code] = (row.engines[answer.code] ?? 0) + 1;
      row.prompts.set(answer.promptId, (row.prompts.get(answer.promptId) ?? 0) + 1);
      row.topics.add(answer.topic);
      row.lastRun = Math.max(row.lastRun, answer.run);
    });
  });
  before.forEach((answer) => answer.urls.forEach((url) => rows.has(url) && (rows.get(url).previous += 1)));
  // The trend is always the last eight weekly runs, so it reads the same whatever the Runs choice
  trendBefore.forEach((answer) => answer.urls.forEach((url) => rows.has(url) && (rows.get(url).trend[answer.run] += 1)));
  trendNow.forEach((answer) => answer.urls.forEach((url) => rows.has(url) && (rows.get(url).trend[4 + answer.run] += 1)));
  return [...rows.values()].map((row) => ({ ...row, lastCited: row.lastRun >= 0 ? RUN_DAYS[row.lastRun] : null, promptCount: row.prompts.size }));
}

/** The detail of one page: per prompt and platform, how many answers cite it, and what is cited beside it. */
export function pageDetail(url, scope) {
  const now = answersIn(scope);
  const prompts = new Map(promptsInScope(scope).map((prompt) => [prompt.id, prompt]));
  const byPrompt = new Map();
  const alongside = new Map();
  let citations = 0;
  now.forEach((answer) => {
    const entry = byPrompt.get(answer.promptId) ?? { prompt: prompts.get(answer.promptId), engines: {}, cited: 0, answers: 0, lastRun: -1 };
    const cell = (entry.engines[answer.code] ??= { k: 0, n: 0 });
    cell.n += 1;
    entry.answers += 1;
    if (answer.urls.includes(url)) {
      cell.k += 1;
      entry.cited += 1;
      entry.lastRun = Math.max(entry.lastRun, answer.run);
      citations += 1;
      answer.urls.forEach((other) => {
        if (other === url) return;
        const domain = other.split('/')[0];
        const item = alongside.get(domain) ?? { domain, owner: pageOf(other).owner, brand: pageOf(other).brand, count: 0 };
        item.count += 1;
        alongside.set(domain, item);
      });
    }
    byPrompt.set(answer.promptId, entry);
  });
  const rows = [...byPrompt.values()].filter((entry) => entry.cited > 0).sort((a, b) => b.cited - a.cited || a.prompt.text.localeCompare(b.prompt.text));
  return { page: pageOf(url), citations, prompts: rows, alongside: [...alongside.values()].sort((a, b) => b.count - a.count).slice(0, 8) };
}

// -------------------------------------------------------------------------------------------------
// Gap analysis

/** A brand's state on a prompt: cited in some answers, only named, not named, or no answers. */
function stateOf(cell) {
  if (cell.n === 0) return 'none';
  if (cell.k > 0) return 'cited';
  if (cell.m > 0) return 'mentioned';
  return 'not';
}

const blank = () => ({ k: 0, m: 0, n: 0 });
function tally(cell, cited, mentioned) {
  cell.n += 1;
  if (cited) cell.k += 1;
  if (mentioned) cell.m += 1;
}

/** A brand on a prompt over the platforms in scope: the summed counts, and on how many platforms it is cited. */
function summarize(codes, cellOf) {
  const perCode = Object.fromEntries(codes.map((code) => [code, { ...cellOf(code) }]));
  Object.values(perCode).forEach((cell) => (cell.state = stateOf(cell)));
  const live = Object.values(perCode).filter((cell) => cell.n > 0);
  const total = live.reduce((sum, cell) => ({ k: sum.k + cell.k, m: sum.m + cell.m, n: sum.n + cell.n }), blank());
  return { ...total, state: stateOf(total), platforms: live.length, citedOn: live.filter((cell) => cell.k > 0).length, perCode };
}

/**
 * One row per prompt in scope: your state, the state of each selected competitor, and the gap. The gap is decided per
 * platform, as Prompt coverage is: the prompt is lost on a platform when a selected competitor is cited there and you
 * are not. Pooling the platforms would hide a prompt cited once on Gemini but lost on the other three.
 */
export function gapRows(scope) {
  const codes = platformsIn(scope);
  const now = answersIn(scope);
  const rows = new Map(
    promptsInScope(scope).map((prompt) => [prompt.id, { prompt, perCode: Object.fromEntries(codes.map((code) => [code, { you: blank(), rivals: Object.fromEntries(scope.competitors.map((id) => [id, blank()])) }])) }]),
  );
  now.forEach((answer) => {
    const cell = rows.get(answer.promptId).perCode[answer.code];
    tally(cell.you, answer.cited, answer.mentioned);
    answer.rivals.forEach((rival) => cell.rivals[rival.id] && tally(cell.rivals[rival.id], rival.cited, rival.mentioned));
  });
  return [...rows.values()]
    .map(({ prompt, perCode }) => {
      const you = summarize(codes, (code) => perCode[code].you);
      const rivals = Object.fromEntries(scope.competitors.map((id) => [id, summarize(codes, (code) => perCode[code].rivals[id])]));
      const lostOn = codes.filter((code) => perCode[code].you.n > 0 && perCode[code].you.k === 0 && Object.values(perCode[code].rivals).some((cell) => cell.k > 0));
      const lostTo = scope.competitors.filter((id) => lostOn.some((code) => perCode[code].rivals[id].k > 0));
      const rivalAnswers = Object.values(rivals).reduce((sum, cell) => sum + cell.k, 0);
      return { id: prompt.id, prompt, you, rivals, lostOn, lostTo, gap: lostOn.length, rivalAnswers };
    })
    .filter((row) => row.you.n > 0);
}

/** The detail of one prompt for the gap drawer: per platform states, the pages competitors are cited with, and leads. */
export function promptDetail(promptId, scope) {
  const now = answersIn(scope).filter((answer) => answer.promptId === promptId);
  const prompt = promptsInScope(scope).find((entry) => entry.id === promptId);
  const codes = platformsIn(scope);
  const empty = () => ({ k: 0, m: 0, n: 0 });
  const perCode = Object.fromEntries(codes.map((code) => [code, { you: empty(), rivals: Object.fromEntries(scope.competitors.map((id) => [id, empty()])) }]));
  const rivalPages = new Map();
  const thirdPages = new Map();
  const ownHere = new Map();
  now.forEach((answer) => {
    answer.own.forEach((url) => ownHere.set(url, (ownHere.get(url) ?? 0) + 1));
    const cell = perCode[answer.code];
    cell.you.n += 1;
    if (answer.cited) cell.you.k += 1;
    if (answer.mentioned) cell.you.m += 1;
    answer.rivals.forEach((rival) => {
      const target = cell.rivals[rival.id];
      if (!target) return;
      target.n += 1;
      if (rival.cited) {
        target.k += 1;
        const entry = rivalPages.get(rival.url) ?? { url: rival.url, brand: trackedOf(rival.id).name, id: rival.id, count: 0, codes: new Set() };
        entry.count += 1;
        entry.codes.add(answer.code);
        rivalPages.set(rival.url, entry);
      }
      if (rival.mentioned) target.m += 1;
    });
    answer.third.forEach((url) => {
      const entry = thirdPages.get(url) ?? { url, count: 0, codes: new Set() };
      entry.count += 1;
      entry.codes.add(answer.code);
      thirdPages.set(url, entry);
    });
  });
  Object.values(perCode).forEach((cell) => {
    cell.you.state = stateOf(cell.you);
    Object.values(cell.rivals).forEach((rival) => (rival.state = stateOf(rival)));
  });
  // Your closest page: the own page cited most for other prompts of the same topic, the one to improve first
  const closest = new Map();
  answersIn(scope).forEach((answer) => {
    if (answer.topic !== prompt.topic || answer.promptId === promptId) return;
    answer.own.forEach((url) => closest.set(url, (closest.get(url) ?? 0) + 1));
  });
  return {
    prompt,
    answers: now.length,
    perCode,
    rivalPages: [...rivalPages.values()].sort((a, b) => b.count - a.count),
    thirdPages: [...thirdPages.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    ownHere: [...ownHere.entries()].map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count),
    closest: [...closest.entries()].map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count).slice(0, 3),
  };
}
