'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';
import {
  citationListQuery,
  sourceChangesQuery,
  sourceDiversityQuery,
  sourceDomainsQuery,
  type SourceFilters,
} from '@/lib/citations/source-queries';
import type {
  CitationPage,
  SourceChangePage,
  SourceDiversity,
  SourceDomainPage,
  SourceScope,
  SourcesMeta,
} from '@/lib/citations/types';

/**
 * The reads of the Citations strip (plan D2, D3, D6). Each loads and fails alone, keeps its last answer while a
 * new scope is read, and shows its own error. None takes the role filter: the strip is of the whole scope, and
 * the role narrows the rows of the tables only.
 */

/** One read: what it has, and how to say so. */
export interface CitationRead<TPage> {
  status: 'loading' | 'error' | 'ready';
  data: TPage | undefined;
  errorId: ErrorIdWords | null;
  retry: () => void;
  /** A request is on its way: the first one, a retry, or the read of a new scope (the data shown is the last one). */
  retrying: boolean;
}

/** `idle`: the read has nothing to ask (a comparison that is off), so it is ready with no data and no request. */
function useRead<TPage>(query: UseQueryResult<TPage>, idle = false): CitationRead<TPage> {
  const errorId = useErrorId(query.error);
  return {
    // An error with data in hand keeps the data: a failed refetch is not an empty strip
    status: idle
      ? 'ready'
      : query.isError && query.data === undefined
        ? 'error'
        : query.isPending
          ? 'loading'
          : 'ready',
    // An idle read has no data: the placeholder of `keepPreviousData` would otherwise show the last window's
    data: idle ? undefined : query.data,
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}

const options = (enabled: boolean): { placeholderData: typeof keepPreviousData; enabled: boolean } => ({
  placeholderData: keepPreviousData,
  enabled,
});

const wholeScope = (filters: SourceFilters): SourceFilters => ({ ...filters, roles: [] });

/**
 * The scope read: one row of the domains, for `meta` (answers, units, units of each role and engine, the weekly
 * series, the window before). It does not depend on the tab, the minimum or the role.
 */
export function useScopeMeta(
  scope: SourceScope,
  filters: SourceFilters,
  enabled = true,
): CitationRead<SourceDomainPage> {
  const query = useQuery({
    ...sourceDomainsQuery(scope, wholeScope(filters), {
      limit: 1,
      minSupport: 1,
      include: ['by_role_by_engine', 'series'],
      compare: true,
    }),
    ...options(enabled),
  });
  return useRead(query);
}

/**
 * The period before: the same route over `meta.compare_window`, for the previous total of the own share (`meta` of
 * the current read has no previous total). Asked only with the comparison on and answers in that window; without
 * them it is ready with no data, and nothing is requested.
 */
export function usePreviousMeta(
  scope: SourceScope,
  filters: SourceFilters,
  current: SourcesMeta | undefined,
  compare: boolean,
): CitationRead<SourceDomainPage> {
  const window = compare && (current?.previous_answers ?? 0) > 0 ? (current?.compare_window ?? null) : null;
  const query = useQuery({
    ...sourceDomainsQuery(
      scope,
      wholeScope(window === null ? filters : { ...filters, from: window.from, to: window.to }),
      { limit: 1, minSupport: 1 },
    ),
    ...options(window !== null),
  });
  return useRead(query, window === null);
}

/** Per engine and over all of them, the distinct and the effective sources (C3): the engines are never pooled. */
export function useDiversity(
  scope: SourceScope,
  filters: SourceFilters,
  enabled = true,
): CitationRead<SourceDiversity> {
  return useRead(useQuery({ ...sourceDiversityQuery(scope, wholeScope(filters)), ...options(enabled) }));
}

/** How many sources are new or lost: `page.total` of one row of `sources/changes`. */
export function useChangeCounts(
  scope: SourceScope,
  filters: SourceFilters,
  { kind, minSupport }: { kind: 'new' | 'lost'; minSupport: number },
  enabled = true,
): CitationRead<SourceChangePage> {
  return useRead(
    useQuery({
      ...sourceChangesQuery(scope, wholeScope(filters), { kind, minSupport, limit: 1 }),
      ...options(enabled),
    }),
  );
}

/** The newest citation in scope (newest first), for "Updated ..." and the stale note. */
export function useLatestCitation(
  scope: SourceScope,
  filters: SourceFilters,
  enabled = true,
): CitationRead<CitationPage> {
  return useRead(useQuery({ ...citationListQuery(scope, wholeScope(filters), { limit: 1 }), ...options(enabled) }));
}
