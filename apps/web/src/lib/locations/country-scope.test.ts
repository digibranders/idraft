import { describe, expect, it } from 'vitest';

import { countryChoices, parseCountry } from './country-scope';

describe('parseCountry', () => {
  it('keeps two capital letters', () => {
    expect(parseCountry('DE')).toBe('DE');
    expect(parseCountry('IN')).toBe('IN');
  });

  it('reads anything else as every country', () => {
    for (const value of ['de', 'De', 'DEU', 'D', '', ' DE', 'DE,IN', 'D1', null]) {
      expect(parseCountry(value)).toBeNull();
    }
  });
});

describe('countryChoices', () => {
  it('lists each prompt country once, sorted', () => {
    const prompts = [{ country_iso: 'IN' }, { country_iso: 'DE' }, { country_iso: 'IN' }, { country_iso: null }];
    expect(countryChoices(prompts, null)).toEqual(['DE', 'IN']);
  });

  it('keeps the selected one even when no prompt has it', () => {
    expect(countryChoices([{ country_iso: 'DE' }], 'AT')).toEqual(['AT', 'DE']);
    expect(countryChoices([], 'AT')).toEqual(['AT']);
  });

  it('lists nothing when no prompt has a country and none is selected', () => {
    expect(countryChoices([{ country_iso: null }], null)).toEqual([]);
    expect(countryChoices([], null)).toEqual([]);
  });
});
