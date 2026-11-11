import { MOCK_TERM_IDS } from './entity-fixtures';
import { usdOfMicros } from './factories/operations';
import { MOCK_CREATED_AT, MOCK_PROJECTS, mockUser } from './fixtures';
import { mockId } from './mock-ids';
import type { EngineCode, ProjectEngine, Prompt } from '@/lib/api/types';

/**
 * The AI prompt tracking fixtures (spec 2026-11-11, plan A): the three engines, Fynix's engines and its 24
 * prompts. A prompt added through the mocks joins them in memory (./prompts-state.ts).
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
