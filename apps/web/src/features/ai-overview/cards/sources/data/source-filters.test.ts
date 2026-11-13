import { describe, expect, it } from 'vitest';

import { canAskSources, sourceFilters, sourcesAskable } from './source-filters';
import { overviewSourcesQuery } from '../../../data/overview-queries';
import { scopeOf, ENGINES_ALL } from '../model/source-fixtures';
import type { EngineCode } from '@/lib/api/types';
import { filterParams, flagParams, sourceDomainsQuery } from '@/lib/citations/source-queries';

const PROJECT = { workspaceId: 'w-1', projectId: 'p-1' };
const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';

const read = (patch = {}, enabledEngines: readonly EngineCode[] = ENGINES_ALL) => ({
  scope: scopeOf(patch),
  enabledEngines,
});

/** The query values of a key: its last element. */
function queryOf(key: readonly unknown[]): Record<string, unknown> {
  const values = key.at(-1);
  if (typeof values !== 'object' || values === null) throw new Error('The key has no query values');
  return { ...values };
}

/** The scope part of a request: the list and comparison parameters left out, `include_branded: false` as left out. */
function scopeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const listOnly = new Set(['limit', 'include', 'compare', 'min_support', 'offset', 'sort']);
  return Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => !listOnly.has(key) && !(key === 'include_branded' && value === false),
    ),
  );
}

describe('sourceFilters', () => {
  it('leaves the engine filter out when every enabled engine is asked', () => {
    expect(sourceFilters(read()).engines).toEqual([]);
    expect(sourceFilters(read({ engines: ['gemini_web', 'chatgpt_web', 'google_ai_mode'] })).engines).toEqual([]);
  });

  it('sends the asked engines, in the order of the project, when a subset is asked', () => {
    const filters = sourceFilters(read({ engines: ['gemini_web', 'chatgpt_web'] }));
    expect(filters.engines).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('asks only the engines that are on: an engine of the scope that is off is not sent', () => {
    const filters = sourceFilters(read({ engines: ['chatgpt_web', 'google_ai_mode'] }, ['chatgpt_web', 'gemini_web']));
    expect(filters.engines).toEqual(['chatgpt_web']);
  });

  it('carries the window, the country and the topic of the scope', () => {
    const filters = sourceFilters(read({ country: 'DE', topic: TOPIC }));
    expect(filters).toMatchObject({ from: '2026-10-16', to: '2026-11-12', country: 'DE', term: TOPIC });
    expect(sourceFilters(read())).not.toHaveProperty('country');
    expect(sourceFilters(read())).not.toHaveProperty('term');
  });

  it('counts branded prompts only when the scope includes them, and never counts the flagged citations', () => {
    expect(sourceFilters(read()).includeBranded).toBe(false);
    expect(sourceFilters(read({ branded: 'included' })).includeBranded).toBe(true);
    const filters = sourceFilters(read({ branded: 'included' }));
    expect(flagParams(filters)).toEqual({});
  });

  it('narrows the rows to the roles given and leaves them out otherwise', () => {
    expect(sourceFilters(read(), ['third_party', 'competitor']).roles).toEqual(['third_party', 'competitor']);
    expect(sourceFilters(read()).roles).toEqual([]);
  });

  it('asks the same scope as the strip: the request parameters equal those of overviewSourcesQuery', () => {
    const scopes = [
      scopeOf(),
      scopeOf({ engines: ['chatgpt_web', 'gemini_web'] }),
      scopeOf({ branded: 'included', country: 'DE', topic: TOPIC }),
      scopeOf({ engines: ['gemini_web'], compare: false }),
    ];
    for (const scope of scopes) {
      const strip = overviewSourcesQuery(PROJECT, { scope, enabledEngines: ENGINES_ALL });
      const card = sourceDomainsQuery(PROJECT, sourceFilters({ scope, enabledEngines: ENGINES_ALL }), { limit: 8 });
      expect(scopeQuery(queryOf(card.queryKey))).toEqual(scopeQuery(queryOf(strip.queryKey)));
    }
  });

  it('writes the filters as the Citations page does', () => {
    expect(filterParams(sourceFilters(read({ engines: ['chatgpt_web'] })))).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      'filter[engine_code_in]': ['chatgpt_web'],
    });
  });
});

describe('sourcesAskable', () => {
  it('is ok for a scope with an engine on', () => {
    expect(sourcesAskable(read())).toBe('ok');
    expect(canAskSources(read())).toBe(true);
  });

  it('is no_engine when no engine is on, or the scope asks none that is on', () => {
    expect(sourcesAskable(read({}, []))).toBe('no_engine');
    expect(sourcesAskable(read({ engines: ['google_ai_mode'] }, ['chatgpt_web']))).toBe('no_engine');
    expect(canAskSources(read({}, []))).toBe(false);
  });

  it('is branded_only for branded prompts alone: the sources routes have no such filter', () => {
    expect(sourcesAskable(read({ branded: 'only' }))).toBe('branded_only');
    expect(canAskSources(read({ branded: 'only' }))).toBe(false);
  });
});
