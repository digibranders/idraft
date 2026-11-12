import { EVENTUS_WORLD, type DefinitionWorld } from './ai-prompt-world';
import { isAiSeeded } from './ai-seed';
import {
  buildAnswer,
  CITATION_KINDS,
  invalidAnswer,
  PROVIDER_CHECK,
  webAddress,
  type Answer,
  type Party,
  type Planned,
  type Site,
  type SourceSpec,
} from './answer-builder';
import { GULF_LOCATIONS, MOCK_ENTITY_IDS, MOCK_LOCATIONS, MOCK_TERM_IDS } from './entity-fixtures';
import { usdOfMicros } from './factories/operations';
import { MOCK_CREATED_AT, MOCK_PROJECTS, mockUser } from './fixtures';
import { mockId } from './mock-ids';
import { AI_ANSWER_MICROS } from './operations-fixtures';
import { profileAnswer } from './profile-answers';
import type { EngineCode, ProjectEngine, Prompt } from '@/lib/api/types';

export { webAddress, type Answer };

/**
 * The AI prompt tracking fixtures (spec 2026-11-11, plans A and B): the three engines, Fynix's engines and its
 * 24 prompts, and the answers each fixture prompt got. Answers are made from the clock, on Monday and Thursday
 * at 02:00 UTC as the base plan runs them, so every window has some. A prompt added through the mocks joins
 * the prompts in memory (./prompts-state.ts) and has no answer: in the app its answers come from the next run.
 */

export const ENGINE_CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const satisfies readonly EngineCode[];

/** The engine facts of plan A's `idraft.domain.ai_engines.ENGINES`. */
export const ENGINE_FACTS: Readonly<Record<EngineCode, ProjectEngine['engine']>> = {
  chatgpt_web: {
    engine_code: 'chatgpt_web',
    label: 'ChatGPT',
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: true,
    max_prompt_chars: 2000,
  },
  gemini_web: {
    engine_code: 'gemini_web',
    label: 'Gemini',
    observation_class: 'consumer_ui',
    vendor: 'google',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 2000,
  },
  google_ai_mode: {
    engine_code: 'google_ai_mode',
    label: 'Google AI Mode',
    observation_class: 'serp_ai',
    vendor: 'google',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 700,
  },
};

/** The base plan (spec section 4.7): 150 active prompts a workspace, asked twice a week. */
export const PROMPT_QUOTA = 150;
/** The longest prompt any engine takes (plan A `PROMPT_TEXT_MAX`). */
export const PROMPT_TEXT_MAX = 2000;
const RUNS_PER_WEEK = 2;
const MICROS_PER_CENT = 10_000;

/** Plan A's `monthly_cost`: prompts x runs a week x 52 / 12 x the price, to the cent, as the API writes money. */
export const monthlyCostUsd = (prompts: number): string =>
  usdOfMicros(Math.round((prompts * RUNS_PER_WEEK * AI_ANSWER_MICROS * 52) / 12 / MICROS_PER_CENT) * MICROS_PER_CENT);

export interface StoredPrompt {
  prompt_id: string;
  version_id: string;
  project_id: string;
  /** Its place among the project's fixture prompts, which its answers are made from; `null` for one added here. */
  index: number | null;
  text: string;
  language_code: string;
  country_iso: string;
  term_ids: string[];
  intent: Prompt['intent'];
  funnel_stage: Prompt['funnel_stage'];
  prompt_type: Prompt['prompt_type'];
  importance: number;
  is_branded: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: { user_id: string; name: string; email: string } | null;
}

export interface StoredEngine {
  engine_code: EngineCode;
  is_enabled: boolean;
  location_ids: number[];
}

const VERSION_OFFSET = 500_000;
export const promptId = (n: number): string => mockId('prompt', n);
export const versionId = (n: number): string => mockId('prompt', VERSION_OFFSET + n);

const T = MOCK_TERM_IDS;
/** "Which is the best SEO agency in India?" in Hindi, from code points so this file stays ASCII. */
const HINDI_PROMPT = String.fromCodePoint(
  ...[
    0x92d, 0x93e, 0x930, 0x924, 0x20, 0x92e, 0x947, 0x902, 0x20, 0x938, 0x92c, 0x938, 0x947, 0x20, 0x905, 0x91a, 0x94d,
    0x91b, 0x940, 0x20, 0x53, 0x45, 0x4f, 0x20, 0x90f, 0x91c, 0x947, 0x902, 0x938, 0x940, 0x20, 0x915, 0x94c, 0x928,
    0x20, 0x938, 0x940, 0x20, 0x939, 0x948, 0x3f,
  ],
);
/** Text, topic, language and country. Line 6 is Hindi and line 8 names the own brand. */
const FYNIX_PROMPTS: readonly (readonly [string, string | null, string, string])[] = [
  ['Which SEO agency is best for a SaaS startup in Germany?', T.seo, 'en', 'DE'],
  ['How do I run a technical SEO audit on a large site?', T.technicalSeo, 'en', 'DE'],
  ['What does a local SEO agency do for a shop in Berlin?', T.localSeo, 'en', 'DE'],
  ['Which agencies write content strategies for B2B software?', T.contentMarketing, 'en', 'DE'],
  ['How often should a company blog publish new posts?', T.blogStrategy, 'en', 'DE'],
  [HINDI_PROMPT, T.seo, 'hi', 'IN'],
  ['What is the best way to manage paid search on a small budget?', T.paidSearch, 'en', 'DE'],
  ['Is Fynix a good SEO agency for software companies?', T.seo, 'en', 'DE'],
  ['How do I fix crawl errors that Google reports?', T.technicalSeo, 'en', 'DE'],
  ['Which tools track local rankings by city?', T.localSeo, 'en', 'DE'],
  ['How do I plan a content calendar for a year?', T.contentMarketing, 'en', 'DE'],
  ['What makes a blog post appear in AI answers?', T.blogStrategy, 'en', 'DE'],
  ['Should a startup hire an SEO agency or a freelancer?', T.seo, 'en', 'DE'],
  ['How long does a technical SEO migration take?', T.technicalSeo, 'en', 'DE'],
  ['How do reviews affect local search results?', T.localSeo, 'en', 'DE'],
  ['Which agencies measure content marketing results well?', T.contentMarketing, 'en', 'DE'],
  ['What is a good length for a B2B blog post?', T.blogStrategy, 'en', 'DE'],
  ['How do I lower the cost per click of search ads?', T.paidSearch, 'en', 'DE'],
  ['Which SEO agencies work with fintech companies?', T.seo, 'en', 'DE'],
  ['What is the difference between SEO and paid search?', null, 'en', 'DE'],
  ['How do I find the questions buyers ask AI assistants?', null, 'en', 'DE'],
  ['Which agency can audit Core Web Vitals?', T.technicalSeo, 'en', 'DE'],
  ['How do I get cited by ChatGPT for my product category?', T.contentMarketing, 'en', 'DE'],
  ['Which SEO agency in Europe has the best case studies?', T.seo, 'en', 'DE'],
];

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const FYNIX_PROJECT_ID = fynix.project_id;
const owner = mockUser('owner');

export const FIXTURE_PROMPTS: ReadonlyMap<string, readonly StoredPrompt[]> = new Map([
  [
    fynix.project_id,
    FYNIX_PROMPTS.map(([text, term, language, country], index): StoredPrompt => ({
      prompt_id: promptId(index + 1),
      version_id: versionId(index + 1),
      project_id: fynix.project_id,
      index,
      text,
      language_code: language,
      country_iso: country,
      term_ids: term === null ? [] : [term],
      intent: 'unknown',
      funnel_stage: 'unknown',
      prompt_type: 'question',
      importance: 3,
      is_branded: text.includes('Fynix'),
      is_active: true,
      created_at: MOCK_CREATED_AT,
      updated_at: MOCK_CREATED_AT,
      created_by: { user_id: owner.user_id, name: owner.name, email: owner.email },
    })),
  ],
]);

/** Fynix asks ChatGPT and Gemini in Germany and India; AI Mode is off. The other projects have no engine yet. */
export const FIXTURE_ENGINES: ReadonlyMap<string, readonly StoredEngine[]> = new Map([
  [
    fynix.project_id,
    [
      { engine_code: 'chatgpt_web', is_enabled: true, location_ids: [2276, 2356] },
      { engine_code: 'gemini_web', is_enabled: true, location_ids: [2276, 2356] },
    ],
  ],
]);

/**
 * The projects whose answers are made from a definition file (`fixtures/ai-prompts/`) instead of Fynix's formulas:
 * their prompts and engines, and the answers each prompt got. They exist only while the data switch is on
 * (./ai-seed.ts), because 72 more active prompts move the workspace's use of its 150 prompt quota, which tests count.
 */
const PROFILE_WORLDS: ReadonlyMap<string, DefinitionWorld> = new Map([[EVENTUS_WORLD.projectId, EVENTUS_WORLD]]);
/** Fynix has prompt numbers 1 to 24; the next project's start after them, and stay below `FIRST_MINTED`. */
const PROFILE_FIRST_PROMPT = 25;

function countryLocation(iso: string): number {
  const found = [...MOCK_LOCATIONS, ...GULF_LOCATIONS].find(
    (location) => location.location_type === 'Country' && location.country_iso === iso,
  );
  if (found === undefined) throw new Error(`No country location for ${iso}`);
  return found.location_id;
}

const PROFILE_PROMPTS: ReadonlyMap<string, readonly StoredPrompt[]> = new Map(
  [...PROFILE_WORLDS].map(([projectId, world]) => [
    projectId,
    world.definition.prompts.map((prompt, index): StoredPrompt => ({
      prompt_id: promptId(PROFILE_FIRST_PROMPT + index),
      version_id: versionId(PROFILE_FIRST_PROMPT + index),
      project_id: projectId,
      index,
      text: prompt.text,
      language_code: world.definition.project.language_code,
      country_iso: prompt.country,
      term_ids: prompt.topics.map((slug) => world.termIdOf(slug)).sort(),
      intent: prompt.intent,
      funnel_stage: prompt.funnel_stage,
      prompt_type: prompt.prompt_type,
      importance: prompt.importance,
      is_branded: prompt.branded,
      is_active: true,
      created_at: MOCK_CREATED_AT,
      updated_at: MOCK_CREATED_AT,
      created_by: { user_id: owner.user_id, name: owner.name, email: owner.email },
    })),
  ]),
);

const PROFILE_ENGINES: ReadonlyMap<string, readonly StoredEngine[]> = new Map(
  [...PROFILE_WORLDS].map(([projectId, world]) => [
    projectId,
    world.definition.engines.map((engine): StoredEngine => ({
      engine_code: engine.engine_code,
      is_enabled: true,
      location_ids: engine.countries.map(countryLocation).sort((a, b) => a - b),
    })),
  ]),
);

/** The prompts a project starts with: Fynix's, or a definition file's while the data switch is on. */
export const fixturePrompts = (projectId: string): readonly StoredPrompt[] =>
  FIXTURE_PROMPTS.get(projectId) ?? (isAiSeeded() ? PROFILE_PROMPTS.get(projectId) : undefined) ?? [];

/** The engines a project starts with, on the same terms. */
export const fixtureEngines = (projectId: string): readonly StoredEngine[] =>
  FIXTURE_ENGINES.get(projectId) ?? (isAiSeeded() ? PROFILE_ENGINES.get(projectId) : undefined) ?? [];

export const DAY_MS = 86_400_000;
/** Answers reach back as far as one request may ask for: 92 days. */
const HISTORY_DAYS = 92;
/** The base plan asks at 02:00 UTC. */
export const RUN_OFFSET_MS = 2 * 3_600_000;
const RUN_WEEKDAYS: readonly number[] = [1, 4];

/** The run times of the last 92 days, newest first: Monday and Thursday at 02:00 UTC, none in the future. */
export function runInstants(now: number): number[] {
  const today = Math.floor(now / DAY_MS);
  const runs: number[] = [];
  for (let day = today; day > today - HISTORY_DAYS; day -= 1) {
    const at = day * DAY_MS + RUN_OFFSET_MS;
    if (RUN_WEEKDAYS.includes(new Date(at).getUTCDay()) && at <= now) runs.push(at);
  }
  return runs;
}

/** An answer's number: its day (days since 1970, UTC), the prompt's place and the engine's, so it can be made again. */
export const observationIdOf = (day: number, index: number, engine: number): string =>
  String(day * 10_000 + index * 10 + engine);

/** What `observationIdOf` put in a number, or `null` for a number that is none of ours. */
export function parseObservationId(id: string): { day: number; index: number; engine: number } | null {
  if (!/^[1-9]\d{4,14}$/.test(id)) return null;
  const value = Number(id);
  const engine = value % 10;
  return engine < ENGINE_CODES.length
    ? { day: Math.floor(value / 10_000), index: Math.floor((value % 10_000) / 10), engine }
    : null;
}

/** Text built from code points, so this file stays ASCII (the Hindi of the answers, and two emoji). */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const HINDI_INTRO = cp(
  ...[0x907, 0x938, 0x20, 0x938, 0x935, 0x93e, 0x932, 0x20, 0x915, 0x947, 0x20, 0x932, 0x93f, 0x90f, 0x20],
  ...[0x915, 0x941, 0x91b, 0x20, 0x935, 0x93f, 0x915, 0x932, 0x94d, 0x92a, 0x20, 0x939, 0x948, 0x902, 0x964],
);
const HINDI_OUTRO = cp(
  ...[0x92b, 0x93c, 0x948, 0x938, 0x932, 0x93e, 0x20, 0x915, 0x930, 0x928, 0x947, 0x20, 0x938, 0x947, 0x20],
  ...[0x92a, 0x939, 0x932, 0x947, 0x20, 0x909, 0x928, 0x915, 0x947, 0x20, 0x909, 0x926, 0x93e, 0x939, 0x930],
  ...[0x923, 0x20, 0x926, 0x947, 0x916, 0x947, 0x902, 0x964],
);
/** Two characters past U+FFFF: each takes two UTF-16 units, which a viewer that counts characters gets wrong. */
const MAGNIFIER = cp(0x1f50e);
const PIN = cp(0x1f4cc);
const INTRO = 'Here is how the options compare for this question.';
const OUTRO = 'Compare their case studies before you decide.';

const MODELS: Readonly<Record<EngineCode, string | null>> = {
  chatgpt_web: 'gpt-6',
  gemini_web: '3.5 Flash-Lite',
  google_ai_mode: null,
};

interface FynixParty extends Party {
  /** What an answer says about it: the name is the first words. */
  sentence: string;
}

const party = (entityId: string, name: string, role: Party['role'], rest: string): FynixParty => ({
  entity_id: entityId,
  name,
  role,
  sentence: `${name} ${rest}`,
});
const OWN = party(MOCK_ENTITY_IDS.fynix, 'Fynix', 'own', 'publishes its audit method and its case studies.');
const BRIGHTWAVE = party(
  MOCK_ENTITY_IDS.brightwave,
  'Brightwave Digital',
  'competitor',
  'is often named for content work.',
);
const RANKFORGE = party(MOCK_ENTITY_IDS.rankforge, 'Rankforge', 'competitor', 'focuses on B2B software companies.');
const NORTHLIGHT = party(MOCK_ENTITY_IDS.northlight, 'Northlight SEO', 'competitor', 'may suit small teams.');
const SEO_WEEKLY = party(MOCK_ENTITY_IDS.seoWeekly, 'SEO Weekly', 'watch', 'covers the topic every week.');
/** Fynix's product: named, it counts as Fynix and has a mention of its own that is not numbered. */
const PRODUCT_NAME = 'Fynix Audit';

const OWN_SITE: Site = {
  url: 'https://fynix.digital/seo-audit',
  host: 'fynix.digital',
  title: 'SEO audits | Fynix',
  source_name: 'Fynix',
  role: 'own',
  entity_id: MOCK_ENTITY_IDS.fynix,
};
const BRIGHTWAVE_SITE: Site = {
  url: 'https://brightwave.digital/blog',
  host: 'brightwave.digital',
  title: 'Content strategy | Brightwave Digital',
  source_name: 'Brightwave Digital',
  role: 'competitor',
  entity_id: MOCK_ENTITY_IDS.brightwave,
};
const GUIDE_SITE: Site = {
  url: 'https://www.searchenginejournal.com/seo-guide/',
  host: 'www.searchenginejournal.com',
  title: 'The SEO guide',
  source_name: 'Search Engine Journal',
  role: 'third_party',
  entity_id: null,
};
const NEWSLETTER_SITE: Site = {
  url: 'https://news.example.com/seo-digest',
  host: 'news.example.com',
  title: 'The SEO digest',
  source_name: 'Example News',
  role: 'third_party',
  entity_id: null,
};
const REDIRECT_SITE: Site = {
  url: 'https://example.org/read-more',
  host: 'example.org',
  title: 'Read more',
  source_name: 'Example',
  role: 'third_party',
  entity_id: null,
};

/** The party named in a sentence that starts with its name, or through its product. */
const plan = (who: FynixParty, viaProduct: boolean, uncertain: boolean): Planned => ({
  who,
  written: viaProduct ? PRODUCT_NAME : who.name,
  sentence: viaProduct ? `${PRODUCT_NAME} covers the technical checks.` : who.sentence,
  at: 0,
  viaProduct,
  uncertain,
});

const cache = new Map<string, Answer>();

/**
 * The answer of fixture prompt `index` on `engine` on day `day` (days since 1970, UTC). One in 29 failed, one
 * was refused, one was empty and one was cut off (partial, still valid). The own brand is named in about two
 * answers of three, and each span is in UTF-16 code units of `answer_text`, as the API's detail gives them.
 * Pure, and the same every time: the answers do not change from one request to the next. `projectId` is the
 * project the prompt is in: Fynix, unless it is one of the projects made from a definition file, whose answers
 * follow each prompt's visibility profile (./profile-answers.ts).
 */
export function answerOf(
  index: number,
  languageCode: string,
  engine: EngineCode,
  day: number,
  projectId: string = FYNIX_PROJECT_ID,
): Answer {
  const key = `${projectId} ${String(index)} ${languageCode} ${engine} ${String(day)}`;
  const found = cache.get(key);
  if (found !== undefined) return found;
  const world = PROFILE_WORLDS.get(projectId);
  const made =
    world === undefined
      ? makeAnswer(index, languageCode, engine, day)
      : profileAnswer(world, index, { code: engine, place: ENGINE_CODES.indexOf(engine) }, day);
  cache.set(key, made);
  return made;
}

/**
 * The answer Run now delivers: `answerOf` for the first day from `day` on whose answer holds facts (one in
 * 29 days fails, is refused or comes back empty, and the days cycle through every case in 29). Deterministic.
 */
export function validAnswerOf(
  index: number,
  languageCode: string,
  engine: EngineCode,
  day: number,
  projectId: string = FYNIX_PROJECT_ID,
): Answer {
  for (let shift = 0; shift < 29; shift += 1) {
    const answer = answerOf(index, languageCode, engine, day + shift, projectId);
    if (answer.facts.is_valid) return answer;
  }
  throw new Error('No day of 29 gives a valid answer');
}

function makeAnswer(index: number, languageCode: string, engine: EngineCode, day: number): Answer {
  const e = ENGINE_CODES.indexOf(engine);
  const turn = (index * 7 + day * 3 + e * 5) % 29;
  const base = {
    model_reported: MODELS[engine],
    check_url: webAddress(turn === 5 ? 'javascript:void(0)' : PROVIDER_CHECK[engine]),
  };
  if (turn === 0) return invalidAnswer('error', base);
  if (turn === 1) return invalidAnswer('refused', base);
  if (turn === 2) return invalidAnswer('empty', base);

  const hindi = languageCode === 'hi';
  const ownIn = (index + day + e) % 3 !== 0;
  const viaProduct = ownIn && (index + day * 2 + e) % 9 === 4;
  const flip = (index + day) % 4 === 3;
  const planned: Planned[] = [
    ...(ownIn ? [plan(OWN, viaProduct, false)] : []),
    ...((index + day) % 2 === 0 ? [plan(BRIGHTWAVE, false, false)] : []),
    ...((index + e) % 4 === 1 ? [plan(RANKFORGE, false, false)] : []),
    ...((index + day) % 5 === 0 ? [plan(NORTHLIGHT, false, true)] : []),
    ...((index + e + day) % 6 === 0 ? [plan(SEO_WEEKLY, false, false)] : []),
  ];
  if (flip) planned.reverse();

  // The sources, so the text can quote the one that is written in the answer
  // ChatGPT adds its own tag to every address; the canonical address and the referral tag are what is left of it
  const chatgptTag = engine === 'chatgpt_web' ? 'chatgpt.com' : null;
  const utm = chatgptTag === null ? '' : `?utm_source=${chatgptTag}`;
  const ownCited = (index + 2 * day + e) % 4 === 0;
  const brightwaveCited = planned.some((item) => item.who === BRIGHTWAVE) && day % 2 === 0;
  const inline = engine !== 'google_ai_mode' && index % 3 === 1;
  const kind = CITATION_KINDS[engine];
  const sources: SourceSpec[] = [
    ...(ownCited ? [{ site: OWN_SITE, raw: `${OWN_SITE.url}${utm}`, kind, tag: chatgptTag, flags: [] }] : []),
    ...(brightwaveCited
      ? [{ site: BRIGHTWAVE_SITE, raw: `${BRIGHTWAVE_SITE.url}${utm}`, kind, tag: chatgptTag, flags: [] }]
      : []),
    { site: GUIDE_SITE, raw: `${GUIDE_SITE.url}${utm}`, kind: inline ? 'inline' : kind, tag: chatgptTag, flags: [] },
    // An ordinary source whose address carries a campaign tag: the canonical address drops it, the referral tag keeps it
    ...((index + day) % 6 === 2
      ? [
          {
            site: NEWSLETTER_SITE,
            raw: `${NEWSLETTER_SITE.url}?utm_source=newsletter&utm_medium=email`,
            kind,
            tag: 'newsletter',
            flags: [],
          },
        ]
      : []),
    // A screen-hardening fixture, not something the API gives: the real backend never stores an address it cannot
    // read as a web address (it keeps the source for the count only), but `raw_url` checks no scheme, so a screen
    // must still never turn it into a link.
    ...(turn === 6
      ? [
          {
            site: REDIRECT_SITE,
            raw: 'javascript:void(0)',
            kind,
            tag: null,
            flags: ['unresolved_redirect'],
          },
        ]
      : []),
  ];

  // An emoji before the names moves every span on by two UTF-16 units, so a viewer must not count characters
  const intro = hindi ? HINDI_INTRO : INTRO;
  const plainOwn = planned.find((item) => item.who === OWN && !item.viaProduct);
  return buildAnswer({
    base,
    lead: index % 5 === 0 ? `${MAGNIFIER} ${intro}` : intro,
    bullet: index % 4 === 0 ? `${PIN} ` : '',
    planned,
    repeat:
      plainOwn !== undefined && (index + day) % 7 === 0
        ? { planned: plainOwn, sentence: `${OWN.name} is listed first.`, at: 0 }
        : null,
    sources,
    inline: (address) => ` See ${address} for the method.`,
    closing: turn === 3 ? ' The comparison goes on to cover pricing and...' : ` ${hindi ? HINDI_OUTRO : OUTRO}`,
    partial: turn === 3,
    product: { entity_id: MOCK_ENTITY_IDS.fynixAudit, name: PRODUCT_NAME },
  });
}
