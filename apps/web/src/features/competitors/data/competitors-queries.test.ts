import { describe, expect, it } from 'vitest';

import {
  competitorsQuery,
  enginesQuery,
  lostPromptsQuery,
  keywordRanksQuery,
  seriesQuery,
  type ProjectRef,
  type ReadScope,
} from './competitors-queries';
import { projectEntitiesQuery } from '@/lib/entities/project-entities';

const PROJECT: ProjectRef = { workspaceId: 'w1', projectId: 'p1' };
const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const ALL = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

const scopeOf = (over: Partial<ReadScope> = {}): ReadScope => ({
  range: { from: '2026-10-17', to: '2026-11-13' },
  engineScope: [...ALL],
  enabledEngines: [...ALL],
  country: null,
  topic: null,
  branded: 'excluded',
  compare: true,
  ...over,
});

/** The normalized query a key ends with, which is also what is sent. */
function sent(options: { queryKey: readonly unknown[] }): Record<string, unknown> {
  return options.queryKey.at(-1) as Record<string, unknown>;
}
const AI_PREFIX = ['ws', 'w1', 'p', 'p1', 'ai'];

describe('the request shapes of the Competitors page', () => {
  it('competitors: the window, branded, and the compare window while cmp is on, with no include and no entity ids', () => {
    const options = competitorsQuery(PROJECT, scopeOf());
    expect(sent(options)).toEqual({
      from: '2026-10-17',
      to: '2026-11-13',
      include_branded: false,
      compare: 'previous_period',
    });
    expect(options.queryKey.slice(0, 6)).toEqual([...AI_PREFIX, 'competitors']);
  });

  it('competitors: every filter of the scope is sent under the parameter name of the route', () => {
    const query = sent(
      competitorsQuery(PROJECT, scopeOf({ engineScope: ['gemini_web'], country: 'DE', topic: TOPIC, branded: 'only' })),
    );
    expect(query).toMatchObject({
      'filter[engine_code_in]': ['gemini_web'],
      'filter[country_iso]': 'DE',
      'filter[term]': TOPIC,
      include_branded: true,
      branded_only: true,
    });
    expect(sent(competitorsQuery(PROJECT, scopeOf({ branded: 'included' })))).toMatchObject({ include_branded: true });
    expect(sent(competitorsQuery(PROJECT, scopeOf({ branded: 'included' })))).not.toHaveProperty('branded_only');
  });

  it('the engine list is omitted when every engine that is on is in scope, in any order', () => {
    expect(sent(competitorsQuery(PROJECT, scopeOf()))).not.toHaveProperty('filter[engine_code_in]');
    const two = ['gemini_web', 'chatgpt_web'] as const;
    expect(sent(competitorsQuery(PROJECT, scopeOf({ engineScope: two, enabledEngines: two })))).not.toHaveProperty(
      'filter[engine_code_in]',
    );
    expect(sent(competitorsQuery(PROJECT, scopeOf({ engineScope: ['chatgpt_web'] })))).toHaveProperty(
      'filter[engine_code_in]',
      ['chatgpt_web'],
    );
  });

  it('compare is sent only when cmp is on, and never to lost or series', () => {
    expect(sent(competitorsQuery(PROJECT, scopeOf({ compare: false })))).not.toHaveProperty('compare');
    const compared = scopeOf({ compare: true });
    for (const options of [
      lostPromptsQuery(PROJECT, compared, 'chatgpt_web'),
      seriesQuery(PROJECT, compared, 'ai.share_of_voice', ['e1']),
      seriesQuery(PROJECT, compared, 'ai.mention_rate', ['e1']),
    ]) {
      expect(sent(options)).not.toHaveProperty('compare');
    }
  });

  it('lostPrompts: the one engine, always, include lost_prompts and lost_limit 10', () => {
    const options = lostPromptsQuery(PROJECT, scopeOf(), 'gemini_web');
    expect(sent(options)).toMatchObject({
      'filter[engine_code_in]': ['gemini_web'],
      include: ['lost_prompts'],
      lost_limit: 10,
    });
    expect(options.queryKey.slice(0, 6)).toEqual([...AI_PREFIX, 'competitors']);
    // Even when it is the only engine on
    expect(
      sent(
        lostPromptsQuery(
          PROJECT,
          scopeOf({ engineScope: ['gemini_web'], enabledEngines: ['gemini_web'] }),
          'gemini_web',
        ),
      ),
    ).toHaveProperty('filter[engine_code_in]', ['gemini_web']);
  });

  it('series: share of voice with the engines in scope and the entity ids, sorted and at most 20', () => {
    const ids = Array.from({ length: 25 }, (_, index) => `e${String(100 - index)}`);
    const options = seriesQuery(
      PROJECT,
      scopeOf({ engineScope: ['chatgpt_web', 'gemini_web'] }),
      'ai.share_of_voice',
      ids,
    );
    const asked = sent(options).entity_ids as string[];
    expect(asked).toHaveLength(20);
    expect([...asked]).toEqual([...asked].sort());
    expect(sent(options)['filter[engine_code_in]']).toEqual(['chatgpt_web', 'gemini_web']);
    expect(options.queryKey.slice(0, 8)).toEqual([...AI_PREFIX, 'metrics', 'ai.share_of_voice', 'series']);
    expect(sent(seriesQuery(PROJECT, scopeOf(), 'ai.share_of_voice', ['b', 'a', 'c'])).entity_ids).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('series: mention rate has its own metric path', () => {
    const options = seriesQuery(PROJECT, scopeOf(), 'ai.mention_rate', ['e1']);
    expect(options.queryKey.slice(0, 8)).toEqual([...AI_PREFIX, 'metrics', 'ai.mention_rate', 'series']);
  });

  it('keywordRanks: active tracked keywords with the competitors ranks, one page of 100', () => {
    expect(sent(keywordRanksQuery(PROJECT))).toMatchObject({
      include: ['competitor_ranks'],
      'filter[is_active]': true,
      limit: 100,
    });
  });

  it('engines and entities are the requests the other pages make, so the cache entry is shared', () => {
    expect(enginesQuery(PROJECT).queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'engines', {}]);
    expect(projectEntitiesQuery(PROJECT).queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'entities', {}]);
  });

  it('every analytic read sits under the ai prefix of the project, so a refresh of the project reaches it', () => {
    for (const options of [
      competitorsQuery(PROJECT, scopeOf()),
      lostPromptsQuery(PROJECT, scopeOf(), 'chatgpt_web'),
      seriesQuery(PROJECT, scopeOf(), 'ai.share_of_voice', ['e1']),
    ]) {
      expect(options.queryKey.slice(0, 5)).toEqual(AI_PREFIX);
    }
  });

  it('two equal scopes share one key, whatever the order of the engines', () => {
    const first = competitorsQuery(PROJECT, scopeOf({ engineScope: ['gemini_web', 'chatgpt_web'] }));
    const second = competitorsQuery(PROJECT, scopeOf({ engineScope: ['chatgpt_web', 'gemini_web'] }));
    expect(first.queryKey).toEqual(second.queryKey);
  });
});
