/**
 * Tests for the layout rules of docs/superpowers/specs/2026-09-30-layout-customization-design.md:
 * catalog integrity, sanitizing (section 6.3), resolution, availability, row packing (section 6.2) and draft edits.
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_TYPES,
  ENGINES,
  LIMITS,
  NUMBER_TYPES,
  SCREENS,
  WIDTHS,
  addCard,
  addNumber,
  canAddCard,
  canAddNumber,
  cardAvailability,
  cardType,
  changeCount,
  defaultLayout,
  hideCard,
  identityOption,
  moveCard,
  moveNumber,
  packRows,
  removeNumber,
  resolveLayout,
  sameLayout,
  sanitizeLayout,
  setCardOption,
  setCardWidth,
  spanOf,
  takenIdentityValues,
  trailingSpace,
  type CardItem,
  type EngineCode,
  type LayoutDocument,
} from './index';

const overview = (): LayoutDocument => structuredClone(SCREENS.overview.builtin);
const card = (id: string, type: string, extra: Partial<CardItem> = {}): CardItem => ({ id, type, ...extra });

describe('catalog', () => {
  it('has unique card type keys and unique metrics', () => {
    const keys = CARD_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const metrics = NUMBER_TYPES.map((n) => n.metric);
    expect(new Set(metrics).size).toBe(metrics.length);
  });

  it('gives every dashboard card type at least one valid width and drawer types none', () => {
    for (const type of CARD_TYPES) {
      for (const width of type.widths) expect(WIDTHS).toContain(width);
      const onDashboard = type.screens.some((screen) => SCREENS[screen].zones.widths);
      expect(type.widths.length > 0).toBe(onDashboard);
    }
  });

  it('declares option defaults that are among the option values', () => {
    for (const type of CARD_TYPES) {
      for (const option of Object.values(type.options)) {
        expect(option.values.map((v) => v.value)).toContain(option.default);
      }
    }
  });

  it('ships the eight cards of the current Overview as its built-in default', () => {
    const cards = SCREENS.overview.builtin.cards ?? [];
    expect(cards.map((c) => c.type)).toEqual([
      'trend.visibility_mentions',
      'seo.rank_distribution',
      'cross.matrix_summary',
      'cross.unclassified',
      'activity.key_changes',
      'cross.opportunities',
      'ai.by_engine',
      'competitors.summary',
    ]);
    expect(cards.map((c) => c.width)).toEqual(['two_thirds', 'third', 'half', 'half', 'half', 'half', 'half', 'half']);
    expect(SCREENS.overview.builtin.numbers).toHaveLength(6);
  });

  it('ships built-in defaults that are already valid', () => {
    for (const screen of Object.values(SCREENS)) {
      const result = sanitizeLayout(screen.builtin, screen.key);
      expect(result.changed).toBe(false);
      expect(result.document).toEqual(screen.builtin);
    }
  });
});

describe('sanitizeLayout', () => {
  it('returns the built-in default for input that is not a layout document', () => {
    for (const raw of [null, undefined, 'x', 42, [], { schema: 2, cards: [] }]) {
      const result = sanitizeLayout(raw, 'overview');
      expect(result.changed).toBe(true);
      expect(result.document).toEqual(SCREENS.overview.builtin);
    }
  });

  it('keeps a valid document unchanged', () => {
    const doc = overview();
    const result = sanitizeLayout(doc, 'overview');
    expect(result.changed).toBe(false);
    expect(result.document).toEqual(doc);
  });

  it('drops unknown card types and types that do not belong on the screen', () => {
    const doc: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [
        card('a', 'seo.rank_distribution', { width: 'third' }),
        card('b', 'made.up'),
        card('c', 'inspector.rank_history'),
      ],
    };
    const result = sanitizeLayout(doc, 'overview');
    expect(result.changed).toBe(true);
    expect(result.document.cards?.map((c) => c.id)).toEqual(['a']);
  });

  it('replaces a width the type does not allow with the type default', () => {
    const doc: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [card('a', 'seo.rank_distribution', { width: 'full' }), card('b', 'seo.rank_distribution')],
    };
    const cards = sanitizeLayout(doc, 'overview').document.cards ?? [];
    expect(cards[0]?.width).toBe('third');
  });

  it('removes widths on screens without widths', () => {
    const doc: LayoutDocument = { schema: 1, cards: [card('a', 'inspector.rank_history', { width: 'half' })] };
    const result = sanitizeLayout(doc, 'inspector.keyword');
    expect(result.document.cards?.[0]).toEqual({ id: 'a', type: 'inspector.rank_history' });
    expect(result.document.numbers).toBeUndefined();
  });

  it('repairs options: bad values get the default, unknown keys go, missing keys are filled', () => {
    const doc: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [card('a', 'seo.top_movers', { width: 'half', options: { direction: 'sideways', extra: 'x' } })],
    };
    const result = sanitizeLayout(doc, 'overview');
    expect(result.document.cards?.[0]?.options).toEqual({ direction: 'all', rows: '5' });
  });

  it('drops instances beyond maxInstances', () => {
    const doc: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [
        card('a', 'seo.rank_distribution', { width: 'third' }),
        card('b', 'seo.rank_distribution', { width: 'third' }),
      ],
    };
    expect(sanitizeLayout(doc, 'overview').document.cards?.map((c) => c.id)).toEqual(['a']);
  });

  it('validates numbers: known metric, engine only and always on AI metrics, no duplicates', () => {
    const doc: LayoutDocument = {
      schema: 1,
      cards: [],
      numbers: [
        { id: 'n1', metric: 'seo.top10_count' },
        { id: 'n2', metric: 'seo.top10_count' },
        { id: 'n3', metric: 'made.up' },
        { id: 'n4', metric: 'ai.mention_rate' },
        { id: 'n5', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
        { id: 'n6', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
        { id: 'n7', metric: 'ai.mention_rate', engine: 'gemini_web' },
        { id: 'n8', metric: 'seo.top3_count', engine: 'gemini_web' },
      ],
    };
    const numbers = sanitizeLayout(doc, 'overview').document.numbers ?? [];
    expect(numbers).toEqual([
      { id: 'n1', metric: 'seo.top10_count' },
      { id: 'n5', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
      { id: 'n7', metric: 'ai.mention_rate', engine: 'gemini_web' },
      { id: 'n8', metric: 'seo.top3_count' },
    ]);
  });

  it('enforces the limits by dropping from the end', () => {
    const dashboard = CARD_TYPES.filter((t) => t.screens.includes('overview'));
    expect(dashboard.length).toBeGreaterThan(LIMITS.cards);
    const cards = dashboard.map((t, i) => ({ id: `c${i}`, type: t.key }));
    const kept = sanitizeLayout({ schema: 1, numbers: [], cards }, 'overview').document.cards ?? [];
    expect(kept.map((c) => c.id)).toEqual(cards.slice(0, LIMITS.cards).map((c) => c.id));

    const numbers = NUMBER_TYPES.filter((n) => !n.perEngine).map((n, i) => ({ id: `n${i}`, metric: n.metric }));
    expect(numbers.length).toBeGreaterThan(LIMITS.numbers);
    const keptNumbers = sanitizeLayout({ schema: 1, cards: [], numbers }, 'overview').document.numbers ?? [];
    expect(keptNumbers.map((n) => n.id)).toEqual(numbers.slice(0, LIMITS.numbers).map((n) => n.id));
  });

  it('gives a card without a width the default width of its type', () => {
    const result = sanitizeLayout(
      { schema: 1, numbers: [], cards: [{ id: 'a', type: 'activity.key_changes' }] },
      'overview',
    );
    expect(result.document.cards?.[0]?.width).toBe('half');
  });

  it('keeps one instance per identity value of a reusable type', () => {
    const cards = ['gemini_web', 'gemini_web', 'chatgpt_web', 'chatgpt_web', 'google_ai_mode'].map((engine, i) => ({
      id: `t${i}`,
      type: 'ai.mention_trend',
      width: 'half',
      options: { engine },
    }));
    const kept = sanitizeLayout({ schema: 1, numbers: [], cards }, 'overview').document.cards ?? [];
    expect(kept.map((c) => c.options?.engine)).toEqual(['gemini_web', 'chatgpt_web', 'google_ai_mode']);
  });

  it('replaces ids that are not plain tokens, so they are safe in selectors', () => {
    const doc = {
      schema: 1,
      numbers: [],
      cards: [
        { id: 'a"] b', type: 'seo.rank_distribution', width: 'third' },
        { id: 'x'.repeat(80), type: 'seo.serp_features', width: 'third' },
      ],
    };
    const ids = (sanitizeLayout(doc, 'overview').document.cards ?? []).map((c) => c.id);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))).toBe(true);
  });

  it('does not throw on hostile input', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20000; i += 1) deep = { nested: deep };
    expect(() =>
      sanitizeLayout(
        { schema: 1, numbers: [], cards: [{ id: 'a', type: 'seo.top_movers', options: deep }] },
        'overview',
      ),
    ).not.toThrow();
    const polluted = JSON.parse(
      '{"schema":1,"numbers":[],"cards":[{"id":"a","type":"seo.top_movers","options":{"__proto__":{"x":1},"constructor":"y"}}]}',
    ) as unknown;
    expect(sanitizeLayout(polluted, 'overview').document.cards?.[0]?.options).toEqual({ direction: 'all', rows: '5' });
  });

  it('replaces missing or duplicate ids', () => {
    const doc = {
      schema: 1,
      numbers: [],
      cards: [
        { id: 'a', type: 'seo.rank_distribution', width: 'third' },
        { id: 'a', type: 'seo.serp_features', width: 'third' },
        { type: 'activity.key_changes', width: 'half' },
      ],
    };
    const ids = (sanitizeLayout(doc, 'overview').document.cards ?? []).map((c) => c.id);
    expect(ids[0]).toBe('a');
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });
});

describe('resolveLayout', () => {
  const personal: LayoutDocument = {
    schema: 1,
    numbers: [],
    cards: [card('p', 'seo.rank_distribution', { width: 'half' })],
  };
  const team: LayoutDocument = {
    schema: 1,
    numbers: [],
    cards: [card('t', 'activity.key_changes', { width: 'full', options: { rows: '8' } })],
  };

  it('prefers the personal layout, then the team default, then the built-in default', () => {
    expect(resolveLayout({ personal, team }, 'overview')).toEqual({ source: 'personal', document: personal });
    expect(resolveLayout({ personal: null, team }, 'overview')).toEqual({ source: 'team', document: team });
    expect(resolveLayout({ personal: null, team: undefined }, 'overview')).toEqual({
      source: 'builtin',
      document: SCREENS.overview.builtin,
    });
  });

  it('falls through when a stored value is not a layout document at all', () => {
    for (const broken of ['text', 42, [], { schema: 2 }]) {
      expect(resolveLayout({ personal: broken, team }, 'overview')).toEqual({ source: 'team', document: team });
      expect(resolveLayout({ personal: broken, team: broken }, 'overview').source).toBe('builtin');
    }
  });

  it('resets to the team default when there is one, otherwise to the built-in default', () => {
    expect(defaultLayout(team, 'overview')).toEqual({ source: 'team', document: team });
    expect(defaultLayout(null, 'overview')).toEqual({ source: 'builtin', document: SCREENS.overview.builtin });
  });

  it('compares layouts by content, whatever the key order', () => {
    const a: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [{ id: 'a', type: 'seo.top_movers', width: 'half', options: { direction: 'all', rows: '5' } }],
    };
    const b: LayoutDocument = {
      cards: [{ options: { rows: '5', direction: 'all' }, width: 'half', type: 'seo.top_movers', id: 'a' }],
      numbers: [],
      schema: 1,
    };
    expect(sameLayout(a, b)).toBe(true);
    expect(sameLayout(a, { ...b, cards: [] })).toBe(false);
  });

  it('sanitizes what it resolves instead of failing', () => {
    const result = resolveLayout(
      { personal: { schema: 1, numbers: [], cards: [{ id: 'x', type: 'made.up' }] }, team },
      'overview',
    );
    expect(result.source).toBe('personal');
    expect(result.document.cards).toEqual([]);
  });
});

describe('cardAvailability', () => {
  const all = { channels: ['seo', 'ai'] as const, permissions: [] as string[], integrations: [] as string[] };

  it('is available when every requirement is met', () => {
    for (const type of CARD_TYPES) expect(cardAvailability(type, all).state).toBe('available');
  });

  it('explains a missing channel', () => {
    const matrix = cardType('cross.matrix_summary');
    expect(matrix).toBeDefined();
    if (!matrix) return;
    expect(cardAvailability(matrix, { ...all, channels: ['seo'] })).toEqual({
      state: 'unavailable',
      reason: 'AI tracking is off in this project',
    });
  });

  it('accepts either channel for cards that need only one', () => {
    const competitors = cardType('competitors.summary');
    if (!competitors) throw new Error('missing card type');
    expect(cardAvailability(competitors, { ...all, channels: ['ai'] }).state).toBe('available');
    expect(cardAvailability(competitors, { ...all, channels: [] })).toEqual({
      state: 'unavailable',
      reason: 'SEO and AI tracking are off in this project',
    });
  });

  it('explains a missing integration', () => {
    const base = cardType('seo.rank_distribution');
    if (!base) throw new Error('missing card type');
    const needsGsc = { ...base, integration: 'gsc' };
    expect(cardAvailability(needsGsc, all).state).toBe('unavailable');
    expect(cardAvailability(needsGsc, { ...all, integrations: ['gsc'] }).state).toBe('available');
  });

  it('hides a card the person has no permission for', () => {
    const base = cardType('seo.rank_distribution');
    if (!base) throw new Error('missing card type');
    expect(cardAvailability({ ...base, permission: 'costs:read' }, all)).toEqual({ state: 'hidden' });
    expect(cardAvailability({ ...base, permission: 'costs:read' }, { ...all, permissions: ['costs:read'] }).state).toBe(
      'available',
    );
  });
});

describe('rows', () => {
  it('maps widths to columns per breakpoint', () => {
    expect(WIDTHS.map((w) => spanOf(w, 'wide'))).toEqual([4, 6, 8, 12]);
    expect(WIDTHS.map((w) => spanOf(w, 'medium'))).toEqual([6, 6, 12, 12]);
    expect(WIDTHS.map((w) => spanOf(w, 'narrow'))).toEqual([12, 12, 12, 12]);
  });

  it('flows cards in order, wraps when a card does not fit, and never stretches', () => {
    const cards = [
      card('a', 'x', { width: 'two_thirds' }),
      card('b', 'x', { width: 'third' }),
      card('c', 'x', { width: 'two_thirds' }),
      card('d', 'x', { width: 'half' }),
    ];
    expect(packRows(cards, 'wide')).toEqual([
      [
        { id: 'a', span: 8 },
        { id: 'b', span: 4 },
      ],
      [{ id: 'c', span: 8 }],
      [{ id: 'd', span: 6 }],
    ]);
    expect(trailingSpace(cards, 'wide')).toBe(6);
  });

  it('collapses at medium and stacks at narrow', () => {
    const cards = [
      card('a', 'x', { width: 'third' }),
      card('b', 'x', { width: 'third' }),
      card('c', 'x', { width: 'two_thirds' }),
    ];
    expect(packRows(cards, 'medium').map((row) => row.length)).toEqual([2, 1]);
    expect(packRows(cards, 'narrow').map((row) => row.length)).toEqual([1, 1, 1]);
  });

  it('reports a whole free row when there are no cards or the last row is full', () => {
    expect(packRows([], 'wide')).toEqual([]);
    expect(trailingSpace([], 'wide')).toBe(12);
    expect(trailingSpace([card('a', 'x', { width: 'full' })], 'wide')).toBe(12);
  });
});

describe('draft edits', () => {
  it('adds a card with the type defaults, at the end or at an index', () => {
    const doc = overview();
    const added = addCard(doc, 'seo.top_movers', 'new-1');
    expect(added.cards?.at(-1)).toEqual({
      id: 'new-1',
      type: 'seo.top_movers',
      width: 'half',
      options: { direction: 'all', rows: '5' },
    });
    const first = addCard(doc, 'seo.serp_features', 'new-2', 0);
    expect(first.cards?.[0]?.id).toBe('new-2');
    expect(doc.cards).toHaveLength(8);
  });

  it('refuses a card beyond maxInstances or the page limit', () => {
    const doc = overview();
    expect(canAddCard(doc, 'seo.rank_distribution', 'overview')).toBe(false);
    expect(addCard(doc, 'seo.rank_distribution', 'dup')).toBe(doc);
    expect(canAddCard(doc, 'inspector.rank_history', 'overview')).toBe(false);
    let full = overview();
    for (let i = 0; i < 4; i += 1) full = addCard(full, 'ai.mention_trend', `t${i}`);
    expect(full.cards).toHaveLength(LIMITS.cards);
    expect(canAddCard(full, 'seo.top_movers', 'overview')).toBe(false);
  });

  it('gives each instance of a reusable type the first engine not yet used', () => {
    let doc = overview();
    doc = addCard(doc, 'ai.mention_trend', 't1');
    doc = addCard(doc, 'ai.mention_trend', 't2');
    const engines = (doc.cards ?? []).filter((c) => c.type === 'ai.mention_trend').map((c) => c.options?.engine);
    expect(engines).toEqual([ENGINES[0]?.code, ENGINES[1]?.code]);
  });

  it('hides and moves cards without touching the others', () => {
    const doc = overview();
    const ids = (doc.cards ?? []).map((c) => c.id);
    const hidden = hideCard(doc, ids[1] ?? '');
    expect(hidden.cards?.map((c) => c.id)).toEqual(ids.filter((_, i) => i !== 1));
    const moved = moveCard(doc, ids[0] ?? '', 2);
    expect(moved.cards?.map((c) => c.id)).toEqual([ids[1], ids[2], ids[0], ...ids.slice(3)]);
    expect(moveCard(doc, ids[0] ?? '', 99).cards?.at(-1)?.id).toBe(ids[0]);
    expect(moveCard(doc, 'missing', 0)).toBe(doc);
    expect(moveCard(doc, ids[0] ?? '', 0)).toBe(doc);
  });

  it('sets only widths and option values the type allows', () => {
    const doc = addCard(overview(), 'seo.top_movers', 'm');
    const id = doc.cards?.[1]?.id ?? '';
    expect(setCardWidth(doc, id, 'half').cards?.[1]?.width).toBe('half');
    expect(setCardWidth(doc, id, 'full')).toBe(doc);
    expect(setCardOption(doc, 'm', 'direction', 'declined').cards?.at(-1)?.options?.direction).toBe('declined');
    expect(setCardOption(doc, 'm', 'direction', 'sideways')).toBe(doc);
    expect(setCardOption(doc, 'm', 'unknown', 'x')).toBe(doc);
  });

  it('refuses an id already in use and indexes that are not numbers', () => {
    const doc = overview();
    const usedId = doc.cards?.[0]?.id ?? '';
    const hidden = hideCard(doc, doc.cards?.[1]?.id ?? '');
    expect(addCard(hidden, 'seo.rank_distribution', usedId)).toBe(hidden);
    const fewer = removeNumber(doc, doc.numbers?.[1]?.id ?? '');
    expect(addNumber(fewer, { id: doc.numbers?.[0]?.id ?? '', metric: 'seo.top10_count' })).toBe(fewer);
    expect(moveCard(doc, usedId, Number.NaN)).toBe(doc);
    expect(moveNumber(doc, doc.numbers?.[0]?.id ?? '', Number.NaN)).toBe(doc);
    expect(addCard(doc, 'seo.top_movers', 'm', Number.NaN).cards?.at(-1)?.id).toBe('m');
  });

  it('ignores option keys that are not the type\u2019s own', () => {
    const doc = addCard(overview(), 'seo.top_movers', 'm');
    for (const key of ['constructor', '__proto__', 'toString']) expect(setCardOption(doc, 'm', key, 'x')).toBe(doc);
  });

  it('keeps the instances of a reusable type on different identity values', () => {
    let doc = overview();
    doc = addCard(doc, 'ai.mention_trend', 't1');
    doc = addCard(doc, 'ai.mention_trend', 't2');
    const type = cardType('ai.mention_trend');
    if (!type) throw new Error('missing card type');
    expect(identityOption(type)).toBe('engine');
    expect(identityOption(cardType('seo.top_movers') ?? type)).toBeNull();
    expect([...takenIdentityValues(doc, type, 't2')]).toEqual(['chatgpt_web']);
    expect(setCardOption(doc, 't2', 'engine', 'chatgpt_web')).toBe(doc);
    expect(setCardOption(doc, 't2', 'engine', 'google_ai_mode').cards?.at(-1)?.options?.engine).toBe('google_ai_mode');
  });

  it('adds, removes and moves numbers within the rules', () => {
    const doc = overview();
    expect(canAddNumber(doc, 'seo.top3_count')).toBe(false);
    const fewer = removeNumber(doc, doc.numbers?.[0]?.id ?? '');
    expect(fewer.numbers).toHaveLength(5);
    expect(canAddNumber(fewer, 'seo.top10_count')).toBe(false);
    expect(canAddNumber(fewer, 'ai.mention_rate')).toBe(false);
    expect(canAddNumber(fewer, 'ai.mention_rate', 'chatgpt_web')).toBe(false);
    expect(canAddNumber(fewer, 'ai.mention_rate', 'google_ai_overview')).toBe(true);
    // An SEO number never takes an engine, whatever string is passed
    expect(canAddNumber(fewer, 'seo.top3_count', 'chatgpt_web')).toBe(false);
    expect(canAddNumber(fewer, 'seo.top3_count', 'not-an-engine' as EngineCode)).toBe(false);
    expect(canAddNumber(fewer, 'ai.citation_rate', 'not-an-engine' as EngineCode)).toBe(false);
    expect(addNumber(fewer, { id: 'dup', metric: 'seo.top10_count', engine: 'chatgpt_web' })).toBe(fewer);
    expect(addNumber(fewer, { id: 'first', metric: 'seo.top20_count' }, 0).numbers?.[0]?.id).toBe('first');
    const more = addNumber(fewer, { id: 'n-new', metric: 'seo.top3_count' });
    expect(more.numbers?.at(-1)).toEqual({ id: 'n-new', metric: 'seo.top3_count' });
    expect(addNumber(more, { id: 'x', metric: 'seo.top20_count' })).toBe(more);
    const moved = moveNumber(more, 'n-new', 0);
    expect(moved.numbers?.[0]?.id).toBe('n-new');
  });

  it('counts changes between two documents', () => {
    const before = overview();
    expect(changeCount(before, overview())).toBe(0);
    const ids = (before.cards ?? []).map((c) => c.id);
    expect(changeCount(before, hideCard(before, ids[0] ?? ''))).toBe(1);
    expect(changeCount(before, addCard(before, 'seo.top_movers', 'm'))).toBe(1);
    expect(changeCount(before, moveCard(before, ids[0] ?? '', 3))).toBe(1);
    expect(changeCount(before, setCardWidth(before, ids[1] ?? '', 'half'))).toBe(1);
    const withMovers = addCard(before, 'seo.top_movers', 'm');
    expect(changeCount(withMovers, setCardOption(withMovers, 'm', 'rows', '10'))).toBe(1);
    const several = removeNumber(
      moveCard(hideCard(before, ids[7] ?? ''), ids[0] ?? '', 2),
      before.numbers?.[0]?.id ?? '',
    );
    expect(changeCount(before, several)).toBe(3);
  });

  it('agrees with sameLayout: no changes exactly when the two layouts show the same thing', () => {
    // Same id, different card: a change, even though the id pairs them
    const rank: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [{ id: 'a', type: 'seo.rank_distribution', width: 'third' }],
    };
    const serp: LayoutDocument = {
      schema: 1,
      numbers: [],
      cards: [{ id: 'a', type: 'seo.serp_features', width: 'third' }],
    };
    expect(sameLayout(rank, serp)).toBe(false);
    expect(changeCount(rank, serp)).toBeGreaterThan(0);

    // Two trend cards whose engines were swapped and whose order was swapped back: the same layout again
    let start = addCard(overview(), 'ai.mention_trend', 't1');
    start = addCard(start, 'ai.mention_trend', 't2');
    let draft = setCardOption(start, 't2', 'engine', 'google_ai_mode');
    draft = setCardOption(draft, 't1', 'engine', 'gemini_web');
    draft = setCardOption(draft, 't2', 'engine', 'chatgpt_web');
    const index = draft.cards?.findIndex((item) => item.id === 't2') ?? -1;
    draft = moveCard(draft, 't2', index - 1);
    expect(draft.cards?.slice(-2).map((item) => `${item.id}:${item.options?.engine}`)).toEqual([
      't2:chatgpt_web',
      't1:gemini_web',
    ]);
    expect(sameLayout(start, draft)).toBe(true);
    expect(changeCount(start, draft)).toBe(0);
  });

  it('does not count a card that was hidden and put back where it was', () => {
    const before = overview();
    const last = before.cards?.at(-1);
    if (!last) throw new Error('missing card');
    const readded = addCard(hideCard(before, last.id), last.type, 'fresh-id');
    expect(changeCount(before, readded)).toBe(0);
    const first = before.cards?.[0];
    if (!first) throw new Error('missing card');
    // Put back at the end instead: the same card, moved, which is one change
    const moved = addCard(hideCard(before, first.id), first.type, 'fresh-id-2');
    expect(changeCount(before, moved)).toBe(1);
    expect(sameLayout(before, readded)).toBe(true);
    expect(sameLayout(before, moved)).toBe(false);
  });
});
