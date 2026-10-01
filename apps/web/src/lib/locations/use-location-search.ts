'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { apiQuery } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';

export type Location = components['schemas']['Location'];

/** Server-side filtering (10-forms.md section 6.3): from 2 characters, 250 ms after typing stops, 50 results. */
const MIN_QUERY_LENGTH = 2;
const QUERY_DELAY_MS = 250;
const RESULT_LIMIT = 50;
/** A search that has run this long shows that it is running; a quicker one never flickers. */
const LOADING_DELAY_MS = 300;
/** DataForSEO's type for a country, which the list offers before anything is typed. */
const COUNTRY = 'Country';

export interface LocationSearch {
  items: readonly Location[];
  loading: boolean;
  onQueryChange: (query: string) => void;
}

/**
 * The locations rank checks can target (19 section 3.2.5, `GET /api/v1/locations`), for `LocationCombobox`.
 * Before 2 characters are typed it lists the countries; after that, the locations whose name contains the
 * text. The previous results stay while the next ones load.
 */
export function useLocationSearch(): LocationSearch {
  const [query, setQuery] = useState('');
  const settled = useDebouncedValue(query.trim(), QUERY_DELAY_MS);
  const searching = settled.length >= MIN_QUERY_LENGTH;
  const result = useQuery({
    ...apiQuery('/api/v1/locations', {
      params: {
        query: {
          limit: RESULT_LIMIT,
          'filter[supports]': 'serp',
          ...(searching ? { 'filter[q]': settled } : { 'filter[location_type]': COUNTRY }),
        },
      },
    }),
    placeholderData: keepPreviousData,
  });
  const slow = useDebouncedValue(result.isFetching, LOADING_DELAY_MS);
  return { items: result.data?.data ?? [], loading: slow && result.isFetching, onQueryChange: setQuery };
}
