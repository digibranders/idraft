'use client';

import { useQueries } from '@tanstack/react-query';

import { keywordsKey, readPage, type KeywordFilters, type ProjectScope } from '../rankings-queries';

/**
 * The counts of the Rankings strip (24-page-templates.md section 9.3, "Strip"): how many keywords the list's
 * filters match that ranked, that were checked and not found, and that rank in the top 3, 10 and 20. The API
 * has no summary route, so each is the `page.total` of a one-row read with the filters and one more
 * condition. A count the filters already rule out is known to be 0 and not asked for. The search box is not
 * part of the strip's scope, so the strip reads the same in both list modes.
 */

export const STRIP_COUNTS = ['total', 'ranked', 'beyond', 'top3', 'top10', 'top20'] as const;
export type StripCount = (typeof STRIP_COUNTS)[number];

const TOPS = { top3: 3, top10: 10, top20: 20 } as const;
const DEEPEST = 700;

/** The filters of each count, or `null` for a count that is 0 under these filters. */
export function stripQueries(filters: KeywordFilters): Record<StripCount, KeywordFilters | null> {
  const beyondOnly = filters['filter[rank_is_null]'] === true;
  const rankedOnly = filters['filter[rank_is_null]'] === false;
  const from = filters['filter[rank_gte]'] ?? 1;
  const to = filters['filter[rank_lte]'] ?? DEEPEST;
  const ranged = filters['filter[rank_gte]'] !== undefined || filters['filter[rank_lte]'] !== undefined;
  const top = (limit: number): KeywordFilters | null => {
    const lte = Math.min(to, limit);
    return beyondOnly || from > lte ? null : { ...filters, 'filter[rank_lte]': lte };
  };
  return {
    total: { ...filters },
    ranked: beyondOnly ? null : { ...filters, 'filter[rank_is_null]': false },
    // A keyword beyond the depth has no rank, so a range or the ranked chip leaves none
    beyond: rankedOnly || ranged ? null : { ...filters, 'filter[rank_is_null]': true },
    top3: top(TOPS.top3),
    top10: top(TOPS.top10),
    top20: top(TOPS.top20),
  };
}

export interface StripCounts {
  counts: Record<StripCount, number | null> | null;
  itemErrors: Record<StripCount, boolean>;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  refetch: () => Promise<void>;
}

/** The five counts, read together; they sit under the list's key, so a write that refreshes the list refreshes them. */
export function useStripCounts(scope: ProjectScope, filters: KeywordFilters, enabled: boolean): StripCounts {
  const queries = stripQueries(filters);
  const results = useQueries({
    queries: STRIP_COUNTS.map((id) => {
      const asked = queries[id];
      return {
        queryKey: [...keywordsKey(scope), filters, 'strip', id],
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<number> =>
          asked === null ? 0 : (await readPage(scope, { ...asked, limit: 1 }, signal)).page.total,
        enabled,
        placeholderData: (previous: number | undefined) => previous,
      };
    }),
  });
  const loading = results.some((result) => result.isPending);
  const itemErrors = Object.fromEntries(
    STRIP_COUNTS.map((id, index) => [id, results[index]?.isError ?? false]),
  ) as Record<StripCount, boolean>;
  const counts: Record<StripCount, number | null> | null = loading
    ? null
    : (Object.fromEntries(
        STRIP_COUNTS.map((id, index) => [id, results[index]?.isError ? null : (results[index]?.data ?? 0)]),
      ) as Record<StripCount, number | null>);
  return {
    counts,
    itemErrors,
    loading,
    fetching: results.some((result) => result.isFetching),
    error: results.some((result) => result.isError),
    refetch: async () => {
      await Promise.all(results.map((r) => r.refetch()));
    },
  };
}
