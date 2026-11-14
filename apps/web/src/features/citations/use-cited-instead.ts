'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { sourceDomainsQuery, type SourceFilters } from '@/lib/citations/source-queries';
import type { DomainRole, EngineCode, SourceDomainPage, SourceDomainRow, SourceScope } from '@/lib/citations/types';

/**
 * The domains cited instead of the project's own, for each prompt and engine pair of the "no own page" list (plan
 * Q16): one `sources/domains` read of the pair's prompt and engine, competitor and third party roles, the five
 * most cited. The caller gives the pairs it lists (the first 10) and nothing else is read.
 */

/** A prompt asked on one engine, the unit of the list. */
export interface CitedInsteadPair {
  promptId: string;
  engineCode: EngineCode;
}

/** The pair's id in the map of reads. */
export const citedInsteadId = ({ promptId, engineCode }: CitedInsteadPair): string => `${promptId}|${engineCode}`;

/** The most domains the popover lists. */
const LIMIT = 5;
const ROLES: readonly DomainRole[] = ['competitor', 'third_party'];

/** What one read says: `total` is every domain cited instead, `null` while it is not known (loading or failed). */
export interface CitedInsteadRead {
  status: 'loading' | 'error' | 'ready';
  domains: readonly SourceDomainRow[];
  total: number | null;
  /** Reads the pair's domains again. */
  retry: () => void;
}

/** In the order of the queries. A failed read with no page is an error; one with a page in hand keeps it. */
function combineReads(
  results: readonly {
    isError: boolean;
    isPending: boolean;
    data: SourceDomainPage | undefined;
    refetch: () => Promise<unknown>;
  }[],
): CitedInsteadRead[] {
  return results.map((result): CitedInsteadRead => ({
    status: result.isError && result.data === undefined ? 'error' : result.isPending ? 'loading' : 'ready',
    domains: result.data?.data ?? [],
    total: result.data?.page.total ?? null,
    retry: () => void result.refetch(),
  }));
}

export interface CitedInsteadOptions {
  source: SourceScope;
  /** The scope's filters; each read narrows the prompt, the engine and the roles to its pair's. */
  filters: SourceFilters;
  /** The rows listed: keep it stable between renders that change nothing. */
  pairs: readonly CitedInsteadPair[];
  /** False while another tab is shown: nothing is asked. */
  enabled: boolean;
}

/** The read of each pair, by its id. */
export function useCitedInstead({
  source,
  filters,
  pairs,
  enabled,
}: CitedInsteadOptions): ReadonlyMap<string, CitedInsteadRead> {
  const reads = useQueries({
    queries: pairs.map((pair) => ({
      ...sourceDomainsQuery(
        source,
        { ...filters, promptId: pair.promptId, engines: [pair.engineCode], roles: ROLES },
        { limit: LIMIT },
      ),
      enabled,
    })),
    combine: combineReads,
  });
  return useMemo(() => {
    const byPair = new Map<string, CitedInsteadRead>();
    pairs.forEach((pair, index) => {
      const read = reads[index];
      if (read !== undefined) byPair.set(citedInsteadId(pair), read);
    });
    return byPair;
  }, [pairs, reads]);
}
