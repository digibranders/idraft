import { describe, expect, it } from 'vitest';

import { rankHistoryChart } from './rank-history-model';
import type { RankHistory } from '@/lib/api/types';

const fixture = (overrides: Partial<RankHistory> = {}): RankHistory => ({
  tracked_keyword_id: 'kw-1',
  bands: [],
  columns: null,
  config_history: [],
  deep_check_weekday: 1,
  events: null,
  series: [
    {
      entity: {
        entity_id: 'own-1',
        canonical_name: 'Fynix',
        entity_type: 'organization',
        role: 'own',
        color_index: null,
      },
      points: [
        {
          date: '2026-10-01',
          rank: 4,
          depth_requested: 20,
          state: 'ranked',
          observed_at: '2026-10-01T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: 4,
        },
        {
          date: '2026-10-02',
          rank: null,
          depth_requested: 20,
          state: 'beyond_depth',
          observed_at: '2026-10-02T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: null,
        },
      ],
    },
    {
      entity: {
        entity_id: 'comp-1',
        canonical_name: 'Acme',
        entity_type: 'organization',
        role: 'competitor',
        color_index: 3,
      },
      points: [
        {
          date: '2026-10-02',
          rank: 8,
          depth_requested: 20,
          state: 'ranked',
          observed_at: '2026-10-02T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: 8,
        },
        {
          date: '2026-10-03',
          rank: 7,
          depth_requested: 20,
          state: 'ranked',
          observed_at: '2026-10-03T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: 7,
        },
      ],
    },
    {
      entity: {
        entity_id: 'comp-2',
        canonical_name: 'Beta',
        entity_type: 'organization',
        role: 'competitor',
        color_index: null,
      },
      points: [
        {
          date: '2026-10-01',
          rank: null,
          depth_requested: 20,
          state: 'failed',
          observed_at: '2026-10-01T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: null,
        },
      ],
    },
  ],
  summary: {
    checks: 2,
    ranked_checks: 1,
    beyond_depth_checks: 1,
    failed_checks: 0,
    average_rank: null,
  },
  urls: {},
  version_boundaries: [],
  window: {
    from: '2026-10-01',
    to: '2026-10-03',
    timezone: 'Europe/Berlin',
  },
  ...overrides,
});

describe('rankHistoryChart', () => {
  it('gives categories as the sorted union of series dates, with own series first and competitors colored', () => {
    const model = rankHistoryChart(fixture(), { ownName: (name) => `${name} (you)` });
    expect(model.categories).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);

    expect(model.series).toHaveLength(3);
    const [own, comp1, comp2] = model.series;
    expect(own).toEqual({
      id: 'own-1',
      name: 'Fynix (you)',
      role: { kind: 'brand' },
      values: [4, null, null],
    });
    // comp1 has color_index 3
    expect(comp1).toEqual({
      id: 'comp-1',
      name: 'Acme',
      role: { kind: 'palette', index: 3 },
      values: [null, 8, 7],
    });
    // comp2 has no color_index, gets index 3 by order (second competitor)
    expect(comp2?.role).toEqual({ kind: 'palette', index: 3 });
    expect(comp2?.values).toEqual([null, null, null]);
  });

  it('sets depthMax to 20 when all depths are at most 20, or the largest depth up to 100', () => {
    const standard = rankHistoryChart(fixture(), { ownName: (name) => `${name} (you)` });
    expect(standard.depthMax).toBe(20);

    const withDeep = fixture({
      series: [
        {
          entity: {
            entity_id: 'own-1',
            canonical_name: 'Fynix',
            entity_type: 'organization',
            role: 'own',
            color_index: null,
          },
          points: [
            {
              date: '2026-10-01',
              rank: 35,
              depth_requested: 50,
              state: 'ranked',
              observed_at: '2026-10-01T02:00:00Z',
              serp_snapshot_id: null,
              url_id: null,
              absolute_rank: 35,
            },
          ],
        },
      ],
    });
    const deepModel = rankHistoryChart(withDeep, { ownName: (name) => `${name} (you)` });
    expect(deepModel.depthMax).toBe(50);
  });

  it('keeps own entity bands as category indices', () => {
    const withBands = fixture({
      bands: [
        {
          entity_id: 'own-1',
          from: '2026-10-01',
          to: '2026-10-02',
          depth_requested: 20,
          kind: 'beyond_depth',
          label: 'Not in top 20',
        },
        {
          entity_id: 'other-entity',
          from: '2026-10-01',
          to: '2026-10-02',
          depth_requested: 20,
          kind: 'beyond_depth',
          label: 'Not in top 20',
        },
      ],
    });
    const model = rankHistoryChart(withBands, { ownName: (name) => `${name} (you)` });
    expect(model.bands).toEqual([{ from: 0, to: 1, depth: 20 }]);
  });

  it('passes summary counts through and sets empty when checks is 0', () => {
    const model = rankHistoryChart(fixture(), { ownName: (name) => `${name} (you)` });
    expect(model.summary).toEqual({ checks: 2, ranked: 1, beyond: 1, failed: 0 });
    expect(model.empty).toBe(false);

    const empty = rankHistoryChart(
      fixture({
        series: [],
        summary: { checks: 0, ranked_checks: 0, beyond_depth_checks: 0, failed_checks: 0, average_rank: null },
      }),
      { ownName: (name) => `${name} (you)` },
    );
    expect(empty.empty).toBe(true);
    expect(empty.summary.checks).toBe(0);
  });
});
