/**
 * The catalog: every card type and headline number a person can place, and the built-in default of each screen.
 * The catalog is code, not data, so every card is a reviewed component that keeps the data rules
 * (spec section 7.4). Adding a card type here does not add it to anyone's layout (spec section 6.4).
 */
import type {
  CardTypeDefinition,
  Channel,
  EngineCode,
  NumberDefinition,
  OptionDefinition,
  ScreenDefinition,
  ScreenKey,
  Width,
} from './types';

export const LIMITS = { cards: 12, numbers: 6 } as const;

export const ENGINES: ReadonlyArray<{ code: EngineCode; label: string }> = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
  { code: 'google_ai_overview', label: 'AI Overview' },
];

const ROWS_5_10: OptionDefinition = {
  label: 'Rows',
  values: [
    { value: '5', label: '5 rows' },
    { value: '10', label: '10 rows' },
  ],
  default: '5',
};
const ENGINE_OPTION: OptionDefinition = {
  label: 'Engine',
  values: ENGINES.map((e) => ({ value: e.code, label: e.label })),
  default: 'chatgpt_web',
};

const SEO: { all: Channel[]; any: Channel[] } = { all: ['seo'], any: [] };
const AI: { all: Channel[]; any: Channel[] } = { all: ['ai'], any: [] };
const BOTH: { all: Channel[]; any: Channel[] } = { all: ['seo', 'ai'], any: [] };
const EITHER: { all: Channel[]; any: Channel[] } = { all: [], any: ['seo', 'ai'] };
const NONE: { all: Channel[]; any: Channel[] } = { all: [], any: [] };

/** Release dates drive the catalog's "New" badge (30 days). Cards that existed before customization are not new. */
const ORIGINAL = '2026-06-01';
const RELEASE = '2026-09-30';

function dashboardCard(
  key: string,
  title: string,
  description: string,
  group: CardTypeDefinition['group'],
  widths: Width[],
  channels: CardTypeDefinition['channels'],
  extra: Partial<Pick<CardTypeDefinition, 'options' | 'maxInstances' | 'addedOn'>> = {},
): CardTypeDefinition {
  return {
    key,
    title,
    description,
    group,
    screens: ['overview'],
    widths,
    maxInstances: 1,
    options: {},
    channels,
    permission: null,
    integration: null,
    status: 'active',
    addedOn: ORIGINAL,
    ...extra,
  };
}

function drawerCard(
  key: string,
  title: string,
  description: string,
  group: CardTypeDefinition['group'],
  channels: CardTypeDefinition['channels'],
  addedOn = ORIGINAL,
): CardTypeDefinition {
  return {
    key,
    title,
    description,
    group,
    screens: ['inspector.keyword'],
    widths: [],
    maxInstances: 1,
    options: {},
    channels,
    permission: null,
    integration: null,
    status: 'active',
    addedOn,
  };
}

export const CARD_TYPES: ReadonlyArray<CardTypeDefinition> = [
  dashboardCard(
    'trend.visibility_mentions',
    'Visibility and mention rate',
    'How SEO visibility and each engine’s mention rate moved over the window.',
    'cross',
    ['two_thirds', 'full'],
    EITHER,
  ),
  dashboardCard(
    'seo.rank_distribution',
    'Rank distribution',
    'How many keywords sit in each rank bucket at the latest check.',
    'seo',
    ['third', 'half'],
    SEO,
  ),
  dashboardCard(
    'seo.top_movers',
    'Top movers',
    'The keywords whose rank changed most in the window.',
    'seo',
    ['half', 'third'],
    SEO,
    {
      addedOn: RELEASE,
      options: {
        direction: {
          label: 'Show',
          values: [
            { value: 'all', label: 'Improved and declined' },
            { value: 'improved', label: 'Improved only' },
            { value: 'declined', label: 'Declined only' },
          ],
          default: 'all',
        },
        rows: ROWS_5_10,
      },
    },
  ),
  dashboardCard(
    'seo.serp_features',
    'SERP features',
    'Which result features appear for your keywords, and where you appear in them.',
    'seo',
    ['third', 'half'],
    SEO,
    { addedOn: RELEASE },
  ),
  dashboardCard(
    'ai.by_engine',
    'AI by engine',
    'Mention, citation and recommendation rates for each engine, side by side.',
    'ai',
    ['half', 'two_thirds', 'full'],
    AI,
  ),
  dashboardCard(
    'ai.mention_trend',
    'Mention rate trend',
    'One engine’s mention rate over the window, with its interval.',
    'ai',
    ['half', 'two_thirds', 'full'],
    AI,
    {
      addedOn: RELEASE,
      maxInstances: 4,
      options: { engine: ENGINE_OPTION },
    },
  ),
  dashboardCard(
    'ai.citation_share_by_domain_type',
    'Citation share by domain type',
    'Whose pages AI answers cite: yours, competitors, publishers and others.',
    'ai',
    ['third', 'half'],
    AI,
    { addedOn: RELEASE },
  ),
  dashboardCard(
    'cross.matrix_summary',
    'SEO and AI matrix',
    'Keywords grouped by whether they are strong in search, in AI answers, or both.',
    'cross',
    ['half', 'two_thirds'],
    BOTH,
  ),
  dashboardCard(
    'cross.unclassified',
    'Not classified',
    'Keywords the matrix could not place, and why.',
    'cross',
    ['third', 'half'],
    BOTH,
  ),
  dashboardCard(
    'cross.opportunities',
    'Opportunities',
    'Conditions worth acting on, such as ranking in the top 3 without an AI citation.',
    'cross',
    ['half', 'third'],
    BOTH,
    {
      options: { rows: ROWS_5_10 },
    },
  ),
  dashboardCard(
    'competitors.summary',
    'Competitors',
    'Your share of voice and visibility next to each tracked competitor.',
    'cross',
    ['half', 'two_thirds', 'full'],
    EITHER,
  ),
  dashboardCard(
    'competitors.share_of_voice',
    'Share of voice',
    'Share of voice as bars, for search or for one AI engine.',
    'cross',
    ['third', 'half'],
    EITHER,
    {
      addedOn: RELEASE,
      options: {
        channel: {
          label: 'Channel',
          values: [{ value: 'seo', label: 'Search' }, ...ENGINES.map((e) => ({ value: e.code, label: e.label }))],
          default: 'seo',
        },
      },
    },
  ),
  dashboardCard(
    'activity.key_changes',
    'Key changes',
    'Detectable changes and collection issues in the window, most urgent first.',
    'activity',
    ['half', 'two_thirds', 'full'],
    NONE,
    {
      options: {
        rows: {
          label: 'Rows',
          values: [
            { value: '5', label: '5 rows' },
            { value: '8', label: '8 rows' },
          ],
          default: '8',
        },
      },
    },
  ),
  dashboardCard(
    'activity.collection_status',
    'Collection status',
    'When data was last collected, what is scheduled next, and what failed.',
    'activity',
    ['third', 'half'],
    NONE,
    { addedOn: RELEASE },
  ),

  drawerCard('inspector.key_numbers', 'Key numbers', 'Rank, average rank and search volume.', 'seo', SEO),
  drawerCard(
    'inspector.rank_history',
    'Rank history',
    'This keyword’s rank over time, with two competitors.',
    'seo',
    SEO,
  ),
  drawerCard(
    'inspector.ai_by_engine',
    'AI mentions by engine',
    'Share of responses to linked prompts that mention you, per engine.',
    'ai',
    AI,
  ),
  drawerCard(
    'inspector.competing_domains',
    'Competing domains',
    'The domains ranking for this keyword and how they moved.',
    'seo',
    SEO,
  ),
  drawerCard(
    'inspector.serp_features',
    'SERP features',
    'Which result features appeared for this keyword in recent checks.',
    'seo',
    SEO,
    RELEASE,
  ),
  drawerCard(
    'inspector.url_history',
    'Ranking URL history',
    'Which of your pages ranked for this keyword, and when it changed.',
    'seo',
    SEO,
    RELEASE,
  ),
];

function seoNumber(metric: string, label: string): NumberDefinition {
  return { metric, label, channel: 'seo', perEngine: false, screens: ['overview'] };
}
function aiNumber(metric: string, label: string): NumberDefinition {
  return { metric, label, channel: 'ai', perEngine: true, screens: ['overview'] };
}

export const NUMBER_TYPES: ReadonlyArray<NumberDefinition> = [
  seoNumber('seo.keywords_tracked', 'Keywords tracked'),
  seoNumber('seo.visibility_volume', 'SEO visibility'),
  seoNumber('seo.visibility_equal', 'SEO visibility, equal-weight'),
  seoNumber('seo.top3_count', 'Top 3'),
  seoNumber('seo.top10_count', 'Top 10'),
  seoNumber('seo.top20_count', 'Top 20'),
  seoNumber('seo.average_rank', 'Average rank'),
  seoNumber('seo.est_clicks', 'Estimated clicks'),
  seoNumber('seo.aio_citation_rate', 'AIO citation rate'),
  seoNumber('seo.share_of_voice', 'SEO share of voice'),
  aiNumber('ai.mention_rate', 'Mention rate'),
  aiNumber('ai.citation_rate', 'Citation rate'),
  aiNumber('ai.recommendation_rate', 'Recommendation rate'),
  aiNumber('ai.share_of_voice', 'Share of voice'),
];

export const SCREENS: Readonly<Record<ScreenKey, ScreenDefinition>> = {
  overview: {
    key: 'overview',
    title: 'Overview',
    zones: { numbers: true, cards: true, widths: true },
    builtin: {
      schema: 1,
      numbers: [
        { id: 'visibility', metric: 'seo.visibility_volume' },
        { id: 'top10', metric: 'seo.top10_count' },
        { id: 'aio-citation', metric: 'seo.aio_citation_rate' },
        { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
        { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
        { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' },
      ],
      cards: [
        { id: 'trend', type: 'trend.visibility_mentions', width: 'two_thirds' },
        { id: 'rank-distribution', type: 'seo.rank_distribution', width: 'third' },
        { id: 'matrix', type: 'cross.matrix_summary', width: 'half' },
        { id: 'unclassified', type: 'cross.unclassified', width: 'half' },
        { id: 'key-changes', type: 'activity.key_changes', width: 'half', options: { rows: '8' } },
        { id: 'opportunities', type: 'cross.opportunities', width: 'half', options: { rows: '5' } },
        { id: 'ai-by-engine', type: 'ai.by_engine', width: 'half' },
        { id: 'competitors', type: 'competitors.summary', width: 'half' },
      ],
    },
  },
  'inspector.keyword': {
    key: 'inspector.keyword',
    title: 'Keyword',
    zones: { numbers: false, cards: true, widths: false },
    builtin: {
      schema: 1,
      cards: [
        { id: 'key-numbers', type: 'inspector.key_numbers' },
        { id: 'rank-history', type: 'inspector.rank_history' },
        { id: 'ai-by-engine', type: 'inspector.ai_by_engine' },
        { id: 'competing-domains', type: 'inspector.competing_domains' },
      ],
    },
  },
};

const CARD_TYPE_BY_KEY = new Map(CARD_TYPES.map((type) => [type.key, type]));
const NUMBER_TYPE_BY_METRIC = new Map(NUMBER_TYPES.map((type) => [type.metric, type]));
const ENGINE_CODES = new Set<string>(ENGINES.map((engine) => engine.code));

export function cardType(key: string): CardTypeDefinition | undefined {
  return CARD_TYPE_BY_KEY.get(key);
}

export function numberType(metric: string): NumberDefinition | undefined {
  return NUMBER_TYPE_BY_METRIC.get(metric);
}

export function isEngineCode(value: unknown): value is EngineCode {
  return typeof value === 'string' && ENGINE_CODES.has(value);
}

/**
 * The option that tells the instances of a reusable type apart: its first option. Two "Mention rate trend"
 * cards must be for different engines. Null for types that can be placed only once.
 */
export function identityOption(type: CardTypeDefinition): string | null {
  if (type.maxInstances <= 1) return null;
  return Object.keys(type.options)[0] ?? null;
}

/** A card type's options at their defaults, or undefined when the type has no options. */
export function defaultOptions(type: CardTypeDefinition): Record<string, string> | undefined {
  const entries = Object.entries(type.options);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, option]) => [key, option.default]));
}
