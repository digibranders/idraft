import { describe, expect, it } from 'vitest';

import { AI_OVERVIEW_CARDS, cardEntries } from './registry';
import { ACTIVITY_CARDS } from './activity';
import { COMPETITOR_CARDS } from './competitors';
import { ENGINE_CARDS } from './engines';
import { SOURCE_CARDS } from './sources';
import { TOPIC_CARDS } from './topics';
import type { CardRegistration } from '@/features/layouts';
import { CARD_TYPES } from '@/lib/layouts';

const ACTIVE_TYPES = CARD_TYPES.filter((type) => type.status === 'active' && type.screens.includes('ai_overview')).map(
  (type) => type.key,
);

describe('the card registry of the AI visibility Overview', () => {
  it('has an entry for every active card type of the screen', () => {
    expect(ACTIVE_TYPES.length).toBeGreaterThan(30);
    expect(Object.keys(AI_OVERVIEW_CARDS).sort()).toEqual([...ACTIVE_TYPES].sort());
  });

  it('has no entry for a card type of another screen', () => {
    const other = CARD_TYPES.find((type) => !type.screens.includes('ai_overview'));
    if (other === undefined) throw new Error('every card type is on this screen');
    expect(Object.keys(AI_OVERVIEW_CARDS)).not.toContain(other.key);
  });

  it('replaces a pending entry with a family card, the families after the pending cards', () => {
    const real: CardRegistration = { load: () => Promise.reject(new Error('not loaded here')) };
    const entries = cardEntries([{ 'ai.by_engine': real }]);
    expect(entries['ai.by_engine']).toBe(real);
    expect(Object.keys(entries).sort()).toEqual([...ACTIVE_TYPES].sort());
    expect(entries['ai.outcome_mix']).not.toBe(real);
  });

  it('throws for a family card whose type the catalog does not have on this screen', () => {
    const real: CardRegistration = { load: () => Promise.reject(new Error('not loaded here')) };
    expect(() => cardEntries([{ 'ai.no_such_card': real }])).toThrow(
      'The card type "ai.no_such_card" is not an active card type of the ai_overview screen',
    );
  });

  it('starts with the five family maps empty, each a record of registrations', () => {
    for (const family of [ENGINE_CARDS, COMPETITOR_CARDS, TOPIC_CARDS, SOURCE_CARDS, ACTIVITY_CARDS]) {
      expect(family).toEqual({});
    }
  });
});
