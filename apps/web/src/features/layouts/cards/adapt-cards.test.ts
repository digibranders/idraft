import { describe, expect, it } from 'vitest';

import { adaptCardsByReadiness } from './adapt-cards';
import type { CardItem } from '@/lib/layouts';

const makeCard = (id: string, type = 'ai.rate_trend_by_engine'): CardItem => ({
  id,
  type,
  width: 'half',
});

describe('adaptCardsByReadiness', () => {
  it('returns cards unchanged when all cards are ready', () => {
    const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')];
    const isNotReady = () => false;
    expect(adaptCardsByReadiness(cards, isNotReady)).toEqual(cards);
  });

  it('moves not-ready (empty) cards to the end, preserving relative order of both groups', () => {
    const c1 = makeCard('c1');
    const c2 = makeCard('c2');
    const c3 = makeCard('c3');
    const c4 = makeCard('c4');
    const cards = [c1, c2, c3, c4];

    // c2 and c3 are empty/not-ready
    const notReady = new Set(['c2', 'c3']);
    const isNotReady = (id: string) => notReady.has(id);

    const result = adaptCardsByReadiness(cards, isNotReady);
    expect(result).toEqual([c1, c4, c2, c3]);
  });

  it('returns cards unchanged when all cards are not ready', () => {
    const cards = [makeCard('c1'), makeCard('c2')];
    const isNotReady = () => true;
    expect(adaptCardsByReadiness(cards, isNotReady)).toEqual(cards);
  });

  it('returns empty array when input is empty', () => {
    expect(adaptCardsByReadiness([], () => false)).toEqual([]);
  });
});
