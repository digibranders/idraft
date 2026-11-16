/**
 * The AI visibility screen and its card catalog (WP-33 T2, then the redesign of 2026-11-16). The tables below are typed
 * copies of docs/ai-visibility/inventory/overview-and-charts.md sections 9.3 (numbers) and 9.4 (cards), changed by the
 * redesign spec (docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md section 5) and by the preview's card
 * registry (apps/web/design-preview/aiov-registry.js), written row by row and independent of catalog.ts, so a slip in
 * either one fails here.
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
  identityOption,
  isNewCardType,
  numberType,
  packRows,
  sanitizeLayout,
  type LayoutDocument,
  type Width,
} from './index';

const SHORT_WIDTH: Readonly<Record<string, Width>> = { T: 'third', H: 'half', '2T': 'two_thirds', F: 'full' };
const RELEASED = '2026-11-13';
const REDESIGN_RELEASED = '2026-11-16';

interface Opt {
  name: string;
  values: readonly string[];
  default: string;
}
const opt = (name: string, values: readonly string[], fallback: string): Opt => ({ name, values, default: fallback });

const ENGINE = opt('engine', ['chatgpt_web', 'gemini_web', 'google_ai_mode'], 'chatgpt_web');
const METRIC = opt('metric', ['mention', 'citation', 'share_of_voice'], 'mention');
/** The trend and the group heat map also draw AI Visibility, which is their default. */
const VISIBILITY_METRIC = opt('metric', ['visibility', 'mention', 'citation', 'share_of_voice'], 'visibility');
const DIRECTION = opt('direction', ['both', 'up', 'down'], 'both');
const rows = (values: readonly string[], fallback: string): Opt => opt('rows', values, fallback);

/**
 * 9.4 says "4 (engine)" for a reusable per engine card. A fourth engine is Google AI Overview, which the API refuses
 * until slice 2 (ENGINES has three), so an instance past the third could never be told apart.
 */
const PER_ENGINE = 3;
const PER_METRIC = 3;
const PER_VISIBILITY_METRIC = 4;

interface Row {
  key: string;
  /** Existing types keep the title WP-15 shipped. */
  title: string | null;
  group: 'ai' | 'activity' | 'traffic';
  widths: string;
  max: number;
  options: readonly Opt[];
  permission?: string;
  integration?: string;
  released?: string;
}

const row = (
  key: string,
  title: string | null,
  group: Row['group'],
  widths: string,
  max: number,
  options: readonly Opt[] = [],
  extra: Pick<Row, 'permission' | 'integration' | 'released'> = {},
): Row => ({ key, title, group, widths, max, options, ...extra });

/** Every row of 9.4 whose Screens column has AO, except the planned types, which are not listed until data exists. */
const EXISTING: readonly Row[] = [
  row('ai.mention_trend', null, 'ai', 'H 2T F', PER_ENGINE, [ENGINE]),
  row('ai.by_engine', null, 'ai', 'H 2T F', 1),
  row('ai.citation_share_by_domain_type', null, 'ai', 'H T', 1),
  // Two thirds stays for the project Overview; the AI visibility page also takes a third.
  row('activity.key_changes', null, 'activity', 'H T 2T F', 1, [rows(['5', '8'], '8')]),
  row('activity.collection_status', null, 'activity', 'T H', 1),
];

const NEW: readonly Row[] = [
  row('ai.visibility_split', 'Headline numbers', 'ai', 'F', 1, [], { released: REDESIGN_RELEASED }),
  row('ai.change_summary', 'What changed', 'activity', 'F 2T', 1, [opt('facts', ['3', '5'], '5')]),
  row('ai.rate_trend_by_engine', 'Rates by platform over time', 'ai', '2T F H', PER_VISIBILITY_METRIC, [
    VISIBILITY_METRIC,
  ]),
  row('ai.outcome_mix', 'Mentioned and cited', 'ai', 'T H', 1),
  row('ai.answer_funnel', 'From answer to citation', 'ai', 'T H', 1),
  // The three competitor cards follow the page scope, so they have no engine option and one instance.
  row('ai.share_of_voice', 'Share of voice', 'ai', 'H T', 1, [rows(['5', '10'], '10')]),
  row('ai.competitor_trend', 'You vs top competitors', 'ai', 'H 2T F', PER_ENGINE, [
    ENGINE,
    opt('competitors', ['3', '5'], '3'),
  ]),
  row('ai.competitor_table', 'Competitors by platform', 'ai', 'H 2T F', 1, [
    opt('metric', ['mention', 'share_of_voice'], 'mention'),
    rows(['5', '10'], '5'),
  ]),
  row('ai.lost_to_competitor', 'Competitor gap', 'ai', 'H F', 1, [rows(['5', '10'], '5')]),
  row('ai.co_mentions', 'Who we are mentioned with', 'ai', 'H 2T', PER_ENGINE, [ENGINE]),
  row('ai.sov_over_time', 'Share of voice over time', 'ai', 'H 2T F', 1),
  row('ai.sov_rank', 'Share of voice rank', 'ai', 'H 2T', PER_ENGINE, [ENGINE]),
  row('ai.topic_heatmap', 'Groups by platform', 'ai', '2T F', PER_VISIBILITY_METRIC, [
    VISIBILITY_METRIC,
    rows(['5', '10', '20'], '10'),
    opt('level', ['top', 'all'], 'top'),
    opt('sort', ['prompts', 'rate', 'gap'], 'prompts'),
  ]),
  row('ai.topic_extremes', 'Strongest and weakest groups', 'ai', 'T H', PER_METRIC, [METRIC, rows(['3', '5'], '5')]),
  row('ai.topic_movers', 'Groups gaining or losing', 'ai', 'H 2T', PER_METRIC, [
    METRIC,
    DIRECTION,
    rows(['5', '10'], '5'),
  ]),
  row('ai.topic_engine_gap', 'Where platforms disagree', 'ai', '2T H F', PER_METRIC, [METRIC, rows(['5', '10'], '10')]),
  row('ai.engine_disagreement', 'Mentioned by one platform, not another', 'ai', 'H 2T', 1, [rows(['5', '10'], '5')]),
  row('ai.topic_trends', 'Group trends by platform', 'ai', 'F 2T', PER_METRIC, [
    METRIC,
    opt('topics', ['3', '6'], '6'),
  ]),
  row('ai.topic_small_multiples', 'Group trends, one platform', 'ai', '2T F', PER_ENGINE, [
    ENGINE,
    opt('topics', ['6', '9'], '6'),
  ]),
  row('ai.topic_contribution', 'What each group adds', 'ai', 'H 2T', PER_ENGINE, [
    ENGINE,
    opt('view', ['level', 'change'], 'level'),
  ]),
  row('ai.prompt_heatmap', 'Prompts by platform', 'ai', '2T F', 1, [
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
  row('ai.engine_agreement', 'Platform agreement', 'ai', 'T H', 1),
  row('ai.citation_vs_mention', 'Cited as often as mentioned?', 'ai', 'H 2T', PER_ENGINE, [ENGINE]),
  row('ai.country_breakdown', 'By location', 'ai', 'H 2T', PER_METRIC, [METRIC]),
  row('sources.top_domains', 'Top cited domains', 'ai', 'H T', 1, [
    opt('role', ['all', 'third_party', 'competitor'], 'all'),
    rows(['5', '8', '10'], '8'),
  ]),
  row('sources.own_pages', 'Your pages cited', 'ai', 'H T', 1, [rows(['5', '8', '10'], '8')]),
  row('sources.new_lost', 'New and lost domains', 'ai', 'H T', 1),
  row('sources.diversity', 'Cited domain diversity', 'ai', 'H 2T', 1),
  row('ai.fanout_top', 'Top fan-out queries', 'ai', 'H T F', 1, [rows(['5', '10'], '5')]),
  row('ai.unlinked_mentions', 'Mentioned, not cited', 'ai', 'H T', 1, [], { released: REDESIGN_RELEASED }),
  row('ai.position_distribution', 'Mention position', 'ai', 'H T F', 1, [], { released: REDESIGN_RELEASED }),
  row('ai.sentiment_by_engine', 'Sentiment by platform', 'ai', 'H T', 1, [], { released: REDESIGN_RELEASED }),
  row('traffic.ai_referrals', 'AI referral visits', 'traffic', 'F 2T', 1, [], { released: REDESIGN_RELEASED }),
  row('ai.opportunities', 'AI opportunities', 'ai', 'H T', 1, [rows(['4', '8'], '4')]),
  row('ops.answer_calendar', 'Run calendar', 'activity', 'F H', 1),
  row('ops.answer_status', 'Answer status by platform', 'activity', 'H 2T', 1),
  row('ops.engines', 'Platforms and schedule', 'activity', 'T H', 1),
  row('ops.ai_spend', 'AI spend', 'activity', 'T', 1, [], { permission: 'costs:read' }),
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
  ['ai.mention_and_citation_rate', 'Mentioned and cited', true],
  ['ai.share_of_voice', 'Share of voice', true],
  ['ai.citation_share', 'Your citation share', true],
  ['ai.fanout_presence_rate', 'Fan-out presence', true],
];

const widthsOf = (short: string): Width[] =>
  short.split(' ').map((part) => {
    const width = SHORT_WIDTH[part];
    if (!width) throw new Error(`Unknown width ${part}`);
    return width;
  });

describe('every card of inventory 9.4 for ai_overview', () => {
  it('is 5 reused and 43 new types', () => {
    expect(EXISTING).toHaveLength(5);
    expect(NEW).toHaveLength(43);
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
      expect(type.integration).toBe(entry.integration ?? null);
      if (entry.title !== null) {
        expect(type.title).toBe(entry.title);
        expect(type.addedOn).toBe(entry.released ?? RELEASED);
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

  it('gives the 43 new types a release date, so the catalog shows New for 30 days', () => {
    for (const entry of NEW) {
      const type = cardType(entry.key);
      const released = entry.released ?? RELEASED;
      expect(type && isNewCardType(type, released)).toBe(true);
      expect(type && isNewCardType(type, '2026-12-17')).toBe(false);
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
    const trend = cardType('ai.competitor_trend');
    if (trend) expect(identityOption(trend)).toBe('engine');
    expect(Object.keys(trend?.options ?? {})).toEqual(['engine', 'competitors']);
  });

  it('give the competitor cards that follow the page scope no engine and one instance', () => {
    for (const key of ['ai.share_of_voice', 'ai.sov_over_time', 'ai.lost_to_competitor']) {
      const type = cardType(key);
      expect(type?.maxInstances, key).toBe(1);
      expect(Object.keys(type?.options ?? {}), key).not.toContain('engine');
      expect(type && identityOption(type), key).toBeNull();
    }
  });

  it('keep a stored layout of the old per engine competitor cards valid: the engine goes, the first instance stays', () => {
    const stored: LayoutDocument = {
      schema: 1,
      cards: (['chatgpt_web', 'gemini_web'] as const).map((engine, index) => ({
        id: `c${index}`,
        type: 'ai.share_of_voice',
        width: 'half',
        options: { engine, rows: '5' },
      })),
    };
    expect(sanitizeLayout(stored, 'ai_overview').document.cards).toEqual([
      { id: 'c0', type: 'ai.share_of_voice', width: 'half', options: { rows: '5' } },
    ]);
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
      cards: ['chatgpt_web', 'chatgpt_web', 'gemini_web'].map((engine, index) => ({
        id: `c${index}`,
        type: 'ai.competitor_trend',
        width: 'half',
        options: { engine, competitors: '3' },
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
    expect(cardType('ai.by_engine')?.title).toBe('AI by platform');
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

  it('keeps the referral card in every project, because it says itself that GA4 is not connected', () => {
    const type = cardType('traffic.ai_referrals');
    if (!type) throw new Error('traffic.ai_referrals is not in the catalog');
    expect(type.group).toBe('traffic');
    const capabilities = { channels: ['ai'] as const, permissions: [] as string[], integrations: [] as string[] };
    // A card the layout skipped would lose its place; the owner decision is that every card keeps it and says why
    expect(cardAvailability(type, capabilities).state).toBe('available');
    for (const other of CARD_TYPES) expect(other.integration).toBeNull();
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
    for (const [metric, , perEngine] of NUMBERS) expect(numberType(metric)?.perEngine).toBe(perEngine);
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

describe('the built-in layout of ai_overview', () => {
  const { builtin } = SCREENS.ai_overview;

  it('is the Default of the redesign: eleven cards in order, every option written out', () => {
    // The headline card replaced the numbers strip: the screen has no numbers zone and the Default no numbers
    expect(SCREENS.ai_overview.zones.numbers).toBe(false);
    expect(builtin.numbers).toBeUndefined();
    expect(builtin.cards?.map((card) => [card.type, card.width])).toEqual([
      ['ai.visibility_split', 'full'],
      ['ai.rate_trend_by_engine', 'two_thirds'],
      ['ai.outcome_mix', 'third'],
      ['ai.share_of_voice', 'half'],
      ['ai.lost_to_competitor', 'half'],
      ['ai.topic_heatmap', 'full'],
      ['sources.top_domains', 'third'],
      ['ai.position_distribution', 'third'],
      ['ai.sentiment_by_engine', 'third'],
      ['traffic.ai_referrals', 'two_thirds'],
      ['ai.fanout_top', 'third'],
    ]);
    // The trend and the heat map open on AI Visibility
    expect(builtin.cards?.[1]?.options).toEqual({ metric: 'visibility' });
    expect(builtin.cards?.[5]?.options).toEqual({ metric: 'visibility', rows: '10', level: 'top', sort: 'prompts' });
  });

  it('sanitizes unchanged', () => {
    expect(sanitizeLayout(builtin, 'ai_overview')).toEqual({ document: builtin, changed: false });
  });

  it('uses every card at its catalog widths and fills complete rows at 1280 px', () => {
    for (const card of builtin.cards ?? []) expect(cardType(card.type)?.widths).toContain(card.width);
    for (const placedRow of packRows(builtin.cards ?? [], 'wide'))
      expect(placedRow.reduce((sum, placed) => sum + placed.span, 0)).toBe(12);
  });

  it('keeps the project Overview built-in layout as it was', () => {
    expect(SCREENS.overview.builtin.cards).toHaveLength(8);
    expect(SCREENS.overview.builtin.numbers).toHaveLength(6);
  });
});

describe('a layout stored before the numbers strip was retired', () => {
  it('is read with its numbers ignored, and its cards kept', () => {
    const stored = {
      schema: 1,
      numbers: [
        { id: 'prompts', metric: 'ai.prompts_in_scope' },
        { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
      ],
      cards: [{ id: 'visibility-split', type: 'ai.visibility_split', width: 'full' }],
    };
    const { document } = sanitizeLayout(stored, 'ai_overview');
    expect(document.numbers).toBeUndefined();
    expect(document.cards?.map((card) => card.type)).toEqual(['ai.visibility_split']);
  });
});

describe('the limits', () => {
  it('stay at 12 cards and 6 numbers, and the catalog offers more types than a layout can hold', () => {
    expect(LIMITS).toEqual({ cards: 12, numbers: 6 });
    const cards = CARD_TYPES.filter((type) => type.screens.includes('ai_overview'));
    const numbers = NUMBER_TYPES.filter((type) => type.screens.includes('ai_overview'));
    expect(cards.length).toBe(TABLE.length);
    expect(numbers.length).toBeGreaterThan(LIMITS.numbers);
    const everyCard = cards.map((type, index) => ({ id: `c${index}`, type: type.key }));
    const kept = sanitizeLayout({ schema: 1, cards: everyCard }, 'ai_overview').document.cards ?? [];
    expect(kept).toHaveLength(LIMITS.cards);
  });
});
