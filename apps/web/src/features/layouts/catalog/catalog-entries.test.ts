import { describe, expect, it } from 'vitest';

import { catalogEntries, type CatalogEntry, type CatalogGroup } from './catalog-entries';
import { CARD_TYPES, SCREENS, type Availability, type CardItem, type LayoutDocument } from '@/lib/layouts';

const AVAILABLE: Availability = { state: 'available' };
const everythingAvailable = (): Availability => AVAILABLE;
const BUILTIN: LayoutDocument = SCREENS.overview.builtin;
const EMPTY: LayoutDocument = { schema: 1, numbers: [], cards: [] };
const TODAY = '2026-10-15';

function entries(options: Partial<Parameters<typeof catalogEntries>[0]> = {}): CatalogGroup[] {
  return catalogEntries({
    screen: 'overview',
    document: BUILTIN,
    availabilityOf: everythingAvailable,
    query: '',
    today: TODAY,
    ...options,
  });
}

const flat = (groups: readonly CatalogGroup[]): CatalogEntry[] => groups.flatMap((group) => group.entries);
const keysOf = (groups: readonly CatalogGroup[]): string[] => flat(groups).map((entry) => entry.type.key);
const entryOf = (groups: readonly CatalogGroup[], key: string): CatalogEntry => {
  const found = flat(groups).find((entry) => entry.type.key === key);
  if (found === undefined) throw new Error(`the catalog does not list ${key}`);
  return found;
};
const cardsOfType = (type: string, count: number): CardItem[] =>
  Array.from({ length: count }, (_, at) => ({ id: `${type}-${String(at)}`, type }));

describe('catalogEntries', () => {
  it('lists only active types of the screen', () => {
    const topMovers = CARD_TYPES.find((type) => type.key === 'seo.top_movers');
    if (topMovers === undefined) throw new Error('the catalog has no Top movers');
    const retired = { ...topMovers, key: 'old.card', status: 'retired' as const };
    const overview = keysOf(entries({ types: [...CARD_TYPES, retired] }));
    expect(overview).toContain('seo.top_movers');
    expect(overview).not.toContain('old.card');
    // A drawer card is not offered on the overview, nor an overview card in the drawer
    expect(overview).not.toContain('inspector.key_numbers');
    const drawer = keysOf(entries({ screen: 'inspector.keyword', document: EMPTY }));
    expect(drawer).toContain('inspector.key_numbers');
    expect(drawer).not.toContain('seo.top_movers');
  });

  it('leaves out hidden types', () => {
    const keys = keysOf(
      entries({ availabilityOf: (item) => (item.type === 'seo.top_movers' ? { state: 'hidden' } : AVAILABLE) }),
    );
    expect(keys).not.toContain('seo.top_movers');
    expect(keys).toContain('seo.serp_features');
  });

  it('groups in the order SEO, AI, Cross-channel, Activity and drops empty groups', () => {
    expect(entries().map((group) => group.group)).toEqual(['seo', 'ai', 'cross', 'activity']);
    expect(entries({ query: 'collection status' }).map((group) => group.group)).toEqual(['activity']);
    expect(entries({ screen: 'inspector.keyword', document: EMPTY }).map((group) => group.group)).toEqual([
      'seo',
      'ai',
    ]);
  });

  it('matches the search on title and description, case blind and trimmed', () => {
    expect(keysOf(entries({ query: '  TOP MOVERS ' }))).toEqual(['seo.top_movers']);
    // Only the description says "share of voice" in both
    expect(keysOf(entries({ query: 'Share Of Voice' }))).toEqual(['competitors.summary', 'competitors.share_of_voice']);
    expect(entries({ query: 'no card says this' })).toEqual([]);
    expect(keysOf(entries({ query: '   ' }))).toEqual(keysOf(entries()));
  });

  it('says add, addAnother, added, unavailable with its reason, or pageFull', () => {
    // The built-in layout holds AI by engine once, and the type takes one instance
    expect(entryOf(entries(), 'ai.by_engine').state).toBe('added');
    expect(entryOf(entries(), 'seo.top_movers').state).toBe('add');

    const oneTrend: LayoutDocument = {
      schema: 1,
      cards: [{ id: 'm1', type: 'ai.mention_trend', options: { engine: 'chatgpt_web' } }],
    };
    expect(entryOf(entries({ document: oneTrend }), 'ai.mention_trend').state).toBe('addAnother');

    const reason = 'AI tracking is off in this project';
    const off = entryOf(
      entries({
        availabilityOf: (item) => (item.type === 'ai.by_engine' ? { state: 'unavailable', reason } : AVAILABLE),
      }),
      'ai.by_engine',
    );
    expect(off).toMatchObject({ state: 'unavailable', reason });

    // Twelve cards fill the page: what is not on it yet cannot be added
    const full: LayoutDocument = { schema: 1, cards: cardsOfType('seo.rank_distribution', 12) };
    const groups = entries({ document: full });
    expect(entryOf(groups, 'seo.top_movers').state).toBe('pageFull');
    expect(entryOf(groups, 'seo.rank_distribution').state).toBe('added');
  });

  it('marks a type new by isNewCardType with today', () => {
    // Top movers was released on 2026-09-30, key changes before customization existed
    expect(entryOf(entries({ today: '2026-10-15' }), 'seo.top_movers').isNew).toBe(true);
    expect(entryOf(entries({ today: '2026-10-15' }), 'activity.key_changes').isNew).toBe(false);
    expect(entryOf(entries({ today: '2026-10-29' }), 'seo.top_movers').isNew).toBe(true);
    expect(entryOf(entries({ today: '2026-10-30' }), 'seo.top_movers').isNew).toBe(false);
  });
});
