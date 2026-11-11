import { describe, expect, it } from 'vitest';

import type { DetailState } from './detail-state';
import { aioCounts, stripCells, type StripInput } from './strip-model';
import type { AioHistoryItem, HistoryPoint, RankCell, RankHistory, TrackedKeywordState } from '@/lib/api/types';

const NOW = '2026-11-02T02:00:00.000Z';
const LAST_GOOD = '2026-10-30T02:00:00.000Z';

interface Stats {
  ranked: number;
  checks: number;
  topTenDays: number;
  daysChecked: number;
}

interface Spec {
  kind: DetailState['kind'];
  failing?: boolean;
  rank?: number | null;
  depth?: number;
  lastGood?: string;
  best?: number | null;
  average?: number | null;
  /** The own series of the history: one check a day. `undefined` is a history that is not there. */
  stats?: Stats | null | undefined;
  /** The own series as given, for a window the one check a day of `stats` cannot describe. */
  points?: readonly HistoryPoint[];
  aio?: readonly AioHistoryItem[] | undefined;
}

const cellOf = (spec: Spec): RankCell => {
  if (spec.kind === 'pending') {
    return {
      state: 'not_checked',
      rank: null,
      depth_requested: null,
      observed_at: null,
      absolute_rank: null,
      serp_snapshot_id: null,
      url: null,
    };
  }
  if (spec.kind === 'failed') {
    return {
      state: 'failed',
      rank: null,
      depth_requested: null,
      observed_at: null,
      absolute_rank: null,
      serp_snapshot_id: null,
      url: null,
    };
  }
  const rank = spec.rank ?? null;
  return {
    state: rank === null ? 'beyond_depth' : 'ranked',
    rank,
    depth_requested: spec.depth ?? 20,
    observed_at: spec.lastGood ?? NOW,
    absolute_rank: rank,
    serp_snapshot_id: null,
    url: null,
  };
};

const trackedOf = (spec: Spec): TrackedKeywordState => ({
  aio: { state: 'present_cited', citation_position: 2, observation_id: null },
  best_rank: spec.best ?? null,
  best_rank_at: spec.best === undefined || spec.best === null ? null : '2026-09-12T02:00:00.000Z',
  change: { label: 'numeric', value: 3, previous_rank: 15, previous_observed_at: null },
  consecutive_failures: spec.failing === true ? 2 : 0,
  current: cellOf(spec),
  feature_types_present: [],
  first_ranked_at: null,
  is_stale: spec.kind === 'stale',
  last_observed_at: spec.lastGood ?? null,
  owned_feature_types: [],
  ranking_url_count: 1,
  drop_unconfirmed: false,
  target_url_match: null,
  url_changed_at: null,
  worst_rank: null,
});

const point = (day: number, state: HistoryPoint['state'], rank: number | null): HistoryPoint => {
  const date = `2026-08-${String(day).padStart(2, '0')}`;
  return {
    date,
    observed_at: `${date}T02:00:00Z`,
    state,
    rank,
    depth_requested: 20,
    url_id: null,
    serp_snapshot_id: null,
    absolute_rank: rank,
  };
};

/** One check a day: `topTenDays` at rank 4, the rest of `ranked` at 15, the rest of `checks` beyond depth. */
function historyOf(stats: Stats, average: number | null): RankHistory {
  const points = Array.from({ length: stats.checks }, (_, index) => {
    const day = index + 1;
    if (index < stats.topTenDays) return point(day, 'ranked', 4);
    if (index < stats.ranked) return point(day, 'ranked', 15);
    return point(day, 'beyond_depth', null);
  });
  return {
    tracked_keyword_id: 'kw-1',
    bands: [],
    columns: null,
    config_history: [],
    deep_check_weekday: 1,
    events: null,
    series: [
      {
        entity: {
          entity_id: 'own',
          canonical_name: 'Fynix',
          entity_type: 'organization',
          role: 'own',
          color_index: null,
        },
        points,
      },
    ],
    summary: {
      checks: stats.checks,
      ranked_checks: stats.ranked,
      beyond_depth_checks: stats.checks - stats.ranked,
      failed_checks: 0,
      average_rank:
        average === null
          ? null
          : {
              value: average,
              unit: 'rank',
              metric: 'average_rank',
              method: 'mean',
              method_version: 1,
              is_estimate: false,
              n_observations: stats.ranked,
              numerator: null,
              denominator: null,
              filters: {},
              window: { from: '2026-08-01', to: '2026-11-02', timezone: 'Europe/Berlin' },
            },
    },
    urls: {},
    version_boundaries: [],
    window: { from: '2026-08-01', to: '2026-11-02', timezone: 'Europe/Berlin' },
  };
}

const NINETY: Stats = { ranked: 88, checks: 90, topTenDays: 61, daysChecked: 90 };

function input(spec: Spec): StripInput {
  const stats = spec.stats === undefined ? NINETY : spec.stats;
  const base = stats === null ? undefined : historyOf(stats, spec.average === undefined ? 4.6 : spec.average);
  const [series] = base?.series ?? [];
  const history =
    base === undefined || series === undefined || spec.points === undefined
      ? base
      : { ...base, series: [{ ...series, points: [...spec.points] }] };
  return {
    state: { kind: spec.kind, failing: spec.failing ?? false },
    tracked: trackedOf(spec),
    history,
    aio: spec.aio,
  };
}

const aio = (state: AioHistoryItem['ai_overview_state']): AioHistoryItem => ({
  ai_overview_state: state,
  competitors_cited: [],
  device: 'desktop',
  location_id: 2276,
  observation_id: null,
  observed_at: NOW,
  organic_rank: cellOf({ kind: 'live', rank: 3 }),
  own_citation_position: null,
  own_cited: null,
  serp_snapshot_id: 'snap-1',
  source_count: 0,
});

describe('stripCells', () => {
  it('reads the rank cell by the keyword state, not by the raw flags', () => {
    expect(stripCells(input({ kind: 'pending' })).rank).toEqual({ kind: 'pending' });
    expect(stripCells(input({ kind: 'failed' })).rank).toEqual({ kind: 'failed' });
    expect(stripCells(input({ kind: 'stale', rank: 12, lastGood: LAST_GOOD })).rank).toMatchObject({
      kind: 'value',
      rank: 12,
      stale: true,
      observedAt: LAST_GOOD,
    });
    expect(stripCells(input({ kind: 'live', rank: 3 })).rank).toMatchObject({
      kind: 'value',
      rank: 3,
      stale: false,
      failing: false,
    });
    expect(stripCells(input({ kind: 'live', rank: null, depth: 20 })).rank).toMatchObject({
      kind: 'beyond',
      depth: 20,
      stale: false,
    });
  });

  it('carries the change of the rank and whether later checks failed', () => {
    expect(stripCells(input({ kind: 'live', rank: 12, failing: true })).rank).toMatchObject({
      kind: 'value',
      failing: true,
      change: { kind: 'arrow', direction: 'up', amount: 3 },
    });
  });

  it('shows a pending keyword as pending even when the cell carries a stale rank', () => {
    const pending = input({ kind: 'pending' });
    const contradicting: StripInput = { ...pending, tracked: trackedOf({ kind: 'live', rank: 5 }) };
    expect(stripCells(contradicting).rank).toEqual({ kind: 'pending' });
  });

  it('takes the average from the API and the days in the top 10 from the series, each with its denominator', () => {
    const cells = stripCells(input({ kind: 'live', rank: 4, average: 4.6, stats: NINETY }));
    expect(cells.average).toEqual({ kind: 'value', value: 4.6, ranked: 88, checks: 90 });
    expect(cells.topTen).toEqual({ kind: 'value', days: 61, of: 90 });
  });

  it('counts days, not checks: two checks on one day are one day, and a failed check is no day', () => {
    const cells = stripCells(
      input({
        kind: 'live',
        rank: 4,
        points: [
          point(1, 'ranked', 4),
          point(1, 'ranked', 6),
          point(2, 'ranked', 14),
          point(3, 'failed', null),
          point(4, 'beyond_depth', null),
        ],
      }),
    );
    expect(cells.topTen).toEqual({ kind: 'value', days: 1, of: 3 });
    expect(cells.average).toMatchObject({ kind: 'value', ranked: 3, checks: 4 });
  });

  it('has no average, and says so, when nothing ranked in the window', () => {
    const cells = stripCells(
      input({
        kind: 'live',
        rank: null,
        depth: 20,
        average: null,
        stats: { ranked: 0, checks: 90, topTenDays: 0, daysChecked: 90 },
      }),
    );
    expect(cells.average).toEqual({ kind: 'none', checks: 90 });
    expect(cells.topTen).toEqual({ kind: 'value', days: 0, of: 90 });
  });

  it('is unavailable, never zero, when the history is not there or holds no check', () => {
    const missing = stripCells(input({ kind: 'live', rank: 4, stats: null }));
    expect(missing.average).toEqual({ kind: 'unavailable' });
    expect(missing.topTen).toEqual({ kind: 'unavailable' });
    const empty = stripCells(
      input({ kind: 'live', rank: 4, average: null, stats: { ranked: 0, checks: 0, topTenDays: 0, daysChecked: 0 } }),
    );
    expect(empty.average).toEqual({ kind: 'unavailable' });
    expect(empty.topTen).toEqual({ kind: 'unavailable' });
  });

  it('is unavailable for a keyword with no good check, whatever the history says', () => {
    for (const kind of ['pending', 'failed'] as const) {
      const cells = stripCells(input({ kind, stats: NINETY }));
      expect(cells.best).toEqual({ kind: 'unavailable' });
      expect(cells.average).toEqual({ kind: 'unavailable' });
      expect(cells.topTen).toEqual({ kind: 'unavailable' });
    }
  });

  it('takes the best rank from the keyword with its date, all time, and says never ranked when it has none', () => {
    expect(stripCells(input({ kind: 'live', rank: 4, best: 2 })).best).toEqual({
      kind: 'value',
      rank: 2,
      at: '2026-09-12T02:00:00.000Z',
    });
    expect(stripCells(input({ kind: 'live', rank: null, best: null })).best).toEqual({ kind: 'none' });
  });

  it('keeps the AI Overview of the keyword and counts the checks that could be read', () => {
    const cells = stripCells(input({ kind: 'live', rank: 3, aio: [aio('present_cited'), aio('absent')] }));
    expect(cells.aio).toEqual({ display: { kind: 'cited', position: 2 }, counts: { present: 1, of: 2 } });
    expect(stripCells(input({ kind: 'live', rank: 3, aio: undefined })).aio.counts).toBeNull();
    expect(stripCells(input({ kind: 'pending' })).aio.display).toEqual({ kind: 'pending' });
    expect(stripCells(input({ kind: 'failed' })).aio.display).toEqual({ kind: 'unknown' });
  });
});

describe('aioCounts', () => {
  it('counts the AI Overview checks that could be read, not those that could not', () => {
    const items = [aio('present_cited'), aio('present_not_cited'), aio('absent'), aio('not_loaded'), aio('unknown')];
    expect(aioCounts(items)).toEqual({ present: 2, of: 3 });
  });

  it('is zero of zero without a check', () => {
    expect(aioCounts([])).toEqual({ present: 0, of: 0 });
  });

  it('counts a cited and a not cited overview alike as present', () => {
    expect(aioCounts([aio('present_not_cited'), aio('present_not_cited')])).toEqual({ present: 2, of: 2 });
  });
});
