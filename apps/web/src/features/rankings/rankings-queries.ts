'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { DEPTH_PROFILES, FUNNEL_STAGES, INTENTS, SOURCES } from './keyword-values';
import type { PageSize } from '@/components/app/data-table/types';
import type { FilterValues } from '@/components/app/filters/types';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import type { paths } from '@/lib/api/schema';
import type { TrackedKeywordRow } from '@/lib/api/types';
import type { FilterValue } from '@/lib/filters/filter-values';
import { isUuid } from '@/lib/routes/paths';
import { formatSort, type SortKey } from '@/lib/tables/table-state';

/**
 * The tracked keyword list of Rankings (12-tables.md section 12, backend plan D15). The filters always go
 * to the API. When they match at most 10,000 keywords, every page loads in the background, 200 at a time,
 * and the table sorts and searches them in memory (client mode); above that the table shows one page at a
 * time in the API's sort, with the search sent as `filter[q]` (server mode).
 */

const TRACKED = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords';
export type ListQuery = NonNullable<paths[typeof TRACKED]['get']['parameters']['query']>;
export type ListPage = paths[typeof TRACKED]['get']['responses'][200]['content']['application/json'];

/** The list's filters as the API takes them: everything but the sort, the paging and the search. */
export type KeywordFilters = Omit<ListQuery, 'sort' | 'include' | 'cursor' | 'limit' | 'filter[q]'>;

export interface ProjectScope {
  workspaceId: string;
  projectId: string;
}

/** Up to this many matches, the table holds them all (12-tables.md section 12). */
export const CLIENT_MODE_LIMIT = 10_000;
/** The largest page the API answers. */
const PAGE = 200;
const INCLUDE: NonNullable<ListQuery['include']> = ['metrics', 'groups', 'terms'];
/** The cursor of the first page: none. */
const FIRST_PAGE: string | null = null;
/** The sort the client mode loads in: the table sorts in memory, so changing it reads nothing again. */
const LOAD_SORT = 'keyword';
/** The whole list is read again after this long, or when a write invalidates it (never on a focus). */
const ALL_STALE_MS = 5 * 60_000;
/** A list no screen shows is kept this long. */
const ALL_GC_MS = 30_000;

/** Every query of the project's tracked keywords: `refreshKeywords` invalidates them all. */
export const keywordsKey = (scope: ProjectScope): QueryKey => [
  ...projectKey(scope.workspaceId, scope.projectId),
  'tracked-keywords',
];

/**
 * The keys of the three kinds of list query, under `keywordsKey`: the whole list of client mode, one page
 * of server mode, and the count of the page's meta line. `keyword-cache.ts` finds the first two by their
 * shape, so they are built here and nowhere else.
 */
export const allListKey = (scope: ProjectScope, filters: KeywordFilters): QueryKey => [
  ...keywordsKey(scope),
  filters,
  'all',
];
export const pageListKey = (scope: ProjectScope, filters: KeywordFilters, query: ListQuery): QueryKey => [
  ...keywordsKey(scope),
  filters,
  'page',
  query,
];
export const countKey = (scope: ProjectScope): QueryKey => [...keywordsKey(scope), 'count'];

/**
 * After any change to tracked keywords: the list, its counts, every page and the open keyword. Resolves
 * once the queries on screen have read again.
 */
export function refreshKeywords(queryClient: QueryClient, scope: ProjectScope): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: keywordsKey(scope) });
}

// The URL keys of the filters (13-filters-search.md section 5) and what each sends

/** The values of an enum filter that are one of `allowed`. */
function enumOf<T extends string>(value: FilterValue | undefined, allowed: readonly T[]): T[] {
  if (value?.kind !== 'enum') return [];
  return value.values.flatMap((id) => {
    const known = allowed.find((candidate) => candidate === id);
    return known === undefined ? [] : [known];
  });
}

const idsOf = (value: FilterValue | undefined): string[] => (value?.kind === 'enum' ? [...value.values] : []);
const minOf = (value: FilterValue | undefined): number | null => (value?.kind === 'range' ? value.min : null);
const maxOf = (value: FilterValue | undefined): number | null => (value?.kind === 'range' ? value.max : null);

/** The API's filters for the filter bar's values, and the Archived view (`is_active=false`). */
export function keywordFilters(values: FilterValues, archived: boolean): KeywordFilters {
  const [group] = idsOf(values.grp);
  const terms = idsOf(values.tag);
  const [device] = enumOf(values.dev, ['desktop', 'mobile'] as const);
  const [location] = idsOf(values.loc);
  const [language] = idsOf(values.lang);
  const intents = enumOf(values.intent, INTENTS);
  const stages = enumOf(values.stage, FUNNEL_STAGES);
  const sources = enumOf(values.src, SOURCES);
  const depths = enumOf(values.depth, DEPTH_PROFILES);
  const priority = maxOf(values.prio);
  const volume = minOf(values.vol);
  const difficulty = maxOf(values.kd);
  const locationId = location === undefined || !/^\d+$/.test(location) ? Number.NaN : Number(location);
  // A value from a link is sent only in the API's shape, so a hand-edited URL never reads as a server error
  const groupId = group !== undefined && isUuid(group) ? group : undefined;
  const termIds = terms.filter(isUuid);
  return {
    // Always sent: a body filter left without it would take archived keywords too (bulk actions, Task 7)
    'filter[is_active]': !archived,
    ...(groupId === undefined ? {} : { 'filter[group]': groupId }),
    ...(termIds.length === 0 ? {} : { 'filter[term]': termIds }),
    ...(device === undefined ? {} : { 'filter[device]': device }),
    ...(Number.isInteger(locationId) ? { 'filter[location_id]': locationId } : {}),
    ...(language === undefined ? {} : { 'filter[language_code]': language }),
    ...(intents.length === 0 ? {} : { 'filter[intent_in]': intents }),
    ...(stages.length === 0 ? {} : { 'filter[funnel_stage_in]': stages }),
    ...(sources.length === 0 ? {} : { 'filter[source_in]': sources }),
    ...(depths.length === 0 ? {} : { 'filter[depth_profile_in]': depths }),
    ...(priority === null ? {} : { 'filter[priority_lte]': priority }),
    ...(volume === null ? {} : { 'filter[search_volume_gte]': volume }),
    ...(difficulty === null ? {} : { 'filter[keyword_difficulty_lte]': difficulty }),
  };
}

/** One page of the tracked keywords: the list's own reads, and the poll that waits for first metrics. */
export async function readPage(scope: ProjectScope, query: ListQuery, signal: AbortSignal): Promise<ListPage> {
  return unwrap(
    api.GET(TRACKED, {
      params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId }, query },
      signal,
    }),
  );
}

export type ListMode = 'client' | 'server';

/** What Rankings shows: the rows at hand, how they were read, and how to move through them. */
export interface KeywordList {
  /** `null` until the first page tells how many keywords match. */
  mode: ListMode | null;
  rows: readonly TrackedKeywordRow[];
  /** Keywords the filters match; `null` before the first page. */
  total: number | null;
  /** Client mode while pages are still loading. */
  loadProgress: { loaded: number; total: number } | null;
  loading: boolean;
  /** The rows and total on screen still answer the previous filters while the new ones load. */
  stale: boolean;
  fetching: boolean;
  error: unknown;
  refetch: () => void;
  /** Client mode: a page after the first did not load, so the rows are not all there. */
  incomplete: { retry: () => void; retrying: boolean } | null;
  /** Server mode only. */
  server: ServerPages | null;
  /** Server mode: the request that reads the page asked for, which the poll for new metrics repeats. */
  pageRequest: ListQuery | null;
}

/** The page sizes Rankings offers: the API answers at most 200 rows a page. */
export const PAGE_SIZE_CHOICES: readonly PageSize[] = [100, 200];

export interface ServerPages {
  /** Where the page on screen starts: while the next page loads, the one before it keeps its offset. */
  offset: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previous: () => void;
  next: () => void;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
}

interface ListArgs {
  scope: ProjectScope;
  filters: KeywordFilters;
  /** The table's sort, which server mode sends. */
  sort: readonly SortKey[];
  /** The search, which server mode sends as `filter[q]` (already debounced). */
  search: string;
}

type AllPages = UseInfiniteQueryResult<InfiniteData<ListPage, string | null>>;

/** The rows of Rankings in the mode their count calls for. */
export function useKeywordList({ scope, filters, sort, search }: ListArgs): KeywordList {
  const all: AllPages = useInfiniteQuery({
    queryKey: allListKey(scope, filters),
    queryFn: ({ pageParam, signal }) =>
      readPage(
        scope,
        {
          ...filters,
          sort: LOAD_SORT,
          include: INCLUDE,
          limit: PAGE,
          ...(pageParam === null ? {} : { cursor: pageParam }),
        },
        signal,
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    // The rows stay while new filters load: no skeleton flash (12-tables.md section 7, 17 section 3.4)
    placeholderData: keepPreviousData,
    // Reading the whole list again costs a request per 200 rows, so it is read again when something wrote
    // to it (the writes invalidate it), not on every focus or visit
    staleTime: ALL_STALE_MS,
    refetchOnWindowFocus: false,
    // A combination of filters nobody looks at any more is not kept: each holds up to 10,000 rows
    gcTime: ALL_GC_MS,
  });
  // While new filters load, the previous answer keeps the mode, so server mode asks for its page at once
  const total = all.data?.pages[0]?.page.total ?? null;
  const mode: ListMode | null = total === null ? null : total <= CLIENT_MODE_LIMIT ? 'client' : 'server';

  // Client mode reads the rest of the pages one after another, never from the previous filters' pages. The
  // effect runs again with every page that lands, so it does not depend on seeing a flag change: the
  // notifications of a query arrive in batches, and a page can arrive in the same batch as the next fetch's
  // start. It waits while anything is being read (a refetch after a write included) and never cancels a
  // read under way: the page that follows is the one after the pages the refetch brought.
  const { hasNextPage, isFetching, isError, isPlaceholderData, fetchNextPage } = all;
  const loadedPages = all.data?.pages.length ?? 0;
  useEffect(() => {
    if (mode === 'client' && hasNextPage && !isFetching && !isError && !isPlaceholderData) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [mode, hasNextPage, isFetching, isError, isPlaceholderData, fetchNextPage, loadedPages]);
  const rows = useMemo(() => all.data?.pages.flatMap((page) => page.data) ?? [], [all.data]);

  const server = useServerPage({ scope, filters, sort, search }, mode === 'server');

  if (mode === 'server') {
    return {
      mode,
      rows: server.page?.data ?? [],
      total: server.page?.page.total ?? total,
      loadProgress: null,
      loading: server.page === null,
      stale: server.stale,
      fetching: server.fetching,
      error: server.error,
      refetch: server.refetch,
      incomplete: null,
      server: server.pages,
      pageRequest: server.request,
    };
  }
  return {
    mode,
    rows,
    total,
    loadProgress: total !== null && hasNextPage && !all.isFetchNextPageError ? { loaded: rows.length, total } : null,
    loading: all.isPending,
    stale: isPlaceholderData,
    fetching: all.isFetching,
    // A failed later page leaves the rows that loaded; the list says it is incomplete instead
    error: all.isFetchNextPageError ? null : all.error,
    refetch: () => void all.refetch(),
    incomplete: all.isFetchNextPageError
      ? { retry: () => void fetchNextPage({ cancelRefetch: false }), retrying: all.isFetchingNextPage }
      : null,
    server: null,
    pageRequest: null,
  };
}

/** Server mode: one page in the table's sort, moved through by cursor; back steps keep the cursors seen. */
function useServerPage(
  { scope, filters, sort, search }: ListArgs,
  enabled: boolean,
): {
  page: ListPage | null;
  stale: boolean;
  fetching: boolean;
  error: unknown;
  refetch: () => void;
  pages: ServerPages;
  request: ListQuery;
} {
  const [pageSize, setPageSize] = useState<PageSize>(PAGE);
  // The cursors of the pages visited, from the first (`null`); any change of what is asked starts over
  const asked = JSON.stringify([filters, formatSort(sort), search, pageSize]);
  const [visited, setVisited] = useState<{ asked: string; cursors: (string | null)[] }>({ asked, cursors: [null] });
  const cursors = visited.asked === asked ? visited.cursors : [null];
  const cursor = cursors.at(-1) ?? null;
  const query: ListQuery = {
    ...filters,
    include: INCLUDE,
    limit: pageSize,
    ...(sort.length === 0 ? {} : { sort: formatSort(sort) }),
    ...(search.trim() === '' ? {} : { 'filter[q]': search.trim() }),
    ...(cursor === null ? {} : { cursor }),
  };
  const offset = (cursors.length - 1) * pageSize;
  const result = useQuery({
    queryKey: pageListKey(scope, filters, query),
    // The page keeps its offset, so the range under the rows on screen is theirs while the next one loads
    queryFn: async ({ signal }): Promise<{ offset: number; page: ListPage }> => ({
      offset,
      page: await readPage(scope, query, signal),
    }),
    enabled,
    placeholderData: keepPreviousData,
  });
  const page = result.data?.page ?? null;
  // While a page loads, the page before it is still on screen: moving on from it would push its cursor again
  const showsAsked = !result.isPlaceholderData;
  return {
    page,
    stale: result.isPlaceholderData,
    fetching: result.isFetching,
    error: result.error,
    refetch: () => void result.refetch(),
    request: query,
    pages: {
      offset: result.data?.offset ?? offset,
      hasPrevious: cursors.length > 1,
      hasNext: page?.page.has_more ?? false,
      previous: () => {
        if (cursors.length > 1) setVisited({ asked, cursors: cursors.slice(0, -1) });
      },
      next: () => {
        const nextCursor = page?.page.next_cursor ?? null;
        if (showsAsked && nextCursor !== null && nextCursor !== cursor) {
          setVisited({ asked, cursors: [...cursors, nextCursor] });
        }
      },
      pageSize,
      setPageSize,
    },
  };
}

/** The project's tracked keywords in all, active ones, for the page's meta line. */
export function useTrackedCount(scope: ProjectScope): number | null {
  const result = useQuery({
    queryKey: countKey(scope),
    queryFn: ({ signal }) => readPage(scope, { limit: 1 }, signal),
  });
  return result.data?.page.total ?? null;
}
