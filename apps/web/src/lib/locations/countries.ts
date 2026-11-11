'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import type { ApiResponse } from '@/lib/api/query';

/**
 * Every country the API lists (19 section 3.2.5), for the features that choose countries: Rankings (where a
 * keyword is tracked) and AI prompts (where an engine asks and which market a prompt stands for). Regions and
 * cities wait for a location search in the editor.
 */
const COUNTRIES = { 'filter[location_type]': 'Country', 'filter[supports]': 'serp', limit: 200 } as const;
/** About 250 countries exist; the reading stops here whatever the API says. */
const MAX_COUNTRY_PAGES = 5;

export type Country = ApiResponse<'get', '/api/v1/locations'>['data'][number];

/** Every country the API lists, page after page: a link's location must be among them to be kept. */
export async function readCountries(signal: AbortSignal): Promise<Country[]> {
  const found: Country[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_COUNTRY_PAGES; page += 1) {
    const answer: ApiResponse<'get', '/api/v1/locations'> = await unwrap(
      api.GET('/api/v1/locations', {
        params: { query: { ...COUNTRIES, ...(cursor === null ? {} : { cursor }) } },
        signal,
      }),
    );
    found.push(...answer.data);
    cursor = answer.page.has_more ? answer.page.next_cursor : null;
    if (cursor === null) break;
  }
  return found;
}

/** The cache entry Rankings reads the countries under too, so the list is read once a session. */
export const COUNTRIES_KEY = ['locations', 'countries', 'all'] as const;

/** One empty list while the countries load, so what depends on it does not change on every render. */
const NO_COUNTRIES: readonly Country[] = [];

export interface CountryList {
  countries: readonly Country[];
  /** The list could not be read; `retry` asks again. */
  isError: boolean;
  retry: () => void;
}

export function useCountries(): CountryList {
  const query = useQuery({
    queryKey: COUNTRIES_KEY,
    queryFn: ({ signal }) => readCountries(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { countries: query.data ?? NO_COUNTRIES, isError: query.isError, retry: () => void query.refetch() };
}
