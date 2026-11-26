'use client';

import { useQuery } from '@tanstack/react-query';

import { keywordsKey, readPage, type KeywordFilters, type ProjectScope } from '../rankings-queries';

/**
 * The counts of the Rankings strip (24-page-templates.md section 9.3, "Strip"): how many keywords the list's
 * filters match, how many of them ranked, were checked and not found, and rank in the top 3, 10 and 20. One
 * one-row read of the list asks for them with `include=counts`; the API counts all six over the filtered set in a
 * single statement, so a count the filters rule out comes back 0 without the web working it out. The search box is
 * not part of the strip's scope, so the strip reads the same in both list modes.
 */

export const STRIP_COUNTS = ['total', 'ranked', 'beyond', 'top3', 'top10', 'top20'] as const;
export type StripCount = (typeof STRIP_COUNTS)[number];

export interface StripCounts {
  counts: Record<StripCount, number | null> | null;
  itemErrors: Record<StripCount, boolean>;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  refetch: () => Promise<void>;
}

/** The six counts, read together; they sit under the list's key, so a write that refreshes the list refreshes them. */
export function useStripCounts(scope: ProjectScope, filters: KeywordFilters, enabled: boolean): StripCounts {
  const result = useQuery({
    queryKey: [...keywordsKey(scope), filters, 'strip'],
    queryFn: async ({ signal }): Promise<Record<StripCount, number>> => {
      const { page } = await readPage(scope, { ...filters, limit: 1, include: ['counts'] }, signal);
      if (page.counts === undefined || page.counts === null) {
        throw new Error('The keyword list answered without the strip counts.');
      }
      return page.counts;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
  return {
    counts: result.data ?? null,
    // One read feeds all six, so when it fails every one is unavailable
    itemErrors: Object.fromEntries(STRIP_COUNTS.map((id) => [id, result.isError])) as Record<StripCount, boolean>,
    loading: result.isPending,
    fetching: result.isFetching,
    error: result.isError,
    refetch: async () => {
      await result.refetch();
    },
  };
}
