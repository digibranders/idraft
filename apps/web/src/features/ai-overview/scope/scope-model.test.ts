import { describe, expect, it } from 'vitest';

import { parseCompare } from '@/lib/compare/compare-model';

import {
  brandedParams,
  changedFilterCount,
  RESET_PATCH,
  parseBranded,
  parseCountry,
  parseEngines,
  parseTopic,
  previousWindow,
  scopeKey,
  type OverviewScope,
} from './scope-model';

const KNOWN = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';

function scopeOf(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...patch,
  };
}

describe('previousWindow', () => {
  it('is as many days just before from (Oct 16 to Nov 12 gives Sep 18 to Oct 15)', () => {
    expect(previousWindow('2026-10-16', '2026-11-12')).toEqual({ from: '2026-09-18', to: '2026-10-15' });
  });

  it('of one day is the day before', () => {
    expect(previousWindow('2026-11-12', '2026-11-12')).toEqual({ from: '2026-11-11', to: '2026-11-11' });
  });

  it('crosses a month end and a leap day', () => {
    expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
    expect(previousWindow('2028-03-01', '2028-03-10')).toEqual({ from: '2028-02-20', to: '2028-02-29' });
  });

  it('refuses a window that ends before it starts and a date that is not a day', () => {
    expect(() => previousWindow('2026-11-12', '2026-11-01')).toThrow(RangeError);
    expect(() => previousWindow('2026-13-01', '2026-11-01')).toThrow(RangeError);
  });
});

describe('parseCompare', () => {
  it('is the shared rule: only cmp=off is off', () => {
    expect(parseCompare('off')).toBe(false);
    expect(parseCompare(null)).toBe(true);
  });
});

describe('parseCountry', () => {
  it('accepts two capital letters only', () => {
    expect(parseCountry('DE')).toBe('DE');
    expect(parseCountry('de')).toBeNull();
    expect(parseCountry('DEU')).toBeNull();
    expect(parseCountry('D')).toBeNull();
    expect(parseCountry('DE,US')).toBeNull();
    expect(parseCountry('')).toBeNull();
    expect(parseCountry(null)).toBeNull();
  });
});

describe('parseEngines', () => {
  it('keeps known codes once in the order given and reads none as every engine', () => {
    expect(parseEngines('gemini_web,chatgpt_web', KNOWN)).toEqual(['gemini_web', 'chatgpt_web']);
    expect(parseEngines('chatgpt_web,bogus,chatgpt_web, gemini_web', KNOWN)).toEqual(['chatgpt_web', 'gemini_web']);
    expect(parseEngines('bogus', KNOWN)).toBeNull();
    expect(parseEngines('', KNOWN)).toBeNull();
    expect(parseEngines(null, KNOWN)).toBeNull();
    expect(parseEngines(',,', KNOWN)).toBeNull();
  });
});

describe('parseBranded', () => {
  it('defaults to excluded and reads only and included', () => {
    expect(parseBranded(null)).toBe('excluded');
    expect(parseBranded('')).toBe('excluded');
    expect(parseBranded('excluded')).toBe('excluded');
    expect(parseBranded('bogus')).toBe('excluded');
    expect(parseBranded('only')).toBe('only');
    expect(parseBranded('included')).toBe('included');
    expect(parseBranded('ONLY')).toBe('excluded');
  });

  it('reads branded=include, which the Prompts page writes, as included', () => {
    expect(parseBranded('include')).toBe('included');
  });
});

describe('parseTopic', () => {
  it('accepts a term id and nothing else', () => {
    expect(parseTopic(TOPIC)).toBe(TOPIC);
    expect(parseTopic('crm')).toBeNull();
    expect(parseTopic(`${TOPIC},${TOPIC}`)).toBeNull();
    expect(parseTopic('')).toBeNull();
    expect(parseTopic(null)).toBeNull();
  });

  it('lowercases the id, so equal ids share one query key', () => {
    expect(parseTopic(TOPIC.toUpperCase())).toBe(TOPIC);
  });
});

describe('brandedParams', () => {
  it('maps excluded to include_branded false, included to true, only to branded_only true', () => {
    expect(brandedParams('excluded')).toEqual({ include_branded: false });
    expect(brandedParams('included')).toEqual({ include_branded: true });
    expect(brandedParams('only')).toEqual({ include_branded: true, branded_only: true });
  });
});

describe('scopeKey', () => {
  it('is stable and equal for equal scopes', () => {
    expect(scopeKey(scopeOf())).toBe(scopeKey(scopeOf()));
    expect(scopeKey(scopeOf({ engines: ['gemini_web', 'chatgpt_web'] }))).toBe(
      scopeKey(scopeOf({ engines: ['chatgpt_web', 'gemini_web'] })),
    );
  });

  it('differs when any part of the scope differs', () => {
    const base = scopeKey(scopeOf());
    const others = [
      scopeOf({ range: { from: '2026-10-17', to: '2026-11-13', days: 28 } }),
      scopeOf({ compare: false }),
      scopeOf({ country: 'DE' }),
      scopeOf({ engines: ['chatgpt_web'] }),
      scopeOf({ topic: TOPIC }),
      scopeOf({ branded: 'only' }),
    ].map(scopeKey);
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
  });

  it('ignores the previous window when the comparison is off', () => {
    const a = scopeOf({ compare: false });
    const b = scopeOf({ compare: false, previous: { from: '2000-01-01', to: '2000-01-02' } });
    expect(scopeKey(a)).toBe(scopeKey(b));
  });
});

describe('changedFilterCount', () => {
  it('is zero for the default scope, whatever the window and the country are', () => {
    expect(changedFilterCount(scopeOf())).toBe(0);
    expect(changedFilterCount(scopeOf({ country: 'DE', rangeValue: { kind: 'preset', preset: '7d' } }))).toBe(0);
  });

  it('counts the comparison, the engines, the topic and the branded choice that are not the default', () => {
    expect(changedFilterCount(scopeOf({ compare: false }))).toBe(1);
    expect(changedFilterCount(scopeOf({ engines: ['gemini_web'] }))).toBe(1);
    expect(changedFilterCount(scopeOf({ topic: TOPIC }))).toBe(1);
    expect(changedFilterCount(scopeOf({ branded: 'included' }))).toBe(1);
    expect(changedFilterCount(scopeOf({ branded: 'only' }))).toBe(1);
    expect(
      changedFilterCount(scopeOf({ compare: false, engines: ['gemini_web'], topic: TOPIC, branded: 'only' })),
    ).toBe(4);
  });

  it('has a reset patch that leaves the window and the country out and brings the count to zero', () => {
    expect(Object.keys(RESET_PATCH).sort()).toEqual(['branded', 'compare', 'engines', 'topic']);
    const reset = scopeOf({ compare: false, engines: ['gemini_web'], topic: TOPIC, branded: 'only', country: 'DE' });
    expect(changedFilterCount({ ...reset, ...RESET_PATCH } as OverviewScope)).toBe(0);
  });
});
