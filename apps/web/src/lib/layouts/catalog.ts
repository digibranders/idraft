/**
 * The catalog: every card type and headline number a person can place, and the built-in default of each screen.
 * The catalog is code, not data, so every card is a reviewed component that keeps the data rules
 * (spec section 7.4). Adding a card type here does not add it to anyone's layout (spec section 6.4).
 */
import type {
  CardItem,
  CardTypeDefinition,
  Channel,
  EngineCode,
  NumberDefinition,
  NumberItem,
  OptionDefinition,
  ScreenDefinition,
  ScreenKey,
  Width,
} from './types';

export const LIMITS = { cards: 12, numbers: 6 } as const;

/** Only engines the API accepts (Q8 of WP-11): a layout naming another is refused. Add AI Overview in slice 2. */
export const ENGINES: ReadonlyArray<{ code: EngineCode; label: string }> = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
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

/** An enum option from `[value, label]` pairs. Options are project agnostic: no project, topic or competitor value. */
function enumOption(
  label: string,
  values: ReadonlyArray<readonly [string, string]>,
  fallback: string,
): OptionDefinition {
  return { label, values: values.map(([value, valueLabel]) => ({ value, label: valueLabel })), default: fallback };
}
/** A count option: the values are the counts and read as "5 rows". */
function countOption(label: string, noun: string, counts: ReadonlyArray<string>, fallback: string): OptionDefinition {
  return enumOption(
    label,
    counts.map((count) => [count, `${count} ${noun}`] as const),
    fallback,
  );
}
const METRIC_OPTION = enumOption(
  'Metric',
  [
    ['mention', 'Mention rate'],
    ['citation', 'Citation rate'],
    ['share_of_voice', 'Share of voice'],
  ],
  'mention',
);
const DIRECTION_OPTION = enumOption(
  'Direction',
  [
    ['both', 'Gaining and losing'],
    ['up', 'Gaining only'],
    ['down', 'Losing only'],
  ],
  'both',
);

const SEO: { all: Channel[]; any: Channel[] } = { all: ['seo'], any: [] };
const AI: { all: Channel[]; any: Channel[] } = { all: ['ai'], any: [] };
const BOTH: { all: Channel[]; any: Channel[] } = { all: ['seo', 'ai'], any: [] };
const EITHER: { all: Channel[]; any: Channel[] } = { all: [], any: ['seo', 'ai'] };
const NONE: { all: Channel[]; any: Channel[] } = { all: [], any: [] };

/** Release dates drive the catalog's "New" badge (30 days). Cards that existed before customization are not new. */
const ORIGINAL = '2026-06-01';
const RELEASE = '2026-09-30';
const AI_RELEASE = '2026-11-13';

/** A type reused by the AI visibility screen is listed on both screens. */
const OVERVIEW_AND_AI: ReadonlyArray<ScreenKey> = ['overview', 'ai_overview'];

function dashboardCard(
  key: string,
  title: string,
  description: string,
  group: CardTypeDefinition['group'],
  widths: Width[],
  channels: CardTypeDefinition['channels'],
  extra: Partial<Pick<CardTypeDefinition, 'options' | 'maxInstances' | 'addedOn' | 'screens' | 'permission'>> = {},
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

/**
 * A card of the AI visibility screen (inventory section 9.4): AI channel only, on `ai_overview` only, released with
 * the screen. The card packages add the other screens a card is listed for (the project Overview, the drawers).
 */
function aiCard(
  key: string,
  title: string,
  description: string,
  group: 'ai' | 'activity',
  widths: Width[],
  extra: Partial<Pick<CardTypeDefinition, 'options' | 'maxInstances' | 'permission'>> = {},
): CardTypeDefinition {
  return dashboardCard(key, title, description, group, widths, AI, {
    screens: ['ai_overview'],
    addedOn: AI_RELEASE,
    ...extra,
  });
}

/** Instances of a card that is reusable per engine, or per metric: one per value, as many as the identity has. */
const PER_ENGINE = ENGINES.length;
const PER_METRIC = METRIC_OPTION.values.length;

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

/**
 * The cards only the AI visibility screen lists (inventory 9.4, every new type of the screen except the planned ones).
 * The cards are built by the card packages (WP-34 to 37). A type whose engine, country or budget requirement the
 * catalog cannot yet express (`ai.fanout_top`, `ai.country_breakdown`, `ops.ai_spend`) states its own empty reason.
 */
const AI_OVERVIEW_CARDS: ReadonlyArray<CardTypeDefinition> = [
  aiCard(
    'ai.change_summary',
    'What changed',
    'What moved in the window, in a few sentences built from counted facts.',
    'activity',
    ['full', 'two_thirds'],
    { options: { facts: countOption('Facts', 'facts', ['3', '5'], '5') } },
  ),
  aiCard(
    'ai.rate_trend_by_engine',
    'Rates by engine over time',
    'How each engine’s rate moved week by week, with its interval.',
    'ai',
    ['two_thirds', 'full'],
    { maxInstances: PER_METRIC, options: { metric: METRIC_OPTION } },
  ),
  aiCard(
    'ai.outcome_mix',
    'Named and cited',
    'How answers split between named and cited, named only, cited only and neither.',
    'ai',
    ['third', 'half'],
  ),
  aiCard(
    'ai.answer_funnel',
    'From answer to citation',
    'How many answers name you, and how many of those also cite you.',
    'ai',
    ['third', 'half'],
  ),
  aiCard(
    'ai.share_of_voice',
    'Share of voice, one engine',
    'How the answers of one engine divide mentions between you and your competitors.',
    'ai',
    ['half', 'third'],
    {
      maxInstances: PER_ENGINE,
      options: { engine: ENGINE_OPTION, rows: countOption('Rows', 'rows', ['5', '10'], '10') },
    },
  ),
  aiCard(
    'ai.competitor_trend',
    'You vs top competitors',
    'How your share of voice moved next to your top competitors on one engine.',
    'ai',
    ['half', 'two_thirds', 'full'],
    {
      maxInstances: PER_ENGINE,
      options: { engine: ENGINE_OPTION, competitors: countOption('Competitors', 'competitors', ['3', '5'], '3') },
    },
  ),
  aiCard(
    'ai.competitor_table',
    'Competitors by engine',
    'How you and each competitor compare on every engine.',
    'ai',
    ['half', 'two_thirds', 'full'],
    {
      options: {
        metric: enumOption(
          'Metric',
          [
            ['mention', 'Mention rate'],
            ['share_of_voice', 'Share of voice'],
          ],
          'mention',
        ),
        rows: countOption('Rows', 'rows', ['5', '10'], '5'),
      },
    },
  ),
  aiCard(
    'ai.lost_to_competitor',
    'Prompts lost to a competitor',
    'Which prompts name a competitor and not you on one engine.',
    'ai',
    ['third', 'half'],
    {
      maxInstances: PER_ENGINE,
      options: { engine: ENGINE_OPTION, rows: countOption('Rows', 'rows', ['5', '10'], '5') },
    },
  ),
  aiCard(
    'ai.co_mentions',
    'Who we are named with',
    'Which brands answers name next to you on one engine.',
    'ai',
    ['half', 'two_thirds'],
    { maxInstances: PER_ENGINE, options: { engine: ENGINE_OPTION } },
  ),
  aiCard(
    'ai.sov_over_time',
    'Share of voice over time',
    'How the share of voice of every tracked brand moved on one engine.',
    'ai',
    ['two_thirds', 'half', 'full'],
    { maxInstances: PER_ENGINE, options: { engine: ENGINE_OPTION } },
  ),
  aiCard(
    'ai.sov_rank',
    'Share of voice rank',
    'Where you rank among tracked brands by share of voice on one engine, over time.',
    'ai',
    ['half', 'two_thirds'],
    { maxInstances: PER_ENGINE, options: { engine: ENGINE_OPTION } },
  ),
  aiCard(
    'ai.topic_heatmap',
    'Topics by engine',
    'Which topics each engine names, cites or gives you a share of voice in.',
    'ai',
    ['two_thirds', 'full'],
    {
      maxInstances: PER_METRIC,
      options: {
        metric: METRIC_OPTION,
        rows: countOption('Rows', 'rows', ['5', '10', '20'], '10'),
        level: enumOption(
          'Level',
          [
            ['top', 'Top level topics'],
            ['all', 'All levels'],
          ],
          'top',
        ),
        sort: enumOption(
          'Sort by',
          [
            ['prompts', 'Prompts'],
            ['rate', 'Rate'],
            ['gap', 'Gap between engines'],
          ],
          'prompts',
        ),
      },
    },
  ),
  aiCard(
    'ai.topic_extremes',
    'Strongest and weakest topics',
    'Which topics do best and worst on the chosen metric.',
    'ai',
    ['half', 'third', 'two_thirds'],
    {
      maxInstances: PER_METRIC,
      options: { metric: METRIC_OPTION, rows: countOption('Rows', 'rows', ['3', '5'], '5') },
    },
  ),
  aiCard(
    'ai.topic_movers',
    'Topics gaining or losing',
    'Which topics gained or lost the most against the previous window.',
    'ai',
    ['half', 'two_thirds'],
    {
      maxInstances: PER_METRIC,
      options: {
        metric: METRIC_OPTION,
        direction: DIRECTION_OPTION,
        rows: countOption('Rows', 'rows', ['5', '10'], '5'),
      },
    },
  ),
  aiCard(
    'ai.topic_engine_gap',
    'Where engines disagree',
    'Which topics one engine covers far better than another.',
    'ai',
    ['two_thirds', 'half', 'full'],
    {
      maxInstances: PER_METRIC,
      options: { metric: METRIC_OPTION, rows: countOption('Rows', 'rows', ['5', '10'], '10') },
    },
  ),
  aiCard(
    'ai.engine_disagreement',
    'Named by one engine, not another',
    'Which prompts name you on one engine and not on another.',
    'ai',
    ['half', 'two_thirds'],
    { options: { rows: countOption('Rows', 'rows', ['5', '10'], '5') } },
  ),
  aiCard(
    'ai.topic_trends',
    'Topic trends by engine',
    'How the metric moved in your leading topics, one panel per engine.',
    'ai',
    ['full', 'two_thirds'],
    {
      maxInstances: PER_METRIC,
      options: { metric: METRIC_OPTION, topics: countOption('Topics', 'topics', ['3', '6'], '6') },
    },
  ),
  aiCard(
    'ai.topic_small_multiples',
    'Topic trends, one engine',
    'How the mention rate moved in each of your leading topics on one engine.',
    'ai',
    ['two_thirds', 'full'],
    {
      maxInstances: PER_ENGINE,
      options: { engine: ENGINE_OPTION, topics: countOption('Topics', 'topics', ['6', '9'], '6') },
    },
  ),
  aiCard(
    'ai.topic_contribution',
    'What each topic adds',
    'Which topics drive the mention rate of one engine, and which moved it.',
    'ai',
    ['half', 'two_thirds'],
    {
      maxInstances: PER_ENGINE,
      options: {
        engine: ENGINE_OPTION,
        view: enumOption(
          'View',
          [
            ['level', 'Level'],
            ['change', 'Change'],
          ],
          'level',
        ),
      },
    },
  ),
  aiCard(
    'ai.prompt_heatmap',
    'Prompts by engine',
    'Which prompts each engine names you in, one row per prompt.',
    'ai',
    ['two_thirds', 'full'],
    {
      options: {
        rows: countOption('Rows', 'rows', ['10', '20'], '10'),
        sort: enumOption(
          'Sort by',
          [
            ['most_named', 'Most named'],
            ['least_named', 'Least named'],
          ],
          'least_named',
        ),
      },
    },
  ),
  aiCard(
    'ai.top_prompts',
    'Prompts to look at',
    'Which prompts are worth a look: the most named, the least named, or the largest change.',
    'ai',
    ['half', 'third'],
    {
      options: {
        show: enumOption(
          'Show',
          [
            ['most_named', 'Most named'],
            ['least_named', 'Least named'],
            ['largest_change', 'Largest change'],
          ],
          'least_named',
        ),
        rows: countOption('Rows', 'rows', ['5', '10'], '5'),
      },
    },
  ),
  aiCard(
    'ai.prompt_movers',
    'Prompt movers',
    'Which prompts gained or lost the most against the previous window on one engine.',
    'ai',
    ['half', 'two_thirds'],
    {
      maxInstances: PER_ENGINE,
      options: {
        engine: ENGINE_OPTION,
        direction: DIRECTION_OPTION,
        rows: countOption('Rows', 'rows', ['5', '8'], '5'),
      },
    },
  ),
  aiCard(
    'ai.period_comparison',
    'This period vs the last',
    'How each engine compares with the previous window for the metric.',
    'ai',
    ['third', 'half'],
    { maxInstances: PER_METRIC, options: { metric: METRIC_OPTION } },
  ),
  aiCard(
    'ai.change_waterfall',
    'What moved the rate',
    'Which prompts account for the change in the rate of one engine.',
    'ai',
    ['half', 'two_thirds'],
    {
      maxInstances: PER_ENGINE,
      options: {
        engine: ENGINE_OPTION,
        metric: enumOption(
          'Metric',
          [
            ['mention', 'Mention rate'],
            ['citation', 'Citation rate'],
          ],
          'mention',
        ),
      },
    },
  ),
  aiCard(
    'ai.engine_agreement',
    'Engine agreement',
    'How often the engines agree on naming you for the same prompt.',
    'ai',
    ['third', 'half'],
  ),
  aiCard(
    'ai.citation_vs_mention',
    'Cited as often as named?',
    'Which topics name you more often than they cite your pages on one engine.',
    'ai',
    ['half', 'two_thirds'],
    { maxInstances: PER_ENGINE, options: { engine: ENGINE_OPTION } },
  ),
  aiCard(
    'ai.country_breakdown',
    'By country',
    'How the metric differs between the countries you track.',
    'ai',
    ['half', 'two_thirds'],
    { maxInstances: PER_METRIC, options: { metric: METRIC_OPTION } },
  ),
  aiCard(
    'sources.top_domains',
    'Top cited domains',
    'Which domains answers cite most, and whose they are.',
    'ai',
    ['third', 'half'],
    {
      options: {
        role: enumOption(
          'Domains',
          [
            ['all', 'All domains'],
            ['third_party', 'Third party'],
            ['competitor', 'Competitors'],
          ],
          'all',
        ),
        rows: countOption('Rows', 'rows', ['5', '8', '10'], '8'),
      },
    },
  ),
  aiCard(
    'sources.own_pages',
    'Your pages AI engines cite',
    'Which of your pages answers cite, and how often.',
    'ai',
    ['third', 'half'],
    { options: { rows: countOption('Rows', 'rows', ['5', '8', '10'], '8') } },
  ),
  aiCard(
    'sources.new_lost',
    'New and lost sources',
    'Which sources answers started citing, and which they stopped citing.',
    'ai',
    ['half', 'third'],
  ),
  aiCard('sources.diversity', 'Source diversity', 'How concentrated citations are in a few domains.', 'ai', [
    'half',
    'two_thirds',
  ]),
  aiCard(
    'ai.fanout_top',
    'What ChatGPT searched',
    'Which searches ChatGPT ran to build its answers.',
    'ai',
    ['half', 'third'],
    { options: { rows: countOption('Rows', 'rows', ['5', '10'], '5') } },
  ),
  aiCard(
    'ai.opportunities',
    'AI opportunities',
    'Prompts where you are named but not cited, cited but not named, lost to a competitor, or named by no engine.',
    'ai',
    ['half', 'third'],
    { options: { rows: countOption('Rows', 'rows', ['4', '8'], '4') } },
  ),
  aiCard(
    'ops.answer_calendar',
    'Answers collected',
    'How many answers were collected on each day of the window.',
    'activity',
    ['half', 'full'],
  ),
  aiCard(
    'ops.answer_status',
    'Answer status by engine',
    'How many answers were valid, failed or refused on each engine.',
    'activity',
    ['half', 'two_thirds'],
  ),
  aiCard(
    'ops.engines',
    'Engines and schedule',
    'Which engines are on, the days they ask, the next run and the estimated monthly cost.',
    'activity',
    ['third', 'half'],
  ),
  aiCard('ops.ai_spend', 'AI spend', 'How much of this month’s AI budget has been used.', 'activity', ['third'], {
    permission: 'costs:read',
  }),
  aiCard(
    'ai.sample_coverage',
    'Answers behind the numbers',
    'How many prompts have enough valid answers per engine to read a rate.',
    'activity',
    ['third', 'half'],
  ),
];

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
    { screens: OVERVIEW_AND_AI },
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
      screens: OVERVIEW_AND_AI,
      // One instance per engine: another would repeat an engine.
      maxInstances: PER_ENGINE,
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
    { addedOn: RELEASE, screens: OVERVIEW_AND_AI },
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
      screens: OVERVIEW_AND_AI,
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
    { addedOn: RELEASE, screens: OVERVIEW_AND_AI },
  ),

  ...AI_OVERVIEW_CARDS,

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
function aiNumber(
  metric: string,
  label: string,
  screens: ReadonlyArray<ScreenKey> = ['ai_overview'],
): NumberDefinition {
  return { metric, label, channel: 'ai', perEngine: true, screens };
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
  aiNumber('ai.mention_rate', 'Mention rate', OVERVIEW_AND_AI),
  aiNumber('ai.citation_rate', 'Citation rate', OVERVIEW_AND_AI),
  // The recommendation rate waits for slice 2 (inventory 9.3, wave 3), so it stays on the project Overview.
  aiNumber('ai.recommendation_rate', 'Recommendation rate', ['overview']),
  aiNumber('ai.share_of_voice', 'Share of voice', OVERVIEW_AND_AI),
  // Wave 1 of the AI visibility screen (inventory 9.3). Prompts is the one AI number that names no engine.
  { metric: 'ai.prompts_in_scope', label: 'Prompts', channel: 'ai', perEngine: false, screens: ['ai_overview'] },
  aiNumber('ai.valid_answers', 'Valid answers'),
  aiNumber('ai.mention_and_citation_rate', 'Named and cited'),
  aiNumber('ai.citation_share', 'Own citation share'),
  aiNumber('ai.fanout_presence_rate', 'Fan-out presence'),
];

const NUMBERS_ZONE = { numbers: true, cards: false, widths: false } as const;
const DRAWER_ZONE = { numbers: false, cards: true, widths: false } as const;

/** A screen with a numbers strip only (a list page). Its numbers are added by its page package. */
function numbersScreen(key: ScreenKey, title: string): ScreenDefinition {
  return { key, title, zones: { ...NUMBERS_ZONE }, builtin: { schema: 1, numbers: [] } };
}

/** A drawer screen with cards and no widths. Its cards are added by its page package. */
function drawerScreen(key: ScreenKey, title: string): ScreenDefinition {
  return { key, title, zones: { ...DRAWER_ZONE }, builtin: { schema: 1, cards: [] } };
}

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
  ai_overview: {
    key: 'ai_overview',
    title: 'AI visibility',
    zones: { numbers: true, cards: true, widths: true },
    // The Default preset of inventory 9.5. Every option is written out, because sanitizing fills the defaults in.
    builtin: {
      schema: 1,
      numbers: [
        { id: 'prompts', metric: 'ai.prompts_in_scope' },
        { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
        { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
        { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' },
      ],
      cards: [
        { id: 'change-summary', type: 'ai.change_summary', width: 'full', options: { facts: '5' } },
        { id: 'rate-trend', type: 'ai.rate_trend_by_engine', width: 'two_thirds', options: { metric: 'mention' } },
        { id: 'outcome-mix', type: 'ai.outcome_mix', width: 'third' },
        { id: 'top-domains', type: 'sources.top_domains', width: 'third', options: { role: 'all', rows: '8' } },
        {
          id: 'topic-heatmap',
          type: 'ai.topic_heatmap',
          width: 'two_thirds',
          options: { metric: 'mention', rows: '10', level: 'top', sort: 'prompts' },
        },
        {
          id: 'share-of-voice-chatgpt',
          type: 'ai.share_of_voice',
          width: 'half',
          options: { engine: 'chatgpt_web', rows: '10' },
        },
        {
          id: 'competitor-trend-chatgpt',
          type: 'ai.competitor_trend',
          width: 'half',
          options: { engine: 'chatgpt_web', competitors: '3' },
        },
        { id: 'key-changes', type: 'activity.key_changes', width: 'half', options: { rows: '8' } },
        { id: 'opportunities', type: 'ai.opportunities', width: 'half', options: { rows: '4' } },
      ],
    },
  },
  rankings: numbersScreen('rankings', 'Rankings'),
  prompts: numbersScreen('prompts', 'Topics and prompts'),
  citations: numbersScreen('citations', 'Citations'),
  sources: numbersScreen('sources', 'Sources'),
  pages: numbersScreen('pages', 'Pages'),
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
  'inspector.prompt': drawerScreen('inspector.prompt', 'Prompt'),
  'inspector.page': drawerScreen('inspector.page', 'Page'),
  'inspector.citation': drawerScreen('inspector.citation', 'Citation'),
  'inspector.topic': drawerScreen('inspector.topic', 'Topic'),
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

/** The ENGINES label of a code, else the code itself. */
export function engineLabel(code: string): string {
  return ENGINES.find((engine) => engine.code === code)?.label ?? code;
}

/**
 * What a card is called in announcements and labels: its title, plus the engine for a card that has an engine
 * option ("Mention rate trend: Gemini"). A type the catalog does not know is called by its key.
 */
export function cardName(item: CardItem): string {
  const type = cardType(item.type);
  if (!type) return item.type;
  const engine = type.options.engine !== undefined ? item.options?.engine : undefined;
  return engine === undefined ? type.title : `${type.title}: ${engineLabel(engine)}`;
}

/**
 * What a headline number is called in announcements and labels: its label, plus the engine for a per engine
 * metric ("Mention rate Gemini"). A metric the catalog does not know is called by its key.
 */
export function numberName(item: NumberItem): string {
  const type = numberType(item.metric);
  if (!type) return item.metric;
  return item.engine === undefined ? type.label : `${type.label} ${engineLabel(item.engine)}`;
}

/** How long the catalog shows "New" on a card type that was released. */
export const NEW_FOR_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Whether the catalog marks this card type "New" on `today`: released on `type.addedOn` or in the 29 days
 * after it, so false from day 30. Both are ISO business dates (YYYY-MM-DD), read as UTC dates so that no
 * time zone or daylight saving shift moves a day. A date that is not one, or one before the release, is false.
 */
export function isNewCardType(type: CardTypeDefinition, today: string): boolean {
  const days = (Date.parse(today) - Date.parse(type.addedOn)) / MS_PER_DAY;
  return days >= 0 && days < NEW_FOR_DAYS;
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
