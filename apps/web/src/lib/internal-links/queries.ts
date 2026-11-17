import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { projectKey, workspaceKey, type QueryKey } from '@/lib/api/keys';
import { READ_LIMIT, type Direction } from './journey-layout';
import type { LinkScope, Placement } from './scopes';
import type {
  EdgeWorklist,
  LinksScope,
  PageFilter,
  PageFlagFilter,
  PageSort,
  PageWorklist,
  StatusClass,
} from './types';

/**
 * The reads of Internal links (the backend OpenAPI), as `apiQuery` options. Every key starts with the project,
 * so `internalLinksKeys` reaches them after a write, and `crawlKeys` reaches the crawl list.
 */

const W = '/api/v1/workspaces/{workspace_id}';
// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PAGES = `${P}/internal-links/pages` as const;
const PAGE = `${P}/internal-links/pages/{url_id}` as const;
const EDGES = `${P}/internal-links/edges` as const;
const NEIGHBORS = `${P}/internal-links/neighbors` as const;
const FLOW = `${P}/internal-links/tier-flow` as const;
const WORKLISTS = `${P}/internal-links/worklists` as const;
const CRAWLS = `${P}/link-crawls` as const;
const SETTINGS = `${P}/settings` as const;
const RULES = `${P}/tier-rules` as const;
const TIERS = `${W}/page-tiers` as const;

/** The edges list path with its ids filled in, for the CSV download (decision W13). */
export const edgesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/edges`;

/** Rows a page of the Pages and Links tables asks for (decision W6). */
export const PAGE_LIMIT = 100;
/** The crawls the header and the settings list read. */
export const CRAWL_LIMIT = 10;

const pathOf = (scope: LinksScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

/** A url id the API cannot be sent, or that is no id at all. */
export class UrlIdError extends Error {
  override readonly name = 'UrlIdError';
}

/**
 * A `core.urls` id for the API. The answers give the 64-bit id as a string, but the generated client types
 * every request id (`url_id`, `filter[source]`, `filter[target]`, `url_ids`) as a number, so this is the one
 * place a string id becomes a number. An id a number cannot hold exactly is refused, never rounded to another
 * page's id. Every request that carries an id goes through here.
 */
export function urlIdNumber(urlId: string): number {
  if (!/^[1-9][0-9]*$/.test(urlId)) throw new UrlIdError(`Not a url id: ${urlId}`);
  const id = Number(urlId);
  if (!Number.isSafeInteger(id)) {
    throw new UrlIdError(
      `Url id ${urlId} is too large for the API client (at most ${String(Number.MAX_SAFE_INTEGER)})`,
    );
  }
  return id;
}

export interface PageQuery {
  scope: LinkScope;
  tierIds: readonly string[];
  tagIds: readonly string[];
  status: readonly StatusClass[];
  indexable: boolean | null;
  flags: readonly PageFlagFilter[];
  worklist: PageWorklist | null;
  q: string | null;
  sort: PageSort;
  cursor: string | null;
  limit: number;
}

export const DEFAULT_PAGE_QUERY: PageQuery = {
  scope: 'editorial',
  tierIds: [],
  tagIds: [],
  status: [],
  indexable: null,
  flags: [],
  worklist: null,
  q: null,
  sort: '-linking_pages',
  cursor: null,
  limit: PAGE_LIMIT,
};

/** The query values of the pages list; anything unset is left out, as the address leaves it out. */
export function pageParams(query: PageQuery) {
  return {
    scope: query.scope,
    sort: query.sort,
    limit: query.limit,
    ...(query.tierIds.length === 0 ? {} : { 'filter[tier]': [...query.tierIds] }),
    ...(query.tagIds.length === 0 ? {} : { 'filter[tag]': [...query.tagIds] }),
    ...(query.status.length === 0 ? {} : { 'filter[status]': [...query.status] }),
    ...(query.indexable === null ? {} : { 'filter[indexable]': query.indexable }),
    ...(query.flags.length === 0 ? {} : { 'filter[flags]': [...query.flags] }),
    ...(query.worklist === null ? {} : { 'filter[worklist]': query.worklist }),
    ...(query.q === null ? {} : { q: query.q }),
    ...(query.cursor === null ? {} : { cursor: query.cursor }),
  };
}

/** The same selection as a bulk body's `filter` ("Select all N matching", always the latest crawl). */
export function pageFilterOf(query: PageQuery): PageFilter {
  return {
    ...(query.tierIds.length === 0 ? {} : { tier_ids: [...query.tierIds] }),
    ...(query.tagIds.length === 0 ? {} : { tag_ids: [...query.tagIds] }),
    ...(query.status.length === 0 ? {} : { status: [...query.status] }),
    ...(query.indexable === null ? {} : { indexable: query.indexable }),
    ...(query.flags.length === 0 ? {} : { flags: [...query.flags] }),
    ...(query.worklist === null ? {} : { worklist: query.worklist }),
    ...(query.q === null ? {} : { q: query.q }),
  };
}

export const pagesQuery = (scope: LinksScope, query: PageQuery): ApiQueryOptions<typeof PAGES> =>
  apiQuery(PAGES, { params: { path: pathOf(scope), query: pageParams(query) } });

export const pageDetailQuery = (scope: LinksScope, urlId: string, linkScope: LinkScope): ApiQueryOptions<typeof PAGE> =>
  apiQuery(PAGE, { params: { path: { ...pathOf(scope), url_id: urlIdNumber(urlId) }, query: { scope: linkScope } } });

export interface EdgeQuery {
  scope: LinkScope;
  sourceTierIds: readonly string[];
  targetTierIds: readonly string[];
  tagIds: readonly string[];
  placements: readonly Placement[];
  targetStatus: readonly StatusClass[];
  source: string | null;
  target: string | null;
  worklist: EdgeWorklist | null;
  qSource: string | null;
  qTarget: string | null;
  cursor: string | null;
  limit: number;
}

export const DEFAULT_EDGE_QUERY: EdgeQuery = {
  scope: 'editorial',
  sourceTierIds: [],
  targetTierIds: [],
  tagIds: [],
  placements: [],
  targetStatus: [],
  source: null,
  target: null,
  worklist: null,
  qSource: null,
  qTarget: null,
  cursor: null,
  limit: PAGE_LIMIT,
};

export function edgeParams(query: EdgeQuery) {
  return {
    scope: query.scope,
    limit: query.limit,
    ...(query.sourceTierIds.length === 0 ? {} : { 'filter[source_tier]': [...query.sourceTierIds] }),
    ...(query.targetTierIds.length === 0 ? {} : { 'filter[target_tier]': [...query.targetTierIds] }),
    ...(query.tagIds.length === 0 ? {} : { 'filter[tag]': [...query.tagIds] }),
    ...(query.placements.length === 0 ? {} : { 'filter[placement]': [...query.placements] }),
    ...(query.targetStatus.length === 0 ? {} : { 'filter[target_status]': [...query.targetStatus] }),
    ...(query.source === null ? {} : { 'filter[source]': urlIdNumber(query.source) }),
    ...(query.target === null ? {} : { 'filter[target]': urlIdNumber(query.target) }),
    ...(query.worklist === null ? {} : { 'filter[worklist]': query.worklist }),
    ...(query.qSource === null ? {} : { q_source: query.qSource }),
    ...(query.qTarget === null ? {} : { q_target: query.qTarget }),
    ...(query.cursor === null ? {} : { cursor: query.cursor }),
  };
}

export const edgesQuery = (scope: LinksScope, query: EdgeQuery): ApiQueryOptions<typeof EDGES> =>
  apiQuery(EDGES, { params: { path: pathOf(scope), query: edgeParams(query) } });

/** One page of `READ_LIMIT` neighbors (decision W7). */
export const neighborsQuery = (
  scope: LinksScope,
  {
    urlId,
    direction,
    linkScope,
    offset,
  }: { urlId: string; direction: Direction; linkScope: LinkScope; offset: number },
): ApiQueryOptions<typeof NEIGHBORS> =>
  apiQuery(NEIGHBORS, {
    params: {
      path: pathOf(scope),
      query: {
        url_id: urlIdNumber(urlId),
        direction,
        scope: linkScope,
        limit: READ_LIMIT,
        ...(offset === 0 ? {} : { offset }),
      },
    },
  });

export const tierFlowQuery = (scope: LinksScope, linkScope: LinkScope): ApiQueryOptions<typeof FLOW> =>
  apiQuery(FLOW, { params: { path: pathOf(scope), query: { scope: linkScope } } });

export const worklistsQuery = (scope: LinksScope): ApiQueryOptions<typeof WORKLISTS> =>
  apiQuery(WORKLISTS, { params: { path: pathOf(scope) } });

/** The latest crawls, newest first. */
export const crawlsQuery = (scope: LinksScope): ApiQueryOptions<typeof CRAWLS> =>
  apiQuery(CRAWLS, { params: { path: pathOf(scope), query: { limit: CRAWL_LIMIT } } });

/**
 * The project's settings, which hold the internal links part (`internal_links`). The same request, and so the same
 * cache entry, as the keyword defaults section reads.
 */
export const linkSettingsQuery = (scope: LinksScope): ApiQueryOptions<typeof SETTINGS> =>
  apiQuery(SETTINGS, { params: { path: pathOf(scope) } });

export const tierRulesQuery = (scope: LinksScope): ApiQueryOptions<typeof RULES> =>
  apiQuery(RULES, { params: { path: pathOf(scope) } });

export const pageTiersQuery = (workspaceId: string): ApiQueryOptions<typeof TIERS> =>
  apiQuery(TIERS, { params: { path: { workspace_id: workspaceId } } });

/** What a crawl request or cancel makes stale: the crawl list. */
export const crawlKeys = (scope: LinksScope): QueryKey[] => [
  [...projectKey(scope.workspaceId, scope.projectId), 'link-crawls'],
];

/**
 * What a tier, rule or tag change makes stale (spec 6.6): every read of the project's internal links, its rules,
 * and the workspace's tier list (its page counts).
 */
export function internalLinksKeys(scope: LinksScope): QueryKey[] {
  const project = projectKey(scope.workspaceId, scope.projectId);
  return [
    [...project, 'internal-links'],
    [...project, 'tier-rules'],
    [...workspaceKey(scope.workspaceId), 'page-tiers'],
  ];
}
