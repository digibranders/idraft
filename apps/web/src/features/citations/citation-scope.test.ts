import { describe, expect, it } from 'vitest';

import { CITATION_KEYS, parseScope, toFilters } from './citation-scope';
import type { EngineCode } from '@/lib/citations/types';

const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const RANGE = { from: '2026-10-16', to: '2026-11-12' };

describe('parseScope', () => {
  it('reads the tab and falls back to Domains for anything else', () => {
    expect(parseScope({ tab: 'pages' }, ENABLED).tab).toBe('pages');
    expect(parseScope({ tab: 'domains' }, ENABLED).tab).toBe('domains');
    for (const tab of ['changes', 'Pages', '', null, undefined]) {
      expect(parseScope({ tab }, ENABLED).tab).toBe('domains');
    }
    expect(parseScope({}, ENABLED).tab).toBe('domains');
  });

  it('keeps only enabled engines and at most 3', () => {
    expect(parseScope({ engine: 'gemini_web,chatgpt_web' }, ENABLED).engines).toEqual(['gemini_web', 'chatgpt_web']);
    expect(parseScope({ engine: 'gemini_web,unknown_web,gemini_web' }, ENABLED).engines).toEqual(['gemini_web']);
    expect(parseScope({ engine: 'chatgpt_web' }, ['gemini_web']).engines).toEqual([]);
    // Only three engines exist, so the cap is read from a list of four codes
    const four = ['a', 'b', 'c', 'd'] as unknown as readonly EngineCode[];
    expect(parseScope({ engine: 'a,b,c,d' }, four).engines).toEqual(['a', 'b', 'c']);
    expect(parseScope({}, ENABLED).engines).toEqual([]);
  });

  it('reads role, topic, branded, cmp, min and sort and ignores unknown values', () => {
    const scope = parseScope(
      { role: 'competitor,own,vendor,own', topic: 't-9', branded: 'include', cmp: 'off', min: '5', sort: '-prompts' },
      ENABLED,
    );
    expect(scope).toMatchObject({
      roles: ['competitor', 'own'],
      term: 't-9',
      includeBranded: true,
      compare: false,
      minSupport: 5,
      sort: '-prompts',
    });
    const plain = parseScope({ role: 'nope', branded: 'yes', cmp: 'on', min: 'x', sort: 'name', topic: ' ' }, ENABLED);
    expect(plain).toMatchObject({
      roles: [],
      term: null,
      includeBranded: false,
      compare: true,
      minSupport: 2,
      sort: '-citation_units',
    });
  });

  it('min defaults to 2 and is clamped to 1 to 1000', () => {
    expect(parseScope({}, ENABLED).minSupport).toBe(2);
    expect(parseScope({ min: '0' }, ENABLED).minSupport).toBe(1);
    expect(parseScope({ min: '-4' }, ENABLED).minSupport).toBe(1);
    expect(parseScope({ min: '1000' }, ENABLED).minSupport).toBe(1000);
    expect(parseScope({ min: '5000' }, ENABLED).minSupport).toBe(1000);
    expect(parseScope({ min: '2.5' }, ENABLED).minSupport).toBe(2);
  });

  it('the domain filter reads equals:g2.com and nothing else', () => {
    expect(parseScope({ domain: 'equals:g2.com' }, ENABLED).domain).toBe('g2.com');
    for (const domain of ['contains:g2', 'g2.com', 'equals:', 'equals:  ', null]) {
      expect(parseScope({ domain }, ENABLED).domain).toBeNull();
    }
  });

  it('the domain filter is lower case, as the backend filter is not', () => {
    expect(parseScope({ domain: 'equals:G2.COM' }, ENABLED).domain).toBe('g2.com');
    expect(parseScope({ domain: 'equals: Mixed.Example ' }, ENABLED).domain).toBe('mixed.example');
  });

  it('reads the density and keeps the column text for the table to parse', () => {
    expect(parseScope({}, ENABLED)).toMatchObject({ density: 'compact', columns: null });
    expect(parseScope({ density: 'default', cols: 'domain,units' }, ENABLED)).toMatchObject({
      density: 'default',
      columns: 'domain,units',
    });
  });
});

describe('toFilters', () => {
  it('writes the window and the filters the routes take', () => {
    const scope = parseScope(
      { engine: 'chatgpt_web', role: 'own', topic: 't-1', branded: 'include', domain: 'equals:g2.com', min: '3' },
      ENABLED,
    );
    expect(toFilters(scope, RANGE)).toEqual({
      from: RANGE.from,
      to: RANGE.to,
      engines: ['chatgpt_web'],
      roles: ['own'],
      term: 't-1',
      includeBranded: true,
    });
  });

  it('leaves out what is not set', () => {
    expect(toFilters(parseScope({}, ENABLED), RANGE)).toEqual({
      from: RANGE.from,
      to: RANGE.to,
      engines: [],
      roles: [],
      includeBranded: false,
    });
  });
});

describe('CITATION_KEYS', () => {
  it('names every key the scope reads, once', () => {
    expect([...CITATION_KEYS].sort()).toEqual(
      ['branded', 'cmp', 'cols', 'density', 'domain', 'engine', 'min', 'role', 'sort', 'tab', 'topic'].sort(),
    );
    expect(new Set(CITATION_KEYS).size).toBe(CITATION_KEYS.length);
  });
});
