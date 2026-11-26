import { queryOptions, type UseQueryOptions } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { projectKey, workspaceKey, type QueryKey } from '@/lib/api/keys';
import type { paths } from '@/lib/api/schema';
import { READ_LIMIT, type Direction } from './journey-layout';
import type { LinkScope, Placement } from './scopes';
import type { DownloadQuery } from '@/lib/api/download';
import type {
  ChangeKind,
  ChangeLinkPage,
  ChangeOnly,
  ChangeScope,
  EdgeRowPage,
  EdgeWorklist,
  LinksScope,
  OpportunityPage,
  OpportunityStatus,
  PageFilter,
  PageFlagFilter,
  PageInclude,
  PageRowPage,
  PageSort,
  PageWorklist,
  StatusClass,
  TierRulePreview,
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
const GRAPH = `${P}/internal-links/graph` as const;
const WORKLISTS = `${P}/internal-links/worklists` as const;
const CHANGES_SUMMARY = `${P}/internal-links/changes/summary` as const;
const CHANGES_LINKS = `${P}/internal-links/changes/links` as const;
const CHANGES_PAGES = `${P}/internal-links/changes/pages` as const;
const OPPORTUNITIES = `${P}/internal-links/opportunities` as const;
const SUGGESTIONS = `${P}/internal-links/tier-suggestions` as const;
const ROUTES = `${P}/internal-links/paths` as const;
const CRAWLS = `${P}/link-crawls` as const;
const SETTINGS = `${P}/settings` as const;
const RULES = `${P}/tier-rules` as const;
const PREVIEW = `${P}/tier-rules/preview` as const;
const TIERS = `${W}/page-tiers` as const;
const SHARES = `${P}/internal-links/shares` as const;
const PUBLIC_SUMMARY = '/api/v1/public/internal-links/summary/{token}' as const;

/** The query parameters the generated client takes for the two lists. */
type PagesParams = NonNullable<paths[typeof PAGES]['get']['parameters']['query']>;
type EdgesParams = NonNullable<paths[typeof EDGES]['get']['parameters']['query']>;
type ChangeLinksParams = paths[typeof CHANGES_LINKS]['get']['parameters']['query'];
type OpportunityParams = NonNullable<paths[typeof OPPORTUNITIES]['get']['parameters']['query']>;

/**
 * The `run` parameter of every read: a chosen crawl, or none for the latest (the address's `run`). Left out for
 * the latest, so the latest crawl has one cache entry, and a crawl chosen has its own.
 */
export const withRun = <T extends object>(params: T, run: string | null): T & { run?: string } =>
  run === null ? params : { ...params, run };

/** A CSV download of a selection: the same query without its window (`offset`, `limit`), as `format=csv`. */
const csvOf = (params: object): DownloadQuery => {
  const wanted: Record<string, DownloadQuery[string]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'limit' && key !== 'offset' && value !== undefined && value !== null) wanted[key] = value;
  }
  return { ...wanted, format: 'csv' };
};

/** The lost and added links path with its ids filled in, for the CSV download (decision W13). */
export const changeLinksPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/changes/links`;

/** The opportunities path with its ids filled in, for the filtered CSV and the planned fixes download. */
export const opportunitiesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/opportunities`;

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
  /** The parts to add to each row as `extras`, from `moreIncludes`. */
  include: readonly PageInclude[];
  cursor: string | null;
  limit: number;
}

/** Which `include` parts the visible optional columns need (the column ids of `page-columns.tsx`). */
export function moreIncludes(visible: readonly string[]): PageInclude[] {
  const want = new Set<PageInclude>();
  for (const id of visible) {
    if (id === 'change') want.add('changes');
    if (id === 'rank' || id === 'keywords') want.add('keywords');
    if (id === 'citations') want.add('citations');
    if (id === 'anchors' || id === 'matches') want.add('anchors');
    if (id === 'clicks' || id === 'impressions') want.add('gsc');
  }
  const order: PageInclude[] = ['changes', 'keywords', 'citations', 'anchors', 'gsc'];
  return order.filter((part) => want.has(part));
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
  include: [],
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
    ...(query.include.length === 0 ? {} : { include: [...query.include] }),
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
    // Variants are left out; asking for the `variant` flag lists only them
    include_variants: false,
  };
}

export const pagesQuery = (scope: LinksScope, query: PageQuery, run: string | null): ApiQueryOptions<typeof PAGES> =>
  apiQuery(PAGES, { params: { path: pathOf(scope), query: withRun(pageParams(query), run) } });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The pages list's 200 declares a JSON body and a CSV body in the OpenAPI, so the generated type of its answer is
 * `unknown`. The JSON read (never `format=csv`, which goes through `downloadApiFile`) is checked here, at the
 * boundary: the parts every reader uses (`data`, `page` with its cursor, `meta`), not each row.
 */
export function isPageRowPage(value: unknown): value is PageRowPage {
  return hasCursorShape(value);
}

/**
 * The edges list answers the same way (JSON and CSV declared, so `unknown`): the same parts are checked. As with
 * `isPageRowPage`, the rows themselves are trusted past the envelope.
 */
export function isEdgeRowPage(value: unknown): value is EdgeRowPage {
  return hasCursorShape(value);
}

function hasCursorShape(value: unknown): boolean {
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
export const pageDetailQuery = (
  scope: LinksScope,
  urlId: string,
  linkScope: LinkScope,
  run: string | null,
): ApiQueryOptions<typeof PAGE> =>
  apiQuery(PAGE, {
    params: { path: { ...pathOf(scope), url_id: checkUrlId(urlId) }, query: withRun({ scope: linkScope }, run) },
  });

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

export const edgesQuery = (scope: LinksScope, query: EdgeQuery, run: string | null): ApiQueryOptions<typeof EDGES> =>
  apiQuery(EDGES, { params: { path: pathOf(scope), query: withRun(edgeParams(query), run) } });

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
  run: string | null,
): ApiQueryOptions<typeof NEIGHBORS> =>
  apiQuery(NEIGHBORS, {
    params: {
      path: pathOf(scope),
      query: withRun(
        {
          url_id: checkUrlId(urlId),
          direction,
          scope: linkScope,
          limit: READ_LIMIT,
          ...(offset === 0 ? {} : { offset }),
        },
        run,
      ),
    },
  });

export const tierFlowQuery = (
  scope: LinksScope,
  linkScope: LinkScope,
  run: string | null,
): ApiQueryOptions<typeof FLOW> =>
  apiQuery(FLOW, { params: { path: pathOf(scope), query: withRun({ scope: linkScope }, run) } });

/** The most pages the Link map draws (plan 11, W3): the canvas stays smooth to about this many. */
export const MAP_MAX_PAGES = 3000;

/** The whole crawl as the Link map's nodes and edges. A finished crawl never changes, so the answer is kept. */
export const linkGraphQuery = (
  scope: LinksScope,
  includeAuto: boolean,
  run: string | null,
): ApiQueryOptions<typeof GRAPH> => ({
  ...apiQuery(GRAPH, {
    params: { path: pathOf(scope), query: withRun({ include_auto: includeAuto, max_pages: MAP_MAX_PAGES }, run) },
  }),
  staleTime: run === null ? 60_000 : Number.POSITIVE_INFINITY,
});

export const worklistsQuery = (scope: LinksScope, run: string | null): ApiQueryOptions<typeof WORKLISTS> =>
  apiQuery(WORKLISTS, { params: { path: pathOf(scope), query: withRun({}, run) } });

/** Rows a page of the lost and added links table and the opportunities table asks for (offset paging, 200 at most). */
export const CHANGE_LIMIT = 50;
/** Moved pages the Changes tab lists (the API takes up to 50). */
export const MOVED_LIMIT = 8;

export interface ChangeLinksQuery {
  change: ChangeKind;
  linkScope: ChangeScope;
  only: ChangeOnly;
  offset: number;
  limit: number;
}

/** The query values of the lost and added links, `run` added when a crawl is chosen. */
export function changeLinksParams(query: ChangeLinksQuery, run: string | null): ChangeLinksParams {
  return withRun(
    {
      change: query.change,
      link_scope: query.linkScope,
      only: query.only,
      offset: query.offset,
      limit: query.limit,
    },
    run,
  );
}

/** The server's CSV of the same selection, every row (no window). */
export const changeLinksExportQuery = (query: ChangeLinksQuery, run: string | null): DownloadQuery =>
  csvOf(changeLinksParams(query, run));

export interface OpportunitiesQuery {
  status: OpportunityStatus | null;
  /** A tier position `1` to `8`, or `none` for pages without a tier. */
  tier: string | null;
  q: string | null;
  offset: number;
  limit: number;
}

/** The query values of the opportunities list; anything unset is left out. */
export function opportunitiesParams(query: OpportunitiesQuery, run: string | null): OpportunityParams {
  return withRun(
    {
      offset: query.offset,
      limit: query.limit,
      ...(query.status === null ? {} : { status: query.status }),
      ...(query.tier === null ? {} : { 'filter[target_tier]': query.tier }),
      ...(query.q === null ? {} : { q: query.q }),
    },
    run,
  );
}

/** The server's CSV of the filtered opportunities, every row. */
export const opportunitiesExportQuery = (query: OpportunitiesQuery, run: string | null): DownloadQuery =>
  csvOf(opportunitiesParams(query, run));

/** The planned fixes CSV: the accepted rows, or every open row when none is accepted. */
export const plannedExportQuery = (run: string | null): DownloadQuery => withRun({ export: 'planned' }, run);

/**
 * The two reads below answer JSON or CSV in the OpenAPI, so their typed answer is `unknown`, as the pages list's
 * is. These check the envelope the screens read (`data`, `meta` with its run id and total), not each row.
 */
export function isChangeLinkPage(value: unknown): value is ChangeLinkPage {
  return isRecord(value) && Array.isArray(value.data) && hasRunAndTotal(value.meta);
}

export function isOpportunityPage(value: unknown): value is OpportunityPage {
  return isRecord(value) && Array.isArray(value.data) && hasRunAndTotal(value.meta) && isRecord(value.meta.counts);
}

function hasRunAndTotal(meta: unknown): meta is Record<string, unknown> {
  return isRecord(meta) && typeof meta.run_id === 'string' && typeof meta.total === 'number';
}

export const changesSummaryQuery = (scope: LinksScope, run: string | null): ApiQueryOptions<typeof CHANGES_SUMMARY> =>
  apiQuery(CHANGES_SUMMARY, { params: { path: pathOf(scope), query: withRun({}, run) } });

export const changeLinksQuery = (
  scope: LinksScope,
  query: ChangeLinksQuery,
  run: string | null,
): ApiQueryOptions<typeof CHANGES_LINKS> =>
  apiQuery(CHANGES_LINKS, { params: { path: pathOf(scope), query: changeLinksParams(query, run) } });

/** The pages whose links in, equity or depth moved most, `limit` of them. */
export const movedPagesQuery = (
  scope: LinksScope,
  run: string | null,
  limit: number = MOVED_LIMIT,
): ApiQueryOptions<typeof CHANGES_PAGES> =>
  apiQuery(CHANGES_PAGES, { params: { path: pathOf(scope), query: withRun({ limit }, run) } });

export const opportunitiesQuery = (
  scope: LinksScope,
  query: OpportunitiesQuery,
  run: string | null,
): ApiQueryOptions<typeof OPPORTUNITIES> =>
  apiQuery(OPPORTUNITIES, { params: { path: pathOf(scope), query: opportunitiesParams(query, run) } });

/** Pages the latest crawl suggests a tier for. It takes no `run`: suggestions are of the latest crawl. */
export const tierSuggestionsQuery = (scope: LinksScope): ApiQueryOptions<typeof SUGGESTIONS> =>
  apiQuery(SUGGESTIONS, { params: { path: pathOf(scope) } });

/** The shortest routes from the home page to a page. Throws `UrlIdError` for an id that is no url id. */
export const routesQuery = (scope: LinksScope, urlId: string, run: string | null): ApiQueryOptions<typeof ROUTES> =>
  apiQuery(ROUTES, { params: { path: pathOf(scope), query: withRun({ url_id: checkUrlId(urlId) }, run) } });

/** The latest crawls, newest first: `limit` of them (`CRAWL_LIMIT` for a list, `CRAWL_SCREEN_LIMIT` for the screen). */
export const crawlsQuery = (scope: LinksScope, limit: number = CRAWL_LIMIT): ApiQueryOptions<typeof CRAWLS> =>
  apiQuery(CRAWLS, { params: { path: pathOf(scope), query: { limit } } });

/**
 * The project's settings, which hold the internal links part (`internal_links`). The same request, and so the same
 * cache entry, as the keyword defaults section reads.
 */
export const linkSettingsQuery = (scope: LinksScope): ApiQueryOptions<typeof SETTINGS> =>
  apiQuery(SETTINGS, { params: { path: pathOf(scope) } });

/** The project's client summary links, newest first, without their tokens. */
export const sharesQuery = (scope: LinksScope): ApiQueryOptions<typeof SHARES> =>
  apiQuery(SHARES, { params: { path: pathOf(scope) } });

/**
 * The public client summary a link opens: no sign-in, so a 404 (unknown, expired or revoked) is final and a 429 is
 * shown by the page, which asks again on a press of "Try again", not by a silent retry.
 */
export const publicSummaryQuery = (token: string): ApiQueryOptions<typeof PUBLIC_SUMMARY> => ({
  ...apiQuery(PUBLIC_SUMMARY, { params: { path: { token } } }),
  retry: false,
  staleTime: 0,
});

export const tierRulesQuery = (scope: LinksScope): ApiQueryOptions<typeof RULES> =>
  apiQuery(RULES, { params: { path: pathOf(scope) } });

/** A rule as the dialog holds it, for the count of pages it matches (decision W16). */
export interface RulePreviewInput {
  matchType: 'exact' | 'prefix' | 'pattern';
  value: string;
  /** Where the rule stands among the others (1 first). */
  position: number;
  /** The saved rule being edited, `null` for a new one. */
  ruleId: string | null;
}

/**
 * Pages the latest crawl holds that a rule matches, and how many of them it would decide. A POST that only reads,
 * so it is a query: its key sits under `tier-rules` and a rule change refreshes it.
 */
export const tierRulePreviewQuery = (
  scope: LinksScope,
  input: RulePreviewInput,
): UseQueryOptions<TierRulePreview, Error, TierRulePreview, unknown[]> =>
  queryOptions({
    queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'tier-rules', 'preview', input],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST(PREVIEW, {
          params: { path: pathOf(scope) },
          body: {
            match_type: input.matchType,
            value: input.value,
            position: input.position,
            ...(input.ruleId === null ? {} : { rule_id: input.ruleId }),
          },
          signal,
        }),
      ).then((answer) => answer.data),
  });

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
