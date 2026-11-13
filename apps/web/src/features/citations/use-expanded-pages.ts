'use client';

import { useQueries } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { domainRowId, PAGES_PER_DOMAIN, type ChildPagesRead } from './domain-rows';
import { sourcePagesQuery, type SourceFilters } from '@/lib/citations/source-queries';
import type { SourceDomainRow, SourcePagePage, SourceScope } from '@/lib/citations/types';

/**
 * The top pages of the open domains of the Domains table (plan D8): one `sources/pages` read for each open row,
 * of its registrable domain AND its role (a domain with several role rows would otherwise list the same pages
 * under each), in the scope of the page. A collapsed row is not read.
 */

export interface ExpandedPagesOptions {
  source: SourceScope;
  /** The scope's filters; each read narrows the roles to its own row's. */
  filters: SourceFilters;
  minSupport: number;
  compare: boolean;
  /** The domain rows that are open: the only ones read. Keep it stable between renders that change nothing. */
  open: readonly SourceDomainRow[];
  /** False while another tab is shown: nothing is asked. */
  enabled?: boolean;
}

export interface ExpandedPages {
  /** The read of each open domain, by its row id. */
  reads: ReadonlyMap<string, ChildPagesRead>;
  /** Reads one domain's pages again. Its identity never changes, so the columns that hold it are not rebuilt. */
  retry: (rowId: string) => void;
}

interface Read extends ChildPagesRead {
  refetch: () => Promise<unknown>;
}

/** In the order of the queries. A failed read with no pages is an error; one with pages in hand keeps them. */
function combineReads(
  results: readonly {
    isError: boolean;
    isPending: boolean;
    data: SourcePagePage | undefined;
    refetch: () => Promise<unknown>;
  }[],
): Read[] {
  return results.map((result): Read => ({
    status: result.isError && result.data === undefined ? 'error' : result.isPending ? 'loading' : 'ready',
    data: result.data,
    refetch: result.refetch,
  }));
}

export function useExpandedPages({
  source,
  filters,
  minSupport,
  compare,
  open,
  enabled = true,
}: ExpandedPagesOptions): ExpandedPages {
  const results = useQueries({
    queries: open.map((domain) => ({
      ...sourcePagesQuery(
        source,
        { ...filters, roles: [domain.domain_role] },
        {
          registrableDomain: domain.registrable_domain,
          limit: PAGES_PER_DOMAIN,
          minSupport,
          compare,
          include: ['series'],
        },
      ),
      // No `keepPreviousData`: `useQueries` gives each key its own observer, so it has nothing to carry over when
      // the scope changes (a row says "Loading pages" until its new read lands). A read of the same key that is
      // fetched again keeps its pages without it.
      enabled,
    })),
    combine: combineReads,
  });
  const reads = useMemo(() => {
    const byRow = new Map<string, Read>();
    open.forEach((domain, index) => {
      const read = results[index];
      if (read !== undefined) byRow.set(domainRowId(domain), read);
    });
    return byRow;
  }, [open, results]);
  // The latest reads, so `retry` keeps one identity
  const latest = useRef(reads);
  useEffect(() => {
    latest.current = reads;
  }, [reads]);
  const retry = useCallback((rowId: string): void => {
    void latest.current.get(rowId)?.refetch();
  }, []);
  return { reads, retry };
}
