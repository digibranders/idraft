'use client';

import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';

import { PAGE_MAX, PREVIOUS_LIMIT, fanoutQuery } from './fanout-queries';
import { previousWindow } from './fanout-model';
import type { FanoutFilters, FanoutQueryPage } from './types';
import type { QueryKey } from '@/lib/api/keys';
import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';
import type { SourceScope } from '@/lib/citations/types';

/**
 * The reads of the fan-out surfaces (plan D14): five minutes fresh, no refetch on focus, the last rows kept while a
 * new scope is read. Each read loads and fails alone, so a failed read of the period before never hides the rows.
 */

const STALE_MS = 5 * 60_000;
/** The key of a read with nothing to ask. It is never fetched. */
const IDLE_KEY: QueryKey = ['ai', 'fanout-queries', 'idle'];

/**
 * One read: what it has, and how to say so. `idle`: nothing was asked (no exposing engine yet, or switched off), so
 * there is no request and no data. This is the `CitationRead` of the Citations page, defined again because a
 * feature never imports another feature.
 */
export interface FanoutRead {
  status: 'idle' | 'loading' | 'error' | 'ready';
  data: FanoutQueryPage | undefined;
  errorId: ErrorIdWords | null;
  retry: () => void;
  /** A request is on its way: the first one, a retry, or the read of a new scope. */
  retrying: boolean;
  /** The rows on screen are the last scope's while the new one is read. */
  refreshing: boolean;
}

export interface FanoutReads {
  /** The queries of the window, at the minimum and the limit asked. */
  current: FanoutRead;
  /** The period before the window, every query it had, to tell the new ones (only with `previous`). */
  previous: FanoutRead;
  /** The window's queries with the topics of their prompts, for the clusters (only with `topics`). */
  topics: FanoutRead;
}

export interface FanoutReadsOptions {
  /** The fewest answers a query is listed for. */
  minSupport: number;
  /** The rows of the current read, at most `PAGE_MAX`. */
  limit: number;
  /** Read the period before the window. Default false. */
  previous?: boolean;
  /** Read the topics of each query, with `PAGE_MAX` rows: a cluster needs every row it groups. Default false. */
  topics?: boolean;
  /** `false` reads nothing, while the surface is not the one shown. Default true. */
  enabled?: boolean;
}

type Options = ReturnType<typeof fanoutQuery>;

function useFanoutRead(options: Options | null): FanoutRead {
  const query = useQuery<FanoutQueryPage, Error, FanoutQueryPage, QueryKey>({
    queryKey: options?.queryKey ?? IDLE_KEY,
    queryFn: options?.queryFn ?? skipToken,
    enabled: options !== null,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });
  const errorId = useErrorId(query.error);
  const data = options === null ? undefined : query.data;
  return {
    // A failed refetch with rows in hand keeps the rows: it is not an empty list
    status:
      options === null ? 'idle' : query.isError && data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    data,
    errorId,
    retry: () => void query.refetch(),
    retrying: options !== null && query.isFetching,
    refreshing: options !== null && query.isFetching && data !== undefined,
  };
}

/**
 * The reads of one engine's queries. `filters` is `undefined` while there is no engine that shows its queries to
 * name (the engines are loading, or none exposes fan-out): nothing is asked then, because a placeholder engine would
 * be named in a request and the route answers `422 engine_has_no_fanout` to it. A filter that names an engine that
 * does not show its queries throws `EngineNotExposedError`: that is a bug of the screen, not a state.
 */
export function useFanoutReads(
  source: SourceScope,
  filters: FanoutFilters | undefined,
  { minSupport, limit, previous = false, topics = false, enabled = true }: FanoutReadsOptions,
): FanoutReads {
  const asked = enabled ? filters : undefined;
  return {
    current: useFanoutRead(asked === undefined ? null : fanoutQuery(source, asked, { minSupport, limit })),
    previous: useFanoutRead(
      asked === undefined || !previous
        ? null
        : fanoutQuery(source, { ...asked, ...previousWindow(asked) }, { minSupport: 1, limit: PREVIOUS_LIMIT }),
    ),
    topics: useFanoutRead(
      asked === undefined || !topics ? null : fanoutQuery(source, asked, { minSupport, limit: PAGE_MAX, topics: true }),
    ),
  };
}
