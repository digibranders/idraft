'use client';

import { useQuery } from '@tanstack/react-query';

import { checkPriceUsd } from './add-plan';
import type { ProjectScope } from '../rankings-queries';
import { apiAllPagesQuery, apiQuery } from '@/lib/api/query';

/** What the Add keywords dialog reads once it opens: the plan use and the price of a check. */

const QUOTA = '/api/v1/workspaces/{workspace_id}/tracked-keyword-quota';
const PRICE_BOOK = '/api/v1/workspaces/{workspace_id}/price-book';
const CHECK_PROVIDER = 'dataforseo';
const CHECK_ENDPOINT = 'serp/google/organic';

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
