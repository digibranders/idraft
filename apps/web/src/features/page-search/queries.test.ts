import { describe, expect, it } from 'vitest';

import {
  breakdownQuery,
  pageSearchKeys,
  pageSearchQuery,
  suggestionsQuery,
  trackedIdsQuery,
  trackedPagesQuery,
} from './queries';

const scope = { workspaceId: 'w1', projectId: 'p1' };
const october = { from: '2026-10-01', to: '2026-10-31', compare: 'previous_period' } as const;

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]): boolean =>
  prefix.every((part, index) => JSON.stringify(key[index]) === JSON.stringify(part));

describe('page search reads', () => {
  it('keys every read by the project, so one invalidation reaches them all', () => {
    for (const options of [
      trackedPagesQuery(scope, october),
      trackedIdsQuery(scope),
      suggestionsQuery(scope),
      pageSearchQuery(scope, '812', october),
      breakdownQuery(scope, '812', 'country', october),
    ]) {
      expect(JSON.stringify(options.queryKey)).toContain('p1');
      expect(pageSearchKeys(scope).some((prefix) => startsWith(options.queryKey, prefix))).toBe(true);
    }
  });

  it('gives each period, page and dimension its own entry', () => {
    const other = { ...october, compare: 'none' } as const;
    expect(trackedPagesQuery(scope, october).queryKey).not.toEqual(trackedPagesQuery(scope, other).queryKey);
    expect(pageSearchQuery(scope, '812', october).queryKey).not.toEqual(
      pageSearchQuery(scope, '813', october).queryKey,
    );
    expect(breakdownQuery(scope, '812', 'country', october).queryKey).not.toEqual(
      breakdownQuery(scope, '812', 'device', october).queryKey,
    );
  });

  it('keeps a detail with numbers fresh for five minutes, and one without them not at all', () => {
    const options = pageSearchQuery(scope, '812', october);
    const numbers = { clicks: 10, impressions: 200, ctr: 0.05, position: 4.2 };
    const detail = {
      url_id: '812',
      url: 'https://example.com/a',
      path: '/a',
      title: null,
      tier_id: null,
      tracked: true,
      current: numbers,
      previous: null,
      health: null,
      series: [],
      previous_series: [],
    };
    const meta = {
      state: 'ok' as const,
      property: 'sc-domain:example.com',
      final_through: '2026-11-23',
      window: { from: '2026-10-01', to: '2026-10-31', days: 31 },
      compare_window: null,
      history_from: '2025-07-25',
      retry_after: null,
    };
    expect(options.staleTime({ state: { data: undefined } })).toBe(0);
    expect(options.staleTime({ state: { data: { data: detail, meta } } })).toBe(300_000);
    // Google was busy: the answer has no numbers and says when to ask again
    const busy = { data: { ...detail, current: null }, meta: { ...meta, history_from: null, retry_after: 20 } };
    expect(options.staleTime({ state: { data: busy } })).toBe(0);
  });

  it('keeps a breakdown with rows fresh for five minutes, and an empty one not at all', () => {
    const options = breakdownQuery(scope, '812', 'device', october);
    const meta = {
      state: 'ok' as const,
      property: 'sc-domain:example.com',
      final_through: '2026-11-23',
      window: { from: '2026-10-01', to: '2026-10-31', days: 31 },
      compare_window: null,
      dimension: 'device' as const,
      row_limit: 25,
      truncated: false,
      coverage: null,
      fetched_at: '2026-11-26T12:00:00Z',
    };
    const row = { key: 'MOBILE', current: { clicks: 1, impressions: 9, ctr: 0.1111, position: 3 }, previous: null };
    expect(options.staleTime({ state: { data: undefined } })).toBe(0);
    expect(options.staleTime({ state: { data: { data: [], meta } } })).toBe(0);
    expect(options.staleTime({ state: { data: { data: [row], meta } } })).toBe(300_000);
  });

  it('leaves out the dates when the period is the last full month', () => {
    const options = trackedPagesQuery(scope, { compare: 'none' });
    expect(JSON.stringify(options.queryKey)).not.toContain('from');
  });
});
