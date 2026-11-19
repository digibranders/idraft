/**
 * Writes src/mocks/fixtures/citations-v2.json from the design preview's Citations data (design-preview/cit-data.js),
 * so the app under NEXT_PUBLIC_API_MOCKING=all shows the preview's numbers (WP-77 brief section 5). Run from apps/web:
 * `node scripts/citations-fixture.mjs`. The fixture is committed; run the script again only when cit-data.js changes.
 *
 * The preview's data imports the transpiled src/lib modules, so design-preview/core-modules.mjs runs first. The app has
 * three engine codes: the preview's Google AI Overview answers are left out (D-4). An answer is one row with its slot
 * (D-2): run r of the current window is slot 4 - r, run r of the window before is slot 8 - r.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execPath, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const preview = join(web, 'design-preview');
execFileSync(execPath, [join(preview, 'core-modules.mjs')], { stdio: 'inherit' });

const cit = await import(pathToFileURL(join(preview, 'cit-data.js')).href);
const aiov = await import(pathToFileURL(join(preview, 'aiov-data.js')).href);

const ENGINES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
/** The run time of each platform (aiov-data.js LAST_RUN_BY_PLATFORM), in Europe/Berlin, UTC+2 on these days. */
const RUN_TIME = { chatgpt_web: '02:10', gemini_web: '02:12', google_ai_mode: '02:15' };
const OFFSET = '+02:00';
/** Slot 1 to 8: the current window's runs Sep 28 back to Sep 7, then the previous window's Aug 31 back to Aug 10. */
const SLOT_DAYS = [
  '2026-09-28',
  '2026-09-21',
  '2026-09-14',
  '2026-09-07',
  '2026-08-31',
  '2026-08-24',
  '2026-08-17',
  '2026-08-10',
];
const instant = (slot, code) => new Date(`${SLOT_DAYS[slot - 1]}T${RUN_TIME[code]}:00${OFFSET}`).toISOString();
const promptUuid = (index) => `0192d1a8-c177-7000-8000-${String(index + 1).padStart(12, '0')}`;

const base = { platform: 'all', group: 'all', runs: 4, competitors: cit.DEFAULT_COMPETITORS };
const prompts = cit.promptsInScope(base);
const promptIndex = new Map(prompts.map((prompt, index) => [prompt.id, index]));
const topics = aiov.GROUPS.filter((group) => group.kind === 'topic').map((group) => group.label);
const tracked = cit.TRACKED;

// Every URL any kept answer cites, in first-seen order, with its owner
const urls = [];
const urlIndex = new Map();
const urlOf = (url) => {
  if (!urlIndex.has(url)) {
    const page = cit.pageOf(url);
    urlIndex.set(url, urls.length);
    urls.push({
      domain: page.domain,
      path: page.path,
      title: page.title,
      role: page.owner === 'own' ? 'own' : page.owner === 'competitor' ? 'competitor' : 'third_party',
      competitor: page.owner === 'competitor' ? tracked.findIndex((entry) => entry.name === page.brand) : null,
    });
  }
  return urlIndex.get(url);
};

const kept = (answer) => ENGINES.includes(answer.code);
const rowOf = (answer, slot) => [
  promptIndex.get(answer.promptId),
  ENGINES.indexOf(answer.code),
  slot,
  answer.mentioned ? 1 : 0,
  answer.urls.map(urlOf),
  tracked.map((competitor) => {
    const rival = answer.rivals.find((entry) => entry.id === competitor.id);
    return rival?.cited ? 2 : rival?.mentioned ? 1 : 0;
  }),
];
const answers = [
  ...cit
    .answersIn(base)
    .filter(kept)
    .map((answer) => rowOf(answer, 4 - answer.run)),
  ...cit
    .answersIn(base, 'previous')
    .filter(kept)
    .map((answer) => rowOf(answer, 8 - answer.run)),
];

// -------------------------------------------------------------------------------------------------
// What the screen must show, over the preview's own answers and rules

const scopeOf = (code) => ({ ...base, platform: code });
const mean = (values) => {
  const known = values.filter((value) => value !== null);
  return {
    value: known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length,
    used: known.length,
  };
};
/** D 222 to 233: per engine, answers citing you over answers and prompts citing you over prompts. */
function ratesOf(lists) {
  const per = lists.map((list) => {
    const prompts = new Set(list.map((answer) => answer.promptId));
    const covered = new Set(list.filter((answer) => answer.cited).map((answer) => answer.promptId));
    return {
      n: list.length,
      k: list.filter((answer) => answer.cited).length,
      prompts: prompts.size,
      covered: covered.size,
    };
  });
  const sum = (field) => per.reduce((total, entry) => total + entry[field], 0);
  const frequency = mean(per.map((entry) => (entry.n > 0 ? entry.k / entry.n : null)));
  const coverage = mean(per.map((entry) => (entry.prompts > 0 ? entry.covered / entry.prompts : null)));
  return {
    frequency,
    coverage,
    answers: { k: sum('k'), n: sum('n') },
    prompts: { k: sum('covered'), n: sum('prompts') },
  };
}
const distinct = (lists, pick) => new Set(lists.flat().flatMap(pick)).size;
const ownUnits = (lists) => lists.flat().reduce((sum, answer) => sum + answer.own.length, 0);

function expectedFor(codes) {
  const now = codes.map((code) => cit.answersIn(scopeOf(code)));
  const before = codes.map((code) => cit.answersIn(scopeOf(code), 'previous'));
  const a = ratesOf(now);
  const b = ratesOf(before);
  const strip = {
    answers: now.flat().length,
    prompts: distinct(now, (answer) => [answer.promptId]),
    citations: ownUnits(now),
    previousCitations: ownUnits(before),
    frequency: a.frequency.value,
    frequencyUsed: a.frequency.used,
    frequencyCounts: a.answers,
    previousFrequency: b.frequency.value,
    coverage: a.coverage.value,
    coverageUsed: a.coverage.used,
    coverageCounts: a.prompts,
    previousCoverage: b.coverage.value,
    urls: distinct(now, (answer) => answer.own),
    previousUrls: distinct(before, (answer) => answer.own),
    domains: distinct(now, (answer) => answer.urls.map((url) => url.split('/')[0])),
    previousDomains: distinct(before, (answer) => answer.urls.map((url) => url.split('/')[0])),
  };
  // Cited pages: one row per URL of the current answers; citations add up over the engines
  const rows = new Map();
  now.flat().forEach((answer) =>
    answer.urls.forEach((url) => {
      const row = rows.get(url) ?? {
        url,
        owner: cit.pageOf(url).owner,
        path: cit.pageOf(url).path,
        citations: 0,
        prompts: new Set(),
      };
      row.citations += 1;
      row.prompts.add(answer.promptId);
      rows.set(url, row);
    }),
  );
  const all = [...rows.values()];
  const topOwn = all
    .filter((row) => row.owner === 'own')
    .sort((x, y) => y.citations - x.citations || x.url.localeCompare(y.url))[0];
  // Gap analysis: per engine, then a prompt lost on any engine is a gap (D 371 to 392)
  const gapRows = new Map();
  codes.forEach((code) =>
    cit.gapRows(scopeOf(code)).forEach((row) => {
      const entry = gapRows.get(row.id) ?? { text: row.prompt.text, gap: 0, lostTo: new Set(), rivalAnswers: 0 };
      entry.gap += row.gap;
      row.lostTo.forEach((id) => entry.lostTo.add(id));
      entry.rivalAnswers += row.rivalAnswers;
      gapRows.set(row.id, entry);
    }),
  );
  const gaps = [...gapRows.values()];
  const first = [...gaps].sort(
    (x, y) =>
      y.gap - x.gap || y.lostTo.size - x.lostTo.size || y.rivalAnswers - x.rivalAnswers || x.text.localeCompare(y.text),
  )[0];
  return {
    engines: codes,
    strip,
    pages: {
      own: all.filter((row) => row.owner === 'own').length,
      competitor: all.filter((row) => row.owner === 'competitor').length,
      third_party: all.filter((row) => row.owner === 'third').length,
      all: all.length,
      topOwn: { path: topOwn.path, citations: topOwn.citations, prompts: topOwn.prompts.size },
    },
    gaps: { prompts: gaps.length, gaps: gaps.filter((row) => row.gap > 0).length, first: first.text },
  };
}

const chatgpt = expectedFor(['chatgpt_web']);
// The single engine numbers are the preview's own functions' numbers
const head = cit.headline(scopeOf('chatgpt_web'));
assert.equal(chatgpt.strip.citations, head.citations.value);
assert.equal(chatgpt.strip.previousCitations, head.citations.previous);
assert.equal(chatgpt.strip.urls, head.urls.value);
assert.equal(chatgpt.strip.domains, head.domains.value);
assert.equal(chatgpt.strip.frequency, head.frequency.value);
assert.equal(chatgpt.strip.coverage, head.coverage.value);
assert.equal(chatgpt.pages.all, cit.pageRows(scopeOf('chatgpt_web')).length);
assert.equal(chatgpt.gaps.gaps, cit.gapRows(scopeOf('chatgpt_web')).filter((row) => row.gap > 0).length);

const fixture = {
  version: 1,
  source: 'apps/web/design-preview/cit-data.js through apps/web/scripts/citations-fixture.mjs',
  engines: ENGINES,
  ownDomain: cit.OWN_DOMAIN,
  ownName: cit.OWN_NAME,
  latestRunNumber: aiov.RUNS.number,
  slots: SLOT_DAYS.map((_, index) => Object.fromEntries(ENGINES.map((code) => [code, instant(index + 1, code)]))),
  competitors: tracked.map((competitor) => ({ name: competitor.name, domain: competitor.domain })),
  topics,
  prompts: prompts.map((prompt, index) => ({
    id: promptUuid(index),
    text: prompt.text,
    topic: topics.indexOf(prompt.topic),
  })),
  urls,
  answers,
  expected: { chatgpt, enabled: expectedFor(['chatgpt_web', 'gemini_web']), three: expectedFor(ENGINES) },
};

const out = join(web, 'src', 'mocks', 'fixtures', 'citations-v2.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture)}\n`);
stdout.write(
  `Wrote ${answers.length} answers, ${urls.length} pages and ${prompts.length} prompts to src/mocks/fixtures/citations-v2.json\n`,
);
stdout.write(
  `ChatGPT: ${chatgpt.strip.citations} citations, ${chatgpt.strip.urls} own URLs, ${chatgpt.strip.domains} domains, ${chatgpt.gaps.gaps} gaps of ${chatgpt.gaps.prompts} prompts\n`,
);
