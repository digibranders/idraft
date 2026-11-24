/**
 * The measures of the Prompts page that the generated counts of prompts-data.js do not carry: intent, search volume,
 * position, sentiment, the brands named in answers, the links answers cite, and the latest answer of an engine.
 * Everything is derived from the prompt's own counts and seed, so a number never changes between renders, and the
 * measures of a group are computed from the prompts in it, never from a copy of its own.
 *
 * In the app these come from the prompt summary read (`include=entities,sources`) and the answer store; here they are
 * labelled sample values wherever the backend does not collect them yet (sentiment, search volume).
 */
import { MIN_OBSERVATIONS, rateState } from './vendor/stats/index.js';
import { COMPETITORS, ENGINES, OWN, answerFor, clamp, engineOf, linkedKeywordOf, observationsOf, seeded } from './prompts-data.js';

// -------------------------------------------------------------------------------------------------
// Intent: a property of the prompt, the same on every engine

const INTENT_OF_TYPE = { recommendation: 'Commercial', comparison: 'Commercial', how_to: 'Informational', question: 'Informational', definition: 'Informational' };

export function intentOf(prompt) {
  if (prompt.branded) return 'Navigational';
  if (prompt.topic === 'Pricing') return 'Transactional';
  return INTENT_OF_TYPE[prompt.type] ?? 'Informational';
}

/** All intents of a prompt (lower case): its own, plus local when it names a place, and research for a comparison. */
export function intentsOf(prompt) {
  const found = new Set([intentOf(prompt).toLowerCase()]);
  if (/\b(in|near) (india|me|the middle east|west of india)\b|\bmiddle east\b/i.test(prompt.text)) found.add('local');
  if (prompt.type === 'comparison' || prompt.type === 'recommendation') found.add('informational');
  return [...found];
}

// -------------------------------------------------------------------------------------------------
// Search volume: the monthly searches of the keyword a prompt is linked to

function hashText(text) {
  let value = 7;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) % 2147483647;
  return value;
}

/** Monthly searches of the linked keyword, or null when the prompt has none. The same keyword always has the same volume. */
export function volumeOf(prompt) {
  const link = linkedKeywordOf(prompt);
  if (!link) return { value: null, keyword: null };
  const random = seeded(hashText(link.keyword));
  const low = Math.log(90);
  const high = Math.log(18000);
  return { value: Math.round(Math.exp(low + random() * (high - low)) / 10) * 10, keyword: link.keyword };
}

/** The volume of a group: each linked keyword once, however many prompts share it. */
export function groupVolume(prompts) {
  const keywords = new Map();
  prompts.forEach((prompt) => {
    const { value, keyword } = volumeOf(prompt);
    if (value !== null) keywords.set(keyword, value);
  });
  const value = keywords.size === 0 ? null : [...keywords.values()].reduce((sum, volume) => sum + volume, 0);
  return { value, keywords: keywords.size, prompts: prompts.length };
}

// -------------------------------------------------------------------------------------------------
// Position: where the brand sits in an ordered answer, 1 = named first (lower is better). Only answers that are an
// ordered list have a position, so the count of such answers always travels with the mean.

const ranksCache = new Map();
function ranksOf(prompt, code) {
  const key = `${prompt.id}:${code}`;
  if (ranksCache.has(key)) return ranksCache.get(key);
  const mentioned = observationsOf(prompt).filter((observation) => observation.engine.code === code && observation.mentioned);
  const result = { mentions: mentioned.length, ranks: mentioned.map((observation) => answerFor(prompt, observation).rank).filter((rank) => rank !== null) };
  ranksCache.set(key, result);
  return result;
}

/** An engine needs this many ordered answers before its mean position is shown. */
export const POSITION_MIN_LISTS = 2;

/**
 * The position over the prompts and engines given: each engine's own mean, then the equal-weight average of the
 * engines that have enough ordered answers (`used` of them, by `names`), never one pooled mean. `lists`, `mentions` and
 * `answers` count what the engines in scope rest on; `answers` of 0 means nothing was observed at all.
 */
export function positionOf(prompts, scope) {
  const engines = scope.map((code) => {
    let lists = 0;
    let mentions = 0;
    let sum = 0;
    let answers = 0;
    prompts.forEach((prompt) => {
      const found = ranksOf(prompt, code);
      answers += prompt.engines[code].n;
      lists += found.ranks.length;
      mentions += found.mentions;
      sum += found.ranks.reduce((total, rank) => total + rank, 0);
    });
    return { code, answers, lists, mentions, mean: lists >= POSITION_MIN_LISTS ? sum / lists : null };
  });
  const used = engines.filter((engine) => engine.mean !== null);
  const total = (key) => engines.reduce((sum, engine) => sum + engine[key], 0);
  return {
    value: used.length === 0 ? null : used.reduce((sum, engine) => sum + engine.mean, 0) / used.length,
    used: used.length,
    names: used.map((engine) => engineOf(engine.code).label),
    lists: total('lists'),
    mentions: total('mentions'),
    answers: total('answers'),
  };
}

// -------------------------------------------------------------------------------------------------
// Sentiment: the tone of the answers that name the brand, as four shares (never one score). It is classified on the
// engines that classify recommendations, and a share needs at least MIN_OBSERVATIONS classified mentions.

export const SENTIMENT_MIN = MIN_OBSERVATIONS;
const SHARES = ['positive', 'neutral', 'negative', 'mixed'];

/** Positive, neutral, negative and mixed counts of the mentions on one engine. They always add up to its mentions. */
function sentimentCounts(prompt, code) {
  const mentions = prompt.engines[code].mention;
  const random = seeded(prompt.seed + 313 + ENGINES.findIndex((engine) => engine.code === code) * 29);
  const positive = Math.round(mentions * clamp(0.3 + prompt.strength * 0.55 + (random() - 0.5) * 0.25, 0.12, 0.92));
  const negative = Math.min(mentions - positive, Math.round(mentions * clamp(0.14 - prompt.strength * 0.1 + (random() - 0.5) * 0.08, 0.01, 0.3)));
  const mixed = Math.min(mentions - positive - negative, Math.round(mentions * clamp(0.04 + random() * 0.05, 0, 0.12)));
  return { positive, neutral: mentions - positive - negative - mixed, negative, mixed };
}

/**
 * The sentiment of the prompts over the engines given: each classifying engine's four shares, then the equal-weight
 * average of the engines with at least SENTIMENT_MIN classified mentions (`used` of them, by `names`). `state` is
 * "none" when no engine in scope classifies sentiment, "unobserved" when they have no answers, "insufficient" when
 * none has enough mentions, otherwise "ok" and `shares` holds the four shares. `mentions` is what the engines rest on.
 */
export function sentimentOf(prompts, scope) {
  const classifying = scope.filter((code) => engineOf(code).recommendations);
  const engines = classifying.map((code) => {
    const counts = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
    let answers = 0;
    prompts.forEach((prompt) => {
      answers += prompt.engines[code].n;
      const found = sentimentCounts(prompt, code);
      SHARES.forEach((key) => (counts[key] += found[key]));
    });
    return { code, answers, counts, mentions: SHARES.reduce((sum, key) => sum + counts[key], 0) };
  });
  const used = engines.filter((engine) => engine.mentions >= SENTIMENT_MIN);
  const mentions = engines.reduce((sum, engine) => sum + engine.mentions, 0);
  const answers = engines.reduce((sum, engine) => sum + engine.answers, 0);
  if (classifying.length === 0) return { state: 'none', shares: null, used: 0, names: [], mentions, answers };
  if (answers === 0) return { state: 'unobserved', shares: null, used: 0, names: [], mentions, answers };
  if (used.length === 0) return { state: 'insufficient', shares: null, used: 0, names: [], mentions, answers };
  const shares = Object.fromEntries(SHARES.map((key) => [key, used.reduce((sum, engine) => sum + engine.counts[key] / engine.mentions, 0) / used.length]));
  return { state: 'ok', shares, used: used.length, names: used.map((engine) => engineOf(engine.code).label), mentions, answers };
}

// -------------------------------------------------------------------------------------------------
// Brands named in answers. The tracked competitors come from the counts; the others are brands the answers named
// that nobody tracks yet, which is what makes the list longer than the competitor set.

const OTHER_BRANDS = ['Copper', 'Insightly', 'Monday CRM', 'Close', 'Nutshell', 'Zendesk Sell', 'Keap', 'Capsule', 'Less Annoying CRM', 'Apptivo'];
/** How many brands or links a list popover shows. */
export const LIST_SIZE = 10;

/**
 * Brands a person added to the competitor list from a brands list. The entity palette has six colors (the own brand
 * and five competitors), so a brand added beyond them takes the neutral "other" color, as every chart does.
 */
const addedBrands = new Set();
export const addCompetitor = (name) => addedBrands.add(name);
export const removeCompetitor = (name) => addedBrands.delete(name);
export const isAddedCompetitor = (name) => addedBrands.has(name);

/** One count per brand for one prompt on one engine, for the answers observed. */
function entityCounts(prompt, code) {
  const engine = prompt.engines[code];
  const random = seeded(prompt.seed + 521 + ENGINES.findIndex((entry) => entry.code === code) * 31);
  return [
    { name: OWN, own: true, tracked: true, swatch: 'bg-chart-1', k: engine.mention },
    ...COMPETITORS.map((competitor, c) => ({ name: competitor.name, own: false, tracked: true, swatch: competitor.swatch, k: engine.competitors[c] })),
    ...OTHER_BRANDS.map((name, i) => ({ name, own: false, tracked: addedBrands.has(name), swatch: addedBrands.has(name) ? 'other' : null, k: clamp(Math.round(engine.n * (0.11 - i * 0.009) * (0.4 + random() * 1.2)), 0, engine.n) })),
  ];
}

/**
 * The brands named in the answers to these prompts, most named first. A brand's value is the equal-weight average of
 * the engines in scope that have enough answers, each engine prompt-weighted, like every other rate of the page.
 * `shown` is the top of the list, `own` the own brand when it is not in it.
 */
export function brandsOf(prompts, scope) {
  const rows = new Map();
  const names = [];
  let answers = 0;
  scope.forEach((code) => {
    const observed = prompts.filter((prompt) => prompt.engines[code].n > 0);
    const observations = observed.reduce((sum, prompt) => sum + prompt.engines[code].n, 0);
    if (rateState(observations) !== 'ok') return;
    names.push(engineOf(code).label);
    answers += observations;
    observed.forEach((prompt) =>
      entityCounts(prompt, code).forEach((entity) => {
        const row = rows.get(entity.name) ?? { ...entity, rates: new Map(), counts: new Map(), k: 0, n: 0 };
        const rate = row.rates.get(code) ?? { sum: 0, count: 0 };
        rate.sum += entity.k / prompt.engines[code].n;
        rate.count += 1;
        row.rates.set(code, rate);
        const counts = row.counts.get(engineOf(code).label) ?? { k: 0, n: 0 };
        counts.k += entity.k;
        counts.n += prompt.engines[code].n;
        row.counts.set(engineOf(code).label, counts);
        row.k += entity.k;
        row.n += prompt.engines[code].n;
        rows.set(entity.name, row);
      }),
    );
  });
  const ranked = [...rows.values()]
    .map((row) => ({ name: row.name, own: row.own, tracked: row.tracked, swatch: row.swatch, k: row.k, n: row.n, counts: row.counts, rate: [...row.rates.values()].reduce((sum, rate) => sum + rate.sum / rate.count, 0) / row.rates.size }))
    // A brand the project follows stays in the list at a rate of 0 (shown as 0%, with its counts), never hidden
    .filter((row) => row.rate > 0 || row.own || row.tracked)
    .sort((a, b) => b.rate - a.rate)
    .map((row, index) => ({ ...row, place: index + 1 }));
  const shown = ranked.slice(0, LIST_SIZE);
  return { shown, own: shown.some((row) => row.own) ? null : ranked.find((row) => row.own) ?? null, names, answers, prompts: prompts.length, total: ranked.length };
}

// -------------------------------------------------------------------------------------------------
// Links cited in the answers of one engine

const SOURCE_PATH = {
  'g2.com': 'categories/crm',
  'techradar.com': 'best/best-crm-software',
  'capterra.com': 'crm-software',
  'forbes.com': 'advisor/business/software/best-crm-software',
  'zapier.com': 'blog/best-crm-app',
  'reddit.com': 'r/sales/comments/best_crm_for_a_small_team',
};
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The page a source domain stands for in this prompt's answers. The own domain leads to the page of the topic. */
function urlOf(domain, prompt) {
  if (domain === 'northwind.com') return `northwind.com/crm-for-${slug(prompt.topic)}`;
  return `${domain}/${SOURCE_PATH[domain] ?? ''}`.replace(/\/$/, '');
}

/** The links one engine cited for a prompt, most cited first, with how many of its answers cited each. */
export function citedLinksOf(prompt, code) {
  const observations = observationsOf(prompt).filter((observation) => observation.engine.code === code);
  const counts = new Map();
  observations.forEach((observation) => answerFor(prompt, observation).sources.forEach((domain) => counts.set(domain, (counts.get(domain) ?? 0) + 1)));
  const links = [...counts.entries()]
    .map(([domain, count]) => ({ url: urlOf(domain, prompt), domain, own: domain === 'northwind.com', count }))
    .sort((a, b) => b.count - a.count || a.url.localeCompare(b.url));
  return { links, answers: observations.length };
}

// -------------------------------------------------------------------------------------------------
// The latest answer of one engine: what a screenshot of it shows

/** The newest observation of the engine for this prompt with its answer, or null when it has none. */
export function latestAnswerOf(prompt, code) {
  const observation = observationsOf(prompt).find((entry) => entry.engine.code === code);
  return observation ? { observation, answer: answerFor(prompt, observation) } : null;
}
