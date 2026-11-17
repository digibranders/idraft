/**
 * What the Add prompts dialog computes, with no DOM: how a pasted list is read, what each line becomes, the findings
 * of the checks, the plan of the add (answers, cost, places in the workspace, asking now) and why the add is off.
 * The same rules as src/features/prompts/add (add-model.ts, check-rows.ts, plan-block.tsx) and the mock lint of
 * src/mocks/prompt-lint-rules.ts, run on the fixture of prompts-data.js. The real app asks the API for the lint;
 * here the fixture answers, and the wording is the real catalog's (messages/en.json, prompts.add).
 */
import { formatInteger } from './vendor/format/number.js';
import { COMPETITORS, ENGINES, OWN, PROMPTS, PROMPT_QUOTA } from './prompts-data.js';

// -------------------------------------------------------------------------------------------------
// Limits and the mock project's market

export const BULK_MAX = 1000;
export const PROMPT_TEXT_MAX = 2000;
/** One manual run asks at most this many prompts, and a day allows this many runs. */
export const BULK_RUN_MAX = 150;
export const MANUAL_RUN_CAP = 20;
/** Fixture: no manual run has been used today. */
export const MANUAL_RUNS_USED = 0;
export const RUNS_PER_WEEK = 2;
/** Fixture: the price of one answer, in dollars (the real mock's 1,200 micros). AI Mode has none in the price book. */
const ANSWER_PRICE = 0.0012;
/** The next scheduled run of the fixture project: the Thursday after the fixture's today (Sep 30, 2026). */
export const NEXT_RUN = 'Oct 1, 2026 · 02:10 UTC';
const WEEKS_PER_MONTH = 52 / 12;

/** The enabled engines of the project: what each takes in characters and whether the price book has a price. */
const LIMITS = { chatgpt_web: { maxChars: 2000, priced: true }, gemini_web: { maxChars: 2000, priced: true }, google_ai_mode: { maxChars: 700, priced: false }, google_ai_overview: { maxChars: 2000, priced: true } };
export const ADD_ENGINES = ENGINES.map((engine) => ({ code: engine.code, label: engine.label, ...LIMITS[engine.code] }));

/** Fixture: the countries each engine asks in. A prompt may stand for the countries every enabled engine asks in. */
const NAMES = { US: 'United States', GB: 'United Kingdom', CA: 'Canada', IN: 'India', AU: 'Australia' };
const REACH = { chatgpt_web: ['US', 'GB', 'CA', 'IN', 'AU'], gemini_web: ['US', 'GB', 'CA', 'IN'], google_ai_mode: ['US', 'GB', 'CA', 'IN'], google_ai_overview: ['US', 'GB', 'CA', 'IN', 'AU'] };
export const COUNTRIES = Object.keys(NAMES)
  .filter((iso) => ADD_ENGINES.every((engine) => REACH[engine.code].includes(iso)))
  .map((iso) => ({ value: iso, label: NAMES[iso] }));
/** The market of every prompt of the fixture: it is what "already tracked" is read against. */
export const FIXTURE_MARKET = { country: 'US', language: 'en' };
export const DEFAULT_COUNTRY = 'US';
export const DEFAULT_LANGUAGE = 'en';
export const engineReach = () => ADD_ENGINES.map((engine) => ({ label: engine.label, count: REACH[engine.code].length }));

const LANGUAGE_CODES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'tr', 'ru', 'ar', 'hi', 'ja', 'ko', 'zh'];
const languageNames = new Intl.DisplayNames(['en-US'], { type: 'language' });
export const LANGUAGES = LANGUAGE_CODES.map((code) => ({ value: code, label: languageNames.of(code) }));

// -------------------------------------------------------------------------------------------------
// Words: lists, counts and money

export const formatList = (items) => new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(items);
/** "1 prompt", "3 prompts". */
export const count = (n, one, other = `${one}s`) => `${formatInteger(n)} ${n === 1 ? one : other}`;
const dollars = (usd) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
/** What an estimate under this many dollars is written as: "under $0.01". */
const ONE_CENT = 0.01;
const isUnderCent = (usd, answers) => answers > 0 && usd < ONE_CENT;

// -------------------------------------------------------------------------------------------------
// Reading the list

const UNSAVABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const KEPT_INVISIBLE = new Set(['‌', '‍']);
/** One line as the API stores it: control and format characters dropped (joiners kept), white space made one space. */
const cleanLine = (raw) =>
  raw
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (KEPT_INVISIBLE.has(char) ? char : ''))
    .replace(/\s+/g, ' ')
    .trim();

/** One prompt per line; blank lines and repeats are left out of `lines`, a repeat names the line it repeats. */
export function readLines(text) {
  const seen = new Map();
  const lines = [];
  const repeats = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const value = cleanLine(raw);
    if (value === '') return;
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, index + 1);
      lines.push({ text: value, line: index + 1 });
    } else repeats.push({ line: index + 1, first });
  });
  return { lines, repeats };
}

const refusalOf = (text) => ([...text].length > PROMPT_TEXT_MAX ? 'tooLong' : UNSAVABLE.test(text) ? 'unsupported' : null);

// -------------------------------------------------------------------------------------------------
// The lint rules (prompt-lint-rules.ts): what a line says about itself

const QUESTION_RUN = /[?？؟]+/g;
const COMPARISON = /(?<!\w)(?:vs\.?|versus)(?!\w)/i;
const HOW_TO = /(?<!\w)how\s+to(?!\w)/;
const SUPERLATIVE = /(?<![\w#])(?:best|top|leading|greatest|number\s+one|#1)(?!\w)/gi;
const WHY_IS_BEST = /(?<!\w)why\s+is\s+[^\s.?!][^.?!]*?\s+the\s+(best)(?!\w)/id;
const LEADING_DISTANCE = 3;
const WORDS_MIN = 5;
const WORDS_MAX = 60;
const INTERROGATIVES = new Set(['what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'is', 'are', 'can', 'could', 'should', 'does', 'do', 'did', 'will', 'would']);

const wordsOf = (text) => text.split(/\s+/).filter(Boolean).length;
const isComparison = (text) => COMPARISON.test(text);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The type the server gives a prompt when none is chosen: comparison, then how to, then a question, else other. */
export function suggestType(text) {
  const folded = text.toLowerCase();
  if (isComparison(folded)) return 'comparison';
  if (HOW_TO.test(folded)) return 'how_to';
  const leading = /^\W*(\w+)/.exec(folded)?.[1];
  if ((leading !== undefined && INTERROGATIVES.has(leading)) || /[?？؟]$/.test(folded.trimEnd())) return 'question';
  return 'other';
}

/** The own brand and the competitors a text names, each with where. */
function namedIn(text) {
  return [{ name: OWN, competitor: false }, ...COMPETITORS.map((entry) => ({ name: entry.name, competitor: true }))].flatMap((entity) => {
    const spans = [...text.matchAll(new RegExp(`(?<!\\w)${escapeRegExp(entity.name)}(?!\\w)`, 'gi'))].map((found) => [found.index, found.index + found[0].length]);
    return spans.length === 0 ? [] : [{ ...entity, spans }];
  });
}

/** The first superlative within three words of a name, or "why is <words> the best". */
function leadingWording(text, named) {
  const starts = [...text.matchAll(/\S+/g)].map((token) => token.index);
  const word = (at) => starts.filter((start) => start <= at).length - 1;
  const near = (start, end) =>
    named.some((entity) =>
      entity.spans.some(([from, to]) => {
        if (from < end && start < to) return false;
        return (end <= from ? word(from) - word(end - 1) : word(start) - word(to - 1)) <= LEADING_DISTANCE;
      }),
    );
  const hits = [...text.matchAll(SUPERLATIVE)].filter((found) => near(found.index, found.index + found[0].length));
  return hits.length > 0 || WHY_IS_BEST.test(text);
}

/** The findings of the checks on a line that will be added: `tone` is error, warning or note. */
function findingsOf(text, choice) {
  const named = namedIn(text);
  const found = [];
  const own = named.find((entity) => !entity.competitor);
  if (own) {
    found.push(
      choice.branded === 'never'
        ? { tone: 'warning', text: `Mentions ${own.name} but is marked not branded. Its answers will count in the rates.` }
        : { tone: 'note', text: `Mentions ${own.name}, so it counts as branded and stays out of the rates unless branded prompts are included.` },
    );
  }
  const compares = (choice.type === 'auto' ? suggestType(text) : choice.type) === 'comparison';
  for (const rival of named.filter((entity) => entity.competitor)) {
    const [from, to] = rival.spans[0];
    if (compares) found.push({ tone: 'note', text: `Compares with ${text.slice(from, to)}.` });
    else if (isComparison(text)) found.push({ tone: 'note', text: `Compares with ${rival.name}.` });
    else found.push({ tone: 'warning', text: `Mentions ${rival.name}. A competitor mentioned in the prompt is likely to be mentioned in the answer.` });
  }
  if (leadingWording(text, named)) found.push({ tone: 'warning', text: 'The wording leads the answer. It measures agreement, not AI visibility.' });
  if ((text.match(QUESTION_RUN) ?? []).length > 1) found.push({ tone: 'warning', text: 'Asks more than one question. Answers to it will mix them.' });
  const words = wordsOf(text);
  if (words < WORDS_MIN || words > WORDS_MAX) found.push({ tone: 'warning', text: `Has ${words} ${words === 1 ? 'word' : 'words'}. Prompts of ${WORDS_MIN} to ${WORDS_MAX} words read like real questions.` });
  for (const engine of ADD_ENGINES) {
    if ([...text].length > engine.maxChars) found.push({ tone: 'warning', text: `Too long for ${engine.label}, which skips it.` });
  }
  return found;
}

const TONE_RANK = { error: 0, warning: 1, note: 2 };
const bySeriousness = (a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone];

export const TYPE_NAMES = { question: 'question', comparison: 'comparison', recommendation: 'recommendation', how_to: 'how to', definition: 'definition', local: 'local', transactional: 'transactional', other: 'other' };

// -------------------------------------------------------------------------------------------------
// The check: each line with its outcome and reasons

const fold = (text) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/**
 * Each line of the list as a row: `group` is new, tracked, archived, repeat or refused. What is tracked is read
 * against the fixture's prompts, which stand for the market of FIXTURE_MARKET.
 * @param {{text: string, country: string, language: string, type: string, branded: string, archived: Set<string>}} input
 */
export function checkList({ text, country, language, type, branded, archived }) {
  const read = readLines(text);
  const sameMarket = country === FIXTURE_MARKET.country && language === FIXTURE_MARKET.language;
  const byText = new Map();
  const byFold = new Map();
  if (sameMarket) {
    for (const prompt of PROMPTS) {
      if (!byText.has(prompt.text)) byText.set(prompt.text, prompt);
      const key = fold(prompt.text);
      if (!byFold.has(key)) byFold.set(key, prompt);
    }
  }
  const lines = read.lines.map(({ text: value, line }) => {
    const row = { line, text: value, group: 'new', reasons: [], suggestedType: null, target: null };
    const refusal = refusalOf(value);
    if (refusal !== null) {
      row.group = 'refused';
      row.reasons = [{ tone: 'error', text: refusal === 'tooLong' ? `Longer than ${formatInteger(PROMPT_TEXT_MAX)} characters, so it cannot be added.` : 'Has a character that cannot be saved.' }];
      return row;
    }
    const tracked = byText.get(value);
    if (tracked) {
      const isArchived = archived.has(tracked.id);
      row.group = isArchived ? 'archived' : 'tracked';
      row.target = tracked.id;
      row.reasons = [{ tone: 'note', text: isArchived ? 'Archived. Restoring it brings back its history and answers.' : 'Already tracked, so it is left out.' }];
      return row;
    }
    const near = byFold.get(fold(value));
    row.reasons = [
      ...findingsOf(value, { type, branded }),
      ...(near ? [{ tone: 'note', text: `Differs from a tracked prompt only in case or spacing: “${near.text}”. Both will be asked.` }] : []),
    ].sort(bySeriousness);
    if (type === 'auto') row.suggestedType = `Type: ${TYPE_NAMES[suggestType(value)]} (from wording)`;
    return row;
  });
  const repeats = read.repeats.map(({ line, first }) => ({
    line,
    text: read.lines.find((entry) => entry.line === first)?.text ?? '',
    group: 'repeat',
    reasons: [{ tone: 'note', text: `Repeats line ${first} and is left out.` }],
    suggestedType: null,
    target: null,
  }));
  return [...lines, ...repeats].sort((a, b) => a.line - b.line);
}

export function lineCounts(rows) {
  const of = (...groups) => rows.filter((row) => groups.includes(row.group)).length;
  return { lines: rows.length, new: of('new'), tracked: of('tracked', 'archived'), archived: of('archived'), repeats: of('repeat'), refused: of('refused') };
}

/** "12 lines: 9 new, 2 already tracked, and 1 repeat"; null for a field with no line. */
export function counterText(counts) {
  if (counts.lines === 0) return null;
  const parts = [
    counts.new === 0 ? null : `${formatInteger(counts.new)} new`,
    counts.tracked === 0 ? null : `${formatInteger(counts.tracked)} already tracked${counts.archived === 0 ? '' : ` (${counts.archived} archived)`}`,
    counts.repeats === 0 ? null : count(counts.repeats, 'repeat'),
    counts.refused === 0 ? null : `${formatInteger(counts.refused)} cannot be added`,
  ].filter((part) => part !== null);
  return `${count(counts.lines, 'line')}: ${formatList(parts)}`;
}

/** The rows by outcome, errors first. A line that will be added with a warning is in Warnings and in Will be added. */
export function groupRows(rows) {
  const of = (group) => rows.filter((row) => row.group === group);
  const added = of('new');
  const warned = (reason) => reason.tone !== 'note';
  const groups = [
    { id: 'refused', rows: of('refused') },
    { id: 'warnings', rows: added.filter((row) => row.reasons.some(warned)).map((row) => ({ ...row, reasons: row.reasons.filter(warned), suggestedType: null })) },
    { id: 'new', rows: added.map((row) => ({ ...row, reasons: row.reasons.filter((reason) => !warned(reason)) })) },
    { id: 'tracked', rows: of('tracked') },
    { id: 'archived', rows: of('archived') },
    { id: 'repeat', rows: of('repeat') },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

export const GROUP_TITLES = {
  refused: (n) => `Cannot be added (${formatInteger(n)})`,
  warnings: (n) => `Warnings (${formatInteger(n)})`,
  new: (n) => `Will be added (${formatInteger(n)})`,
  tracked: (n) => `Already tracked (${formatInteger(n)})`,
  archived: (n) => `Archived (${formatInteger(n)})`,
  repeat: (n) => `Repeats in the list (${formatInteger(n)})`,
};

/** What the closed "Check the list" says: the problems, else the warnings, else that there are none. */
export function checkSummary(rows, counts, checking) {
  if (checking) return { text: 'Checking the list', tone: 'note' };
  const warned = groupRows(rows).find((group) => group.id === 'warnings')?.rows.length ?? 0;
  if (counts.refused > 0) return { text: count(counts.refused, 'line cannot be added', 'lines cannot be added'), tone: 'error' };
  if (warned > 0) return { text: count(warned, 'warning'), tone: 'warning' };
  return { text: 'No problems found', tone: 'note' };
}

// -------------------------------------------------------------------------------------------------
// The plan: what the add takes and costs

/** The answers and cost on each engine for the prompts to create: those the engine takes, asked twice a week. */
export function planNumbers(creating) {
  const engines = ADD_ENGINES.map((engine) => {
    const fit = creating.filter((text) => [...text].length <= engine.maxChars).length;
    const cents = Math.round(fit * RUNS_PER_WEEK * ANSWER_PRICE * WEEKS_PER_MONTH * 100);
    return {
      code: engine.code,
      label: engine.label,
      promptsFit: fit,
      answersPerMonth: Math.floor(fit * RUNS_PER_WEEK * WEEKS_PER_MONTH),
      monthlyCost: engine.priced ? cents / 100 : null,
      runNowAnswers: fit,
      runNowCost: engine.priced ? fit * ANSWER_PRICE : null,
    };
  });
  const priced = engines.filter((engine) => engine.monthlyCost !== null);
  const runNow = engines.filter((engine) => engine.runNowCost !== null);
  const sum = (values) => Math.round(values.reduce((total, value) => total + value, 0) * 1e6) / 1e6;
  return {
    prompts: creating.length,
    engines,
    answersPerMonth: sum(engines.map((engine) => engine.answersPerMonth)),
    monthlyCost: priced.length === 0 ? null : sum(priced.map((engine) => engine.monthlyCost)),
    runNowAnswers: sum(engines.map((engine) => engine.runNowAnswers)),
    runNowCost: runNow.length === 0 ? null : sum(runNow.map((engine) => engine.runNowCost)),
    unpriced: engines.filter((engine) => engine.monthlyCost === null).map((engine) => engine.label),
  };
}

/** The workspace's places before and after the add. */
export function quotaState(used, wouldCreate, restore) {
  const room = Math.max(0, PROMPT_QUOTA - used);
  const needs = wouldCreate + restore;
  const over = needs > room;
  return { limit: PROMPT_QUOTA, used, room, needs, after: used + needs, over, short: over ? needs - room : 0 };
}

/** What asking the prompts to create right after the add takes: one manual run for each 150 prompts. */
export function askState(plan, prompts) {
  if (prompts === 0) return null;
  const runs = Math.ceil(prompts / BULK_RUN_MAX);
  const sizes = Array.from({ length: runs }, (_, index) => Math.min(BULK_RUN_MAX, prompts - index * BULK_RUN_MAX));
  return { runs, sizes, answers: plan.runNowAnswers, cost: plan.runNowCost, used: MANUAL_RUNS_USED, limit: MANUAL_RUN_CAP, blocked: MANUAL_RUNS_USED + runs > MANUAL_RUN_CAP };
}

export function askCostText(ask) {
  if (ask.cost === null) return 'no price in the price book';
  return isUnderCent(ask.cost, ask.answers) ? `under ${dollars(ONE_CENT)}` : `about ${dollars(ask.cost)}`;
}

/** Why asking now is off, in words; null when it is possible. */
export function askReasonText(ask) {
  if (ask === null || !ask.blocked) return null;
  const left = Math.max(0, ask.limit - ask.used);
  return left === 0
    ? `Today's ${formatInteger(ask.limit)} manual runs are used. They reset at 00:00 UTC.`
    : `This ask needs ${formatInteger(ask.runs)} manual runs and ${formatInteger(left)} ${left === 1 ? 'is' : 'are'} left today. They reset at 00:00 UTC.`;
}

/** Why the add button is off, in the order the dialog says them; 'empty' is no reason, the form asks for a prompt. */
export function disabledReason(counts, quota, restore) {
  if (counts.lines === 0) return 'empty';
  if (counts.refused > 0) return 'cannotAdd';
  if (counts.new + restore === 0) return 'allTracked';
  return quota?.over === true ? 'overQuota' : null;
}

export const FIX_LINES = 'Some lines cannot be added. Fix or remove them first.';
export const ALL_TRACKED = 'Every line is already tracked.';
const overText = (quota) => `This add needs ${formatInteger(quota.needs)} places and the workspace has ${formatInteger(quota.room)}. ${quota.short === 1 ? 'Remove 1 line' : `Remove ${formatInteger(quota.short)} lines`}, or archive prompts you no longer need.`;

/**
 * Everything the plan block and the footer say, from what the check found. `lines` are the plan block's lines in
 * order (`{ slot: 'ask' }` marks where the "Ask them now" box goes); `reason` is why the add is off.
 * @param {{rows: object[], counts: object, checking: boolean, restore: number, used: number}} input
 */
export function planOf({ rows, counts, checking, restore, used }) {
  const hasLines = counts.lines > 0;
  // A list longer than one add takes, or one of lines the API refuses, is not sent to the lint: there are no numbers
  const tooMany = counts.lines - counts.repeats > BULK_MAX;
  const asked = counts.lines - counts.repeats - counts.refused > 0 && !tooMany;
  const creating = rows.filter((row) => row.group === 'new').map((row) => row.text);
  const prompts = creating.length;
  const plan = asked ? planNumbers(creating) : null;
  const quota = asked ? quotaState(used, prompts, restore) : null;
  const ask = plan === null ? null : askState(plan, prompts);
  const why = disabledReason(counts, checking ? null : quota, restore);
  const blocked = why === 'empty' ? null : why;
  const lines = [];
  const add = (text, tone) => lines.push({ text, tone });
  if (!hasLines) add('Type or paste prompts to see what the add takes and costs.');
  if (hasLines && checking) add('Checking...');
  if (plan !== null && prompts > 0) {
    const total = formatInteger(plan.answersPerMonth);
    add(
      plan.engines.every((engine) => engine.promptsFit === prompts)
        ? `About ${total} answers a month: ${count(prompts, 'prompt')} x ${count(plan.engines.length, 'platform')} x ${RUNS_PER_WEEK} runs a week.`
        : `About ${total} answers a month: ${formatList(plan.engines.map((engine) => `${engine.label} ${formatInteger(engine.answersPerMonth)}`))}.`,
    );
    const priced = plan.engines.filter((engine) => engine.monthlyCost !== null);
    if (priced.length > 0) {
      const amount = (usd, answers) => (isUnderCent(usd, answers) ? `under ${dollars(ONE_CENT)}` : dollars(usd));
      const lead = isUnderCent(plan.monthlyCost, plan.answersPerMonth) ? `Under ${dollars(ONE_CENT)}` : `About ${dollars(plan.monthlyCost)}`;
      add(`${lead} a month: ${formatList(priced.map((engine) => `${engine.label} ${amount(engine.monthlyCost, engine.answersPerMonth)}`))} (standard queue).`);
    }
    for (const label of plan.unpriced) add(`${label}: no price in the price book.`);
  }
  for (const engine of plan?.engines ?? []) {
    const limit = ADD_ENGINES.find((entry) => entry.code === engine.code).maxChars;
    if (prompts > engine.promptsFit) add(`${engine.label} skips ${formatInteger(prompts - engine.promptsFit)} of these (over ${formatInteger(limit)} characters).`);
  }
  if (quota !== null) {
    add(`Workspace prompts: ${formatInteger(quota.used)} of ${formatInteger(quota.limit)} used, ${formatInteger(quota.after)} after this add.`);
    if (restore > 0) add(`${restore === 1 ? '1 archived prompt is' : `${formatInteger(restore)} archived prompts are`} brought back as well, which the estimate leaves out.`);
    if (quota.over) add(overText(quota), 'negative');
  }
  if (ask !== null && prompts > 0) {
    add(`Asking them now adds ${count(ask.answers, 'answer')}, ${askCostText(ask)}, and uses ${formatInteger(ask.runs)} of today's ${formatInteger(ask.limit)} manual runs (${formatInteger(ask.used)} used).`);
    if (ask.runs > 1) add(`This is ${formatInteger(ask.runs)} manual runs: ${formatList(ask.sizes.map((size) => formatInteger(size)))} prompts.`);
    const reason = askReasonText(ask);
    if (reason !== null) add(reason);
    lines.push({ slot: 'ask' });
  }
  if (hasLines) add(`First scheduled answers: ${NEXT_RUN}.`);
  if (blocked === 'cannotAdd') add(FIX_LINES, 'negative');
  if (blocked === 'allTracked') add(ALL_TRACKED);

  const summary = (() => {
    if (!hasLines || prompts === 0) return null;
    const parts = [
      count(prompts, 'prompt'),
      plan === null || plan.monthlyCost === null ? null : isUnderCent(plan.monthlyCost, plan.answersPerMonth) ? `under ${dollars(ONE_CENT)} a month` : `about ${dollars(plan.monthlyCost)} a month`,
      quota === null ? null : quota.over ? `over the limit of ${formatInteger(quota.limit)}` : `${formatInteger(quota.after)} of ${formatInteger(quota.limit)}`,
    ].filter((part) => part !== null);
    return formatList(parts);
  })();
  const reason = blocked === 'cannotAdd' ? FIX_LINES : blocked === 'allTracked' ? ALL_TRACKED : blocked === 'overQuota' && quota !== null ? overText(quota) : null;
  return { lines, summary, blocked, reason, quota, ask, askReason: askReasonText(ask), plan, tooMany, prompts };
}

/** The add button's label: the lines not tracked or repeated, the refused ones and the restored ones. */
export const submitLabel = (sendCount) => (sendCount === 0 ? 'Add prompts' : `Add ${count(sendCount, 'prompt')}`);

export { dollars };
