import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MIN_SUPPORT,
  EngineNotExposedError,
  MIN_SUPPORT_RANGE,
  PAGE_MAX,
  PREVIOUS_LIMIT,
  fanoutQuery,
  projectEnginesQuery,
} from './fanout-queries';
import type { FanoutFilters } from './types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import type { SourceScope } from '@/lib/citations/types';

const scope: SourceScope = { workspaceId: 'w-1', projectId: 'p-1' };
const FILTERS: FanoutFilters = { from: '2026-10-16', to: '2026-11-12', engine: ENGINE_FACTS.chatgpt_web };
const OPTIONS = { minSupport: 2, limit: 10 };

/** The query values of a key: its last element. */
const queryOf = (key: readonly unknown[]): unknown => key.at(-1);

describe('fanoutQuery', () => {
  it('sends the window, one engine, min_support and limit', () => {
    const query = fanoutQuery(scope, FILTERS, OPTIONS);
    expect(query.queryKey.slice(0, -1)).toEqual(['ws', 'w-1', 'p', 'p-1', 'ai', 'fanout-queries']);
    expect(queryOf(query.queryKey)).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      'filter[engine_code_in]': ['chatgpt_web'],
      min_support: 2,
      limit: 10,
    });
  });

  it('sends filter[prompt_id], filter[term], filter[country_iso] and include_branded only when set', () => {
    const asked = fanoutQuery(
      scope,
      { ...FILTERS, promptId: 'prompt-1', term: 'term-1', country: 'DE', includeBranded: true },
      OPTIONS,
    );
    expect(queryOf(asked.queryKey)).toMatchObject({
      'filter[prompt_id]': 'prompt-1',
      'filter[term]': 'term-1',
      'filter[country_iso]': 'DE',
      include_branded: true,
    });
    const plain = queryOf(fanoutQuery(scope, { ...FILTERS, includeBranded: false }, OPTIONS).queryKey);
    for (const name of ['filter[prompt_id]', 'filter[term]', 'filter[country_iso]', 'include_branded']) {
      expect(plain).not.toHaveProperty(name);
    }
  });

  it('sends include=topics only when asked', () => {
    expect(queryOf(fanoutQuery(scope, FILTERS, { ...OPTIONS, topics: true }).queryKey)).toHaveProperty('include', [
      'topics',
    ]);
    expect(queryOf(fanoutQuery(scope, FILTERS, { ...OPTIONS, topics: false }).queryKey)).not.toHaveProperty('include');
    expect(queryOf(fanoutQuery(scope, FILTERS, OPTIONS).queryKey)).not.toHaveProperty('include');
    // A topics read is its own cache entry
    expect(fanoutQuery(scope, FILTERS, { ...OPTIONS, topics: true }).queryKey).not.toEqual(
      fanoutQuery(scope, FILTERS, OPTIONS).queryKey,
    );
  });

  it('never sends offset 0, and sends a later one', () => {
    expect(queryOf(fanoutQuery(scope, FILTERS, { ...OPTIONS, offset: 0 }).queryKey)).not.toHaveProperty('offset');
    expect(queryOf(fanoutQuery(scope, FILTERS, { ...OPTIONS, offset: 50 }).queryKey)).toHaveProperty('offset', 50);
  });

  it('keeps one key per request: the same filters are one entry, another minimum or project is another', () => {
    const key = fanoutQuery(scope, FILTERS, OPTIONS).queryKey;
    expect(fanoutQuery(scope, { ...FILTERS }, { ...OPTIONS }).queryKey).toEqual(key);
    expect(fanoutQuery(scope, FILTERS, { ...OPTIONS, minSupport: 1 }).queryKey).not.toEqual(key);
    expect(fanoutQuery({ ...scope, projectId: 'p-2' }, FILTERS, OPTIONS).queryKey).not.toEqual(key);
  });

  it('no engine key is named for a non-exposing engine: the builder throws a specific error', () => {
    for (const code of ['gemini_web', 'google_ai_mode'] as const) {
      const call = (): unknown => fanoutQuery(scope, { ...FILTERS, engine: ENGINE_FACTS[code] }, OPTIONS);
      expect(call).toThrow(EngineNotExposedError);
      expect(call).toThrow(code);
    }
  });

  it('has the limits of the route', () => {
    expect(DEFAULT_MIN_SUPPORT).toBe(2);
    expect(MIN_SUPPORT_RANGE).toEqual({ min: 1, max: 1000 });
    expect(PAGE_MAX).toBe(200);
    expect(PREVIOUS_LIMIT).toBe(PAGE_MAX);
  });
});

describe('projectEnginesQuery', () => {
  it('is the engines of the project, under the project and not under ai', () => {
    const query = projectEnginesQuery(scope);
    expect(query.queryKey).toEqual(['ws', 'w-1', 'p', 'p-1', 'engines', {}]);
  });
});
