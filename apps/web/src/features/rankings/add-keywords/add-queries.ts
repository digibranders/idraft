'use client';

import { useQuery } from '@tanstack/react-query';

import { checkPriceUsd } from './add-plan';
import { readCountries, type Country } from '../keyword-filters';
import type { ProjectScope } from '../rankings-queries';
import { apiAllPagesQuery, apiQuery } from '@/lib/api/query';
import { COUNTRIES_KEY } from '@/lib/locations/countries';

/** What the Add keywords dialog reads once it opens: the plan use and the price of a check. */

const QUOTA = '/api/v1/workspaces/{workspace_id}/tracked-keyword-quota';
const PRICE_BOOK = '/api/v1/workspaces/{workspace_id}/price-book';
const CHECK_PROVIDER = 'dataforseo';
const CHECK_ENDPOINT = 'serp/google/organic';

/** One empty list while the countries load, so what depends on it does not change on every render. */
const NO_COUNTRIES: readonly Country[] = [];

export interface CountryList {
  countries: readonly Country[];
  /** The list could not be read; `retry` asks again. */
  isError: boolean;
  retry: () => void;
}

/**
 * Every country, with whether the list could be read. The same cache entry as `useCountries()` of
 * keyword-scope.tsx (its key and reader), which the Add dialog needs with its error state.
 */
export function useCountryList(): CountryList {
  const query = useQuery({
    queryKey: COUNTRIES_KEY,
    queryFn: ({ signal }) => readCountries(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { countries: query.data ?? NO_COUNTRIES, isError: query.isError, retry: () => void query.refetch() };
}

export interface TrackedKeywordQuota {
  limit: number;
  used: number;
}

/**
 * The workspace's tracked keyword limit and use; `null` while it loads and when it cannot be read. Never
 * served from the cache: an add, an archive or a keyword tracked from another screen changes the figure.
 */
export function useTrackedKeywordQuota(scope: ProjectScope, enabled: boolean): TrackedKeywordQuota | null {
  const query = useQuery({
    ...apiQuery(QUOTA, { params: { path: { workspace_id: scope.workspaceId } } }),
    enabled,
    staleTime: 0,
  });
  return query.data?.data ?? null;
}

/**
 * The cost in dollars of one depth-100 check, from the price book; `null` while it loads, when the price
 * book is refused to this member (it is behind `costs:read`) or fails, and when it holds no such price. The
 * dialog then leaves the cost line out. Only DataForSEO's Google organic prices are read, those valid today.
 */
export function useCheckPrice(scope: ProjectScope, enabled: boolean): number | null {
  const query = useQuery({
    ...apiAllPagesQuery(PRICE_BOOK, (price) => price.price_id, {
      params: {
        path: { workspace_id: scope.workspaceId },
        query: { 'filter[provider_code]': CHECK_PROVIDER, 'filter[endpoint]': CHECK_ENDPOINT },
      },
    }),
    enabled,
  });
  return query.data === undefined ? null : checkPriceUsd(query.data.data);
}
