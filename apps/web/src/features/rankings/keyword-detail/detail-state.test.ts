import { describe, expect, it } from 'vitest';

import { detailStateOf, statusBadges } from './detail-state';
import type { TrackedKeywordState } from '@/lib/api/types';

interface StateInput {
  current: TrackedKeywordState['current']['state'];
  stale?: boolean;
  failures?: number;
}

/** A complete state with only the parts the model reads set. */
function stateWith({ current, stale = false, failures = 0 }: StateInput): TrackedKeywordState {
  return {
    current: {
      state: current,
      rank: current === 'ranked' ? 4 : null,
      absolute_rank: null,
      depth_requested: current === 'not_checked' ? null : 20,
      observed_at: null,
      serp_snapshot_id: null,
      url: null,
    },
    change: { label: 'first_check', value: null, previous_rank: null, previous_observed_at: null },
    best_rank: null,
    best_rank_at: null,
    worst_rank: null,
    first_ranked_at: null,
    feature_types_present: [],
    owned_feature_types: [],
    aio: { state: 'unknown', citation_position: null, observation_id: null },
    target_url_match: null,
    url_changed_at: null,
    consecutive_failures: failures,
    is_stale: stale,
    last_observed_at: null,
    ranking_url_count: 0,
    drop_unconfirmed: false,
  };
}

describe('detailStateOf', () => {
  it.each([
    ['an archived keyword, whatever its last check was', { current: 'ranked' }, false, 'archived'],
    ['a keyword never checked', { current: 'not_checked' }, true, 'pending'],
    ['a keyword whose checks all failed', { current: 'failed', failures: 3 }, true, 'failed'],
    ['a ranked keyword flagged stale', { current: 'ranked', stale: true }, true, 'stale'],
    ['a keyword beyond the depth that is not stale', { current: 'beyond_depth', stale: false }, true, 'live'],
    ['a ranked keyword', { current: 'ranked' }, true, 'live'],
  ] as const)('reads %s as %s', (_, input, active, kind) => {
    expect(detailStateOf(stateWith(input), active).kind).toBe(kind);
  });

  it('puts archived before pending, failed and stale', () => {
    expect(detailStateOf(stateWith({ current: 'not_checked' }), false).kind).toBe('archived');
    expect(detailStateOf(stateWith({ current: 'failed', failures: 2, stale: true }), false).kind).toBe('archived');
  });

  it('puts failed before stale', () => {
    expect(detailStateOf(stateWith({ current: 'failed', failures: 2, stale: true }), true).kind).toBe('failed');
  });

  it('flags a keyword whose last checks failed while it still has an older good one', () => {
    expect(detailStateOf(stateWith({ current: 'ranked', failures: 2 }), true)).toEqual({ kind: 'live', failing: true });
    expect(detailStateOf(stateWith({ current: 'ranked', failures: 2, stale: true }), true)).toEqual({
      kind: 'stale',
      failing: true,
    });
  });

  it('does not flag a keyword with no failure, and does not repeat a failed keyword as failing', () => {
    expect(detailStateOf(stateWith({ current: 'ranked' }), true).failing).toBe(false);
    expect(detailStateOf(stateWith({ current: 'failed', failures: 3 }), true)).toEqual({
      kind: 'failed',
      failing: false,
    });
  });
});

describe('statusBadges', () => {
  it.each([
    [{ kind: 'archived', failing: false }, ['archived']],
    [{ kind: 'pending', failing: false }, ['pending']],
    [{ kind: 'failed', failing: false }, ['failed']],
    [{ kind: 'stale', failing: false }, ['stale']],
    [{ kind: 'stale', failing: true }, ['stale', 'failing']],
    [{ kind: 'live', failing: true }, ['failing']],
    [{ kind: 'live', failing: false }, []],
  ] as const)('%j shows %j', (state, badges) => {
    expect(statusBadges(state)).toEqual(badges);
  });

  it('shows at most four badges', () => {
    expect(statusBadges({ kind: 'stale', failing: true }).length).toBeLessThanOrEqual(4);
  });
});
