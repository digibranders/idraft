import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiAllPagesQuery, apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { EngineCode, Schemas } from '@/lib/api/types';
import type { SourceScope } from './types';

/**
 * The five reads of the Citations page (WP-76; docs/19 "As built (AI visibility WP-76 ...)"). Every read takes the
 * same scope: each prompt and engine's last `runs` runs (D-2), the engines of the Platform choice (D-4) and the
 * Group's topic term (D-1). Cited pages is paged by offset, 200 rows a page (D-6).
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}' as const;
export const OVERVIEW = `${P}/ai/citation-overview` as const;
export const CITED_PAGES = `${P}/ai/cited-pages` as const;
export const CITED_PAGE = `${P}/ai/cited-pages/{url_id}` as const;
export const GAPS = `${P}/ai/citation-gaps` as const;
export const GAP = `${P}/ai/citation-gaps/{prompt_id}` as const;

export type CitationOverview = Schemas['CitationOverview'];
export type CitedPagePage = Schemas['CitedPagePage'];
export type CitedPagesMeta = Schemas['CitedPagesMeta'];
export type CitedPageRow = Schemas['CitedPageRow'];
export type CitedPageDetail = Schemas['CitedPageDetail'];
export type CitationGapList = Schemas['CitationGapList'];
export type CitationGapRow = Schemas['CitationGapRow'];
export type CitationGapDetail = Schemas['CitationGapDetail'];
export type RunWindow = Schemas['RunWindow'];
export type RunSlot = Schemas['RunSlot'];
export type DomainRole = CitedPageRow['domain_role'];
export type CitedPagesSort = NonNullable<NonNullable<paths[typeof CITED_PAGES]['get']['parameters']['query']>['sort']>;

/** 1, 2 or 4: the API checks it at runtime and types it as a number. */
export type RunsChoice = 1 | 2 | 4;

/** The scope every read takes. `engines` is never empty: All platforms sends the enabled engines. */
export interface BoardScopeParams {
  runs: RunsChoice;
  engines: readonly EngineCode[];
  /** A topic term id, or `null` for every group. */
  term: string | null;
}

/** What Cited pages adds: one role or none, the search, the sort. */
export interface PageListParams {
  role: DomainRole | null;
  q: string;
  sort: CitedPagesSort;
}

/** Rows a Cited pages read asks for (D-6; the API's limit is at most 200). */
export const PAGE_SIZE = 200;

const pathOf = (project: SourceScope): { workspace_id: string; project_id: string } => ({
  workspace_id: project.workspaceId,
  project_id: project.projectId,
});

export function sharedParams(scope: BoardScopeParams): {
  runs: number;
  'filter[engine_code_in]': EngineCode[];
  'filter[term]'?: string;
} {
  return {
    runs: scope.runs,
    'filter[engine_code_in]': [...scope.engines],
    ...(scope.term === null ? {} : { 'filter[term]': scope.term }),
  };
}

export const overviewQuery = (project: SourceScope, scope: BoardScopeParams): ApiQueryOptions<typeof OVERVIEW> =>
  apiQuery(OVERVIEW, { params: { path: pathOf(project), query: sharedParams(scope) } });

export const citedPageQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  urlId: number,
): ApiQueryOptions<typeof CITED_PAGE> =>
  apiQuery(CITED_PAGE, { params: { path: { ...pathOf(project), url_id: urlId }, query: sharedParams(scope) } });

export const gapsQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
): ApiQueryOptions<typeof GAPS> =>
  apiQuery(GAPS, {
    params: {
      path: pathOf(project),
      query: { ...sharedParams(scope), 'filter[competitor_id_in]': [...competitors] },
    },
  });

export const gapQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
  promptId: string,
): ApiQueryOptions<typeof GAP> =>
  apiQuery(GAP, {
    params: {
      path: { ...pathOf(project), prompt_id: promptId },
      query: { ...sharedParams(scope), 'filter[competitor_id_in]': [...competitors] },
    },
  });

/** The query of one page of Cited pages. */
export function citedPagesQueryParams(
  scope: BoardScopeParams,
  list: PageListParams,
  offset: number,
): NonNullable<paths[typeof CITED_PAGES]['get']['parameters']['query']> {
  return {
    ...sharedParams(scope),
    ...(list.role === null ? {} : { 'filter[domain_role_in]': list.role }),
    ...(list.q === '' ? {} : { q: list.q }),
    sort: list.sort,
    offset,
    limit: PAGE_SIZE,
  };
}

/** The cache key of the Cited pages list of a scope, under the project's key. */
export const citedPagesKey = (project: SourceScope, scope: BoardScopeParams, list: PageListParams): QueryKey => [
  ...projectKey(project.workspaceId, project.projectId),
  'cited-pages',
  sharedParams(scope),
  list,
];

/** One page of Cited pages from `offset`. */
export function readCitedPages(
  project: SourceScope,
  scope: BoardScopeParams,
  list: PageListParams,
  offset: number,
  signal: AbortSignal,
): Promise<CitedPagePage> {
  return unwrap(
    api.GET(CITED_PAGES, {
      params: { path: pathOf(project), query: citedPagesQueryParams(scope, list, offset) },
      signal,
    }),
  );
}

/** The offset of the page after `page`, or `undefined` when `page` holds the last row. */
export const nextOffset = (page: Schemas['OffsetPageInfo'], rows: number): number | undefined =>
  page.offset + rows < page.total ? page.offset + rows : undefined;

/** Every row of Cited pages for the scope, for Export (read page after page). */
export const allCitedPagesQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  list: PageListParams,
): ApiQueryOptions<typeof CITED_PAGES> =>
  apiAllPagesQuery(CITED_PAGES, (row) => String(row.url_id), {
    params: { path: pathOf(project), query: citedPagesQueryParams(scope, list, 0) },
  });
