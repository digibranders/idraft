import { describe, expect, it } from 'vitest';

import { MAX_TIERS, tierLabel, tierPosition, UNTIERED_POSITION } from './tiers';

describe('tier helpers', () => {
  it('reads the position from the code the API sends', () => {
    expect(tierPosition({ code: 'T1' })).toBe(1);
    expect(tierPosition({ code: 'T8' })).toBe(8);
  });

  it('puts Untiered after every tier', () => {
    expect(tierPosition(null)).toBe(UNTIERED_POSITION);
    expect(UNTIERED_POSITION).toBeGreaterThan(MAX_TIERS);
  });

  it('refuses a code that is not T1 to T8', () => {
    expect(() => tierPosition({ code: 'T9' })).toThrow('Not a tier code: T9');
    expect(() => tierPosition({ code: 'X' })).toThrow('Not a tier code: X');
  });

  it('labels a tier with its code and name, as filters and tooltips show it', () => {
    expect(tierLabel({ code: 'T1', name: 'Money pages' }, 'Untiered')).toBe('T1 Money pages');
    expect(tierLabel(null, 'Untiered')).toBe('Untiered');
  });
});
