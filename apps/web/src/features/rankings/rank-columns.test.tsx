import { render, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { useCompetitorColumns, useRankColumns } from './rank-columns';
import type { EntityRef, TrackedKeywordRow } from '@/lib/api/types';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {children}
    </NextIntlClientProvider>
  );
}

function makeRow(overrides: Record<string, unknown>): TrackedKeywordRow {
  return {
    tracked_keyword_id: 'tk-1',
    is_active: true,
    state: {
      current: { rank: 3, observed_at: '2026-10-29T10:00:00Z', depth_requested: 20, url: null, state: 'ranked' },
      change: { label: 'numeric', value: 1, previous_rank: 4 },
      best_rank: 3,
      last_observed_at: '2026-10-29T10:00:00Z',
      consecutive_failures: 0,
      is_stale: false,
      ranking_url_count: 1,
      feature_types_present: [],
      owned_feature_types: [],
      aio: { state: 'absent', citation_position: null, observation_id: null },
      target_url_match: null,
    },
    ...overrides,
  } as unknown as TrackedKeywordRow;
}

/** A row whose metrics hold these monthly volumes, oldest first, ending in September 2026. */
function withVolumes(volumes: readonly (number | null)[]): TrackedKeywordRow {
  const monthly_searches = volumes.map((search_volume, index) => {
    const offset = index - (volumes.length - 1);
    const at = new Date(Date.UTC(2026, 8 + offset, 1));
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, search_volume };
  });
  return makeRow({ metrics: { monthly_searches } });
}

describe('useRankColumns trend column', () => {
  it('names the volumes the line shows: first, last and the peak', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const { getByRole } = render(result.current.trend.cell(withVolumes([1300, 2400, 1900])));
    expect(
      getByRole('img', { name: 'Search volume trend, last 3 months: from 1,300 to 1,900, peak 2,400' }),
    ).toBeInTheDocument();
  });

  it('reads the first and the last month that has a volume when the ends have none', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const { getByRole } = render(result.current.trend.cell(withVolumes([null, 500, 700, null])));
    expect(
      getByRole('img', { name: 'Search volume trend, last 4 months: from 500 to 700, peak 700' }),
    ).toBeInTheDocument();
  });

  it('says there are no monthly volumes yet when the keyword has no metrics, or none for any month', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    for (const row of [makeRow({}), makeRow({ metrics: null }), withVolumes([]), withVolumes([null, null])]) {
      const { getByRole, unmount } = render(result.current.trend.cell(row));
      expect(getByRole('img', { name: 'Search volume trend: no monthly volumes yet' })).toBeInTheDocument();
      unmount();
    }
  });

  it('does not depend on the rank checks: a keyword whose check failed still shows its volumes', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const failed = withVolumes([100, 200]);
    const row = {
      ...failed,
      state: { ...failed.state, current: { ...failed.state.current, state: 'failed' as const, rank: null } },
    } as TrackedKeywordRow;
    const { getByRole } = render(result.current.trend.cell(row));
    expect(
      getByRole('img', { name: 'Search volume trend, last 2 months: from 100 to 200, peak 200' }),
    ).toBeInTheDocument();
  });

  it('lists the last six months in the cell tip, a month without a volume as n/a', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const tip = result.current.trend.cellTip?.(withVolumes([1, 2, 3, 4, 5, 1200, null]));
    expect(tip?.content).toBe('Monthly search volume');
    expect(tip?.detail).toBe('Apr 2026: 2, May 2026: 3, Jun 2026: 4, Jul 2026: 5, Aug 2026: 1,200, Sep 2026: n/a');
  });

  it('has no tip where there are no months', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    expect(result.current.trend.cellTip?.(makeRow({}))).toBeUndefined();
  });
});

describe('useCompetitorColumns', () => {
  const competitors: EntityRef[] = [
    {
      entity_id: 'e-zeta',
      canonical_name: 'Zeta Corp',
      color_index: 4,
      entity_type: 'organization',
      role: 'competitor',
    },
    {
      entity_id: 'e-alpha',
      canonical_name: 'Alpha Ltd',
      color_index: 2,
      entity_type: 'organization',
      role: 'competitor',
    },
    {
      entity_id: 'e-beta',
      canonical_name: 'Beta Co',
      color_index: null,
      entity_type: 'organization',
      role: 'competitor',
    },
    {
      entity_id: 'e-gamma',
      canonical_name: 'Gamma Inc',
      color_index: null,
      entity_type: 'organization',
      role: 'competitor',
    },
  ];

  it('sorts competitors by color_index ascending, then canonical_name with null color_index last', () => {
    const { result } = renderHook(() => useCompetitorColumns(competitors), { wrapper });
    const cols = result.current;
    expect(cols.map((col) => col.id)).toEqual([
      'competitor_e-alpha',
      'competitor_e-zeta',
      'competitor_e-beta',
      'competitor_e-gamma',
    ]);
    expect(cols[0]?.header).toBe('Alpha Ltd');
    expect(cols[0]?.defaultVisible).toBe(true);
    expect(cols[1]?.defaultVisible).toBe(false);
    expect(cols[2]?.defaultVisible).toBe(false);
    expect(cols[3]?.defaultVisible).toBe(false);
  });

  it('gives the rank column a cell tip only for a hyphen, which says the checked depth', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const rank = makeRow({});
    expect(result.current.rank.headerTooltip).toBeUndefined();
    expect(result.current.rank.cellTip?.(rank)).toBeUndefined();
    expect(result.current.rank.width).toBe(112);
    const beyond = makeRow({});
    beyond.state.current = { ...beyond.state.current, state: 'beyond_depth', rank: null, depth_requested: 20 };
    expect(result.current.rank.cellTip?.(beyond)?.content).toBe('Not in the top 20');
    expect(result.current.best.headerTooltip).toBeUndefined();
    expect(result.current.trend.headerTooltip).toBeUndefined();
    expect(result.current.best.cellTip?.(rank)).toBeUndefined();
  });

  it('reads the rank of the row it is given, whatever device that row is', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const mobile = makeRow({ device: 'mobile' });
    expect(result.current.rank.header).toBe('Rank');
    expect(result.current.rank.sortValue?.(mobile)).toBe(
      mobile.state.current.state === 'ranked' ? mobile.state.current.rank : null,
    );
  });

  it('keeps a tooltip only where the cell cannot say it: the features named, a failed AI Overview, a cut-short URL', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const checked = makeRow({});
    const failed = {
      ...checked,
      state: { ...checked.state, current: { ...checked.state.current, state: 'failed' as const } },
    } as TrackedKeywordRow;

    // A feature list that is empty, or a keyword never checked, says so in the cell
    expect(result.current.features.cellTip?.(failed)).toBeUndefined();
    // The AI Overview cell shows what it found; only a failure is an icon without words
    expect(result.current.aio.cellTip?.(checked)).toBeUndefined();
    expect(result.current.aio.cellTip?.(failed)?.content).toContain('failed');
    expect(result.current.features.headerTooltip).toBeDefined();
    expect(result.current.aio.headerTooltip).toBeDefined();
  });

  it('gives competitor columns no tooltip: their cell is their rank', () => {
    const { result } = renderHook(() => useCompetitorColumns(competitors), { wrapper });
    for (const column of result.current) {
      expect(column.headerTooltip).toBeUndefined();
      expect(column.cellTip).toBeUndefined();
    }
  });
});
