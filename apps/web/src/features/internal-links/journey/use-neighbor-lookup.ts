'use client';

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import { READ_LIMIT, type ListLookup, type ListRequest, type LoadedList } from '@/lib/internal-links/journey-layout';
import { neighborsQuery } from '@/lib/internal-links/queries';
import type { LinksScope, Neighbor, NeighborList } from '@/lib/internal-links/types';

const STALE_MS = 60_000;
/** What changes a list in the cache: an answer, a failure, or data put there. A fetch starting changes nothing to read. */
const CHANGES = new Set(['success', 'error', 'setState']);

const pagesOf = (scope: LinksScope, request: ListRequest, run: string | null) =>
  Array.from({ length: request.pages }, (_, index) =>
    neighborsQuery(
      scope,
      {
        urlId: request.urlId,
        direction: request.direction,
        linkScope: request.scope,
        offset: index * READ_LIMIT,
      },
      run,
    ),
  );

/**
 * A number that changes whenever a neighbor list of the project changes in the cache. The lookup reads the cache and
 * is no subscription, so a host that keeps its layout in `useMemo` lists the lookup (which carries this number) as a
 * dependency.
 */
export function useNeighborVersion(scope: LinksScope, watched?: { current: ReadonlySet<string> }): number {
  const queryClient = useQueryClient();
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        // A key is `['ws', workspace, 'p', project, 'internal-links', 'neighbors', query]`
        const key = event.query.queryKey;
        if (
          event.type !== 'updated' ||
          !CHANGES.has(event.action.type) ||
          key[3] !== scope.projectId ||
          key[4] !== 'internal-links' ||
          key[5] !== 'neighbors' ||
          // Another reader of the same route (the inspector's lists) does not change what this layout reads
          (watched !== undefined && !watched.current.has(JSON.stringify(key)))
        ) {
          return;
        }
        version.current += 1;
        notify();
      }),
    [queryClient, scope.projectId, watched],
  );
  return useSyncExternalStore(
    subscribe,
    () => version.current,
    () => 0,
  );
}

/**
 * The neighbor lists of the journey (decision W7). `lookup` reads what the cache holds for a list, page by page of
 * 50: a list is loading until its first page is there and failed only when its first page failed; with the first
 * page read it is ready with the pages that have arrived (`partial` while a later one is missing or failed), so
 * pressing "+N more" never empties the column. `useLoad` subscribes to every page the layout asked for, so an answer
 * renders the journey again. The layout is pure: it is computed again from the cache whenever the lookup changes.
 */
export function useNeighborLookup(
  scope: LinksScope,
  run: string | null = null,
): {
  lookup: ListLookup<Neighbor>;
  useLoad: (requests: readonly ListRequest[]) => void;
  retry: (request: ListRequest) => void;
  /** Reads again every page of these lists that failed (a failed page after the first is otherwise never asked again). */
  retryFailed: (requests: readonly ListRequest[]) => void;
} {
  const queryClient = useQueryClient();
  // The keys of the lists the layout last asked for: only their changes render the layout again
  const watched = useRef<ReadonlySet<string>>(new Set());
  const version = useNeighborVersion(scope, watched);
  const lookup = useCallback<ListLookup<Neighbor>>(
    (request) => {
      void version;
      const states = pagesOf(scope, request, run).map((options) =>
        queryClient.getQueryState<NeighborList>(options.queryKey),
      );
      const [first] = states;
      if (first?.data === undefined) {
        return first?.status === 'error'
          ? { status: 'error', items: [], total: 0, otherScopes: [] }
          : { status: 'loading', items: [], total: 0, otherScopes: [] };
      }
      // The pages that have arrived in a row from the first; a page after a gap waits for the gap
      const arrived: NeighborList[] = [];
      for (const state of states) {
        if (state?.data === undefined) break;
        arrived.push(state.data);
      }
      const list: LoadedList<Neighbor> = {
        status: 'ready',
        items: arrived.flatMap((answer) => answer.data),
        total: first.data.meta.total,
        otherScopes: first.data.meta.other_scopes,
        partial: arrived.length < states.length,
      };
      return list;
    },
    [queryClient, scope, run, version],
  );
  // A hook that the host calls once per render with the requests of the layout it just built
  const useLoad = (requests: readonly ListRequest[]): void => {
    const queries = requests.flatMap((request) => pagesOf(scope, request, run));
    const keys = queries.map((options) => JSON.stringify(options.queryKey)).join('\n');
    // Before the queries below start (a layout effect runs first), so no answer is missed
    useLayoutEffect(() => {
      watched.current = new Set(keys === '' ? [] : keys.split('\n'));
    }, [keys]);
    useQueries({ queries: queries.map((options) => ({ ...options, staleTime: STALE_MS })) });
  };
  // Try again on a failed list: every page of it is read again
  const retry = useCallback(
    (request: ListRequest): void => {
      for (const { queryKey } of pagesOf(scope, request, run)) void queryClient.refetchQueries({ queryKey });
    },
    [queryClient, scope, run],
  );
  const retryFailed = useCallback(
    (requests: readonly ListRequest[]): void => {
      for (const request of requests) {
        for (const { queryKey } of pagesOf(scope, request, run)) {
          if (queryClient.getQueryState(queryKey)?.status === 'error') void queryClient.refetchQueries({ queryKey });
        }
      }
    },
    [queryClient, scope, run],
  );
  return { lookup, useLoad, retry, retryFailed };
}
