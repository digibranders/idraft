import { describe, expect, it } from 'vitest';

import { neighbour, normaliseObs, snapshotOptions } from './snapshot-options';
import type { RankCell, SerpSnapshotSummary } from '@/lib/api/types';

function cell(state: RankCell['state'], rank: number | null, path: string | null): RankCell {
  return {
    state,
    rank,
    absolute_rank: rank,
    depth_requested: 20,
    observed_at: '2026-10-29T02:00:00.000Z',
    serp_snapshot_id: null,
    url:
      path === null
        ? null
        : {
            url_id: path,
            canonical_url: `https://fynix.digital${path}`,
            host: 'fynix.digital',
            path,
            registrable_domain: 'fynix.digital',
          },
  };
}

function snap(id: string, state: RankCell['state'], rank: number | null, path: string | null): SerpSnapshotSummary {
  return {
    serp_snapshot_id: id,
    observed_at: `2026-10-${id.padStart(2, '0')}T02:00:00.000Z`,
    observed_date: `2026-10-${id.padStart(2, '0')}`,
    config_version: 1,
    provider_code: 'serpapi',
    provider_endpoint: 'google',
    se_domain: 'google.com',
    location_id: 2276,
    language_code: 'en',
    device: 'desktop',
    os: null,
    depth_requested: 20,
    depth_returned: 18,
    se_results_count: 18,
    item_types: ['organic'],
    has_ai_overview: id === '3',
    ai_overview_state: id === '3' ? 'present' : 'absent',
    has_ai_mode_link: null,
    served_from_cache: false,
    cost_usd: '0.002',
    own: cell(state, rank, path),
  };
}

describe('snapshotOptions', () => {
  it('lists snapshots newest first with their depth and the own rank, and flags a ranking URL change from the next older one', () => {
    const options = snapshotOptions([
      snap('3', 'ranked', 4, '/pricing'),
      snap('2', 'ranked', 5, '/blog'),
      snap('1', 'beyond_depth', null, null),
    ]);
    expect(options.map((o) => [o.id, o.urlChanged])).toEqual([
      ['3', true],
      ['2', false],
      ['1', false],
    ]);
  });

  it('does not call it a change when the older snapshot had no ranking URL', () => {
    const options = snapshotOptions([snap('2', 'ranked', 4, '/pricing'), snap('1', 'beyond_depth', null, null)]);
    expect(options.map((o) => o.urlChanged)).toEqual([false, false]);
  });

  it('does not call it a change when the newer snapshot has no ranking URL', () => {
    const options = snapshotOptions([snap('2', 'beyond_depth', null, null), snap('1', 'ranked', 4, '/pricing')]);
    expect(options.map((o) => o.urlChanged)).toEqual([false, false]);
  });

  it('does not call it a change when the same address ranks twice', () => {
    const options = snapshotOptions([snap('2', 'ranked', 4, '/pricing'), snap('1', 'ranked', 6, '/pricing')]);
    expect(options.map((o) => o.urlChanged)).toEqual([false, false]);
  });

  it('carries what the picker shows of each snapshot', () => {
    const [first] = snapshotOptions([snap('3', 'ranked', 4, '/pricing')]);
    expect(first).toMatchObject({
      id: '3',
      observedAt: '2026-10-03T02:00:00.000Z',
      observedDate: '2026-10-03',
      depth: 20,
      depthReturned: 18,
      hasAio: true,
    });
    expect(first?.own.rank).toBe(4);
  });

  it('is empty for no snapshots', () => {
    expect(snapshotOptions([])).toEqual([]);
  });
});

describe('normaliseObs', () => {
  it('clears obs when the chosen snapshot is the latest check', () => {
    expect(normaliseObs('9', '9')).toBeNull();
    expect(normaliseObs('8', '9')).toBe('8');
    expect(normaliseObs('8', null)).toBe('8');
  });

  it('keeps an empty choice empty', () => {
    expect(normaliseObs(null, '9')).toBeNull();
  });
});

describe('neighbour', () => {
  const ids = ['3', '2', '1'];

  it('steps to the neighbour snapshot and stops at the ends', () => {
    expect(neighbour(ids, '2', 'newer')).toBe('3');
    expect(neighbour(ids, '2', 'older')).toBe('1');
    expect(neighbour(ids, '3', 'newer')).toBeNull();
    expect(neighbour(ids, '1', 'older')).toBeNull();
    expect(neighbour(ids, 'gone', 'older')).toBeNull();
  });

  it('has no neighbour in an empty list', () => {
    expect(neighbour([], '2', 'older')).toBeNull();
  });
});
