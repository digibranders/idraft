'use client';

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useSyncExternalStore } from 'react';

import { READ_LIMIT, type ListLookup, type ListRequest, type LoadedList } from '@/lib/internal-links/journey-layout';
import { neighborsQuery } from '@/lib/internal-links/queries';
import type { LinksScope, Neighbor, NeighborList } from '@/lib/internal-links/types';

const STALE_MS = 60_000;

const pagesOf = (scope: LinksScope, request: ListRequest) =>
  Array.from({ length: request.pages }, (_, index) =>
    neighborsQuery(scope, {
      urlId: request.urlId,
      direction: request.direction,
      linkScope: request.scope,
      offset: index * READ_LIMIT,
    }),
  );

/**
 * A number that changes whenever a neighbor list of the project changes in the cache. The lookup reads the cache and
 * is no subscription, so a host that keeps its layout in `useMemo` lists it as a dependency.
 */
export function useNeighborVersion(scope: LinksScope): number {
  const queryClient = useQueryClient();
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        // A key is `['ws', workspace, 'p', project, 'internal-links', 'neighbors', query]`
        const key = event.query.queryKey;
        if (
          event.type !== 'updated' ||
          key[3] !== scope.projectId ||
          key[4] !== 'internal-links' ||
          key[5] !== 'neighbors'
        ) {
          return;
        }
        version.current += 1;
        notify();
      }),
    [queryClient, scope.projectId],
  );
  return useSyncExternalStore(
    subscribe,
    () => version.current,
    () => 0,
  );
}

/**
 * The neighbor lists of the journey (decision W7). `lookup` reads what the cache holds for a list, page by page of
 * 50; `useLoad` subscribes to every page the layout asked for, so an answer renders the journey again. The layout is
 * pure: it is computed again from the cache on each render.
 */
export function useNeighborLookup(scope: LinksScope): {
  lookup: ListLookup<Neighbor>;
  useLoad: (requests: readonly ListRequest[]) => void;
  retry: (request: ListRequest) => void;
} {
  const queryClient = useQueryClient();
  const lookup = useCallback<ListLookup<Neighbor>>(
    (request) => {
      const pages = pagesOf(scope, request).map((options) => queryClient.getQueryState<NeighborList>(options.queryKey));
      if (pages.some((page) => page?.status === 'error' && page.data === undefined)) {
        return { status: 'error', items: [], total: 0, otherScopes: [] };
      }
      const answers = pages.map((page) => page?.data);
      const [first] = answers;
      if (first === undefined || answers.some((answer) => answer === undefined)) {
        return { status: 'loading', items: [], total: 0, otherScopes: [] };
      }
      const list: LoadedList<Neighbor> = {
        status: 'ready',
        items: answers.flatMap((answer) => answer?.data ?? []),
        total: first.meta.total,
        otherScopes: first.meta.other_scopes,
      };
      return list;
    },
    [queryClient, scope],
  );
  // A hook that the host calls once per render with the requests of the layout it just built
  const useLoad = (requests: readonly ListRequest[]): void => {
    useQueries({
      queries: requests
        .flatMap((request) => pagesOf(scope, request))
        .map((options) => ({ ...options, staleTime: STALE_MS })),
    });
  };
  // Try again on a failed list: every page of it is read again
  const retry = useCallback(
    (request: ListRequest): void => {
      for (const { queryKey } of pagesOf(scope, request)) void queryClient.refetchQueries({ queryKey });
    },
    [queryClient, scope],
  );
  return { lookup, useLoad, retry };
}
