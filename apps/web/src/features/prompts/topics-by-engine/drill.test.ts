import { describe, expect, it } from 'vitest';

import { drillHref, ENGINE_PARAM, parseEngineParam, parseView } from './drill';

const PATH = '/acme/site/ai/prompts';

/** The path and the query of an address, for a test to read keys from. */
const parts = (href: string): { path: string; params: URLSearchParams } => {
  const url = new URL(href, 'https://app.test');
  return { path: url.pathname, params: url.searchParams };
};

describe('drillHref: the address of a topic on one engine (WB-TPE-07 and 12)', () => {
  it('builds the drill-down address and keeps the other keys', () => {
    const { path, params } = parts(drillHref(PATH, '?metric=sov&view=heatmap&country=DE', 't-1', 'gemini_web'));
    expect(path).toBe(PATH);
    expect(params.get('inspect')).toBe('topic:t-1');
    expect(params.get('itab')).toBe('prompts');
    expect(params.get(ENGINE_PARAM)).toBe('gemini_web');
    expect(params.get('metric')).toBe('sov');
    expect(params.get('view')).toBe('heatmap');
    expect(params.get('country')).toBe('DE');
  });

  it('replaces an earlier inspect, itab and eng', () => {
    const { params } = parts(
      drillHref(PATH, 'inspect=prompt:p-9&itab=history&eng=chatgpt_web&view=engines', 't-1', 'gemini_web'),
    );
    expect(params.getAll('inspect')).toEqual(['topic:t-1']);
    expect(params.getAll('itab')).toEqual(['prompts']);
    expect(params.getAll(ENGINE_PARAM)).toEqual(['gemini_web']);
    expect(params.get('view')).toBe('engines');
  });

  it('works from an address with no query', () => {
    const { params } = parts(drillHref(PATH, '', 't-1', 'chatgpt_web'));
    expect([...params.keys()].sort()).toEqual(['eng', 'inspect', 'itab']);
  });

  it('keeps the key __none', () => {
    const { params } = parts(drillHref(PATH, '', '__none', 'chatgpt_web'));
    expect(params.get('inspect')).toBe('topic:__none');
  });
});

describe('parseEngineParam: the engine the drawer filters its prompts to', () => {
  it('parses eng against the engines shown and drops an unknown code', () => {
    const codes = ['chatgpt_web', 'gemini_web'];
    expect(parseEngineParam('gemini_web', codes)).toBe('gemini_web');
    expect(parseEngineParam('google_ai_mode', codes)).toBeNull();
    expect(parseEngineParam('', codes)).toBeNull();
    expect(parseEngineParam(null, codes)).toBeNull();
  });
});

describe('parseView: which view of the Topics tab the address names', () => {
  it('reads view: list by default, engines, heatmap, anything else is list', () => {
    expect(parseView(null)).toBe('list');
    expect(parseView('engines')).toBe('engines');
    expect(parseView('heatmap')).toBe('heatmap');
    expect(parseView('list')).toBe('list');
    expect(parseView('Heatmap')).toBe('list');
    expect(parseView('table')).toBe('list');
  });
});
