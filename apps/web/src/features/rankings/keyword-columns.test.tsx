import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { useKeywordColumns } from './keyword-columns';
import { makeQueryClient } from '@/lib/api/query-client';
import type { EntityRef } from '@/lib/api/types';

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
  it('follow the order of the page template: CPC after AI Overview, the competitors after CPC', () => {
    const { result } = renderHook(() => useKeywordColumns('UTC', [COMPETITOR]), { wrapper });
    expect(result.current.map((column) => column.id)).toEqual([
      'keyword',
      'country',
      'current_rank',
      'ranking_url',
      'search_volume',
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
