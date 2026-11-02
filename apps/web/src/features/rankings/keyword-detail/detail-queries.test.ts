import { describe, expect, it } from 'vitest';

import { aioHistoryQuery, chartCompetitors, MAX_HISTORY_COMPETITORS, pageRankHistoryQuery } from './detail-queries';
import { rankHistoryQuery, type KeywordScope } from '../keyword-inspector/inspector-queries';
import type { ProjectEntity } from '@/lib/api/types';

const idOf = (n: number): string => `0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d${String(n).padStart(2, '0')}`;

function entity(n: number, name: string, role: ProjectEntity['role'] = 'competitor'): ProjectEntity {
  return {
    added_at: '2026-01-01T00:00:00Z',
    alias_count: 0,
    color_index: null,
    domains: [],
    entity: { entity_id: idOf(n), canonical_name: name, entity_type: 'organization', role, color_index: null },
    is_primary: false,
    project_id: idOf(99),
    removed_at: null,
    role,
    track_ai: false,
    track_seo: true,
  };
}

const scope: KeywordScope = { workspaceId: idOf(90), projectId: idOf(91), trackedKeywordId: idOf(92) };

describe('chartCompetitors', () => {
  it('lists the effective competitors by name and asks for all of them', () => {
    const result = chartCompetitors([entity(1, 'Zeta'), entity(2, 'Alpha'), entity(3, 'Me', 'own')], []);
    expect(result.all.map((e) => e.entity.canonical_name)).toEqual(['Alpha', 'Zeta']);
    expect(result.asked).toEqual([idOf(2), idOf(1)]);
  });

  it('applies the keyword overrides: an excluded competitor is gone, an included watched entity is in', () => {
    const entities = [entity(1, 'Alpha'), entity(2, 'Beta'), entity(3, 'Gamma', 'watch')];
    const [alpha, , gamma] = entities;
    if (alpha === undefined || gamma === undefined) throw new Error('fixture');
    const result = chartCompetitors(entities, [
      { entity: alpha.entity, mode: 'exclude' },
      { entity: gamma.entity, mode: 'include' },
    ]);
    expect(result.all.map((e) => e.entity.canonical_name)).toEqual(['Beta', 'Gamma']);
  });

  it('asks for the first ten by name and keeps the rest in the offer', () => {
    const entities = Array.from({ length: 12 }, (_, n) => entity(n + 1, `Rival ${String.fromCharCode(65 + n)}`));
    const result = chartCompetitors(entities, []);
    expect(MAX_HISTORY_COMPETITORS).toBe(10);
    expect(result.all).toHaveLength(12);
    expect(result.asked).toHaveLength(10);
    expect(result.asked.at(-1)).toBe(idOf(10));
  });

  it('is empty for a project with no competitors', () => {
    expect(chartCompetitors([entity(3, 'Me', 'own')], [])).toEqual({ all: [], asked: [] });
  });
});

describe('the history queries', () => {
  it('asks for the window, the own site and the competitors, with the absolute rank and the events', () => {
    const query = pageRankHistoryQuery(scope, '30d', [idOf(1), idOf(2)]);
    expect(query.queryKey.at(-1)).toEqual({
      window: 'last_30d',
      entity_ids: ['own', idOf(1), idOf(2)],
      include: ['absolute', 'events'],
    });
  });

  it('asks for the own site alone when the keyword has no competitor', () => {
    expect(pageRankHistoryQuery(scope, '7d', []).queryKey.at(-1)).toEqual({
      window: 'last_7d',
      entity_ids: ['own'],
      include: ['absolute', 'events'],
    });
  });

  it('keeps the inspector request as it was: the last 90 days and nothing else', () => {
    expect(rankHistoryQuery(scope).queryKey.at(-1)).toEqual({ window: 'last_90d' });
  });
});

describe('aioHistoryQuery', () => {
  it('asks for the days of the window, both included, under the keyword', () => {
    const query = aioHistoryQuery(scope, { from: '2026-08-05', to: '2026-11-02' });
    expect(query.queryKey.at(-1)).toEqual({ from: '2026-08-05', to: '2026-11-02' });
    expect(query.queryKey).toContain('aio-history');
    expect(query.queryKey).toContain(scope.trackedKeywordId);
  });

  it('is another request for another window, so that a new window never shows the old answer', () => {
    const a = aioHistoryQuery(scope, { from: '2026-10-27', to: '2026-11-02' }).queryKey;
    const b = aioHistoryQuery(scope, { from: '2026-08-05', to: '2026-11-02' }).queryKey;
    expect(a).not.toEqual(b);
  });
});
