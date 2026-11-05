import { QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { useKeywordColumns } from './keyword-columns';
import { makeQueryClient } from '@/lib/api/query-client';
import type { EntityRef, TrackedKeywordRow } from '@/lib/api/types';
import type { PairedRow } from './keyword-pairs';

function wrapper({ children }: { children: ReactNode }): ReactElement {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={makeQueryClient({ retry: false })}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

const COMPETITOR: EntityRef = {
  entity_id: 'e1',
  canonical_name: 'Brightwave',
  color_index: 1,
  entity_type: 'organization',
  role: 'competitor',
};

describe('the keyword columns', () => {
  it('show the Search Console count of the row, 0 as a count, and say why a count is missing', () => {
    const { result } = renderHook(() => useKeywordColumns('UTC'), { wrapper });
    const clicks = result.current.find((column) => column.id === 'gsc_clicks');
    const row = (gsc: TrackedKeywordRow['gsc']): PairedRow =>
      ({ device: 'mobile', gsc, keyword: { text: 'soc' }, devices: { desktop: null, mobile: null } }) as PairedRow;
    const text = (gsc: TrackedKeywordRow['gsc']): string => {
      const { container } = render(<>{clicks?.cell(row(gsc))}</>);
      return container.textContent ?? '';
    };

    // The device of the row picks the count, and a sort reads the same figure
    expect(text({ state: 'ok', clicks: { desktop: 9, mobile: 1234 } })).toBe('1,234');
    expect(clicks?.sortValue?.(row({ state: 'ok', clicks: { desktop: 9, mobile: 1234 } }))).toBe(1234);
    expect(text({ state: 'ok', clicks: { desktop: 9, mobile: 0 } })).toBe('0');
    expect(text({ state: 'pending' })).toBe('Pending');
    expect(text({ state: 'not_connected' })).toBe('Not connected');
    expect(text(null)).toBe('Pending');
  });

  it.each([
    [
      'clicks',
      [4, 4, 4, 0, 6, 6, 5],
      'Clicks up 42 percent over the last 28 days',
      'First 12 days: 12. Last 12 days: 17',
    ],
    [
      'clicks',
      [6, 6, 5, 0, 4, 4, 4],
      'Clicks down 29 percent over the last 28 days',
      'First 12 days: 17. Last 12 days: 12',
    ],
    ['clicks', [4, 4, 4, 9, 4, 4, 5], 'Clicks flat over the last 28 days', 'First 12 days: 12. Last 12 days: 13'],
    [
      'clicks',
      [0, 0, 0, 0, 0, 0, 0],
      'Too few clicks in the last 28 days to show a trend',
      'First 12 days: 0. Last 12 days: 0',
    ],
    [
      'impressions',
      [0, 0, 0, 0, 7, 7, 7],
      'Impressions up from none over the last 28 days',
      'First 12 days: 0. Last 12 days: 21',
    ],
    [
      'impressions',
      [2, 2, 2, 2, 2, 2, 2],
      'Too few impressions in the last 28 days to show a trend',
      'First 12 days: 6. Last 12 days: 6',
    ],
  ] as const)('draw the %s count with a graph named by its movement: %j', (metric, buckets, label, halves) => {
    const { result } = renderHook(() => useKeywordColumns('UTC'), { wrapper });
    const column = result.current.find((candidate) => candidate.id === `gsc_${metric}`);
    const total = buckets.reduce((sum: number, value) => sum + value, 0);
    const counts = { desktop: total, mobile: 0 };
    const row = {
      device: 'desktop',
      keyword: { text: 'soc' },
      devices: { desktop: null, mobile: null },
      gsc: {
        state: 'ok',
        clicks: counts,
        impressions: counts,
        window: { start: '2026-10-07', end: '2026-11-03' },
        trend: { bucket_days: 4, clicks: [...buckets], impressions: [...buckets] },
      },
    } as PairedRow;

    const { getByRole, container } = render(<>{column?.cell(row)}</>);

    expect(getByRole('img', { name: label })).toBeInTheDocument();
    expect(container.textContent).toBe(String(total));
    expect(column?.cellTip?.(row)).toEqual({ content: label, detail: halves });
  });

  it('follow the order of the page template: CPC after AI Overview, the competitors after CPC', () => {
    const { result } = renderHook(() => useKeywordColumns('UTC', [COMPETITOR]), { wrapper });
    expect(result.current.map((column) => column.id)).toEqual([
      'keyword',
      'country',
      'current_rank',
      'ranking_url',
      'search_volume',
      'gsc_clicks',
      'gsc_impressions',
      'keyword_difficulty',
      'intent',
      'serp_features',
      'aio',
      'cpc_usd',
      'competitor_e1',
      'trend',
      'priority',
      'group',
      'tags',
      'best_rank',
      'last_observed_at',
      'created_at',
    ]);
  });
});
