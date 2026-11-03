import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RankCellView } from './rank-cells';
import type { RankCell, TrackedKeywordState } from '@/lib/api/types';
import { rankDisplay, rowChangeDisplay } from '@/lib/format';
import { renderWithProviders } from '@/test/render';

/**
 * What the dashboard shows for the states the API returned for the Fynix keywords on 2026-11-03, read from
 * DataForSEO's standard queue (backend: `test_tracked_keyword_ranks.py`, the standard queue acceptance tests).
 * These are fixture states, not a live call: the values are those the backend test asserts on the API output.
 */

const URL_REF = {
  url_id: '11',
  canonical_url: 'https://www.fynix.digital/',
  host: 'www.fynix.digital',
  path: '/',
  registrable_domain: 'fynix.digital',
};

const cell = (over: Partial<RankCell>): RankCell => ({
  state: 'ranked',
  rank: 1,
  absolute_rank: 1,
  depth_requested: 100,
  depth_returned: 96,
  url: URL_REF,
  observed_at: '2026-11-03T11:54:47Z',
  serp_snapshot_id: '1',
  ...over,
});

const state = (current: RankCell, over: Partial<TrackedKeywordState> = {}): TrackedKeywordState => ({
  current,
  change: { label: 'first_check', value: null, previous_rank: null, previous_observed_at: null },
  best_rank: current.rank,
  best_rank_at: null,
  worst_rank: current.rank,
  first_ranked_at: null,
  feature_types_present: [],
  owned_feature_types: [],
  aio: { state: 'present_cited', citation_position: 2, observation_id: null },
  target_url_match: null,
  url_changed_at: null,
  consecutive_failures: 0,
  is_stale: false,
  last_observed_at: current.observed_at,
  ranking_url_count: 1,
  drop_unconfirmed: false,
  check: { status: 'completed' },
  ...over,
});

const show = (s: TrackedKeywordState): void => {
  renderWithProviders(
    <RankCellView
      display={rankDisplay(s.current, s.is_stale, s.consecutive_failures, {
        dropUnconfirmed: s.drop_unconfirmed,
        check: s.check,
      })}
      change={rowChangeDisplay(s.current, s.change)}
    />,
  );
};

describe('the Fynix keywords as the dashboard shows them', () => {
  it('shows fynix digital at 1 when the standard queue found the site at 1', () => {
    show(state(cell({})));
    expect(screen.getByText('1')).toHaveClass('num', 'text-foreground');
    expect(screen.queryByText(/not yet confirmed/)).toBeNull();
  });

  it('shows the later reading as beyond what Google returned, with the drop marked unconfirmed, not as >100', () => {
    show(
      state(cell({ state: 'beyond_depth', rank: null, absolute_rank: null, depth_returned: 99, url: null }), {
        drop_unconfirmed: true,
        change: { label: 'lost', value: null, previous_rank: 1, previous_observed_at: '2026-11-03T11:54:47Z' },
      }),
    );
    expect(screen.getByText('>99')).toBeInTheDocument();
    expect(screen.queryByText('>100')).toBeNull();
    expect(screen.getByText('drop not yet confirmed')).toHaveClass('sr-only');
    expect(screen.getByText('Lost')).toBeInTheDocument();
  });

  it('shows fynix at the provider rank of 21, as the API sends it', () => {
    show(state(cell({ rank: 21, absolute_rank: 26, depth_returned: 71, observed_at: '2026-11-03T11:50:51Z' })));
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.queryByText('19')).toBeNull();
  });

  it('shows a keyword whose check is queued with its last rank and a mark that a check is on its way', () => {
    show(state(cell({ rank: 19 }), { check: { status: 'queued' } }));
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('check in progress')).toHaveClass('sr-only');
  });
});
