import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { projectKey, workspaceKey, type QueryKey } from '@/lib/api/keys';
import type { paths } from '@/lib/api/schema';
import { READ_LIMIT, type Direction } from './journey-layout';
import type { LinkScope, Placement } from './scopes';
import type {
  EdgeWorklist,
  LinksScope,
  PageFilter,
  PageFlagFilter,
  PageRowPage,
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

/** The query parameters the generated client takes for the two lists. */
type PagesParams = NonNullable<paths[typeof PAGES]['get']['parameters']['query']>;
type EdgesParams = NonNullable<paths[typeof EDGES]['get']['parameters']['query']>;

/** The pages list path with its ids filled in, for the CSV download (decision W13). */
export const pagesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/pages`;

/** The edges list path with its ids filled in, for the CSV download (decision W13). */
export const edgesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/edges`;

/** Rows a page of the Pages and Links tables asks for (decision W6). */
export const PAGE_LIMIT = 100;
/** The crawls the project settings list reads. */
export const CRAWL_LIMIT = 10;
/**
 * The crawls the Internal links screen reads (the API takes up to 200). The screen finds the latest finished
 * crawl among them (`is_latest`), and the API marks it apart from the page, so it must be read wide enough that a
 * run of failed crawls does not push the latest one off it.
 */
export const CRAWL_SCREEN_LIMIT = 50;

const pathOf = (scope: LinksScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

/** A text that is not a url id the API takes. */
export class UrlIdError extends Error {
  override readonly name = 'UrlIdError';
}

const INT64_MAX = 9223372036854775807n;

/**
 * A `core.urls` id for the API: a positive whole number of at most int64, as digits without a leading zero
 * (the server refuses anything else with a 422). Ids travel as strings both ways, and the limit is compared
 * as a BigInt, so no id is rounded to another page's. Every request that carries an id goes through here
 * (`url_id`, `filter[source]`, `filter[target]`, bulk `url_ids`).
 */
export function checkUrlId(urlId: string): string {
  if (!/^[1-9][0-9]*$/.test(urlId) || BigInt(urlId) > INT64_MAX) throw new UrlIdError(`Not a url id: ${urlId}`);
  return urlId;
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
export function pageParams(query: PageQuery): PagesParams {
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The pages list's 200 declares a JSON body and a CSV body in the OpenAPI, so the generated type of its answer is
 * `unknown`. The JSON read (never `format=csv`, which goes through `downloadApiFile`) is checked here, at the
 * boundary: the parts every reader uses (`data`, `page` with its cursor, `meta`), not each row.
 */
export function isPageRowPage(value: unknown): value is PageRowPage {
  if (!isRecord(value)) return false;
  const { data, page, meta } = value;
  return (
    Array.isArray(data) &&
    isRecord(page) &&
    typeof page.has_more === 'boolean' &&
    (page.next_cursor === null || typeof page.next_cursor === 'string') &&
    isRecord(meta) &&
    typeof meta.total === 'number' &&
    typeof meta.run_id === 'string'
  );
}

/**
 * One page, the inspector. Throws `UrlIdError` for an id that is no url id: a screen that reads the id from the
 * address validates it first (`checkUrlId`) and shows not found, instead of letting the builder throw.
 */
export const pageDetailQuery = (scope: LinksScope, urlId: string, linkScope: LinkScope): ApiQueryOptions<typeof PAGE> =>
  apiQuery(PAGE, { params: { path: { ...pathOf(scope), url_id: checkUrlId(urlId) }, query: { scope: linkScope } } });

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

/** The query values of the edges list. Throws `UrlIdError` for a `source` or `target` that is no url id. */
export function edgeParams(query: EdgeQuery): EdgesParams {
  return {
    scope: query.scope,
    limit: query.limit,
    ...(query.sourceTierIds.length === 0 ? {} : { 'filter[source_tier]': [...query.sourceTierIds] }),
    ...(query.targetTierIds.length === 0 ? {} : { 'filter[target_tier]': [...query.targetTierIds] }),
    ...(query.tagIds.length === 0 ? {} : { 'filter[tag]': [...query.tagIds] }),
    ...(query.placements.length === 0 ? {} : { 'filter[placement]': [...query.placements] }),
    ...(query.targetStatus.length === 0 ? {} : { 'filter[target_status]': [...query.targetStatus] }),
    ...(query.source === null ? {} : { 'filter[source]': checkUrlId(query.source) }),
    ...(query.target === null ? {} : { 'filter[target]': checkUrlId(query.target) }),
    ...(query.worklist === null ? {} : { 'filter[worklist]': query.worklist }),
    ...(query.qSource === null ? {} : { q_source: query.qSource }),
    ...(query.qTarget === null ? {} : { q_target: query.qTarget }),
    ...(query.cursor === null ? {} : { cursor: query.cursor }),
  };
}

export const edgesQuery = (scope: LinksScope, query: EdgeQuery): ApiQueryOptions<typeof EDGES> =>
  apiQuery(EDGES, { params: { path: pathOf(scope), query: edgeParams(query) } });

/**
 * One page of `READ_LIMIT` neighbors (decision W7). Throws `UrlIdError` for an id that is no url id: a screen that
 * reads the focus from the address validates it first (`checkUrlId`) and shows not found.
 */
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
        url_id: checkUrlId(urlId),
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

/** The latest crawls, newest first: `limit` of them (`CRAWL_LIMIT` for a list, `CRAWL_SCREEN_LIMIT` for the screen). */
export const crawlsQuery = (scope: LinksScope, limit: number = CRAWL_LIMIT): ApiQueryOptions<typeof CRAWLS> =>
  apiQuery(CRAWLS, { params: { path: pathOf(scope), query: { limit } } });

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

/**
 * What a crawl request or cancel makes stale: the crawl list. A crawl that turns ready needs `crawlFinishedKeys`.
 */
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

/**
 * What a crawl turning ready makes stale: the crawl list, every read of the links (a new crawl is the latest one)
 * and the project settings document (which holds the internal links settings).
 */
export const crawlFinishedKeys = (scope: LinksScope): QueryKey[] => [
  ...crawlKeys(scope),
  ...internalLinksKeys(scope),
  [...projectKey(scope.workspaceId, scope.projectId), 'settings'],
];
