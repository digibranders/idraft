import { describe, expect, it } from 'vitest';

import { changesBadge, opportunitiesBadge } from './tab-badges';
import type { ChangesSummary } from './types';

const summary = (over: Partial<ChangesSummary>): ChangesSummary => ({
  alert: { channel: 'app', delivery_state: 'shown_in_app', lost_links: 6, max_position: 2, threshold: 1 },
  all_added: 0,
  all_lost: 0,
  editorial_added: 0,
  editorial_lost: 0,
  important_max_position: 2,
  lost_to_top: 6,
  pages_added: 0,
  pages_lost: 0,
  previous_finished_at: null,
  previous_run_id: null,
  run_id: '00000000-0000-4000-8000-000000000001',
  state: 'ready',
  ...over,
});

describe('changesBadge', () => {
  it('counts the links of the open alert when the changes are worked out', () => {
    expect(changesBadge(summary({}))).toBe(6);
  });

  it('shows nothing without an alert, with no lost links, before the changes are ready or without a read', () => {
    expect(changesBadge(summary({ alert: null }))).toBeNull();
    expect(
      changesBadge(
        summary({
          alert: { channel: 'app', delivery_state: 'shown_in_app', lost_links: 0, max_position: 2, threshold: 1 },
        }),
      ),
    ).toBeNull();
    for (const state of ['pending', 'first_crawl', 'unavailable'] as const) {
      expect(changesBadge(summary({ state }))).toBeNull();
    }
    expect(changesBadge(undefined)).toBeNull();
  });
});

describe('opportunitiesBadge', () => {
  it('counts the open ones', () => {
    expect(opportunitiesBadge(12)).toBe(12);
    expect(opportunitiesBadge(0)).toBeNull();
    expect(opportunitiesBadge(undefined)).toBeNull();
  });
});
