import type { QueryClient } from '@tanstack/react-query';

import { applyKeywordWrite } from '../keyword-cache';
import { keywordsKey, refreshKeywords, type ProjectScope } from '../rankings-queries';
import { apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';

/**
 * What the keyword inspector reads: the tracked keyword with its groups, terms and competitor overrides,
 * its configuration versions, the keyword's Labs history at the keyword's location and language, and the
 * project's entities for the competitor set. Every key of the tracked keyword sits under Rankings' key,
 * so `refreshKeywords` refreshes the inspector with the list.
 */

export const DETAIL = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}';
const CONFIG_HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/config-history';
const RANK_HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/rank-history';
export const COMPETITORS =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/competitors';
const METRICS_HISTORY = '/api/v1/workspaces/{workspace_id}/keywords/{keyword_id}/metrics-history';
const PROJECT_ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';
export const GROUP_MEMBERS =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}/members';
export const GROUP_MEMBERS_REMOVE =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}/members/remove';
export const TERM_ASSIGNMENTS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/term-assignments';

export type KeywordDetail = ApiResponse<'get', typeof DETAIL>['data'];
export type ConfigVersion = ApiResponse<'get', typeof CONFIG_HISTORY>['data'][number];
export type MetricsHistory = ApiResponse<'get', typeof METRICS_HISTORY>['data'];
export type ProjectEntity = ApiResponse<'get', typeof PROJECT_ENTITIES>['data'][number];
export type EntityRef = ProjectEntity['entity'];
export type CompetitorOverride = KeywordDetail['competitor_overrides'][number];

/** One tracked keyword of a project. */
export interface KeywordScope extends ProjectScope {
  trackedKeywordId: string;
}

const keywordPath = (scope: KeywordScope) =>
  ({
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    tracked_keyword_id: scope.trackedKeywordId,
  }) as const;

/**
 * After a write to the open keyword: the keyword and its history read again, and this resolves once they
 * have, so a section leaves edit mode showing what was saved. The lists are not read again whole (in client
 * mode that is a request per 200 rows): the keyword as just read is laid over its row, and a list reads
 * again only where the write can change what it holds (`applyKeywordWrite`). When the keyword could not be
 * read, the lists are invalidated instead.
 */
export async function refreshAfterWrite(queryClient: QueryClient, scope: KeywordScope): Promise<void> {
  await queryClient.invalidateQueries(
    { queryKey: [...keywordsKey(scope), scope.trackedKeywordId] },
    { cancelRefetch: false },
  );
  const key = detailQuery(scope).queryKey;
  const read = queryClient.getQueryState<{ data: KeywordDetail }>(key);
  const detail = read?.status === 'success' ? read.data?.data : undefined;
  if (detail === undefined) void refreshKeywords(queryClient, scope);
  else applyKeywordWrite(queryClient, scope, detail);
}

export const detailQuery = (scope: KeywordScope): ApiQueryOptions<typeof DETAIL> =>
  apiQuery(DETAIL, { params: { path: keywordPath(scope) } });

export const configHistoryQuery = (scope: KeywordScope): ApiQueryOptions<typeof CONFIG_HISTORY> =>
  apiQuery(CONFIG_HISTORY, { params: { path: keywordPath(scope) } });

/** The keyword's rank over the last 90 days, with its competitors (the API's defaults). */
export const rankHistoryQuery = (scope: KeywordScope): ApiQueryOptions<typeof RANK_HISTORY> =>
  apiQuery(RANK_HISTORY, { params: { path: keywordPath(scope), query: { window: 'last_90d' } } });

/** The Labs snapshots of the keyword where it is tracked. */
export const metricsHistoryQuery = (
  workspaceId: string,
  keyword: Pick<KeywordDetail, 'keyword' | 'location_id' | 'language_code'>,
): ApiQueryOptions<typeof METRICS_HISTORY> =>
  apiQuery(METRICS_HISTORY, {
    params: {
      path: { workspace_id: workspaceId, keyword_id: keyword.keyword.keyword_id },
      query: { location_id: keyword.location_id, language_code: keyword.language_code },
    },
  });

/** The project's entities with their roles: the same request, and so the same cache, as the entities screen's. */
export const projectEntitiesQuery = (scope: ProjectScope): ApiQueryOptions<typeof PROJECT_ENTITIES> =>
  apiQuery(PROJECT_ENTITIES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });

/** An entity the project tracks in SEO as a competitor: the default competitor set of every keyword. */
export const isProjectCompetitor = (entity: ProjectEntity): boolean =>
  entity.role === 'competitor' && entity.track_seo && entity.removed_at === null;

/** The entities a keyword's competitor set can hold: the project's competitors and watched entities. */
export const competitorCandidates = (entities: readonly ProjectEntity[]): ProjectEntity[] =>
  entities
    .filter((entity) => entity.removed_at === null && (entity.role === 'competitor' || entity.role === 'watch'))
    .sort((a, b) => a.entity.canonical_name.localeCompare(b.entity.canonical_name));

/**
 * The keyword's competitors: the project's SEO competitors, less the excluded, plus the included, as the
 * API computes them (the `PUT .../competitors` description).
 */
export function effectiveCompetitorIds(
  entities: readonly ProjectEntity[],
  overrides: readonly CompetitorOverride[],
): Set<string> {
  const ids = new Set(entities.filter(isProjectCompetitor).map((entity) => entity.entity.entity_id));
  for (const override of overrides) {
    if (override.mode === 'exclude') ids.delete(override.entity.entity_id);
    else ids.add(override.entity.entity_id);
  }
  return ids;
}

/** The overrides that make `chosen` the keyword's set: whatever differs from the project's default. */
export function overridesFor(
  entities: readonly ProjectEntity[],
  chosen: ReadonlySet<string>,
): { include: string[]; exclude: string[] } {
  const defaults = new Set(entities.filter(isProjectCompetitor).map((entity) => entity.entity.entity_id));
  return {
    include: [...chosen].filter((id) => !defaults.has(id)).sort(),
    exclude: [...defaults].filter((id) => !chosen.has(id)).sort(),
  };
}
