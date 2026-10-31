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

describe('useRankColumns trend label branches', () => {
  it('returns labelFailed when check failed', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      state: {
        ...makeRow({}).state,
        current: { rank: null, observed_at: '2026-10-29T10:00:00Z', depth_requested: 20, url: null, state: 'failed' },
      },
      sparkline: { depth_mode: 'daily_depth', points: [] },
    });
    const cell = result.current.trend.cell(row);
    const { getByRole } = render(cell);
    expect(getByRole('img', { name: 'Rank trend: checks failed' })).toBeInTheDocument();
  });

  it('returns labelEmpty when not checked yet', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      state: {
        ...makeRow({}).state,
        current: { rank: null, observed_at: null, depth_requested: 20, url: null, state: 'not_checked' },
      },
      sparkline: { depth_mode: 'daily_depth', points: [] },
    });
    const cell = result.current.trend.cell(row);
    const { getByRole } = render(cell);
    expect(getByRole('img', { name: 'Rank trend: no checks yet' })).toBeInTheDocument();
  });

  it('returns labelEmpty when sparkline points are empty', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      sparkline: { depth_mode: 'daily_depth', points: [] },
    });
    const cell = result.current.trend.cell(row);
    const { getByRole } = render(cell);
    expect(getByRole('img', { name: 'Rank trend: no checks yet' })).toBeInTheDocument();
  });

  it('returns labelNone when all checks were beyond depth', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      sparkline: {
        depth_mode: 'daily_depth',
        points: [
          { t: '2026-10-27T10:00:00Z', rank: null, depth: 20, state: 'beyond_depth' },
          { t: '2026-10-28T10:00:00Z', rank: null, depth: 20, state: 'beyond_depth' },
        ],
      },
    });
    const cell = result.current.trend.cell(row);
    const { getByRole } = render(cell);
    expect(
      getByRole('img', { name: 'Rank trend: not ranked within the depth in the last 2 checks' }),
    ).toBeInTheDocument();
  });

  it('uses >depth for latest rank when latest check is beyond depth', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      sparkline: {
        depth_mode: 'daily_depth',
        points: [
          { t: '2026-10-27T10:00:00Z', rank: 9, depth: 20, state: 'ranked' },
          { t: '2026-10-28T10:00:00Z', rank: 4, depth: 20, state: 'ranked' },
          { t: '2026-10-29T10:00:00Z', rank: null, depth: 20, state: 'beyond_depth' },
        ],
      },
    });
    const cell = result.current.trend.cell(row);
    const { getByRole } = render(cell);
    expect(
      getByRole('img', {
        name: 'Rank trend, last 3 checks: from 9 to >20, best 4, 1 check beyond the depth checked',
      }),
    ).toBeInTheDocument();
  });

  it('returns standard label when latest check is ranked', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      sparkline: {
        depth_mode: 'daily_depth',
        points: [
          { t: '2026-10-27T10:00:00Z', rank: 9, depth: 20, state: 'ranked' },
          { t: '2026-10-28T10:00:00Z', rank: 4, depth: 20, state: 'ranked' },
        ],
      },
    });
    const cell = result.current.trend.cell(row);
    const { getByRole } = render(cell);
    expect(getByRole('img', { name: 'Rank trend, last 2 checks: from 9 to 4, best 4' })).toBeInTheDocument();
  });

  it('formats cell tip dates and ranks using locale formatters without hardcoded formats', () => {
    const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
    const row = makeRow({
      sparkline: {
        depth_mode: 'daily_depth',
        points: [
          { t: '2026-10-27T10:00:00Z', rank: 3, depth: 20, state: 'ranked' },
          { t: '2026-10-28T10:00:00Z', rank: null, depth: 20, state: 'beyond_depth' },
        ],
      },
    });
    const tip = result.current.trend.cellTip?.(row);
    expect(tip?.content).toBe('Last checks');
    expect(tip?.detail).toBe('Oct 27: 3, Oct 28: >20');
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
    const { result } = renderHook(() => useCompetitorColumns(competitors, 'UTC'), { wrapper });
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

  it('puts competitor rank change in cell tooltip', () => {
    const { result } = renderHook(() => useCompetitorColumns(competitors, 'UTC'), { wrapper });
    const alphaCol = result.current[0];
    if (!alphaCol) throw new Error('Missing alpha column');
    const alphaCompetitor = competitors[1];
    if (!alphaCompetitor) throw new Error('Missing alpha competitor');

    const row = makeRow({
      competitor_ranks: [
        {
          entity: alphaCompetitor,
          current: { rank: 4, observed_at: '2026-10-29T10:00:00Z', depth_requested: 20, url: null, state: 'ranked' },
          change: { label: 'numeric', value: 2, previous_rank: 6 },
        },
      ],
    });

    const tip = alphaCol.cellTip?.(row);
    expect(tip?.content).toContain('Rank 4');
    expect(tip?.content).toContain('Improved 2 positions');
    expect(tip?.detail).toContain('From 6 to 4');
  });
});
