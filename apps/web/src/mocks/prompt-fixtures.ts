import { MOCK_ENTITY_IDS, MOCK_TERM_IDS } from './entity-fixtures';
import { usdOfMicros } from './factories/operations';
import { MOCK_CREATED_AT, MOCK_PROJECTS, mockUser } from './fixtures';
import { mockId } from './mock-ids';
import type { CitationOut, EngineCode, MentionOut, ObservationDetail, ProjectEngine, Prompt } from '@/lib/api/types';

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
/** One answer on the standard queue: $0.0012, in micro dollars. */
const TASK_PRICE_MICROS = 1200;
const RUNS_PER_WEEK = 2;
const MICROS_PER_CENT = 10_000;

/** Plan A's `monthly_cost`: prompts x runs a week x 52 / 12 x the price, to the cent, as the API writes money. */
export const monthlyCostUsd = (prompts: number): string =>
  usdOfMicros(Math.round((prompts * RUNS_PER_WEEK * TASK_PRICE_MICROS * 52) / 12 / MICROS_PER_CENT) * MICROS_PER_CENT);

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

/** `value` when it is an http or https address: a provider's string is not trusted as a link (the API's `_web_address`). */
export function webAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
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

type Facts = NonNullable<ObservationDetail['facts']>;

export interface Answer {
  status: ObservationDetail['status'];
  answer_text: string | null;
  error_code: string | null;
  model_reported: string | null;
  /** The provider's page to check the answer by, as the API gives it: http or https only. */
  check_url: string | null;
  mentions: MentionOut[];
  citations: CitationOut[];
  facts: Facts;
}

const MODELS: Readonly<Record<EngineCode, string | null>> = {
  chatgpt_web: 'gpt-6',
  gemini_web: '3.5 Flash-Lite',
  google_ai_mode: null,
};
const PROVIDER_CHECK: Readonly<Record<EngineCode, string>> = {
  chatgpt_web: 'https://chatgpt.com/',
  gemini_web: 'https://gemini.google.com/app',
  google_ai_mode: 'https://www.google.com/search?udm=50',
};
/**
 * The kinds the backend stores (migration 0018 allows more, but the parser gives these): ChatGPT and Gemini give a
 * source list or inline links, Google AI Mode reference cards. An advertisement is never stored as a source
 * (providers/dataforseo/ai_parse.py drops them).
 */
const CITATION_KINDS: Readonly<Record<EngineCode, string>> = {
  chatgpt_web: 'source_list',
  gemini_web: 'source_list',
  google_ai_mode: 'reference_card',
};

interface Party {
  entity_id: string;
  name: string;
  role: 'own' | 'competitor' | 'watch';
  /** What an answer says about it: the name is the first words. */
  sentence: string;
}

const party = (entityId: string, name: string, role: Party['role'], rest: string): Party => ({
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

interface Site {
  url: string;
  host: string;
  title: string;
  source_name: string;
  role: CitationOut['domain_role'];
  entity_id: string | null;
}
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

/** Everything an answer says is about the facts of its fact row, which are what the summary counts. */
const NOT_VALID: Facts = {
  derivation_id: 1,
  is_valid: false,
  // Null for an answer that is not valid: it is in no bucket (the API's `ObservationFacts.outcome`)
  outcome: null,
  own_mentioned: false,
  own_domain_cited: false,
  own_mention_order: null,
  own_prominence: null,
  own_citation_count: 0,
  total_citation_count: 0,
  tracked_entities_mentioned: 0,
  competitor_mentions: [],
  competitor_cited: [],
  had_structured_list: false,
};

interface Planned {
  who: Party;
  /** Named through its product, which counts as the brand. */
  viaProduct: boolean;
  /** The matcher was unsure: kept as evidence, counted nowhere. */
  uncertain: boolean;
}

const cache = new Map<string, Answer>();

/**
 * The answer of fixture prompt `index` on `engine` on day `day` (days since 1970, UTC). One in 29 failed, one
 * was refused, one was empty and one was cut off (partial, still valid). The own brand is named in about two
 * answers of three, and each span is in UTF-16 code units of `answer_text`, as the API's detail gives them.
 * Pure, and the same every time: the answers do not change from one request to the next.
 */
export function answerOf(index: number, languageCode: string, engine: EngineCode, day: number): Answer {
  const key = `${String(index)} ${languageCode} ${engine} ${String(day)}`;
  const found = cache.get(key);
  if (found !== undefined) return found;
  const made = makeAnswer(index, languageCode, engine, day);
  cache.set(key, made);
  return made;
}

function makeAnswer(index: number, languageCode: string, engine: EngineCode, day: number): Answer {
  const e = ENGINE_CODES.indexOf(engine);
  const turn = (index * 7 + day * 3 + e * 5) % 29;
  const base = {
    model_reported: MODELS[engine],
    check_url: webAddress(turn === 5 ? 'javascript:void(0)' : PROVIDER_CHECK[engine]),
  };
  if (turn === 0) {
    return {
      ...base,
      status: 'error',
      answer_text: null,
      error_code: 'provider_error',
      model_reported: null,
      check_url: null,
      mentions: [],
      citations: [],
      facts: NOT_VALID,
    };
  }
  if (turn === 1) {
    return {
      ...base,
      status: 'refused',
      answer_text: 'I cannot help with that request.',
      error_code: null,
      mentions: [],
      citations: [],
      facts: NOT_VALID,
    };
  }
  if (turn === 2) {
    return {
      ...base,
      status: 'empty',
      answer_text: null,
      error_code: null,
      mentions: [],
      citations: [],
      facts: NOT_VALID,
    };
  }

  const hindi = languageCode === 'hi';
  const ownIn = (index + day + e) % 3 !== 0;
  const viaProduct = ownIn && (index + day * 2 + e) % 9 === 4;
  const flip = (index + day) % 4 === 3;
  const planned: Planned[] = [
    ...(ownIn ? [{ who: OWN, viaProduct, uncertain: false }] : []),
    ...((index + day) % 2 === 0 ? [{ who: BRIGHTWAVE, viaProduct: false, uncertain: false }] : []),
    ...((index + e) % 4 === 1 ? [{ who: RANKFORGE, viaProduct: false, uncertain: false }] : []),
    ...((index + day) % 5 === 0 ? [{ who: NORTHLIGHT, viaProduct: false, uncertain: true }] : []),
    ...((index + e + day) % 6 === 0 ? [{ who: SEO_WEEKLY, viaProduct: false, uncertain: false }] : []),
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
  const sources: { site: Site; raw: string; kind: string; tag: string | null; flags: string[] }[] = [
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

  // The text: an emoji before the names moves every span on by two UTF-16 units, so a viewer must not count characters
  let text = hindi ? HINDI_INTRO : INTRO;
  if (index % 5 === 0) text = `${MAGNIFIER} ${text}`;
  const bullet = index % 4 === 0 ? `${PIN} ` : '';
  const spans = new Map<Planned, [number, number][]>();
  for (const item of planned) {
    text += ` ${bullet}`;
    const start = text.length;
    const name = item.viaProduct ? PRODUCT_NAME : item.who.name;
    text += item.viaProduct ? `${PRODUCT_NAME} covers the technical checks.` : item.who.sentence;
    spans.set(item, [[start, start + name.length]]);
  }
  const plainOwn = planned.find((item) => item.who === OWN && !item.viaProduct);
  if (plainOwn !== undefined && (index + day) % 7 === 0) {
    text += ' ';
    const start = text.length;
    text += `${OWN.name} is listed first.`;
    spans.get(plainOwn)?.push([start, start + OWN.name.length]);
  }
  const quoted = sources.find((source) => source.kind === 'inline');
  if (quoted !== undefined) text += ` See ${quoted.raw} for the method.`;
  text += turn === 3 ? ' The comparison goes on to cover pricing and...' : ` ${hindi ? HINDI_OUTRO : OUTRO}`;

  let order = 0;
  const mentions: MentionOut[] = planned.flatMap((item) => {
    const own = item.who.role === 'own';
    const numbered = !item.uncertain && item.who.role !== 'watch';
    if (numbered) order += 1;
    const evidence = spans.get(item) ?? [];
    const first = evidence[0]?.[0] ?? 0;
    const row: MentionOut = {
      entity_id: item.who.entity_id,
      name: item.who.name,
      role: item.who.role,
      mention_count: evidence.length,
      first_char_offset: first,
      mention_order: numbered ? order : null,
      match_method: item.viaProduct ? 'via_product' : item.who.role === 'watch' ? 'alias_exact' : 'alias_word',
      mention_status: item.uncertain ? 'uncertain' : 'accepted',
      confidence: item.uncertain ? 0.45 : 0.95,
      evidence_spans: evidence,
    };
    // The product's own row is kept with no number: it is not a member of the set
    const product: MentionOut = {
      ...row,
      entity_id: MOCK_ENTITY_IDS.fynixAudit,
      name: PRODUCT_NAME,
      role: 'own',
      mention_order: null,
      match_method: 'alias_word',
    };
    return own && item.viaProduct ? [row, product] : [row];
  });
  // The API lists the numbered mentions first, by number, and the others after them
  mentions.sort(
    (a, b) =>
      (a.mention_order ?? Infinity) - (b.mention_order ?? Infinity) || a.first_char_offset - b.first_char_offset,
  );

  const citations: CitationOut[] = sources.map((source, place) => ({
    citation_index: place + 1,
    url: source.site.url,
    raw_url: source.raw,
    host: source.site.host,
    title: source.site.title,
    source_name: source.site.source_name,
    citation_kind: source.kind,
    domain_role: source.site.role,
    role_entity_id: source.site.entity_id,
    occurrences: 1,
    first_char_offset: source.kind === 'inline' ? text.indexOf(source.raw) : null,
    answer_block_index: null,
    referral_tag: source.tag,
    flags: source.flags,
  }));

  const counted = mentions.filter((mention) => mention.mention_order !== null);
  const own = counted.filter((mention) => mention.role === 'own');
  const competitors = counted.filter((mention) => mention.role === 'competitor');
  const ownCitations = citations.filter((citation) => citation.domain_role === 'own');
  const firstOwn = own[0];
  const length = [...text].length;
  const facts: Facts = {
    derivation_id: 1,
    is_valid: true,
    outcome:
      own.length > 0
        ? ownCitations.length > 0
          ? 'mentioned_and_cited'
          : 'mentioned_only'
        : ownCitations.length > 0
          ? 'cited_only'
          : 'neither',
    own_mentioned: own.length > 0,
    own_domain_cited: ownCitations.length > 0,
    own_mention_order: firstOwn?.mention_order ?? null,
    // 1 minus the first offset over the length, both in code points as the backend counts them
    own_prominence:
      firstOwn === undefined
        ? null
        : Math.round((1 - [...text.slice(0, firstOwn.first_char_offset)].length / length) * 10_000) / 10_000,
    own_citation_count: ownCitations.length,
    total_citation_count: citations.length,
    tracked_entities_mentioned: counted.length,
    competitor_mentions: competitors.map((mention) => mention.entity_id),
    competitor_cited: [
      ...new Set(
        citations.flatMap((citation) =>
          citation.domain_role === 'competitor' && citation.role_entity_id !== null ? [citation.role_entity_id] : [],
        ),
      ),
    ],
    had_structured_list: false,
  };
  return {
    ...base,
    status: turn === 3 ? 'partial' : 'complete',
    answer_text: text,
    error_code: null,
    mentions,
    citations,
    facts,
  };
}
