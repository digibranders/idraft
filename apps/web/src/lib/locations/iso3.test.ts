import { describe, expect, it } from 'vitest';

import { countryNameOfIso3, iso2Of } from './iso3';

describe('iso2Of', () => {
  it('gives the alpha-2 code of an alpha-3 code, in any case', () => {
    expect(iso2Of('IND')).toBe('IN');
    expect(iso2Of('usa')).toBe('US');
    expect(iso2Of('ZWE')).toBe('ZW');
    expect(iso2Of('AND')).toBe('AD');
  });

  it('knows Kosovo by the code Search Console uses', () => {
    expect(iso2Of('XKK')).toBe('XK');
  });

  it('has no code for the unknown region or for a code that is not a country', () => {
    expect(iso2Of('ZZZ')).toBeNull();
    expect(iso2Of('QQQ')).toBeNull();
    expect(iso2Of('IN')).toBeNull();
  });
});

describe('countryNameOfIso3', () => {
  it('names a country in the language asked for', () => {
    expect(countryNameOfIso3('IND', 'en')).toBe('India');
    expect(countryNameOfIso3('deu', 'en')).toBe('Germany');
    expect(countryNameOfIso3('DEU', 'de')).toBe('Deutschland');
    expect(countryNameOfIso3('XKK', 'en')).toBe('Kosovo');
  });

  it('has no name for the unknown region or an unknown code', () => {
    expect(countryNameOfIso3('ZZZ', 'en')).toBeNull();
    expect(countryNameOfIso3('QQQ', 'en')).toBeNull();
  });
});
