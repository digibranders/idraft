/**
 * Data of the AI visibility Overview (docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md).
 *
 * No DOM: this module can be loaded in Node, which is how its totals are checked. Everything is computed from the
 * Prompts fixture (prompts-data.js) for the platform, group and branded scope the person chose. Measures the
 * fixture does not carry (how many answers both name and cite us, mention order, sentiment, cited domains, fan-out
 * queries, referral sessions) are derived here with seeded randomness, so they are the same on every load and
 * consistent with the fixture's counts. In the app these come from the metric routes (doc 19 section 3.7).
 */
import { equalWeightAverage, isDetectableChange, pooledCounts, promptWeightedRate, rateState } from './vendor/stats/index.js';
import { COMPETITORS, ENGINES, OWN, PROMPTS, TOPIC_PARENT, WEEKS, clamp, seeded } from './prompts-data.js';

// -------------------------------------------------------------------------------------------------
// Scope: platform, group, branded

export const PLATFORMS = ENGINES.map((engine) => ({ code: engine.code, name: engine.name, asked: engine.asked, recommendations: engine.recommendations }));
export const PLATFORM_CODES = PLATFORMS.map((platform) => platform.code);
export const platformOf = (code) => PLATFORMS.find((platform) => platform.code === code);
export const PARENTS = [...new Set(Object.values(TOPIC_PARENT))];
/** A group is a top-level topic (`parent:CRM`) or a topic (`topic:Pricing`). Every prompt has exactly one topic. */
export const GROUPS = [
  { id: 'all', label: 'All groups', kind: 'all' },
  ...PARENTS.flatMap((parent) => [
    { id: `parent:${parent}`, label: parent, kind: 'parent', parent },
    ...Object.keys(TOPIC_PARENT)
      .filter((topic) => TOPIC_PARENT[topic] === parent)
      .map((topic) => ({ id: `topic:${topic}`, label: topic, kind: 'topic', parent })),
  ]),
];
export const groupOf = (id) => GROUPS.find((group) => group.id === id) ?? GROUPS[0];
export const BRANDED_LABEL = { exclude: 'Excluded', include: 'Included', only: 'Only' };

/** Last run of the Core panel, from the Prompts fixture. */
export const RUNS = { number: 48, windowDays: 28, inWindow: 4, last: 'Sep 28, 02:10' };
const LAST_RUN_BY_PLATFORM = { chatgpt_web: 'Sep 28, 02:10', gemini_web: 'Sep 28, 02:12', google_ai_mode: 'Sep 28, 02:15', google_ai_overview: 'Sep 28, 06:12' };

const hashOf = (text) => [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7);
const rng = (text) => seeded(hashOf(text));

export function promptsIn(scope) {
  return PROMPTS.filter((prompt) => {
    if (scope.branded === 'only' ? !prompt.branded : scope.branded === 'exclude' ? prompt.panel !== 'Core' : prompt.panel !== 'Core' && !prompt.branded) return false;
    const group = groupOf(scope.group);
    if (group.kind === 'topic') return prompt.topic === group.label;
    if (group.kind === 'parent') return TOPIC_PARENT[prompt.topic] === group.parent;
    return true;
  });
}

export const platformsIn = (scope) => (scope.platform === 'all' ? PLATFORM_CODES : [scope.platform]);
const scopeKey = (scope) => `${scope.branded}|${scope.group}`;

// -------------------------------------------------------------------------------------------------
// One prompt on one platform, with the measures the fixture lacks

/** Mention order of the own brand among tracked brands (1 = named first), from how many competitors share the answer. */
function meanOrder(engine, strength) {
  const others = engine.n > 0 ? engine.competitors.reduce((sum, count) => sum + count, 0) / engine.n : 0;
  return clamp(1 + others * (0.6 - 0.4 * strength) * 2.4, 1, 6);
}

function derived(prompt, code, previous) {
  const engine = prompt.engines[code];
  const n = engine.n;
  const m = previous ? engine.prevMention : engine.mention;
  const c = previous ? engine.prevCitation : engine.citation;
  const random = rng(`${prompt.id}|${code}|joint`)();
  const low = Math.max(0, m + c - n);
  const high = Math.min(m, c);
  // Answers that cite us are mostly answers that also name us
  const both = clamp(Math.round(high * (0.55 + 0.3 * random)), low, high);
  const recommendation = engine.recommendation === null ? null : previous ? Math.round((engine.recommendation * m) / Math.max(1, engine.mention)) : engine.recommendation;
  const competitors = engine.competitors;
  return {
    n,
    m,
    c,
    both,
    mentionedOnly: m - both,
    citedOnly: c - both,
    neither: n - m - c + both,
    visible: m + c - both,
    recommendation,
    competitors,
    order: m > 0 ? meanOrder(engine, prompt.strength) : null,
  };
}

// -------------------------------------------------------------------------------------------------
// One platform over a list of prompts, one period

const cache = new Map();

/** The measures of one platform. Rates are prompt-weighted (17 section 4.1); share of voice is a ratio of sums. */
function aggregate(prompts, code, period, key) {
  const id = `${key}|${code}|${period}`;
  if (cache.has(id)) return cache.get(id);
  const rows = prompts.map((prompt) => derived(prompt, code, period === 'previous')).filter((row) => row.n > 0);
  const observations = rows.reduce((sum, row) => sum + row.n, 0);
  const enough = rateState(observations) === 'ok';
  const rate = (pick) => (enough ? promptWeightedRate(rows.map((row) => ({ k: pick(row), n: row.n }))) : null);
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
  const mentions = sum((row) => row.m);
  const competitorMentions = sum((row) => row.competitors.reduce((a, b) => a + b, 0));
  const hasRecommendation = platformOf(code).recommendations;
  const result = {
    code,
    prompts: rows.length,
    observations,
    enough,
    counts: {
      visibility: { k: sum((row) => row.visible), n: observations },
      mention: { k: mentions, n: observations },
      citation: { k: sum((row) => row.c), n: observations },
      unlinked: { k: sum((row) => row.mentionedOnly), n: observations },
      sov: { k: mentions, n: mentions + competitorMentions },
      recommendation: { k: sum((row) => row.recommendation ?? 0), n: observations },
    },
    visibility: rate((row) => row.visible),
    mention: rate((row) => row.m),
    citation: rate((row) => row.c),
    unlinked: rate((row) => row.mentionedOnly),
    // A share needs at least 4 brand mentions behind it (R2): otherwise it is not shown
    sov: enough && mentions + competitorMentions >= 4 ? mentions / (mentions + competitorMentions) : null,
    recommendation: hasRecommendation ? rate((row) => row.recommendation ?? 0) : null,
    outcomes: {
      both: rate((row) => row.both),
      mentionedOnly: rate((row) => row.mentionedOnly),
      citedOnly: rate((row) => row.citedOnly),
      neither: rate((row) => row.neither),
    },
    outcomeCounts: { both: sum((row) => row.both), mentionedOnly: sum((row) => row.mentionedOnly), citedOnly: sum((row) => row.citedOnly), neither: sum((row) => row.neither) },
    // Mean mention order, weighted by the answers that name us
    position: mentions >= 4 ? sum((row) => (row.order ?? 0) * row.m) / mentions : null,
    mentioned: mentions,
  };
  cache.set(id, result);
  return result;
}

// -------------------------------------------------------------------------------------------------
// Measures: what each metric is, per platform and as "avg of N"

/** `better` says which direction is good, for the tone of a change. Position: a lower number is better. */
export const MEASURES = {
  visibility: { label: 'AI Visibility', short: 'Visibility', unit: 'ratio', better: 'up', info: 'Share of valid answers that name or cite the brand. 100% minus "neither".' },
  mention: { label: 'Mention rate', short: 'Mention', unit: 'ratio', better: 'up', info: 'Share of valid answers that name the brand. Each prompt counts once.' },
  position: { label: 'Avg. mention position', short: 'Mention position', unit: 'order', better: 'down', noun: 'mentions', info: 'Mean order in which the brand is named among tracked brands. 1 means named first.' },
  recommendation: { label: 'Recommendation rate', short: 'Recommendation', unit: 'ratio', better: 'up', info: 'Share of valid answers that recommend the brand. Not named counts as not recommended.', sample: true },
  rank: { label: 'Avg. recommendation position', short: 'Recommendation position', unit: 'order', better: 'down', noun: 'listed answers', info: 'Mean rank in ordered lists that recommend brands. Only answers with a list count.', sample: true },
  sov: { label: 'Share of voice', short: 'Share of voice', unit: 'ratio', better: 'up', noun: 'brand mentions', info: 'Share of tracked-brand mentions that are the brand. Depends on the tracked competitors.' },
  citation: { label: 'Source citation rate', short: 'Citation', unit: 'ratio', better: 'up', info: 'Share of valid answers that cite a page of the brand’s domain.' },
  sentiment: { label: 'Brand sentiment', short: 'Sentiment', unit: 'ratio', better: 'up', noun: 'classified mentions', info: 'Share of classified mentions with a positive tone. Shown as four shares, never one score.', sample: true },
  unlinked: { label: 'Unlinked brand mention', short: 'Unlinked mention', unit: 'ratio', better: 'up', info: 'Share of valid answers that name the brand without citing it.' },
  referral: { label: 'Referral traffic', short: 'Referrals', unit: 'count', better: 'up', info: 'Sessions from AI platforms (GA4).', sample: true },
  domain: { label: 'Top domain cited', short: 'Top domain', unit: 'text', better: 'up', info: 'The domain cited in the most answers.' },
  prompts: { label: 'Total prompts tracked', short: 'Prompts', unit: 'count', better: 'up', info: 'Prompts in scope, each counted once.' },
};

const NOT_CLASSIFIED = 'not classified for this engine';

// Sentiment and the order of mention have no collector yet: seeded shares around a typical split, per platform and group
function sentimentOf(code, groupId) {
  const platform = platformOf(code);
  if (!platform.recommendations) return null;
  const random = rng(`sentiment|${code}|${groupId}`);
  const positive = 0.5 + random() * 0.16;
  const negative = 0.03 + random() * 0.05;
  const mixed = 0.04 + random() * 0.04;
  return { positive, neutral: 1 - positive - negative - mixed, negative, mixed, coverage: 0.78 + random() * 0.12 };
}

/** A value of one measure on one platform: the rate, its counts, the previous value and the detectable change. */
function cellOf(measure, code, scopeCtx) {
  const cur = aggregate(scopeCtx.prompts, code, 'current', scopeCtx.key);
  const prev = aggregate(scopeCtx.prompts, code, 'previous', scopeCtx.key);
  const info = { code, measure, observations: cur.observations };
  if (measure === 'recommendation' && !platformOf(code).recommendations) return { ...info, state: 'unavailable', reason: NOT_CLASSIFIED };
  if (measure === 'rank' || measure === 'sentiment') {
    if (!platformOf(code).recommendations) return { ...info, state: 'unavailable', reason: NOT_CLASSIFIED };
  }
  if (measure === 'rank') {
    // Position inside ordered lists, only where the answer had a list: a fifth of answers have one
    const listed = Math.round(cur.mentioned * 0.38);
    if (cur.position === null) return { ...info, state: 'insufficient', counts: { k: listed, n: listed } };
    const value = cur.position + 0.7;
    const previous = prev.position === null ? null : prev.position + 0.7;
    return { ...info, state: listed >= 4 ? 'ok' : 'insufficient', value, previous, change: previous === null ? null : { value: value - previous, detectable: null }, counts: { k: listed, n: listed }, coverage: listed / Math.max(1, cur.mentioned) };
  }
  if (measure === 'sentiment') {
    const shares = sentimentOf(code, scopeCtx.scope.group);
    const previous = sentimentOf(code, `${scopeCtx.scope.group}|before`);
    const classified = Math.round(cur.mentioned * shares.coverage);
    return {
      ...info,
      state: classified >= 4 ? 'ok' : 'insufficient',
      value: shares.positive,
      previous: previous.positive * 0.99,
      // No interval is computed for a rule-based tone share yet: the change is shown as not tested (R5)
      change: { value: shares.positive - previous.positive * 0.99, detectable: null },
      shares,
      counts: { k: Math.round(classified * shares.positive), n: classified },
      coverage: shares.coverage,
    };
  }
  if (measure === 'position') {
    if (cur.position === null) return { ...info, state: cur.mentioned > 0 ? 'insufficient' : 'none', counts: { k: cur.mentioned, n: cur.mentioned } };
    const previous = prev.position;
    return { ...info, state: 'ok', value: cur.position, previous, change: previous === null ? null : { value: cur.position - previous, detectable: null }, counts: { k: cur.mentioned, n: cur.mentioned } };
  }
  const value = cur[measure];
  if (value === null) return { ...info, state: cur.observations > 0 ? 'insufficient' : 'none', counts: cur.counts[measure] };
  const previous = prev[measure];
  const detectable = previous !== null && isDetectableChange(cur.counts[measure], prev.counts[measure]);
  return { ...info, state: 'ok', value, previous, change: previous === null ? null : { value: value - previous, detectable }, counts: cur.counts[measure], previousCounts: prev.counts[measure] };
}

/** The equal-weight average of the platforms that have the measure ("avg of N"); its change is detectable from their pooled counts. */
function averageOf(cells, codes) {
  const used = cells.filter((cell) => cell.state === 'ok');
  if (used.length === 0) {
    const state = cells.every((cell) => cell.state === 'unavailable') ? 'unavailable' : 'insufficient';
    // The count that fell under the floor is the largest one a platform reached, never zero (R2, R6)
    const reached = cells.filter((cell) => cell.counts).map((cell) => cell.counts.n);
    return { measure: cells[0].measure, code: 'all', state, used: 0, platforms: codes, observations: Math.max(0, ...cells.map((cell) => cell.observations ?? 0)), counts: reached.length > 0 ? { k: Math.max(...reached), n: Math.max(...reached) } : undefined };
  }
  const { value } = equalWeightAverage(used.map((cell) => cell.value));
  const previousCells = used.filter((cell) => cell.previous !== null && cell.previous !== undefined);
  const previous = previousCells.length === used.length ? equalWeightAverage(previousCells.map((cell) => cell.previous)).value : null;
  const measure = cells[0].measure;
  const counts = pooledCounts(used.map((cell) => cell.counts));
  const ratio = MEASURES[measure].unit === 'ratio';
  // Detectable only from the pooled counts of both periods (R5); a measure without previous counts is not tested
  const testable = ratio && previous !== null && used.every((cell) => cell.previousCounts);
  const detectable = testable ? isDetectableChange(counts, pooledCounts(used.map((cell) => cell.previousCounts))) : null;
  return {
    measure,
    code: 'all',
    state: 'ok',
    used: used.length,
    platforms: used.map((cell) => cell.code),
    value,
    previous,
    change: previous === null ? null : { value: value - previous, detectable },
    counts,
    observations: used.reduce((sum, cell) => sum + cell.observations, 0),
  };
}

/**
 * Everything the page reads for one scope. `cells[measure][code]` is one platform; `average[measure]` is the
 * "avg of N". `shown(measure)` is the cell the headline uses: the platform's own, or the average for All platforms.
 */
export function buildModel(scope) {
  const prompts = promptsIn(scope);
  const key = scopeKey(scope);
  const scopeCtx = { scope, prompts, key };
  const codes = platformsIn(scope);
  const cells = {};
  const average = {};
  for (const measure of ['visibility', 'mention', 'position', 'recommendation', 'rank', 'sov', 'citation', 'sentiment', 'unlinked']) {
    cells[measure] = Object.fromEntries(PLATFORM_CODES.map((code) => [code, cellOf(measure, code, scopeCtx)]));
    // All platforms averages only what the measure has; recommendation and sentiment exist on two platforms
    average[measure] = averageOf(PLATFORM_CODES.map((code) => cells[measure][code]), PLATFORM_CODES);
  }
  const shown = (measure) => (scope.platform === 'all' ? average[measure] : cells[measure][scope.platform]);
  return { scope, prompts, key, codes, cells, average, shown, scopeCtx };
}

export const aggregateFor = (model, code, period = 'current') => aggregate(model.prompts, code, period, model.key);

// -------------------------------------------------------------------------------------------------
// Series over the eight weekly runs (the fixture has no weekly counts, so a series runs from the previous period to the current value)

export const WEEK_LABELS = WEEKS;

export function weekly(previous, current, seedText, amplitude = 0.012, bounds = [0, 1]) {
  if (current === null || current === undefined) return Array(8).fill(null);
  const from = previous ?? current;
  const random = rng(seedText);
  const points = Array.from({ length: 8 }, (_, week) => {
    const base = week < 4 ? from : from + ((current - from) * (week - 3)) / 4;
    const value = base + (random() - 0.5) * 2 * amplitude;
    // A rate stays between 0 and 100%; orders and counts pass `null` bounds
    return bounds ? clamp(value, bounds[0], bounds[1]) : value;
  });
  points[3] = from;
  points[7] = current;
  return points;
}

export function seriesFor(model, measure, code) {
  const cell = code === 'all' ? model.average[measure] : model.cells[measure][code];
  if (cell.state !== 'ok') return Array(8).fill(null);
  const order = MEASURES[measure].unit === 'order';
  return weekly(cell.previous, cell.value, `${model.key}|${measure}|${code}`, order ? 0.06 : 0.012, order ? null : [0, 1]);
}

// -------------------------------------------------------------------------------------------------
// Entities: share of voice and mention rate of the own brand and each competitor

export function entitiesFor(model) {
  const perPlatform = model.codes.map((code) => {
    const rows = model.prompts.map((prompt) => derived(prompt, code, false)).filter((row) => row.n > 0);
    const observations = rows.reduce((sum, row) => sum + row.n, 0);
    if (rateState(observations) !== 'ok') return null;
    const own = rows.reduce((sum, row) => sum + row.m, 0);
    const competitors = COMPETITORS.map((_, index) => rows.reduce((sum, row) => sum + row.competitors[index], 0));
    const total = own + competitors.reduce((a, b) => a + b, 0);
    const rate = (pick) => promptWeightedRate(rows.map((row) => ({ k: pick(row), n: row.n })));
    return {
      total,
      shares: [own / total, ...competitors.map((count) => count / total)],
      counts: [own, ...competitors],
      rates: [rate((row) => row.m), ...COMPETITORS.map((_, index) => rate((row) => row.competitors[index]))],
    };
  });
  const used = perPlatform.filter(Boolean);
  const mean = (pick) => (used.length === 0 ? null : used.reduce((sum, entry) => sum + pick(entry), 0) / used.length);
  return [{ name: OWN, own: true, token: 'chart-1', domain: 'northwind.com' }, ...COMPETITORS.map((competitor) => ({ ...competitor, own: false }))].map((entity, index) => ({
    ...entity,
    sov: mean((entry) => entry.shares[index]),
    mention: mean((entry) => entry.rates[index]),
    answers: used.reduce((sum, entry) => sum + entry.counts[index], 0),
    answersOfTracked: used.reduce((sum, entry) => sum + entry.total, 0),
    platforms: used.length,
  }));
}

/** Weekly share of voice per entity, each week normalized to 100%. Competitors move a little around their share. */
export function sovSeries(model, entities) {
  const own = entities[0];
  const previousOwn = model.scope.platform === 'all' ? model.average.sov.previous : model.cells.sov[model.scope.platform].previous;
  const series = entities.map((entity, index) => {
    if (entity.sov === null) return Array(8).fill(null);
    const before = index === 0 ? previousOwn ?? entity.sov : entity.sov * (1 + (rng(`${model.key}|${entity.name}|prev`)() - 0.5) * 0.12);
    return weekly(before, entity.sov, `${model.key}|sov|${entity.name}`, index === 0 ? 0.008 : 0.01);
  });
  return Array.from({ length: 8 }, (_, week) => {
    const total = series.reduce((sum, line) => sum + (line[week] ?? 0), 0);
    return series.map((line) => (line[week] === null || own.sov === null ? null : line[week] / total));
  });
}

/** The gap to each competitor in mention rate, and the prompts where the competitor is named more often than we are. */
export function gapFor(model) {
  const entities = entitiesFor(model);
  const own = entities[0];
  return entities.slice(1).map((entity, index) => {
    let lost = 0;
    let ahead = 0;
    for (const prompt of model.prompts) {
      let ownRate = 0;
      let competitorRate = 0;
      let used = 0;
      for (const code of model.codes) {
        const engine = prompt.engines[code];
        if (rateState(engine.n) !== 'ok') continue;
        ownRate += engine.mention / engine.n;
        competitorRate += engine.competitors[index] / engine.n;
        used += 1;
      }
      if (used === 0) continue;
      if (competitorRate > ownRate) lost += 1;
      else if (ownRate > competitorRate) ahead += 1;
    }
    return { ...entity, gap: own.mention === null || entity.mention === null ? null : entity.mention - own.mention, lost, ahead, compared: lost + ahead };
  });
}

/** The prompts of the scope with their rates over the platforms in scope, for the group view. */
export function promptRows(model) {
  return model.prompts
    .map((prompt) => {
      const rows = model.codes.map((code) => derived(prompt, code, false)).filter((row) => row.n > 0);
      const answers = rows.reduce((sum, row) => sum + row.n, 0);
      if (rateState(answers) !== 'ok') return null;
      const share = (pick) => rows.reduce((sum, row) => sum + pick(row), 0) / answers;
      return { id: prompt.id, text: prompt.text, topic: prompt.topic, answers, visibility: share((row) => row.visible), mention: share((row) => row.m), citation: share((row) => row.c) };
    })
    .filter(Boolean)
    .sort((a, b) => b.mention - a.mention);
}

// -------------------------------------------------------------------------------------------------
// Groups: topics by platform

export function groupRows(scope, measure) {
  const rows = [];
  for (const [topic, parent] of Object.entries(TOPIC_PARENT)) {
    const topicScope = { ...scope, group: `topic:${topic}`, platform: 'all' };
    const model = buildModel(topicScope);
    if (model.prompts.length === 0) continue;
    rows.push({
      id: `topic:${topic}`,
      name: topic,
      parent,
      prompts: model.prompts.length,
      cells: Object.fromEntries(PLATFORM_CODES.map((code) => [code, model.cells[measure][code]])),
      average: model.average[measure],
    });
  }
  return rows;
}

// -------------------------------------------------------------------------------------------------
// Citations: domains, source types, own pages, unlinked mentions

const DOMAINS = [
  { domain: 'northwind.com', role: 'Own', type: 'Own site', weight: 0 },
  { domain: 'g2.com', role: 'Third party', type: 'Review sites', weight: 9 },
  { domain: 'capterra.com', role: 'Third party', type: 'Review sites', weight: 6.5 },
  { domain: 'reddit.com', role: 'Third party', type: 'Community', weight: 7.5 },
  { domain: 'techradar.com', role: 'Third party', type: 'Publishers', weight: 6 },
  { domain: 'forbes.com', role: 'Third party', type: 'Publishers', weight: 5.2 },
  { domain: 'zapier.com', role: 'Third party', type: 'Publishers', weight: 4.4 },
  { domain: 'hubspot.com', role: 'Competitor', type: 'Competitor sites', weight: 8.2 },
  { domain: 'pipedrive.com', role: 'Competitor', type: 'Competitor sites', weight: 4.6 },
  { domain: 'salesforce.com', role: 'Competitor', type: 'Competitor sites', weight: 4.1 },
  { domain: 'zoho.com', role: 'Competitor', type: 'Competitor sites', weight: 3 },
  { domain: 'quora.com', role: 'Third party', type: 'Community', weight: 2.4 },
  { domain: 'youtube.com', role: 'Third party', type: 'Video', weight: 3.2 },
  { domain: 'wikipedia.org', role: 'Third party', type: 'Reference', weight: 2.1 },
];
const PLATFORM_TILT = {
  chatgpt_web: { 'reddit.com': 1.5, 'g2.com': 1.3, 'quora.com': 1.4 },
  gemini_web: { 'youtube.com': 2, 'wikipedia.org': 1.7, 'forbes.com': 0.7 },
  google_ai_mode: { 'forbes.com': 1.5, 'techradar.com': 1.4, 'capterra.com': 1.2 },
  google_ai_overview: { 'hubspot.com': 1.5, 'zapier.com': 1.5, 'northwind.com': 1 },
};

/** Largest remainder split, so the parts add up to `total` exactly. */
function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  const order = exact.map((value, index) => [value - parts[index], index]).sort((a, b) => b[0] - a[0]);
  for (let left = total - parts.reduce((a, b) => a + b, 0), i = 0; left > 0; left -= 1, i += 1) parts[order[i % order.length][1]] += 1;
  return parts;
}

export function domainsFor(model) {
  const ownUnits = model.codes.reduce((sum, code) => sum + aggregate(model.prompts, code, 'current', model.key).counts.citation.k, 0);
  if (ownUnits === 0) return { total: 0, own: 0, rows: [], types: [] };
  const total = Math.round(ownUnits / 0.095);
  const random = rng(`domains|${model.key}|${model.scope.platform}`);
  const others = DOMAINS.slice(1).map((entry) => {
    const tilt = model.codes.reduce((sum, code) => sum + (PLATFORM_TILT[code]?.[entry.domain] ?? 1), 0) / model.codes.length;
    return entry.weight * tilt * (0.8 + random() * 0.4);
  });
  const units = [ownUnits, ...apportion(total - ownUnits, others)];
  const rows = DOMAINS.map((entry, index) => ({ ...entry, units: units[index], share: units[index] / total, isNew: ['reddit.com', 'quora.com'].includes(entry.domain) && random() < 0.6 })).sort((a, b) => b.units - a.units);
  const types = [...new Set(DOMAINS.map((entry) => entry.type))].map((type) => ({ type, units: rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.units, 0) })).sort((a, b) => b.units - a.units);
  return { total, own: ownUnits, rows, types };
}

const OWN_PAGES = [
  ['/pricing', 'Pricing'],
  ['/compare/hubspot-alternative', 'Comparisons'],
  ['/blog/best-crm-for-startups', 'Startups'],
  ['/features/pipeline', 'Pipeline'],
  ['/guides/sales-forecasting', 'Forecasting'],
  ['/integrations', 'Integrations'],
];
export function ownPagesFor(model, domains) {
  const topicsInScope = new Set(model.prompts.map((prompt) => prompt.topic));
  const pages = OWN_PAGES.filter(([, topic]) => topicsInScope.has(topic));
  if (pages.length === 0 || domains.own === 0) return [];
  const units = apportion(domains.own, pages.map((_, index) => 6 - index));
  return pages.map(([path, topic], index) => ({ url: `northwind.com${path}`, topic, units: units[index] })).sort((a, b) => b.units - a.units);
}

/** Prompts that name the brand but never cite it: the unlinked mentions, with the share of their answers. */
export function unlinkedPrompts(model, limit = 6) {
  return model.prompts
    .map((prompt) => {
      let named = 0;
      let unlinked = 0;
      let answers = 0;
      for (const code of model.codes) {
        const row = derived(prompt, code, false);
        named += row.m;
        unlinked += row.mentionedOnly;
        answers += row.n;
      }
      return { id: prompt.id, text: prompt.text, topic: prompt.topic, named, unlinked, answers };
    })
    .filter((entry) => entry.answers >= 4 && entry.unlinked > 0)
    .sort((a, b) => b.unlinked / b.answers - a.unlinked / a.answers || b.answers - a.answers)
    .slice(0, limit);
}

// -------------------------------------------------------------------------------------------------
// Position distribution, sentiment, outcomes per platform

/** Shares of the order in which we are named, from the mean order (a geometric spread: 1st, 2nd, 3rd, 4th or later). */
export function positionShares(mean) {
  const stay = clamp(1 - 1 / mean, 0, 0.95);
  const first = 1 - stay;
  return [first, first * stay, first * stay ** 2, stay ** 3];
}

// -------------------------------------------------------------------------------------------------
// Traffic (GA4 sample), fan-out and activity

export const GA4_CONNECTED = false;
const REFERRAL_SOURCES = [
  { code: 'chatgpt_web', name: 'ChatGPT', host: 'chatgpt.com', sessions: 1420 },
  { code: 'gemini_web', name: 'Gemini', host: 'gemini.google.com', sessions: 610 },
];
export function trafficFor(model) {
  // Google AI Mode and AI Overview sessions cannot be told from Google organic in GA4 (doc 16 section 10)
  const share = model.prompts.length === 0 ? 0 : model.average.visibility.value ?? 0.3;
  const scale = model.scope.group === 'all' ? 1 : clamp(model.prompts.length / 250, 0.05, 1) * (0.7 + share);
  const sources = REFERRAL_SOURCES.filter((source) => model.codes.includes(source.code)).map((source) => {
    const sessions = Math.round(source.sessions * scale);
    return { ...source, sessions, series: weekly(sessions * 0.86, sessions, `traffic|${model.key}|${source.code}`, sessions * 0.04, null).map((value) => Math.round(value / 4)) };
  });
  const pages = [
    ['/pricing', 0.24],
    ['/blog/best-crm-for-startups', 0.19],
    ['/compare/hubspot-alternative', 0.15],
    ['/features/pipeline', 0.11],
    ['/guides/sales-forecasting', 0.08],
  ];
  const total = sources.reduce((sum, source) => sum + source.sessions, 0);
  return { unavailable: model.scope.platform === 'google_ai_mode' || model.scope.platform === 'google_ai_overview', sources, total, pages: pages.map(([path, part]) => ({ path: `northwind.com${path}`, sessions: Math.round(total * part), events: Math.round(total * part * 0.062) })) };
}

const FANOUT = [
  ['crm pricing comparison 2026', 148, 31, 'g2.com'],
  ['best crm for small business reviews', 121, 27, 'capterra.com'],
  ['hubspot vs pipedrive features', 96, 19, 'hubspot.com'],
  ['crm with email tracking', 84, 22, 'techradar.com'],
  ['sales pipeline software free trial', 71, 16, 'zapier.com'],
  ['crm integrations with gmail and slack', 58, 14, 'northwind.com'],
  ['crm for startups under 10 users', 52, 12, 'reddit.com'],
  ['sales forecasting tools comparison', 44, 11, 'forbes.com'],
];
export function fanoutFor(model) {
  const available = model.codes.includes('chatgpt_web');
  const scale = model.scope.group === 'all' ? 1 : clamp(model.prompts.length / 250, 0.04, 1);
  const rows = FANOUT.map(([query, answers, prompts, domain]) => ({ query, answers: Math.max(2, Math.round(answers * scale)), prompts: Math.max(1, Math.round(prompts * scale)), domain }));
  return { available, rows: rows.filter((row) => row.answers >= 2), meanQueries: 3.4, presence: 0.96 };
}

export const RUN_CALENDAR = {
  weeks: WEEKS,
  // 'ok', 'partial' (some answers failed) or 'missed'
  status: {
    chatgpt_web: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
    gemini_web: ['ok', 'ok', 'ok', 'ok', 'partial', 'ok', 'ok', 'ok'],
    google_ai_mode: ['ok', 'ok', 'ok', 'ok', 'ok', 'partial', 'ok', 'ok'],
    google_ai_overview: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  },
  notes: { 'gemini_web:4': '38 of 250 answers failed', 'google_ai_mode:5': '12 of 250 answers failed' },
};
export const lastRunOf = (code) => LAST_RUN_BY_PLATFORM[code];
