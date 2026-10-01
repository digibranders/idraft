import { describe, expect, it } from 'vitest';

import { foldName, otherNames } from './aliases';

describe('otherNames', () => {
  it('keeps each other name once, whatever its case, and leaves out the name itself', () => {
    expect(otherNames(' HubSpot ', ['hubspot', 'HubSpot CRM', ' ', 'hubspot crm'])).toEqual(['HubSpot CRM']);
  });
});

describe('foldName', () => {
  it('folds case, accents, curly quotes, dashes and runs of spaces, as the matcher does', () => {
    expect(foldName('  Caf\u00E9   Nestl\u00E9 ')).toBe('cafe nestle');
    expect(foldName(`Ben\u2019s${String.fromCodePoint(0x2013)}Shop`)).toBe("ben's-shop");
    expect(foldName('\u201CAcme\u201D')).toBe('"acme"');
    expect(foldName('Acme\u200B Labs')).toBe('acme labs');
    expect(foldName('\uFF21\uFF23\uFF2D\uFF25')).toBe('acme');
  });

  it('reads symbols and other numbers as spaces, and folds case fully', () => {
    expect(foldName('Acme™')).toBe('acme');
    expect(foldName('HubSpot® CRM')).toBe('hubspot crm');
    expect(foldName('Straße')).toBe('strasse');
    expect(foldName('″Acme″')).toBe('"acme"');
  });

  it('keeps the marks that tell letters apart outside Latin, Greek and Cyrillic', () => {
    expect(foldName('\u0915\u093F')).toBe('\u0915\u093F');
  });
});
