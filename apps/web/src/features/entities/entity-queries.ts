import type { QueryClient } from '@tanstack/react-query';

import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';

export type ProjectEntity = components['schemas']['ProjectEntity'];
export type ProjectRole = ProjectEntity['role'];
export type EntityDetail = components['schemas']['EntityDetail'];
export type EntityDomain = components['schemas']['EntityDomain'];
export type Alias = components['schemas']['Alias'];
export type AliasInput = components['schemas']['AliasInput'];

/** The project a screen of this feature works on. */
export interface ProjectScope {
  workspaceId: string;
  projectId: string;
}

/** A project tracks at most this many competitors in SEO (19 section 3.4, `422 competitor_limit`). */
export const COMPETITOR_LIMIT = 10;
/** Entity colors run from 1 to 6; the own brand is 1 (23-application-patterns.md section 5.3). */
const COMPETITOR_COLORS = [2, 3, 4, 5, 6] as const;

const PROJECT_ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';
const ENTITY = '/api/v1/workspaces/{workspace_id}/entities/{entity_id}';
const PROJECT_DOMAINS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/domains';
const PROJECT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

/** The project itself, for its `entity_config_version`. The same key as the project settings' query. */
export const projectQuery = (scope: ProjectScope): ApiQueryOptions<typeof PROJECT> =>
  apiQuery(PROJECT, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });

/** The entities of a project with their roles, the removed ones left out. */
export const projectEntitiesQuery = (scope: ProjectScope): ApiQueryOptions<typeof PROJECT_ENTITIES> =>
  apiQuery(PROJECT_ENTITIES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });

/** One entity with its aliases, domains and the projects it has a role in. */
export const entityQuery = (workspaceId: string, entityId: string): ApiQueryOptions<typeof ENTITY> =>
  apiQuery(ENTITY, { params: { path: { workspace_id: workspaceId, entity_id: entityId } } });

/** The domains of a project by role, as the domain resolver reads them. */
export const projectDomainsQuery = (scope: ProjectScope): ApiQueryOptions<typeof PROJECT_DOMAINS> =>
  apiQuery(PROJECT_DOMAINS, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });

/**
 * After a change to an entity or a role: the project's entity list, its domains, the entity itself, and
 * the project (its `entity_config_version` moved).
 */
export function refreshEntities(queryClient: QueryClient, scope: ProjectScope, entityId?: string): void {
  void queryClient.invalidateQueries({ queryKey: projectEntitiesQuery(scope).queryKey });
  void queryClient.invalidateQueries({ queryKey: projectDomainsQuery(scope).queryKey });
  void queryClient.invalidateQueries({ queryKey: projectQuery(scope).queryKey });
  if (entityId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: entityQuery(scope.workspaceId, entityId).queryKey });
  }
}

/** The color a new competitor gets: the first of 2 to 6 no current role holds, or none past the sixth. */
export function nextCompetitorColor(entities: readonly ProjectEntity[]): number | null {
  const taken = new Set(entities.map((entity) => entity.color_index));
  return COMPETITOR_COLORS.find((color) => !taken.has(color)) ?? null;
}

/** A plain alias as the API's defaults make it: matched on word boundaries, in any case, any language. */
export const wordAlias = (alias: string): AliasInput => ({
  alias,
  match_mode: 'word_boundary',
  case_sensitive: false,
  language_code: null,
  is_negative: false,
  requires_context: false,
});

/** The competitors that count against the limit: those tracked in SEO (a competitor only in AI does not). */
export const seoCompetitors = (entities: readonly ProjectEntity[]): number =>
  entities.filter((entity) => entity.role === 'competitor' && entity.track_seo).length;
