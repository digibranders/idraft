'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { ENGINE_ORDER } from '@/components/app/engine/order';
import { isApiProblem } from '@/lib/api/problem';
import { apiQuery } from '@/lib/api/query';
import type { EngineCode } from '@/lib/api/types';
import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';
import {
  citedPageQuery,
  citedPagesKey,
  gapQuery,
  gapsQuery,
  nextOffset,
  overviewQuery,
  readCitedPages,
  type BoardScopeParams,
  type CitationGapDetail,
  type CitationGapList,
  type CitationOverview,
  type CitedPageDetail,
  type CitedPageRow,
  type CitedPagesMeta,
  type PageListParams,
} from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';
import { projectEntitiesQuery } from '@/lib/entities/project-entities';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';

/**
 * The reads of the Citations page. Each loads and fails on its own, keeps its last answer while a new scope is read
 * (`keepPreviousData`; 17 section 3, Loading: no dimming, the 2 px refetch bar), and says so in `refetching`.
 */

export interface BoardRead<T> {
  status: 'loading' | 'error' | 'ready';
  data: T | undefined;
  /** A new scope is being read while the last answer stays on screen. */
  refetching: boolean;
  /** The API answered 404: a drawer's page or prompt has nothing in this scope (WP-76), which is an answer. */
  notFound: boolean;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

function useRead<T>(query: UseQueryResult<T>): BoardRead<T> {
  const errorId = useErrorId(query.error);
  return {
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    data: query.data,
    refetching: query.isFetching && query.data !== undefined,
    notFound: isApiProblem(query.error) && query.error.status === 404,
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}

export interface BoardEngine {
  code: EngineCode;
  label: string;
}

const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines';

/** The enabled engines in code order (D-4); `null` while unknown, so no read asks "every engine" by mistake. */
export function useBoardEngines(project: SourceScope): {
  engines: readonly BoardEngine[] | null;
  read: BoardRead<unknown>;
} {
  const query = useQuery(
    apiQuery(ENGINES, { params: { path: { workspace_id: project.workspaceId, project_id: project.projectId } } }),
  );
  const read = useRead(query);
  const engines = useMemo(
    () =>
      query.data === undefined
        ? null
        : query.data.data
            .filter((engine) => engine.is_enabled)
            .map((engine) => ({ code: engine.engine.engine_code, label: engine.engine.label }))
            .sort((a, b) => ENGINE_ORDER.indexOf(a.code) - ENGINE_ORDER.indexOf(b.code)),
    [query.data],
  );
  return { engines, read };
}

export interface TrackedCompetitor {
  id: string;
  name: string;
  colorIndex: number | null;
  /** The registrable domain the popover and the gap header name; `null` when the entity has none. */
  domain: string | null;
}

/** The tracked competitors in Settings order (D-7) and the own brand's name; `null` while unknown. */
export function useTracked(project: SourceScope): {
  tracked: readonly TrackedCompetitor[] | null;
  ownName: string | null;
  read: BoardRead<unknown>;
} {
  const query = useQuery(projectEntitiesQuery(project));
  const read = useRead(query);
  // Memoized on the answer alone, so `tracked` keeps its identity between renders (the URL state depends on it)
  const lists = useMemo(() => {
    if (query.data === undefined) return { tracked: null, ownName: null };
    const live = query.data.data.filter((row) => row.removed_at === null);
    const own = live.find((row) => row.role === 'own' && row.is_primary) ?? live.find((row) => row.role === 'own');
    return {
      tracked: live
        .filter((row) => row.role === 'competitor')
        .map((row) => ({
          id: row.entity.entity_id,
          name: row.entity.canonical_name,
          colorIndex: row.color_index,
          domain: row.domains.find((domain) => domain.match_scope !== 'path_prefix')?.domain.registrable_domain ?? null,
        })),
      ownName: own?.entity.canonical_name ?? null,
    };
  }, [query.data]);
  return { ...lists, read };
}

export interface TopicTerm {
  id: string;
  name: string;
}

/** The topic terms of the project (D-1), depth first; `null` while the vocabularies load. */
export function useTopicTerms(project: SourceScope): {
  terms: readonly TopicTerm[] | null;
  ids: ReadonlySet<string> | null;
} {
  const vocabularies = useVocabularies(project);
  return useMemo(() => {
    if (vocabularies.pending && vocabularies.loaded.length === 0) return { terms: null, ids: null };
    const terms = vocabularies.loaded
      .filter((entry) => entry.vocabulary.kind === 'topic')
      .flatMap((entry) => entry.terms.map((term) => ({ id: term.termId, name: term.name })));
    return { terms, ids: new Set(terms.map((term) => term.id)) };
  }, [vocabularies.loaded, vocabularies.pending]);
}

export function useOverview(
  project: SourceScope,
  scope: BoardScopeParams,
  enabled: boolean,
): BoardRead<CitationOverview> {
  return useRead(useQuery({ ...overviewQuery(project, scope), placeholderData: keepPreviousData, enabled }));
}

/** The key without its last element, the normalized query: the path, so the entity of a detail read. */
const entityOf = (key: QueryKey): string => JSON.stringify(key.slice(0, -1));

/** The competitors a key asks about; `''` when it has none. */
function competitorsOf(key: QueryKey): string {
  const query: unknown = key.at(-1);
  return typeof query === 'object' && query !== null && 'filter[competitor_id_in]' in query
    ? JSON.stringify(query['filter[competitor_id_in]'])
    : '';
}

/**
 * `placeholderData` that keeps the last answer only while `same` says the new read asks for the same thing in a new
 * scope. Another page, prompt or competitor set shows the skeleton, not the last one's data under the new heading.
 */
function keepWhile<T>(next: QueryKey, same: (previous: QueryKey, next: QueryKey) => boolean) {
  return (data: T | undefined, query: { queryKey: QueryKey } | undefined): T | undefined =>
    query !== undefined && same(query.queryKey, next) ? data : undefined;
}

export function useGaps(
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
  enabled: boolean,
): BoardRead<CitationGapList> {
  const options = gapsQuery(project, scope, competitors);
  // Never asked with no competitor: the empty state shows instead (brief section 4)
  return useRead(
    useQuery({
      ...options,
      // The columns come from the new competitors: the old rows would read as "n/a" under them
      placeholderData: keepWhile<CitationGapList>(
        options.queryKey,
        (previous, next) => competitorsOf(previous) === competitorsOf(next),
      ),
      enabled: enabled && competitors.length > 0,
    }),
  );
}

export function useCitedPage(
  project: SourceScope,
  scope: BoardScopeParams,
  urlId: number | null,
): BoardRead<CitedPageDetail> {
  const options = citedPageQuery(project, scope, urlId ?? 0);
  return useRead(
    useQuery({
      ...options,
      placeholderData: keepWhile<CitedPageDetail>(
        options.queryKey,
        (previous, next) => entityOf(previous) === entityOf(next),
      ),
      enabled: urlId !== null,
      // A 404 is an answer (the page is not cited in this scope), not a failure to retry
      retry: false,
    }),
  );
}

export function useGap(
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
  promptId: string | null,
): BoardRead<CitationGapDetail> {
  const options = gapQuery(project, scope, competitors, promptId ?? '');
  return useRead(
    useQuery({
      ...options,
      placeholderData: keepWhile<CitationGapDetail>(
        options.queryKey,
        (previous, next) => entityOf(previous) === entityOf(next) && competitorsOf(previous) === competitorsOf(next),
      ),
      enabled: promptId !== null && competitors.length > 0,
      retry: false,
    }),
  );
}

export interface CitedPagesRead {
  status: 'loading' | 'error' | 'ready';
  rows: readonly CitedPageRow[];
  meta: CitedPagesMeta | undefined;
  /** Rows the role and the search keep, every page. */
  total: number | null;
  refetching: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

/** Cited pages: server sorted, searched and paged, the next page on demand (D-6). */
export function useCitedPages(
  project: SourceScope,
  scope: BoardScopeParams,
  list: PageListParams,
  enabled: boolean,
): CitedPagesRead {
  const query = useInfiniteQuery({
    queryKey: citedPagesKey(project, scope, list),
    queryFn: ({ pageParam, signal }) => readCitedPages(project, scope, list, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => nextOffset(last.page, last.data.length),
    placeholderData: keepPreviousData,
    enabled,
  });
  const errorId = useErrorId(query.error);
  // A page read after the list shifted can repeat a row of the one before: each page shows once
  const rows = useMemo(() => {
    const seen = new Set<number>();
    return (query.data?.pages.flatMap((page) => page.data) ?? []).filter((row) => {
      if (seen.has(row.url_id)) return false;
      seen.add(row.url_id);
      return true;
    });
  }, [query.data]);
  const first = query.data?.pages[0];
  return {
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    rows,
    meta: first?.meta,
    total: first?.page.total ?? null,
    refetching: query.isFetching && !query.isFetchingNextPage && query.data !== undefined,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      // Not while the rows on screen are the last scope's: their next page belongs to that scope
      if (query.hasNextPage && !query.isFetchingNextPage && !query.isPlaceholderData) void query.fetchNextPage();
    },
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}
