/**
 * Fixture data of the Prompts page, and the measures computed from it. No DOM: this module can be loaded in
 * Node, which is how its totals are checked.
 *
 * The rows are generated, not written by hand: 250 core prompts, 12 branded ones and 40 discovery prompts,
 * each with counts per engine. The panel totals are fitted to the numbers the Overview shows (612 of 1,800
 * responses on ChatGPT, and so on), and the prompt-weighted rates to the same percentages.
 */
import { equalWeightAverage, isDetectableChange, pooledCounts, promptWeightedRate, rateState } from './vendor/stats/index.js';

// -------------------------------------------------------------------------------------------------
// Deterministic randomness

/** A seeded generator (mulberry32), so the fixture is the same on every load. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// -------------------------------------------------------------------------------------------------
// Engines, entities and vocabulary

/**
 * `recommendations` is false where answers are not classified for recommendation: that rate is then "n/a".
 * `asked` is false for AI Overview: no prompt is sent to it. It is read from the rank check of the prompt's
 * linked keyword on the day of each run, and a check counts only when Google showed an AI Overview
 * (16 section 1, rule 5: no surface is not a miss).
 */
const ENGINES = [
  { code: 'chatgpt_web', name: 'ChatGPT', unit: 'responses', recommendations: true, asked: true },
  { code: 'gemini_web', name: 'Gemini', unit: 'responses', recommendations: true, asked: true },
  { code: 'google_ai_mode', name: 'AI Mode', unit: 'observations', recommendations: false, asked: true },
  { code: 'google_ai_overview', name: 'AI Overview', unit: 'AI Overviews', recommendations: false, asked: false },
];
/** The engines a prompt is sent to. A manual run and the panel sizing are about these. */
const ASKED_ENGINES = ENGINES.filter((engine) => engine.asked);
const OVERVIEW = 'google_ai_overview';
const engineOf = (code) => ENGINES.find((engine) => engine.code === code);
/** Whether an engine has this metric at all. When not, its cells say why instead of showing a number. */
const measures = (code, metric) => metric !== 'recommendation' || engineOf(code).recommendations;
const NOT_CLASSIFIED = 'not classified for this engine';

/**
 * Why a prompt has no observation on an engine, as a short cell text and a sentence. An asked engine did
 * not answer in the window; AI Overview has two different reasons, and they call for different actions.
 */
function absenceOf(prompt, code) {
  if (engineOf(code).asked) return { text: 'n/a', note: 'not observed', reason: 'not observed in this window' };
  if (!prompt.linked) return { text: 'n/a', note: 'no linked keyword', reason: 'no linked keyword. AI Overview is read from the rank checks of a linked keyword' };
  return { text: 'No AIO', note: 'no AI Overview', reason: `Google showed no AI Overview for "${linkedKeywordOf(prompt).keyword}" in this window` };
}
/** The same reason as a sentence of its own. */
const absenceSentence = (prompt, code) => {
  const { reason } = absenceOf(prompt, code);
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
};

const OWN = 'Northwind';
/** Tracked competitors, each with the chart color it has everywhere (15 section 4.2) and a base mention share. */
const COMPETITORS = [
  { name: 'HubSpot', domain: 'hubspot.com', swatch: 'bg-chart-2', token: 'chart-2', base: 0.3 },
  { name: 'Pipedrive', domain: 'pipedrive.com', swatch: 'bg-chart-3', token: 'chart-3', base: 0.2 },
  { name: 'Salesforce', domain: 'salesforce.com', swatch: 'bg-chart-4', token: 'chart-4', base: 0.18 },
  { name: 'Zoho', domain: 'zoho.com', swatch: 'bg-chart-5', token: 'chart-5', base: 0.14 },
  { name: 'Freshsales', domain: 'freshworks.com', swatch: 'bg-chart-6', token: 'chart-6', base: 0.1 },
];

const METRICS = {
  mention: { label: 'Mention rate', short: 'Mention', group: 'Mention rate by engine' },
  citation: { label: 'Citation rate', short: 'Citation', group: 'Citation rate by engine' },
  recommendation: { label: 'Recommendation rate', short: 'Recommendation', group: 'Recommendation rate by engine' },
  sov: { label: 'Share of voice', short: 'Share of voice', group: 'Share of voice by engine' },
};

const TYPE_LABEL = { recommendation: 'Recommendation', comparison: 'Comparison', how_to: 'How-to', question: 'Question', definition: 'Definition' };
const TOPIC_PARENT = {
  Startups: 'CRM',
  'Small business': 'CRM',
  Pricing: 'CRM',
  Comparisons: 'CRM',
  Integrations: 'CRM',
  Onboarding: 'CRM',
  Mobile: 'CRM',
  Pipeline: 'Sales',
  'Email tracking': 'Sales',
  Forecasting: 'Sales',
  'Lead management': 'Sales',
  Automation: 'Sales',
  Reporting: 'Sales',
};
const topicPath = (topic) => `${TOPIC_PARENT[topic]} › ${topic}`;
/** How visible the own brand tends to be per topic: the latent rate the counts are drawn from. */
const TOPIC_STRENGTH = {
  Startups: 0.5,
  'Small business': 0.38,
  Pricing: 0.22,
  Comparisons: 0.3,
  Integrations: 0.36,
  Onboarding: 0.4,
  Mobile: 0.25,
  Pipeline: 0.45,
  'Email tracking': 0.33,
  Forecasting: 0.28,
  'Lead management': 0.3,
  Automation: 0.27,
  Reporting: 0.3,
};

const PANELS = [
  { name: 'Core', type: 'Core', locked: true, schedule: 'Weekly', changed: 0.061, lastRun: 'Sep 28, 02:10' },
  { name: 'Discovery', type: 'Discovery', locked: false, schedule: 'Monthly', changed: 0.35, lastRun: 'Sep 3, 04:40' },
  { name: 'Brand watch', type: 'Custom', locked: false, schedule: 'Weekly', changed: 0, lastRun: 'Sep 28, 02:10' },
];
const PROMPT_QUOTA = 600;

// -------------------------------------------------------------------------------------------------
// Prompt texts. Non-branded prompts never name the brand or a competitor (11 section 4).

const AUDIENCES = [
  ['a 20-person startup', 'Startups'],
  ['an early-stage founder', 'Startups'],
  ['a B2B SaaS team', 'Startups'],
  ['a seed-stage company', 'Startups'],
  ['a small business', 'Small business'],
  ['freelancers', 'Small business'],
  ['a consulting firm', 'Small business'],
  ['a real estate agency', 'Small business'],
  ['a nonprofit', 'Small business'],
  ['an e-commerce brand', 'Small business'],
  ['a remote sales team', 'Small business'],
  ['a two-person agency', 'Small business'],
];
/** A product category as it reads after "the best", its topic, and as it reads after "look for in". */
const THINGS = [
  ['CRM', null, 'a CRM'],
  ['free CRM', 'Pricing', 'a free CRM'],
  ['CRM under $50 per user', 'Pricing', 'a CRM under $50 per user'],
  ['sales pipeline tool', 'Pipeline', 'a sales pipeline tool'],
  ['CRM with email tracking', 'Email tracking', 'a CRM with email tracking'],
  ['CRM with built-in forecasting', 'Forecasting', 'a CRM with built-in forecasting'],
  ['lead management software', 'Lead management', 'lead management software'],
  ['sales automation tool', 'Automation', 'a sales automation tool'],
  ['CRM that works with Gmail', 'Integrations', 'a CRM that works with Gmail'],
  ['CRM with a mobile app', 'Mobile', 'a CRM with a mobile app'],
  ['CRM with good reporting', 'Reporting', 'a CRM with good reporting'],
];
const CHOICES = [
  ['a spreadsheet', 'a CRM'],
  ['an all-in-one CRM', 'separate sales tools'],
  ['a free CRM', 'a paid CRM'],
  ['a simple CRM', 'an enterprise CRM'],
  ['a CRM', 'a project management tool'],
];
const TASKS = [
  ['import contacts from a spreadsheet into a CRM', 'Onboarding'],
  ['set up a sales pipeline', 'Pipeline'],
  ['track email opens from a CRM', 'Email tracking'],
  ['forecast revenue from a sales pipeline', 'Forecasting'],
  ['move from one CRM to another without losing data', 'Onboarding'],
  ['automate follow-up emails', 'Automation'],
  ['score leads', 'Lead management'],
  ['build a sales dashboard', 'Reporting'],
  ['sync a CRM with Google Calendar', 'Integrations'],
  ['get a sales team to keep a CRM up to date', 'Onboarding'],
];
const DEFINITIONS = [
  ['What is a sales pipeline?', 'Pipeline'],
  ['What is lead scoring?', 'Lead management'],
  ['What does CRM stand for, and what does it do?', 'Small business'],
  ['What is sales forecasting?', 'Forecasting'],
  ['What is a sales-qualified lead?', 'Lead management'],
  ['What is contact management software?', 'Small business'],
];
const BRANDED = [
  ['Is Northwind a good CRM for startups?', 'question', 'Startups'],
  ['Northwind or HubSpot for a small sales team?', 'comparison', 'Comparisons'],
  ['How much does Northwind CRM cost?', 'question', 'Pricing'],
  ['What are the best alternatives to HubSpot?', 'recommendation', 'Comparisons'],
  ['Northwind or Pipedrive: which is easier to use?', 'comparison', 'Comparisons'],
  ['Is Pipedrive or Northwind better for pipeline management?', 'comparison', 'Pipeline'],
  ['Does Northwind work with Gmail?', 'question', 'Integrations'],
  ['What do reviews say about Northwind CRM?', 'question', 'Small business'],
  ['Is Zoho CRM or Northwind cheaper?', 'comparison', 'Pricing'],
  ['What are the best alternatives to Salesforce for startups?', 'recommendation', 'Startups'],
  ['Can Northwind replace HubSpot for a 10-person team?', 'question', 'Comparisons'],
  ['What are the pros and cons of Northwind CRM?', 'question', 'Small business'],
];
const PINNED = [
  { text: 'What is the best CRM for a 20-person startup?', type: 'recommendation', topic: 'Startups' },
  { text: 'Which CRM is easiest to set up for a small team?', type: 'recommendation', topic: 'Onboarding' },
];

function promptPool() {
  const pool = [];
  for (const [thing, thingTopic, withArticle] of THINGS) {
    for (const [audience, audienceTopic] of AUDIENCES) {
      const topic = thingTopic ?? audienceTopic;
      pool.push({ text: `What is the best ${thing} for ${audience}?`, type: 'recommendation', topic });
      // Asked from the buyer's side, the question belongs to the buyer's topic
      pool.push({ text: `For ${audience}, which ${thing} would you recommend?`, type: 'recommendation', topic: audienceTopic });
      pool.push({ text: `What should ${audience} look for in ${withArticle}?`, type: 'question', topic });
    }
  }
  for (const [first, second] of CHOICES) {
    for (const [audience] of AUDIENCES) pool.push({ text: `Should ${audience} use ${first} or ${second}?`, type: 'comparison', topic: 'Comparisons' });
  }
  for (const [task, topic] of TASKS) {
    pool.push({ text: `How do I ${task}?`, type: 'how_to', topic });
    for (const [audience] of AUDIENCES) pool.push({ text: `For ${audience}, what is the easiest way to ${task}?`, type: 'how_to', topic });
  }
  for (const [audience, audienceTopic] of AUDIENCES) {
    pool.push({ text: `Is a CRM worth it for ${audience}?`, type: 'question', topic: audienceTopic });
    pool.push({ text: `How much should ${audience} pay for a CRM?`, type: 'question', topic: 'Pricing' });
    pool.push({ text: `When should ${audience} switch from spreadsheets to a CRM?`, type: 'question', topic: 'Onboarding' });
  }
  for (const [text, topic] of DEFINITIONS) pool.push({ text, type: 'definition', topic });
  const pinned = new Set(PINNED.map((prompt) => prompt.text));
  return pool.filter((prompt) => !pinned.has(prompt.text));
}

// -------------------------------------------------------------------------------------------------
// Counts. Observations per prompt follow the sampling design of 17 section 7.3: 100 priority core prompts
// have 3 replicates a week on ChatGPT (12 in the 28-day window), the rest 1 (4 in the window).

const CORE_SIZE = 250;
/** Panel totals the Overview shows for the default scope: successes, and the same for the previous period. */
const TARGETS = {
  chatgpt_web: { n: 1800, mention: 612, prevMention: 574, citation: 378, prevCitation: 317, recommendation: 324, competitorMentions: 1655 },
  gemini_web: { n: 1296, mention: 376, prevMention: 386, citation: 181, prevCitation: 179, recommendation: 194, competitorMentions: 1191 },
  google_ai_mode: { n: 980, mention: 398, prevMention: 457, citation: 323, prevCitation: 334, recommendation: null, competitorMentions: 886 },
  // AI Overview links to pages more often than it names a brand, so citations outnumber mentions.
  // These are rank checks of the keywords linked to core prompts. They are not the 411 keywords with an AI
  // Overview that the Overview's search cards count: that is every tracked keyword at its latest check
  google_ai_overview: { n: 384, mention: 62, prevMention: 61, citation: 158, prevCitation: 156, recommendation: null, competitorMentions: 220 },
};
/**
 * The prompt-weighted rates the strip shows, where prompts differ in their number of observations. The
 * Overview reads 34% (+2.1 pts) and 29% (−0.8 pts) for mention rate, 21% (+3.4) and 14% (+0.2) for citation,
 * 18% and 15% for recommendation. AI Overview reads 16.1% (+0.3 pts) and 41.1% (+0.5 pts).
 * AI Mode has the same count on every prompt, so its weighted rate is its pooled rate and needs no fitting.
 */
const WEIGHTED = {
  chatgpt_web: { mention: 0.34, prevMention: 0.319, citation: 0.21, prevCitation: 0.176, recommendation: 0.18 },
  gemini_web: { mention: 0.29, prevMention: 0.298, citation: 0.14, prevCitation: 0.138, recommendation: 0.15 },
  google_ai_overview: { mention: 0.161, prevMention: 0.158, citation: 0.411, prevCitation: 0.406 },
};
const ENGINE_BIAS = { chatgpt_web: 0, gemini_web: -0.05, google_ai_mode: 0.07 };
/** Observation counts of the 248 generated core prompts, per engine. The two pinned prompts add theirs. */
const OBSERVATION_MIX = {
  chatgpt_web: [[12, 98], [4, 150]],
  gemini_web: [[8, 82], [4, 153], [3, 7], [0, 6]],
  google_ai_mode: [[4, 244], [0, 4]],
};
/**
 * AI Overviews seen per generated core prompt in the window: one rank check of the linked keyword per weekly
 * run, counted when it showed an AI Overview. Half the prompts have none, because no keyword is linked or
 * because Google showed no AI Overview for it.
 */
const OVERVIEW_MIX = [[4, 66], [3, 24], [2, 17], [1, 10], [0, 131]];
const PINNED_OVERVIEWS = [4, 0];
/** Of the prompts without an AI Overview, the share that does have a linked keyword. */
const LINKED_WITHOUT_OVERVIEW = 0.45;

function draw(n, p, random) {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (random() < p) k += 1;
  return k;
}

/** One adjustable count of the fixture: a field of an item, with the most it may hold right now. */
const cellsOf = (items, field, maxOf) => items.map((item) => ({ item, read: () => item[field], write: (value) => (item[field] = value), max: () => maxOf(item) }));

/**
 * Moves single counts until the cells add up to `target`. Throws when they cannot: a target the fixture
 * cannot reach would otherwise leave wrong numbers on the page without a word.
 */
function fitTotal(cells, target, random, what) {
  let total = cells.reduce((sum, cell) => sum + cell.read(), 0);
  const room = cells.reduce((sum, cell) => sum + cell.max(), 0);
  if (target < 0 || target > room) throw new Error(`Fixture: ${what} cannot be ${target} (possible: 0 to ${room})`);
  while (total !== target) {
    const cell = cells[Math.floor(random() * cells.length)];
    if (total < target && cell.read() < cell.max()) {
      cell.write(cell.read() + 1);
      total += 1;
    } else if (total > target && cell.read() > 0) {
      cell.write(cell.read() - 1);
      total -= 1;
    }
  }
}

const WEIGHTED_TOLERANCE = 0.00035;

/**
 * Brings the prompt-weighted rate to `target` without changing the total: a success moved from a prompt with
 * many observations to one with few raises the mean of the prompts' rates, and the reverse lowers it.
 * Throws when the rate cannot get there (every prompt has the same number of observations, or no room is left).
 */
function fitPromptWeighted(items, field, target, maxOf, random, what) {
  const observed = items.filter((item) => item.n > 0);
  const mean = () => observed.reduce((sum, item) => sum + item[field] / item.n, 0) / observed.length;
  const sizes = [...new Set(observed.map((item) => item.n))];
  const withOtherSize = new Map(sizes.map((n) => [n, observed.filter((item) => item.n !== n)]));
  for (let tries = 0; Math.abs(mean() - target) > WEIGHTED_TOLERANCE; tries += 1) {
    if (sizes.length < 2 || tries > 100000) throw new Error(`Fixture: the prompt-weighted ${what} cannot reach ${target} (it is ${mean()})`);
    const a = observed[Math.floor(random() * observed.length)];
    const others = withOtherSize.get(a.n);
    const b = others[Math.floor(random() * others.length)];
    const [large, small] = a.n > b.n ? [a, b] : [b, a];
    const [from, to] = mean() < target ? [large, small] : [small, large];
    if (from[field] > 0 && to[field] < maxOf(to)) {
      from[field] -= 1;
      to[field] += 1;
    }
  }
}

/**
 * Fits one engine's counts over the core panel (`prompts` is the panel, pinned prompts first) to its totals
 * in TARGETS and to its prompt-weighted rates in WEIGHTED. The pinned prompts keep their counts.
 */
function fitPanel(prompts, code, random) {
  const target = TARGETS[code];
  const pinned = prompts.slice(0, PINNED.length).map((prompt) => prompt.engines[code]);
  const free = prompts.slice(PINNED.length).map((prompt) => prompt.engines[code]);
  const observations = [...pinned, ...free].reduce((sum, item) => sum + item.n, 0);
  if (observations !== target.n) throw new Error(`Fixture: ${engineOf(code).name} has ${observations} observations in the panel, and its target says ${target.n}`);
  const left = (field) => target[field] - pinned.reduce((sum, item) => sum + item[field], 0);
  const all = [...pinned, ...free];
  const byN = (item) => item.n;
  const name = engineOf(code).name;
  for (const field of ['mention', 'prevMention', 'citation', 'prevCitation']) fitTotal(cellsOf(free, field, byN), left(field), random, `${name} ${field}`);
  // The strip shows the prompt-weighted rate (17 section 4.1); it is fitted so it reads as the Overview does
  const observed = (items) => items.filter((item) => item.n > 0);
  const fitWeighted = (field, maxOf) => {
    const wanted = WEIGHTED[code]?.[field];
    if (wanted === undefined) return;
    const pinnedRates = observed(pinned).reduce((sum, item) => sum + item[field] / item.n, 0);
    fitPromptWeighted(free, field, (wanted * observed(all).length - pinnedRates) / observed(free).length, maxOf, random, `${name} ${field}`);
  };
  for (const field of ['mention', 'prevMention', 'citation', 'prevCitation']) fitWeighted(field, byN);
  // A recommendation is a kind of mention, so it cannot outnumber them
  if (target.recommendation === null) all.forEach((item) => (item.recommendation = null));
  else {
    const byMention = (item) => item.mention;
    free.forEach((item) => (item.recommendation = Math.min(item.recommendation, item.mention)));
    fitTotal(cellsOf(free, 'recommendation', byMention), left('recommendation'), random, `${name} recommendation`);
    fitWeighted('recommendation', byMention);
  }
  // Competitor mentions: the total sets the panel's share of voice
  const competitorCells = free.flatMap((item) => item.competitors.map((_, c) => ({ read: () => item.competitors[c], write: (value) => (item.competitors[c] = value), max: () => item.n })));
  const pinnedCompetitors = pinned.reduce((sum, item) => sum + item.competitors.reduce((a, b) => a + b, 0), 0);
  fitTotal(competitorCells, target.competitorMentions - pinnedCompetitors, random, `${name} competitor mentions`);
}

/** Days a prompt's wording can have changed on: the last three are inside the chart's eight weeks. */
const VERSION_DAYS = ['Jun 15', 'Jun 29', 'Jul 13', 'Jul 20', 'Jul 27', 'Aug 3', 'Sep 7', 'Sep 14', 'Sep 21'];
const RECENT_VERSION_DAYS = 3;
const versionDayOrder = (day) => VERSION_DAYS.indexOf(day);

/** The day the current version started: recent when it changed inside the window, null for a first version. */
function versionDayOf(prompt) {
  if (prompt.version === 1) return null;
  if (prompt.id === 'p1') return 'Sep 14';
  const random = seeded(prompt.seed + 3);
  const older = VERSION_DAYS.length - RECENT_VERSION_DAYS;
  return prompt.versionChanged ? VERSION_DAYS[older + Math.floor(random() * RECENT_VERSION_DAYS)] : VERSION_DAYS[Math.floor(random() * older)];
}

/**
 * Gives every prompt its AI Overview counts and says whether a keyword is linked to it. It runs last and
 * draws from its own generator, so the counts of the asked engines are what they were without it.
 */
function addOverviews(prompts) {
  const random = seeded(20261001);
  const mix = shuffled(OVERVIEW_MIX.flatMap(([n, count]) => Array.from({ length: count }, () => n)), random);
  const core = prompts.filter((prompt) => prompt.panel === 'Core');
  const seen = (prompt) => {
    const index = core.indexOf(prompt);
    if (index >= 0) return index < PINNED.length ? PINNED_OVERVIEWS[index] : mix[index - PINNED.length];
    // A branded query shows an AI Overview less often; a discovery prompt has one run in the window
    return prompt.panel === 'Discovery' ? (random() < 0.35 ? 1 : 0) : random() < 0.4 ? 4 : 0;
  };
  for (const prompt of prompts) {
    const n = seen(prompt);
    const p = clamp(prompt.strength * 0.4 + (random() - 0.5) * 0.2, 0.01, 0.9);
    const previous = clamp(p + (random() - 0.5) * 0.12, 0.01, 0.9);
    prompt.linked = n > 0 || random() < LINKED_WITHOUT_OVERVIEW;
    prompt.engines[OVERVIEW] = {
      n,
      mention: draw(n, p, random),
      citation: draw(n, clamp(p * 2.3, 0, 0.95), random),
      recommendation: null,
      prevMention: draw(n, previous, random),
      prevCitation: draw(n, clamp(previous * 2.3, 0, 0.95), random),
      competitors: COMPETITORS.map((competitor) => draw(n, clamp(competitor.base * (0.3 + random() * 0.6), 0, 0.95), random)),
    };
  }
  // The first pinned prompt is linked to "best crm for startups", which the AI Overview cites (KEYWORD_FACTS)
  Object.assign(core[0].engines[OVERVIEW], { mention: 1, citation: 3, prevMention: 1, prevCitation: 3 });
  core[0].linked = true;
  core[1].linked = true;
  fitPanel(core, OVERVIEW, random);
}

function buildPrompts() {
  const random = seeded(20260928);
  const texts = shuffled(promptPool(), random);
  const core = [...PINNED, ...texts.slice(0, CORE_SIZE - PINNED.length)];
  const discovery = texts.slice(CORE_SIZE - PINNED.length, CORE_SIZE - PINNED.length + 40);

  const mixes = Object.fromEntries(
    Object.entries(OBSERVATION_MIX).map(([code, mix]) => [code, shuffled(mix.flatMap(([n, count]) => Array.from({ length: count }, () => n)), random)]),
  );
  const pinnedObservations = [
    { chatgpt_web: 12, gemini_web: 4, google_ai_mode: 4 },
    { chatgpt_web: 12, gemini_web: 3, google_ai_mode: 0 },
  ];

  const prompts = [];
  const add = (source, panel, branded, observationsOf) => {
    const index = prompts.length;
    const strength = clamp((branded ? 0.78 : TOPIC_STRENGTH[source.topic]) + (random() - 0.5) * 0.5, 0.02, 0.95);
    const engines = {};
    // Only the asked engines are drawn here. AI Overview is added afterwards from its own generator
    // (addOverviews), so its presence does not shift any number drawn for the other three.
    for (const { code } of ASKED_ENGINES) {
      const n = observationsOf(code, index);
      const p = clamp(strength + ENGINE_BIAS[code] + (random() - 0.5) * 0.2, 0.01, 0.97);
      const previous = clamp(p + (random() - 0.5) * 0.24, 0.01, 0.97);
      const mention = draw(n, p, random);
      engines[code] = {
        n,
        mention,
        citation: draw(n, clamp(p * 0.62 + (random() - 0.5) * 0.12, 0, 0.95), random),
        // Drawn for every engine, so the rest of the fixture does not depend on which engines classify it
        recommendation: draw(mention, 0.55, random),
        prevMention: draw(n, previous, random),
        prevCitation: draw(n, clamp(previous * 0.58, 0, 0.95), random),
        competitors: COMPETITORS.map((competitor) => draw(n, clamp(competitor.base * (0.5 + random() * 1.1), 0, 0.95), random)),
      };
    }
    const version = random() < 0.7 ? 1 : random() < 0.75 ? 2 : 3;
    prompts.push({
      id: `p${index + 1}`,
      text: source.text,
      type: source.type,
      topic: source.topic,
      panel,
      branded,
      locked: panel === 'Core',
      version,
      versionChanged: version > 1 && random() < 0.18,
      stale: panel === 'Core' && random() < 0.04,
      seed: Math.floor(random() * 2 ** 31),
      strength,
      engines,
    });
  };

  core.forEach((source, i) => add(source, 'Core', false, (code) => (i < PINNED.length ? pinnedObservations[i][code] : mixes[code][i - PINNED.length])));

  // The pinned prompts carry the counts of the page template's drawing (24 section 9.5) and are left alone
  Object.assign(prompts[0].engines.chatgpt_web, { mention: 8, citation: 5, recommendation: 6, prevMention: 7, prevCitation: 4 });
  Object.assign(prompts[0].engines.gemini_web, { mention: 3, citation: 1, recommendation: 2, prevMention: 2, prevCitation: 1 });
  Object.assign(prompts[0].engines.google_ai_mode, { mention: 2, citation: 2, prevMention: 3, prevCitation: 2 });
  Object.assign(prompts[0], { version: 3, versionChanged: true, stale: false });
  Object.assign(prompts[1].engines.chatgpt_web, { mention: 5, citation: 3, recommendation: 3, prevMention: 4, prevCitation: 3 });
  Object.assign(prompts[1].engines.gemini_web, { mention: 2, citation: 1, recommendation: 1, prevMention: 1, prevCitation: 0 });
  Object.assign(prompts[1], { version: 1, versionChanged: false, stale: false });

  for (const { code } of ASKED_ENGINES) fitPanel(prompts, code, random);

  // Branded prompts are watched weekly in their own panel; discovery prompts are observed once a month,
  // which is too little for a rate, and that is what their rows show
  BRANDED.forEach(([text, type, topic]) => add({ text, type, topic }, 'Brand watch', true, () => 4));
  discovery.forEach((source) => add(source, 'Discovery', false, () => 1));
  addOverviews(prompts);
  for (const prompt of prompts) {
    for (const { code } of ENGINES) if (!measures(code, 'recommendation')) prompt.engines[code].recommendation = null;
    prompt.versionDay = versionDayOf(prompt);
  }
  return prompts;
}

const PROMPTS = buildPrompts();
const PROMPT_BY_ID = new Map(PROMPTS.map((prompt) => [prompt.id, prompt]));

// -------------------------------------------------------------------------------------------------
// Measures of one prompt. `scope` is the list of engine codes in the filter.

/**
 * Successes and observations of one prompt on one engine for a metric. Share of voice counts entity mentions.
 * `reason` is set when the engine does not have the metric at all.
 */
function countsOf(prompt, code, metric, period = 'current') {
  const engine = prompt.engines[code];
  if (metric === 'sov') return { k: engine.mention, n: engine.mention + engine.competitors.reduce((a, b) => a + b, 0), observations: engine.n };
  if (!measures(code, metric)) return { k: 0, n: 0, observations: engine.n, reason: NOT_CLASSIFIED };
  if (period === 'previous') return { k: metric === 'citation' ? engine.prevCitation : engine.prevMention, n: engine.n, observations: engine.n };
  return { k: engine[metric], n: engine.n, observations: engine.n };
}

/** The rate to show, or null when the observations are too few (or no entity was mentioned at all). */
function rateFor(prompt, code, metric, period) {
  const counts = countsOf(prompt, code, metric, period);
  if (rateState(counts.observations) !== 'ok' || counts.n === 0) return null;
  return counts.k / counts.n;
}

function averageFor(prompt, scope, metric, period) {
  return equalWeightAverage(scope.map((code) => rateFor(prompt, code, metric, period)));
}

/** Change of the equal-weight mention or citation rate against the previous period, with its detectability. */
function changeFor(prompt, scope, metric) {
  const current = averageFor(prompt, scope, metric).value;
  const previous = averageFor(prompt, scope, metric, 'previous').value;
  if (current === null || previous === null) return null;
  const usable = scope.filter((code) => rateFor(prompt, code, metric) !== null);
  const pooled = (period) => pooledCounts(usable.map((code) => countsOf(prompt, code, metric, period)));
  return { value: current - previous, detectable: isDetectableChange(pooled('current'), pooled('previous')) };
}

function topCompetitor(prompt, scope) {
  let best = null;
  COMPETITORS.forEach((competitor, c) => {
    const { value } = equalWeightAverage(
      scope.map((code) => (rateState(prompt.engines[code].n) === 'ok' ? prompt.engines[code].competitors[c] / prompt.engines[code].n : null)),
    );
    if (value !== null && (best === null || value > best.rate)) best = { ...competitor, rate: value };
  });
  return best;
}

/** Eight weekly points of the equal-weight mention rate, ending at the current value. Null is a gap. */
function trendOf(prompt, scope) {
  const current = averageFor(prompt, scope, 'mention').value;
  if (current === null) return [];
  const previous = averageFor(prompt, scope, 'mention', 'previous').value ?? current;
  const random = seeded(prompt.seed);
  const points = Array.from({ length: 8 }, (_, week) => {
    const base = week < 4 ? previous : previous + ((current - previous) * (week - 3)) / 4;
    return clamp(base + (random() - 0.5) * 0.18, 0, 1);
  });
  points[7] = current;
  if (random() < 0.08) points[2 + Math.floor(random() * 3)] = null;
  return points;
}

const RUN_DAYS = ['Sep 7', 'Sep 14', 'Sep 21', 'Sep 28'];
const RANK_CHECK = { hour: 6, minute: 12 };

// -------------------------------------------------------------------------------------------------
// Observations of one prompt: the single answers behind its counts, generated the same way every time

function runDays(prompt) {
  if (prompt.pending) return [];
  if (prompt.panel === 'Discovery') return ['Sep 3'];
  return prompt.stale ? ['Aug 31', 'Sep 7', 'Sep 14', 'Sep 21'] : RUN_DAYS;
}

const observationCache = new Map();
function observationsOf(prompt) {
  if (observationCache.has(prompt.id)) return observationCache.get(prompt.id);
  const random = seeded(prompt.seed + 101);
  const days = runDays(prompt);
  const startMinute = 2 + Math.floor(random() * 44);
  const hour = prompt.panel === 'Discovery' ? 4 : 1;
  const all = [];
  ENGINES.forEach((engine, engineOrder) => {
    const counts = prompt.engines[engine.code];
    if (counts.n === 0 || days.length === 0) return;
    const perRun = Math.max(1, Math.round(counts.n / days.length));
    const flags = (k) => shuffled([...Array.from({ length: k }, () => true), ...Array.from({ length: counts.n - k }, () => false)], random);
    const mentioned = flags(counts.mention);
    const cited = flags(counts.citation);
    const classified = measures(engine.code, 'recommendation');
    let recommendations = counts.recommendation ?? 0;
    for (let i = 0; i < counts.n; i += 1) {
      // The latest runs are filled first, so a prompt with three observations misses the oldest run
      const run = days.length - 1 - Math.floor((counts.n - 1 - i) / perRun);
      const recommended = classified ? mentioned[i] && recommendations > 0 : null;
      if (recommended) recommendations -= 1;
      all.push({
        engine,
        engineOrder,
        run,
        day: days[Math.max(0, run)],
        // A run asks the engines one after the other, a few minutes apart, replicate by replicate.
        // An AI Overview comes from that day's rank check, which runs at 06:12
        hour: engine.asked ? hour : RANK_CHECK.hour,
        minute: engine.asked ? startMinute + engineOrder * 4 + (i % perRun) : RANK_CHECK.minute,
        replicate: (i % perRun) + 1,
        mentioned: mentioned[i],
        cited: cited[i],
        recommended,
      });
    }
  });
  all.forEach((observation) => (observation.time = `0${observation.hour}:${String(observation.minute).padStart(2, '0')}`));
  all.sort((a, b) => b.run - a.run || a.engineOrder - b.engineOrder || b.replicate - a.replicate);
  observationCache.set(prompt.id, all);
  return all;
}

const DAY_ORDER = { 'Aug 31': 0, 'Sep 3': 3, 'Sep 7': 7, 'Sep 14': 14, 'Sep 21': 21, 'Sep 28': 28 };
/**
 * When the prompt was last asked: the latest answer of an asked engine. A rank check that showed an AI
 * Overview is not a run of the prompt, so it does not count. `order` sorts; -1 is "never".
 */
function updatedOf(prompt) {
  const observations = observationsOf(prompt).filter((observation) => observation.engine.asked);
  if (observations.length === 0) return { text: 'Not yet', order: -1 };
  const latest = observations.reduce((a, b) => (b.run > a.run || (b.run === a.run && b.minute > a.minute) ? b : a));
  return { text: `${latest.day}, ${latest.time}`, order: DAY_ORDER[latest.day] * 1440 + Number(latest.time.slice(0, 2)) * 60 + latest.minute };
}

// Answers. `{Name}` marks an entity mention and `[n]` a citation marker, as EvidenceText renders them (23 section 5).
const LIST_LINES = {
  HubSpot: 'has a free tier and the widest set of integrations, which suits teams that expect to grow',
  Pipedrive: 'is built around the pipeline and is easy for reps to keep up to date',
  Salesforce: 'covers every case but takes an administrator to set up and maintain',
  Zoho: 'covers the basics at a low price per user',
  Freshsales: 'bundles phone and email with the contact record',
  [OWN]: 'is quick to set up and keeps the pipeline view simple, a good fit for a small sales team',
};
const PROSE = [
  (names) => `Start with the contacts you already have, then decide how much process you need. Tools such as {${names[0]}} and {${names[1]}} import a spreadsheet directly and flag duplicates [1]. Agree on the deal stages before inviting the team, since stages are hard to change later [2].`,
  (names) => `It depends on how the team sells. {${names[0]}} is a common choice for its reporting, while {${names[1]}} is simpler to keep current [1]. Whichever you pick, check that it connects to your email and calendar before you commit [2].`,
  (names) => `Most teams get there in an afternoon. {${names[0]}} and {${names[1]}} both have guided setup, and the difference shows up later, in reporting and in price per user [1]. Look at what the second year costs, not the first month [2].`,
];
const THIRD_PARTY = ['g2.com', 'techradar.com', 'capterra.com', 'forbes.com', 'zapier.com', 'reddit.com'];

function answerFor(prompt, observation) {
  const random = seeded(prompt.seed + 17 * (observation.engineOrder + 1));
  const counts = prompt.engines[observation.engine.code];
  const rivals = COMPETITORS.map((competitor, c) => ({ ...competitor, count: counts.competitors[c] + random() })).sort((a, b) => b.count - a.count);
  // An AI Overview summarizes the results of the linked keyword: it is prose, not a ranked answer to the prompt
  const listLike = observation.engine.asked && (prompt.type === 'recommendation' || prompt.type === 'comparison');
  const names = rivals.slice(0, 3).map((rival) => rival.name);
  let rank = null;
  if (observation.mentioned) {
    rank = 1 + Math.floor(random() * 3);
    names.splice(rank - 1, 0, OWN);
  }
  const shown = names.slice(0, 3);
  const text = listLike
    ? shown.map((name, i) => `${i + 1}. {${name}} ${LIST_LINES[name]} [${i + 1}].`).join('\n')
    : PROSE[Math.floor(random() * PROSE.length)](observation.mentioned ? [OWN, names.find((name) => name !== OWN)] : names);
  const sources = shuffled(THIRD_PARTY, random).slice(0, 3);
  if (observation.cited) sources.splice(listLike && rank ? Math.min(rank - 1, 2) : 0, 0, 'northwind.com');
  return { text, rank: listLike && observation.mentioned && rank <= 3 ? rank : null, listed: shown.length, sources };
}

// -------------------------------------------------------------------------------------------------
// Measures of a group of prompts: a topic, within the filters in force

/**
 * One rate of a group on one engine. Prompt-weighted (17 section 4.1), so a prompt with extra replicates
 * does not dominate; share of voice is a ratio of sums. Null when the group has too few observations.
 */
function groupRate(prompts, code, metric, period) {
  const counts = prompts.map((prompt) => countsOf(prompt, code, metric, period)).filter((entry) => entry.observations > 0);
  const pooled = pooledCounts(counts);
  const observations = counts.reduce((sum, entry) => sum + entry.observations, 0);
  if (rateState(observations) !== 'ok' || pooled.n === 0) return { rate: null, pooled, observations };
  return { rate: metric === 'sov' ? pooled.k / pooled.n : promptWeightedRate(counts), pooled, observations };
}

/** The equal-weight average of the engines in scope, with the pooled counts of the engines that took part. */
function groupAverage(prompts, scope, metric, period) {
  const rates = scope.map((code) => groupRate(prompts, code, metric, period));
  const { value, used } = equalWeightAverage(rates.map((entry) => entry.rate));
  return { value, used, pooled: pooledCounts(rates.filter((entry) => entry.rate !== null).map((entry) => entry.pooled)) };
}

function groupChange(prompts, scope, metric) {
  const current = groupAverage(prompts, scope, metric);
  const previous = groupAverage(prompts, scope, metric, 'previous');
  if (current.value === null || previous.value === null) return null;
  return { value: current.value - previous.value, detectable: isDetectableChange(current.pooled, previous.pooled) };
}

/** Eight weekly points: the mean of the prompts' own trends. A week no prompt has a value for is a gap. */
function groupTrend(prompts, scope) {
  const trends = prompts.map((prompt) => trendOf(prompt, scope)).filter((trend) => trend.length > 0);
  if (trends.length === 0) return [];
  return Array.from({ length: 8 }, (_, week) => {
    const values = trends.map((trend) => trend[week]).filter((value) => value !== null);
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  });
}

function groupUpdated(prompts) {
  return prompts.map(updatedOf).reduce((latest, entry) => (entry.order > latest.order ? entry : latest), { text: 'Not yet', order: -1 });
}

/**
 * Mention rate of the own brand and of each competitor in a group. Prompt-weighted per engine, like groupRate,
 * then the equal-weight average of the engines: the own brand's value here is the group's mention rate.
 */
function groupEntities(prompts, scope) {
  const rateOfEntity = (pick) =>
    equalWeightAverage(
      scope.map((code) => {
        const observed = prompts.map((prompt) => prompt.engines[code]).filter((engine) => engine.n > 0);
        const observations = observed.reduce((sum, engine) => sum + engine.n, 0);
        return rateState(observations) === 'ok' ? observed.reduce((sum, engine) => sum + pick(engine) / engine.n, 0) / observed.length : null;
      }),
    ).value;
  return [
    { name: OWN, own: true, swatch: 'bg-chart-1', token: 'chart-1', rate: rateOfEntity((engine) => engine.mention) },
    ...COMPETITORS.map((competitor, c) => ({ ...competitor, own: false, rate: rateOfEntity((engine) => engine.competitors[c]) })),
  ];
}

/** Topics in the order of the taxonomy, each with the prompts of `prompts` that belong to it. Empty topics are left out. */
function topicsOf(prompts) {
  return Object.keys(TOPIC_PARENT)
    .map((name) => ({ id: `t-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, name, parent: TOPIC_PARENT[name], prompts: prompts.filter((prompt) => prompt.topic === name) }))
    .filter((topic) => topic.prompts.length > 0);
}

// -------------------------------------------------------------------------------------------------
// The search side of a topic: its tracked keywords. The taxonomy is shared by keywords and prompts
// (04 section 5.3), so a topic has both. Totals are the ones Rankings and the Overview show.

const SEO_TOTALS = { tracked: 1000, checked: 986, top10: 301, visibility: 0.314 };

/** Splits `total` into whole numbers in proportion to `weights` (largest remainder), so the parts add up exactly. */
function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  const order = exact.map((value, i) => [value - parts[i], i]).sort((a, b) => b[0] - a[0]);
  for (let left = total - parts.reduce((a, b) => a + b, 0), i = 0; left > 0; left -= 1, i += 1) parts[order[i % order.length][1]] += 1;
  return parts;
}

function buildTopicSeo() {
  const random = seeded(20260930);
  const names = Object.keys(TOPIC_PARENT);
  const tracked = apportion(SEO_TOTALS.tracked, names.map(() => 0.5 + random()));
  const unchecked = apportion(SEO_TOTALS.tracked - SEO_TOTALS.checked, names.map(() => random()));
  const checked = tracked.map((count, i) => count - Math.min(unchecked[i], count));
  // Where the brand is strong in answers it tends to rank well too, loosely
  const strength = names.map((name) => clamp(TOPIC_STRENGTH[name] + (random() - 0.5) * 0.25, 0.08, 0.8));
  const top10 = apportion(SEO_TOTALS.top10, checked.map((count, i) => count * strength[i]));
  // Volume-weighted visibility: each topic's own value, shifted together so the weighted mean is the project's
  const volume = tracked.map((count) => count * (800 + random() * 2400));
  const raw = strength.map((value) => clamp(0.08 + value * 0.55 + (random() - 0.5) * 0.08, 0.03, 0.7));
  const weighted = (values) => values.reduce((sum, value, i) => sum + value * volume[i], 0) / volume.reduce((a, b) => a + b, 0);
  const shift = SEO_TOTALS.visibility - weighted(raw);
  return new Map(names.map((name, i) => [name, { tracked: tracked[i], checked: checked[i], top10: Math.min(top10[i], checked[i]), visibility: raw[i] + shift, volume: Math.round(volume[i]) }]));
}

const TOPIC_SEO = buildTopicSeo();
/** Tracked keywords of a topic: how many, how many were checked, how many rank in the top 10, and the visibility. */
const seoOf = (topicName) => TOPIC_SEO.get(topicName);

/** Tracked keywords of each topic: the ones a prompt of the topic can be linked to. */
const TOPIC_KEYWORDS = {
  Startups: ['best crm for startups', 'startup crm', 'crm tools for startups'],
  'Small business': ['crm for small business', 'small business crm software', 'simple crm'],
  Pricing: ['crm pricing comparison', 'free crm', 'cheap crm software'],
  Comparisons: ['hubspot alternatives', 'crm comparison', 'best sales crm'],
  Integrations: ['crm gmail integration', 'crm with google calendar', 'crm integrations'],
  Onboarding: ['how to set up a crm', 'import contacts to crm', 'crm migration'],
  Mobile: ['crm mobile app', 'best mobile crm', 'crm for iphone'],
  Pipeline: ['sales pipeline software', 'sales pipeline template', 'pipeline management tool'],
  'Email tracking': ['crm with email tracking', 'email tracking software', 'track email opens'],
  Forecasting: ['sales forecasting software', 'crm forecasting', 'revenue forecast tool'],
  'Lead management': ['lead management software', 'lead scoring', 'lead tracking tool'],
  Automation: ['sales automation tool', 'automate follow-up emails', 'crm automation'],
  Reporting: ['crm reporting', 'sales dashboard software', 'sales reports tool'],
};
/** Rank and AI Overview status of the keywords the page templates draw (24 section 9.5). */
const KEYWORD_FACTS = {
  'best crm for startups': { rank: '3', overview: 'Cited #2', cited: true },
  'crm for small business': { rank: '4', overview: 'Cited #2', cited: true },
  'sales pipeline software': { rank: '8', overview: 'Not cited', cited: false },
  'crm tools for startups': { rank: '5', overview: 'Cited #4', cited: true },
  'startup crm': { rank: '>20', overview: 'No AI Overview', cited: false },
  'best sales crm': { rank: '11', overview: 'Not cited', cited: false },
};

function hash(text) {
  let value = 7;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) % 2147483647;
  return value;
}

/** One tracked keyword as an inspector row: its rank and whether the AI Overview of its latest check cites the site. */
function keywordFacts(keyword) {
  if (KEYWORD_FACTS[keyword]) return { keyword, ...KEYWORD_FACTS[keyword] };
  const random = seeded(hash(keyword));
  const rank = 1 + Math.floor(random() * 24);
  const shown = random() < 0.6;
  const cited = shown && random() < 0.45;
  return { keyword, rank: rank > 20 ? '>20' : String(rank), overview: !shown ? 'No AI Overview' : cited ? `Cited #${1 + Math.floor(random() * 4)}` : 'Not cited', cited };
}

/**
 * The keyword a prompt is linked to, or null. Its AI Overview status is the prompt's own count, so the
 * keyword row, the AI Overview column and the AI Overview card of a prompt always say the same thing.
 */
function linkedKeywordOf(prompt) {
  if (!prompt.linked) return null;
  const pool = TOPIC_KEYWORDS[prompt.topic];
  const keyword = prompt.id === 'p1' ? pool[0] : pool[Math.floor(seeded(prompt.seed + 7)() * pool.length)];
  const counts = prompt.engines[OVERVIEW];
  const overview = counts.n === 0 ? 'No AI Overview' : counts.citation > 0 ? `Cited in ${counts.citation} of ${counts.n}` : `Not cited in ${counts.n}`;
  return { keyword, rank: keywordFacts(keyword).rank, overview, cited: counts.citation > 0, linked: true };
}

/** Keywords for the prompt drawer: the linked one first, then others of the same topic. */
function relatedKeywordsOf(prompt) {
  const linked = linkedKeywordOf(prompt);
  const others = TOPIC_KEYWORDS[prompt.topic].filter((keyword) => keyword !== linked?.keyword).map(keywordFacts);
  return [...(linked ? [linked] : []), ...others.slice(0, prompt.branded ? 0 : 2)];
}

const topicKeywords = (topicName) => TOPIC_KEYWORDS[topicName].map(keywordFacts);

// -------------------------------------------------------------------------------------------------
// The 28-day rolling mention rate at each weekly run (17 section 7.3), for the history chart

const WEEKS = ['Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28'];

function rollingCounts(prompt, code) {
  const counts = prompt.engines[code];
  const random = seeded(prompt.seed + 211 + code.length);
  return WEEKS.map((_, week) => {
    const base = week <= 3 ? counts.prevMention : counts.prevMention + ((counts.mention - counts.prevMention) * (week - 3)) / 4;
    const k = week === 7 ? counts.mention : week === 3 ? counts.prevMention : clamp(Math.round(base + (random() - 0.5) * Math.max(1, counts.n * 0.2)), 0, counts.n);
    return { k, n: counts.n };
  });
}

export {
  ASKED_ENGINES,
  NOT_CLASSIFIED,
  absenceOf,
  absenceSentence,
  linkedKeywordOf,
  relatedKeywordsOf,
  topicKeywords,
  measures,
  versionDayOrder,
  seoOf,
  groupAverage,
  groupChange,
  groupEntities,
  groupRate,
  groupTrend,
  groupUpdated,
  topicsOf,
  COMPETITORS,
  ENGINES,
  METRICS,
  OWN,
  PANELS,
  PROMPTS,
  PROMPT_BY_ID,
  PROMPT_QUOTA,
  TOPIC_PARENT,
  TYPE_LABEL,
  WEEKS,
  answerFor,
  averageFor,
  changeFor,
  clamp,
  countsOf,
  engineOf,
  observationsOf,
  rateFor,
  rollingCounts,
  seeded,
  shuffled,
  topCompetitor,
  topicPath,
  trendOf,
  updatedOf,
};
