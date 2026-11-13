import { describe, expect, it } from 'vitest';

import { CARD_HEIGHT, TOPIC_CARD_KEYS } from './card-heights';

describe('the card heights of the topics family', () => {
  it('has a height for every key and no other', () => {
    expect(Object.keys(CARD_HEIGHT).sort()).toEqual([...TOPIC_CARD_KEYS].sort());
  });

  it('every height is one of 140, 180, 240, 280', () => {
    for (const height of Object.values(CARD_HEIGHT)) {
      expect([140, 180, 240, 280]).toContain(height);
    }
  });
});
