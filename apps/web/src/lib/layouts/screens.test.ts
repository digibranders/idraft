/**
 * Screen keys, the engines the API accepts, and card names (WP-15 plan 2.1, rows WB-LAY-02, 03, 04).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { components } from '@/lib/api/schema';
import {
  CARD_TYPES,
  ENGINES,
  NUMBER_TYPES,
  SCREENS,
  addCard,
  canAddNumber,
  cardName,
  cardType,
  engineLabel,
  isEngineCode,
  sanitizeLayout,
  type EngineCode,
  type LayoutDocument,
  type ScreenKey,
} from './index';

const REFUSED_ENGINE = 'google_ai_overview';

type Zones = { numbers: boolean; cards: boolean; widths: boolean };
const NUMBERS_ONLY: Zones = { numbers: true, cards: false, widths: false };
const CARDS_ONLY: Zones = { numbers: false, cards: true, widths: false };
const BOTH_WITH_WIDTHS: Zones = { numbers: true, cards: true, widths: true };

const EXPECTED: ReadonlyArray<readonly [ScreenKey, string, Zones]> = [
  ['overview', 'Overview', BOTH_WITH_WIDTHS],
  ['ai_overview', 'AI visibility', BOTH_WITH_WIDTHS],
  ['rankings', 'Rankings', NUMBERS_ONLY],
  ['prompts', 'Topics and prompts', NUMBERS_ONLY],
  ['citations', 'Citations', NUMBERS_ONLY],
  ['sources', 'Sources', NUMBERS_ONLY],
  ['pages', 'Pages', NUMBERS_ONLY],
  ['inspector.keyword', 'Keyword', CARDS_ONLY],
  ['inspector.prompt', 'Prompt', CARDS_ONLY],
  ['inspector.page', 'Page', CARDS_ONLY],
  ['inspector.citation', 'Citation', CARDS_ONLY],
  ['inspector.topic', 'Topic', CARDS_ONLY],
];

describe('the types follow the API schema', () => {
  it('ScreenKey is the schema screen enum and EngineCode the schema engine enum (the slice 2 tripwire)', () => {
    expectTypeOf<ScreenKey>().toEqualTypeOf<components['schemas']['ResolvedLayout']['screen']>();
    // Fails to compile when the schema's engine enum gains google_ai_overview (slice 2): then offer it here.
    expectTypeOf<EngineCode>().toEqualTypeOf<components['schemas']['EngineCode']>();
    expectTypeOf<typeof REFUSED_ENGINE>().not.toExtend<EngineCode>();
  });
});

describe('SCREENS', () => {
  it('has the 12 screens of the API, with the zones and titles of the plan', () => {
    expect(Object.keys(SCREENS).sort()).toEqual(EXPECTED.map(([key]) => key).sort());
    for (const [key, title, zones] of EXPECTED) {
      expect(SCREENS[key].key).toBe(key);
      expect(SCREENS[key].title).toBe(title);
      expect(SCREENS[key].zones).toEqual(zones);
    }
  });

  it('has a built-in layout per screen that is already clean and holds only the zones the screen has', () => {
    for (const [key, , zones] of EXPECTED) {
      const { builtin } = SCREENS[key];
      expect(sanitizeLayout(builtin, key)).toEqual({ document: builtin, changed: false });
      expect('numbers' in builtin).toBe(zones.numbers);
      expect('cards' in builtin).toBe(zones.cards);
    }
  });

  it('keeps the AI visibility and the new screens empty until their pages add entries', () => {
    expect(SCREENS.ai_overview.builtin).toEqual({ schema: 1, numbers: [], cards: [] });
    for (const key of ['rankings', 'prompts', 'citations', 'sources', 'pages'] as const)
      expect(SCREENS[key].builtin).toEqual({ schema: 1, numbers: [] });
    for (const key of ['inspector.prompt', 'inspector.page', 'inspector.citation', 'inspector.topic'] as const)
      expect(SCREENS[key].builtin).toEqual({ schema: 1, cards: [] });
  });

  it('gives no card or number type to a screen this package adds', () => {
    const touched = new Set<ScreenKey>(['overview', 'inspector.keyword']);
    for (const type of CARD_TYPES) for (const screen of type.screens) expect(touched.has(screen)).toBe(true);
    for (const type of NUMBER_TYPES) for (const screen of type.screens) expect(touched.has(screen)).toBe(true);
  });
});

describe('engines: only what the API accepts (decision Q8 of WP-11)', () => {
  const withRefusedEngine = (): LayoutDocument => ({
    schema: 1,
    numbers: [
      { id: 'kept', metric: 'ai.mention_rate', engine: 'gemini_web' },
      { id: 'refused', metric: 'ai.mention_rate', engine: REFUSED_ENGINE as EngineCode },
    ],
    cards: [{ id: 'trend', type: 'ai.mention_trend', width: 'half', options: { engine: REFUSED_ENGINE } }],
  });

  it('offers exactly the engines of the schema', () => {
    expect(ENGINES.map((engine) => engine.code)).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(ENGINES.map((engine) => engine.code)).not.toContain(REFUSED_ENGINE);
  });

  it('offers it in no card option value', () => {
    for (const type of CARD_TYPES)
      for (const option of Object.values(type.options))
        expect(option.values.map((v) => v.value)).not.toContain(REFUSED_ENGINE);
  });

  it('refuses it as an engine code and as a number the person can add', () => {
    expect(isEngineCode(REFUSED_ENGINE)).toBe(false);
    const empty: LayoutDocument = { schema: 1, numbers: [], cards: [] };
    expect(canAddNumber(empty, 'ai.mention_rate', 'chatgpt_web')).toBe(true);
    expect(canAddNumber(empty, 'ai.mention_rate', REFUSED_ENGINE as EngineCode)).toBe(false);
  });

  it('drops a number for it and resets a card option naming it to the first engine', () => {
    const result = sanitizeLayout(withRefusedEngine(), 'overview');
    expect(result.changed).toBe(true);
    expect(result.document.numbers).toEqual([{ id: 'kept', metric: 'ai.mention_rate', engine: 'gemini_web' }]);
    expect(result.document.cards?.[0]?.options).toEqual({ engine: 'chatgpt_web' });
  });

  it('lets Mention rate trend be placed once per engine and no more', () => {
    const type = cardType('ai.mention_trend');
    expect(type?.maxInstances).toBe(ENGINES.length);
    let doc: LayoutDocument = { schema: 1, numbers: [], cards: [] };
    for (let i = 0; i < ENGINES.length; i += 1) doc = addCard(doc, 'ai.mention_trend', `t${i}`);
    expect(doc.cards).toHaveLength(ENGINES.length);
    expect(addCard(doc, 'ai.mention_trend', 'one-more')).toBe(doc);
  });
});

describe('cardName and engineLabel', () => {
  it('names a per-engine card with its engine', () => {
    expect(cardName({ id: 'a', type: 'ai.mention_trend', width: 'half', options: { engine: 'gemini_web' } })).toBe(
      'Mention rate trend: Gemini',
    );
  });

  it('names other cards by their title, and an unknown type by its key', () => {
    expect(cardName({ id: 'b', type: 'seo.top_movers', width: 'half', options: { direction: 'all', rows: '5' } })).toBe(
      'Top movers',
    );
    expect(cardName({ id: 'c', type: 'made.up' })).toBe('made.up');
  });

  it('falls back to the title when the engine option is missing or unknown', () => {
    expect(cardName({ id: 'd', type: 'ai.mention_trend', width: 'half' })).toBe('Mention rate trend');
    expect(cardName({ id: 'e', type: 'ai.mention_trend', options: { engine: 'x' } })).toBe('Mention rate trend: x');
  });

  it('labels an engine by its catalog label, else by its code', () => {
    expect(engineLabel('google_ai_mode')).toBe('AI Mode');
    expect(engineLabel('chatgpt_web')).toBe('ChatGPT');
    expect(engineLabel('mystery')).toBe('mystery');
  });
});
