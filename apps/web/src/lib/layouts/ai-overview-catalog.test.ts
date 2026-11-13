/**
 * The AI visibility screen and its card catalog (WP-33 T2). The tables below are typed copies of
 * docs/ai-visibility/inventory/overview-and-charts.md sections 9.3 (numbers), 9.4 (cards) and 9.5 (presets), written
 * row by row and independent of catalog.ts, so a slip in either one fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_TYPES,
  ENGINES,
  LIMITS,
  NUMBER_TYPES,
  SCREENS,
  cardAvailability,
  cardType,
  defaultOptions,
  identityOption,
  isNewCardType,
  numberType,
  packRows,
  sanitizeLayout,
  type CardItem,
  type EngineCode,
  type LayoutDocument,
  type NumberItem,
  type Width,
} from './index';

const SHORT_WIDTH: Readonly<Record<string, Width>> = { T: 'third', H: 'half', '2T': 'two_thirds', F: 'full' };
const RELEASED = '2026-11-13';

interface Opt {
  name: string;
  values: readonly string[];
  default: string;
}
const opt = (name: string, values: readonly string[], fallback: string): Opt => ({ name, values, default: fallback });

const ENGINE = opt('engine', ['chatgpt_web', 'gemini_web', 'google_ai_mode'], 'chatgpt_web');
const METRIC = opt('metric', ['mention', 'citation', 'share_of_voice'], 'mention');
const DIRECTION = opt('direction', ['both', 'up', 'down'], 'both');
const rows = (values: readonly string[], fallback: string): Opt => opt('rows', values, fallback);

/**
 * 9.4 says "4 (engine)" for a reusable per engine card. A fourth engine is Google AI Overview, which the API refuses
 * until slice 2 (ENGINES has three), so an instance past the third could never be told apart.
 */
const PER_ENGINE = 3;
const PER_METRIC = 3;

interface Row {
  key: string;
  /** Existing types keep the title WP-15 shipped. */
  title: string | null;
  group: 'ai' | 'activity';
  widths: string;
  max: number;
  options: readonly Opt[];
  permission?: string;
}

const row = (
  key: string,
  title: string | null,
  group: Row['group'],
  widths: string,
  max: number,
  options: readonly Opt[] = [],
  permission?: string,
): Row => ({ key, title, group, widths, max, options, ...(permission ? { permission } : {}) });

/** Every row of 9.4 whose Screens column has AO, except the planned types, which are not listed until data exists. */
const EXISTING: readonly Row[] = [
  row('ai.mention_trend', null, 'ai', 'H 2T F', PER_ENGINE, [ENGINE]),
  row('ai.by_engine', null, 'ai', 'H 2T F', 1),
  row('ai.citation_share_by_domain_type', null, 'ai', 'T H', 1),
  row('activity.key_changes', null, 'activity', 'H 2T F', 1, [rows(['5', '8'], '8')]),
  row('activity.collection_status', null, 'activity', 'T H', 1),
];

const NEW: readonly Row[] = [
  row('ai.change_summary', 'What changed', 'activity', 'F 2T', 1, [opt('facts', ['3', '5'], '5')]),
  row('ai.rate_trend_by_engine', 'Rates by engine over time', 'ai', '2T F', PER_METRIC, [METRIC]),
  row('ai.outcome_mix', 'Named and cited', 'ai', 'T H', 1),
  row('ai.answer_funnel', 'From answer to citation', 'ai', 'T H', 1),
  row('ai.share_of_voice', 'Share of voice, one engine', 'ai', 'H T', PER_ENGINE, [ENGINE, rows(['5', '10'], '10')]),
  row('ai.competitor_trend', 'You vs top competitors', 'ai', 'H 2T F', PER_ENGINE, [
    ENGINE,
    opt('competitors', ['3', '5'], '3'),
  ]),
  row('ai.competitor_table', 'Competitors by engine', 'ai', 'H 2T F', 1, [
    opt('metric', ['mention', 'share_of_voice'], 'mention'),
    rows(['5', '10'], '5'),
  ]),
  row('ai.lost_to_competitor', 'Prompts lost to a competitor', 'ai', 'T H', PER_ENGINE, [
    ENGINE,
    rows(['5', '10'], '5'),
  ]),
  row('ai.co_mentions', 'Who we are named with', 'ai', 'H 2T', PER_ENGINE, [ENGINE]),
  row('ai.sov_over_time', 'Share of voice over time', 'ai', '2T H F', PER_ENGINE, [ENGINE]),
  row('ai.sov_rank', 'Share of voice rank', 'ai', 'H 2T', PER_ENGINE, [ENGINE]),
  row('ai.topic_heatmap', 'Topics by engine', 'ai', '2T F', PER_METRIC, [
    METRIC,
    rows(['5', '10', '20'], '10'),
    opt('level', ['top', 'all'], 'top'),
    opt('sort', ['prompts', 'rate', 'gap'], 'prompts'),
  ]),
  row('ai.topic_extremes', 'Strongest and weakest topics', 'ai', 'H T 2T', PER_METRIC, [METRIC, rows(['3', '5'], '5')]),
  row('ai.topic_movers', 'Topics gaining or losing', 'ai', 'H 2T', PER_METRIC, [
    METRIC,
    DIRECTION,
    rows(['5', '10'], '5'),
  ]),
  row('ai.topic_engine_gap', 'Where engines disagree', 'ai', '2T H F', PER_METRIC, [METRIC, rows(['5', '10'], '10')]),
  row('ai.engine_disagreement', 'Named by one engine, not another', 'ai', 'H 2T', 1, [rows(['5', '10'], '5')]),
  row('ai.topic_trends', 'Topic trends by engine', 'ai', 'F 2T', PER_METRIC, [METRIC, opt('topics', ['3', '6'], '6')]),
  row('ai.topic_small_multiples', 'Topic trends, one engine', 'ai', '2T F', PER_ENGINE, [
    ENGINE,
    opt('topics', ['6', '9'], '6'),
  ]),
  row('ai.topic_contribution', 'What each topic adds', 'ai', 'H 2T', PER_ENGINE, [
    ENGINE,
    opt('view', ['level', 'change'], 'level'),
  ]),
  row('ai.prompt_heatmap', 'Prompts by engine', 'ai', '2T F', 1, [
    rows(['10', '20'], '10'),
    opt('sort', ['most_named', 'least_named'], 'least_named'),
  ]),
  row('ai.top_prompts', 'Prompts to look at', 'ai', 'H T', 1, [
    opt('show', ['most_named', 'least_named', 'largest_change'], 'least_named'),
    rows(['5', '10'], '5'),
  ]),
  row('ai.prompt_movers', 'Prompt movers', 'ai', 'H 2T', PER_ENGINE, [ENGINE, DIRECTION, rows(['5', '8'], '5')]),
  row('ai.period_comparison', 'This period vs the last', 'ai', 'T H', PER_METRIC, [METRIC]),
  row('ai.change_waterfall', 'What moved the rate', 'ai', 'H 2T', PER_ENGINE, [
    ENGINE,
    opt('metric', ['mention', 'citation'], 'mention'),
  ]),
  row('ai.engine_agreement', 'Engine agreement', 'ai', 'T H', 1),
  row('ai.citation_vs_mention', 'Cited as often as named?', 'ai', 'H 2T', PER_ENGINE, [ENGINE]),
  row('ai.country_breakdown', 'By country', 'ai', 'H 2T', PER_METRIC, [METRIC]),
  row('sources.top_domains', 'Top cited domains', 'ai', 'T H', 1, [
    opt('role', ['all', 'third_party', 'competitor'], 'all'),
    rows(['5', '8', '10'], '8'),
  ]),
  row('sources.own_pages', 'Your pages AI engines cite', 'ai', 'T H', 1, [rows(['5', '8', '10'], '8')]),
  row('sources.new_lost', 'New and lost sources', 'ai', 'H T', 1),
  row('sources.diversity', 'Source diversity', 'ai', 'H 2T', 1),
  row('ai.fanout_top', 'What ChatGPT searched', 'ai', 'H T', 1, [rows(['5', '10'], '5')]),
  row('ai.opportunities', 'AI opportunities', 'ai', 'H T', 1, [rows(['4', '8'], '4')]),
  row('ops.answer_calendar', 'Answers collected', 'activity', 'H F', 1),
  row('ops.answer_status', 'Answer status by engine', 'activity', 'H 2T', 1),
  row('ops.engines', 'Engines and schedule', 'activity', 'T H', 1),
  row('ops.ai_spend', 'AI spend', 'activity', 'T', 1, [], 'costs:read'),
  row('ai.sample_coverage', 'Answers behind the numbers', 'activity', 'T H', 1),
];

const TABLE: readonly Row[] = [...EXISTING, ...NEW];

const PLANNED = ['ai.alerts', 'ai.sentiment', 'ai.list_position'];

/** Types of the project Overview that are not AI visibility cards. */
const OVERVIEW_ONLY = ['competitors.share_of_voice', 'competitors.summary', 'trend.visibility_mentions'];

const NUMBERS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['ai.prompts_in_scope', 'Prompts', false],
  ['ai.valid_answers', 'Valid answers', true],
  ['ai.mention_rate', 'Mention rate', true],
  ['ai.citation_rate', 'Citation rate', true],
  ['ai.mention_and_citation_rate', 'Named and cited', true],
  ['ai.share_of_voice', 'Share of voice', true],
  ['ai.citation_share', 'Own citation share', true],
  ['ai.fanout_presence_rate', 'Fan-out presence', true],
];

const widthsOf = (short: string): Width[] =>
  short.split(' ').map((part) => {
    const width = SHORT_WIDTH[part];
    if (!width) throw new Error(`Unknown width ${part}`);
    return width;
  });

describe('every card of inventory 9.4 for ai_overview', () => {
  it('is 5 reused and 38 new types', () => {
    expect(EXISTING).toHaveLength(5);
    expect(NEW).toHaveLength(38);
  });

  it.each(TABLE.map((entry) => [entry.key, entry] as const))(
    '%s has its widths, instance limit, group, options and defaults',
    (_key, entry) => {
      const type = cardType(entry.key);
      expect(type).toBeDefined();
      if (!type) return;
      expect(type.screens).toContain('ai_overview');
      expect(type.status).toBe('active');
      expect(type.widths).toEqual(widthsOf(entry.widths));
      expect(type.maxInstances).toBe(entry.max);
      expect(type.group).toBe(entry.group);
      expect(type.permission).toBe(entry.permission ?? null);
      expect(type.integration).toBeNull();
      if (entry.title !== null) {
        expect(type.title).toBe(entry.title);
        expect(type.addedOn).toBe(RELEASED);
        expect(type.description.length).toBeGreaterThan(20);
        expect(type.channels).toEqual({ all: ['ai'], any: [] });
      }
      // The order of the options is the order of the table: the first is the identity of a reusable type.
      expect(Object.keys(type.options)).toEqual(entry.options.map((o) => o.name));
      for (const expected of entry.options) {
        const actual = type.options[expected.name];
        expect(actual?.values.map((v) => v.value)).toEqual(expected.values);
        expect(actual?.default).toBe(expected.default);
        expect(actual?.label.length).toBeGreaterThan(0);
        for (const value of actual?.values ?? []) expect(value.label.length).toBeGreaterThan(0);
      }
    },
  );

  it('are the only cards on the screen, so a planned type and a project Overview type are not on it', () => {
    const onScreen = CARD_TYPES.filter((type) => type.screens.includes('ai_overview')).map((type) => type.key);
    expect([...onScreen].sort()).toEqual(TABLE.map((entry) => entry.key).sort());
    for (const key of [...PLANNED, ...OVERVIEW_ONLY]) {
      const type = cardType(key);
      expect(type?.screens.includes('ai_overview') ?? false).toBe(false);
    }
  });

  it('lists no planned type at all', () => {
    for (const key of PLANNED) expect(cardType(key)).toBeUndefined();
  });

  it('gives the 38 new types a release date, so the catalog shows New for 30 days', () => {
    for (const entry of NEW) {
      const type = cardType(entry.key);
      expect(type && isNewCardType(type, RELEASED)).toBe(true);
      expect(type && isNewCardType(type, '2026-12-13')).toBe(false);
    }
  });

  it('has options that are enums only and project agnostic: no Window option (D-13), no project values', () => {
    for (const entry of TABLE) {
      const type = cardType(entry.key);
      expect(Object.keys(type?.options ?? {})).not.toContain('window');
    }
  });

  it('keeps google_ai_overview out of every engine value', () => {
    expect(ENGINES.map((engine) => engine.code)).not.toContain('google_ai_overview');
    for (const type of CARD_TYPES)
      for (const option of Object.values(type.options))
        expect(option.values.map((v) => v.value)).not.toContain('google_ai_overview');
  });
});

describe('reusable card types', () => {
  it('use their first option as the identity, so two instances differ in it', () => {
    for (const entry of TABLE) {
      const type = cardType(entry.key);
      if (!type) continue;
      const first = entry.options[0];
      expect(identityOption(type)).toBe(entry.max > 1 && first ? first.name : null);
    }
    const share = cardType('ai.share_of_voice');
    if (share) expect(identityOption(share)).toBe('engine');
    expect(Object.keys(cardType('ai.share_of_voice')?.options ?? {})).toEqual(['engine', 'rows']);
  });

  it('never allow more instances than the identity option has values', () => {
    for (const type of CARD_TYPES) {
      const identity = identityOption(type);
      if (identity === null) continue;
      expect(type.maxInstances).toBeLessThanOrEqual(type.options[identity]?.values.length ?? 0);
    }
  });

  it('keep one instance per engine when the first option is the engine', () => {
    const doc: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: ['chatgpt_web', 'chatgpt_web', 'gemini_web'].map((engine, index) => ({
        id: `c${index}`,
        type: 'ai.share_of_voice',
        width: 'half',
        options: { engine, rows: '10' },
      })),
    };
    const kept = sanitizeLayout(doc, 'ai_overview').document.cards ?? [];
    expect(kept.map((card) => card.options?.engine)).toEqual(['chatgpt_web', 'gemini_web']);
  });
});

describe('the five reused types', () => {
  it('list overview and ai_overview', () => {
    for (const entry of EXISTING) {
      const type = cardType(entry.key);
      expect(type?.screens).toContain('overview');
      expect(type?.screens).toContain('ai_overview');
    }
  });

  it('keep their titles, widths and release dates for the project Overview', () => {
    expect(cardType('ai.mention_trend')?.title).toBe('Mention rate trend');
    expect(cardType('ai.by_engine')?.title).toBe('AI by engine');
    expect(cardType('activity.key_changes')?.addedOn).toBe('2026-06-01');
    expect(cardType('ai.mention_trend')?.addedOn).toBe('2026-09-30');
  });

  it('are the only reused types: every new type is on ai_overview alone', () => {
    for (const entry of NEW) expect(cardType(entry.key)?.screens).toEqual(['ai_overview']);
  });
});

describe('permissions and integrations', () => {
  it('needs costs:read for ops.ai_spend and nothing else', () => {
    expect(cardType('ops.ai_spend')?.permission).toBe('costs:read');
    for (const entry of NEW) if (entry.key !== 'ops.ai_spend') expect(cardType(entry.key)?.permission).toBeNull();
  });

  it('hides ops.ai_spend from a person without costs:read and shows it to one with it', () => {
    const type = cardType('ops.ai_spend');
    if (!type) throw new Error('ops.ai_spend is not in the catalog');
    const capabilities = { channels: ['ai'] as const, permissions: [] as string[], integrations: [] as string[] };
    expect(cardAvailability(type, capabilities)).toEqual({ state: 'hidden' });
    expect(cardAvailability(type, { ...capabilities, permissions: ['costs:read'] }).state).toBe('available');
  });

  it('cannot yet express "ChatGPT on", "two countries" or "a budget exists", so those cards have no integration', () => {
    for (const key of ['ai.fanout_top', 'ai.country_breakdown', 'ops.ai_spend'])
      expect(cardType(key)?.integration).toBeNull();
  });
});

describe('the numbers of inventory 9.3, wave 1', () => {
  it.each(NUMBERS.map((entry) => [entry[0], entry] as const))(
    '%s is catalogued',
    (_metric, [metric, label, perEngine]) => {
      const type = numberType(metric);
      expect(type?.label).toBe(label);
      expect(type?.channel).toBe('ai');
      expect(type?.perEngine).toBe(perEngine);
      expect(type?.screens).toContain('ai_overview');
    },
  );

  it('puts Prompts on no engine and every other AI number on one engine', () => {
    expect(numberType('ai.prompts_in_scope')?.perEngine).toBe(false);
    const sanitized = sanitizeLayout(
      {
        schema: 1,
        numbers: [
          { id: 'a', metric: 'ai.prompts_in_scope', engine: 'chatgpt_web' },
          { id: 'b', metric: 'ai.prompts_in_scope' },
          { id: 'c', metric: 'ai.valid_answers' },
          { id: 'd', metric: 'ai.valid_answers', engine: 'gemini_web' },
        ],
        cards: [],
      },
      'ai_overview',
    ).document.numbers;
    expect(sanitized).toEqual([
      { id: 'a', metric: 'ai.prompts_in_scope' },
      { id: 'd', metric: 'ai.valid_answers', engine: 'gemini_web' },
    ]);
  });

  it('keeps Mention rate, Citation rate and Share of voice on the project Overview too', () => {
    for (const metric of ['ai.mention_rate', 'ai.citation_rate', 'ai.share_of_voice'])
      expect(numberType(metric)?.screens).toEqual(expect.arrayContaining(['overview', 'ai_overview']));
  });

  it('adds the four new AI numbers and Prompts to ai_overview alone', () => {
    for (const metric of [
      'ai.prompts_in_scope',
      'ai.valid_answers',
      'ai.mention_and_citation_rate',
      'ai.citation_share',
      'ai.fanout_presence_rate',
    ])
      expect(numberType(metric)?.screens).toEqual(['ai_overview']);
  });

  it('leaves ai.recommendation_rate on the project Overview only (slice 2)', () => {
    expect(numberType('ai.recommendation_rate')?.screens).toEqual(['overview']);
  });

  it('puts no SEO number on ai_overview', () => {
    const onScreen = NUMBER_TYPES.filter((type) => type.screens.includes('ai_overview')).map((type) => type.metric);
    expect([...onScreen].sort()).toEqual(NUMBERS.map(([metric]) => metric).sort());
  });
});

const doc = (numbers: NumberItem[], cards: CardItem[]): LayoutDocument => ({ schema: 1, numbers, cards });

interface Placed {
  type: string;
  width: Width;
  options?: Record<string, string>;
}

/** A preset document: every card at its type defaults, then the options the table of 9.5 names. */
function presetDocument(numbers: NumberItem[], placed: readonly Placed[]): LayoutDocument {
  const cards = placed.map((entry, index): CardItem => {
    const type = cardType(entry.type);
    const defaults = type ? defaultOptions(type) : undefined;
    const options = defaults ? { ...defaults, ...entry.options } : undefined;
    return { id: `c${index}`, type: entry.type, width: entry.width, ...(options ? { options } : {}) };
  });
  return doc(
    numbers.map((n, index) => ({ ...n, id: `n${index}` })),
    cards,
  );
}

const mention = (engine: EngineCode): NumberItem => ({ id: '', metric: 'ai.mention_rate', engine });
const citation = (engine: EngineCode): NumberItem => ({ id: '', metric: 'ai.citation_rate', engine });
const sov = (engine: EngineCode): NumberItem => ({ id: '', metric: 'ai.share_of_voice', engine });
const cite = (engine: EngineCode): NumberItem => ({ id: '', metric: 'ai.citation_share', engine });
const PROMPTS: NumberItem = { id: '', metric: 'ai.prompts_in_scope' };
const MENTIONS: NumberItem[] = [mention('chatgpt_web'), mention('gemini_web'), mention('google_ai_mode')];

const DEFAULT_PRESET = {
  numbers: [PROMPTS, ...MENTIONS],
  cards: [
    { type: 'ai.change_summary', width: 'full' },
    { type: 'ai.rate_trend_by_engine', width: 'two_thirds', options: { metric: 'mention' } },
    { type: 'ai.outcome_mix', width: 'third' },
    { type: 'sources.top_domains', width: 'third' },
    { type: 'ai.topic_heatmap', width: 'two_thirds', options: { metric: 'mention' } },
    { type: 'ai.share_of_voice', width: 'half', options: { engine: 'chatgpt_web' } },
    { type: 'ai.competitor_trend', width: 'half', options: { engine: 'chatgpt_web' } },
    { type: 'activity.key_changes', width: 'half', options: { rows: '8' } },
    { type: 'ai.opportunities', width: 'half', options: { rows: '4' } },
  ],
} satisfies { numbers: NumberItem[]; cards: Placed[] };

/** The other four presets of 9.5, with the card each "until" variant swaps in for the one named in the table. */
const PRESETS: ReadonlyArray<{ name: string; numbers: NumberItem[]; cards: Placed[] }> = [
  {
    name: 'Executive summary',
    numbers: [...MENTIONS, sov('chatgpt_web')],
    cards: [
      { type: 'ai.change_summary', width: 'full', options: { facts: '3' } },
      { type: 'ai.rate_trend_by_engine', width: 'full', options: { metric: 'mention' } },
      { type: 'ai.share_of_voice', width: 'half', options: { engine: 'chatgpt_web', rows: '5' } },
      { type: 'ai.topic_extremes', width: 'half', options: { metric: 'mention', rows: '3' } },
      { type: 'ai.answer_funnel', width: 'half' },
      { type: 'ai.period_comparison', width: 'half', options: { metric: 'mention' } },
    ],
  },
  {
    name: 'Executive summary until N2',
    numbers: [...MENTIONS, sov('chatgpt_web')],
    cards: [
      { type: 'ai.change_summary', width: 'full', options: { facts: '3' } },
      { type: 'ai.rate_trend_by_engine', width: 'full', options: { metric: 'mention' } },
      { type: 'ai.share_of_voice', width: 'half', options: { engine: 'chatgpt_web', rows: '5' } },
      { type: 'ai.topic_extremes', width: 'half', options: { metric: 'mention', rows: '3' } },
      { type: 'ai.answer_funnel', width: 'half' },
      { type: 'ai.outcome_mix', width: 'half' },
    ],
  },
  {
    name: 'SEO analyst',
    numbers: [
      PROMPTS,
      citation('chatgpt_web'),
      citation('gemini_web'),
      citation('google_ai_mode'),
      cite('chatgpt_web'),
    ],
    cards: [
      { type: 'sources.own_pages', width: 'half', options: { rows: '10' } },
      { type: 'sources.top_domains', width: 'half', options: { role: 'third_party', rows: '10' } },
      { type: 'ai.citation_vs_mention', width: 'two_thirds', options: { engine: 'chatgpt_web' } },
      { type: 'ai.citation_share_by_domain_type', width: 'third' },
      { type: 'ai.fanout_top', width: 'half', options: { rows: '10' } },
      { type: 'ai.prompt_movers', width: 'half', options: { engine: 'chatgpt_web' } },
      { type: 'ai.opportunities', width: 'half', options: { rows: '8' } },
      { type: 'ai.sample_coverage', width: 'half' },
    ],
  },
  {
    name: 'SEO analyst until wave 2 and N2',
    numbers: [
      PROMPTS,
      citation('chatgpt_web'),
      citation('gemini_web'),
      citation('google_ai_mode'),
      cite('chatgpt_web'),
    ],
    cards: [
      { type: 'sources.own_pages', width: 'half', options: { rows: '10' } },
      { type: 'sources.top_domains', width: 'half', options: { role: 'third_party', rows: '10' } },
      { type: 'ai.topic_heatmap', width: 'two_thirds', options: { metric: 'citation' } },
      { type: 'ai.citation_share_by_domain_type', width: 'third' },
      { type: 'ai.fanout_top', width: 'half', options: { rows: '10' } },
      { type: 'ai.top_prompts', width: 'half', options: { show: 'least_named' } },
      { type: 'ai.opportunities', width: 'half', options: { rows: '8' } },
      { type: 'ai.sample_coverage', width: 'half' },
    ],
  },
  {
    name: 'Competitive',
    numbers: [PROMPTS, sov('chatgpt_web'), sov('gemini_web'), sov('google_ai_mode')],
    cards: [
      { type: 'ai.share_of_voice', width: 'half', options: { engine: 'chatgpt_web' } },
      { type: 'ai.share_of_voice', width: 'half', options: { engine: 'gemini_web' } },
      { type: 'ai.competitor_trend', width: 'full', options: { engine: 'chatgpt_web', competitors: '3' } },
      { type: 'ai.lost_to_competitor', width: 'half', options: { engine: 'chatgpt_web' } },
      { type: 'ai.competitor_table', width: 'half', options: { metric: 'mention' } },
      { type: 'ai.sov_over_time', width: 'two_thirds', options: { engine: 'chatgpt_web' } },
      { type: 'sources.top_domains', width: 'third', options: { role: 'competitor' } },
      { type: 'ai.co_mentions', width: 'half', options: { engine: 'chatgpt_web' } },
    ],
  },
  {
    name: 'Competitive before wave 2',
    numbers: [PROMPTS, sov('chatgpt_web'), sov('gemini_web'), sov('google_ai_mode')],
    cards: [
      { type: 'ai.share_of_voice', width: 'half', options: { engine: 'chatgpt_web' } },
      { type: 'ai.share_of_voice', width: 'half', options: { engine: 'gemini_web' } },
      { type: 'ai.competitor_table', width: 'full', options: { metric: 'share_of_voice' } },
      { type: 'ai.lost_to_competitor', width: 'half', options: { engine: 'chatgpt_web' } },
      // 9.5 names ai.competitor_table (mention) as card 5 and again for card 3, but the type is single use (9.4:
      // one instance): the second is left out here and T6 decides what to do with the pair.
      { type: 'ai.topic_heatmap', width: 'two_thirds', options: { metric: 'share_of_voice' } },
      { type: 'sources.top_domains', width: 'third', options: { role: 'competitor' } },
      { type: 'ai.engine_disagreement', width: 'half' },
    ],
  },
  {
    name: 'Topic owner',
    numbers: [PROMPTS, ...MENTIONS],
    cards: [
      { type: 'ai.topic_heatmap', width: 'full', options: { metric: 'mention', level: 'all', rows: '20' } },
      { type: 'ai.topic_extremes', width: 'half', options: { metric: 'mention' } },
      { type: 'ai.topic_movers', width: 'half', options: { metric: 'mention' } },
      { type: 'ai.topic_engine_gap', width: 'two_thirds', options: { metric: 'mention' } },
      { type: 'ai.sample_coverage', width: 'third' },
      { type: 'ai.topic_trends', width: 'full', options: { metric: 'mention', topics: '6' } },
      { type: 'ai.engine_disagreement', width: 'half' },
      { type: 'ai.topic_contribution', width: 'half', options: { engine: 'chatgpt_web' } },
    ],
  },
  {
    name: 'Topic owner before wave 2',
    numbers: [PROMPTS, ...MENTIONS],
    cards: [
      { type: 'ai.topic_heatmap', width: 'full', options: { metric: 'mention', level: 'all', rows: '20' } },
      { type: 'ai.topic_extremes', width: 'half', options: { metric: 'mention' } },
      { type: 'ai.topic_contribution', width: 'half', options: { engine: 'chatgpt_web' } },
      { type: 'ai.topic_engine_gap', width: 'two_thirds', options: { metric: 'mention' } },
      { type: 'ai.sample_coverage', width: 'third' },
      { type: 'ai.topic_heatmap', width: 'full', options: { metric: 'citation' } },
      { type: 'ai.engine_disagreement', width: 'half' },
      { type: 'ai.top_prompts', width: 'half', options: { show: 'least_named' } },
    ],
  },
];

describe('the built-in layout of ai_overview', () => {
  const builtin = presetDocument(DEFAULT_PRESET.numbers, DEFAULT_PRESET.cards);

  it('is the Default preset of 9.5: four numbers and nine cards in order, with the table options', () => {
    const { numbers, cards } = SCREENS.ai_overview.builtin;
    expect(numbers).toEqual([
      { id: 'prompts', metric: 'ai.prompts_in_scope' },
      { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
      { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
      { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' },
    ]);
    expect(cards?.map((card) => card.id)).toEqual([
      'change-summary',
      'rate-trend',
      'outcome-mix',
      'top-domains',
      'topic-heatmap',
      'share-of-voice-chatgpt',
      'competitor-trend-chatgpt',
      'key-changes',
      'opportunities',
    ]);
    expect(cards?.map((card) => card.type)).toEqual(builtin.cards?.map((card) => card.type));
    expect(cards?.map((card) => card.width)).toEqual(builtin.cards?.map((card) => card.width));
    expect(cards?.map((card) => card.options)).toEqual(builtin.cards?.map((card) => card.options));
  });

  it('sanitizes unchanged', () => {
    expect(sanitizeLayout(SCREENS.ai_overview.builtin, 'ai_overview')).toEqual({
      document: SCREENS.ai_overview.builtin,
      changed: false,
    });
  });

  it('leaves no row part empty at the wide and the medium width', () => {
    for (const breakpoint of ['wide', 'medium'] as const)
      for (const placedRow of packRows(SCREENS.ai_overview.builtin.cards ?? [], breakpoint))
        expect(placedRow.reduce((sum, placed) => sum + placed.span, 0)).toBe(12);
  });

  it('keeps the project Overview built-in layout as it was', () => {
    expect(SCREENS.overview.builtin.cards).toHaveLength(8);
    expect(SCREENS.overview.builtin.numbers).toHaveLength(6);
  });
});

describe('the presets of 9.5', () => {
  it.each(PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s uses only catalogued types, widths, options and numbers, and sanitizes unchanged',
    (_name, preset) => {
      const document = presetDocument(preset.numbers, preset.cards);
      expect(sanitizeLayout(document, 'ai_overview')).toEqual({ document, changed: false });
      expect(document.cards?.length).toBeLessThanOrEqual(LIMITS.cards);
      expect(document.numbers?.length).toBeLessThanOrEqual(LIMITS.numbers);
    },
  );
});

describe('the limits', () => {
  it('stay at 12 cards and 6 numbers, and the catalog offers more types than a layout can hold', () => {
    expect(LIMITS).toEqual({ cards: 12, numbers: 6 });
    const cards = CARD_TYPES.filter((type) => type.screens.includes('ai_overview'));
    const numbers = NUMBER_TYPES.filter((type) => type.screens.includes('ai_overview'));
    expect(cards.length).toBe(43);
    expect(numbers.length).toBeGreaterThan(LIMITS.numbers);
    const everyCard = cards.map((type, index) => ({ id: `c${index}`, type: type.key }));
    const kept = sanitizeLayout({ schema: 1, numbers: [], cards: everyCard }, 'ai_overview').document.cards ?? [];
    expect(kept).toHaveLength(LIMITS.cards);
  });
});
