import type { QueryClient } from '@tanstack/react-query';

import { apiMutation, apiQuery, type ApiQueryOptions } from '@/lib/api/query';

/** The project an entity call is made for. */
export interface EntityProjectRef {
  workspaceId: string;
  projectId: string;
}

const WORKSPACE_ENTITIES = '/api/v1/workspaces/{workspace_id}/entities';
const PROJECT_ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';

/** `POST /entities`: a new workspace entity. */
export const createEntityMutation = apiMutation('post', WORKSPACE_ENTITIES);
/** `POST {P}/entities`: gives a workspace entity a role in the project. */
export const attachEntityMutation = apiMutation('post', PROJECT_ENTITIES);
/** `DELETE {P}/entities/{entity_id}`: takes the role off, keeping the workspace's entity. */
export const detachEntityMutation = apiMutation('delete', `${PROJECT_ENTITIES}/{entity_id}`);

/**
 * `GET {P}/entities`: the project's entities with their roles, colour slots (`color_index`) and the day each joined
 * (`added_at`). One request and one cache entry for every screen that reads it (the entities screen, the prompts,
 * rankings, citations and the Overview), so a change made on one is seen by the others.
 */
export const projectEntitiesQuery = (project: EntityProjectRef): ApiQueryOptions<typeof PROJECT_ENTITIES> =>
  apiQuery(PROJECT_ENTITIES, {
    params: { path: { workspace_id: project.workspaceId, project_id: project.projectId } },
  });

/** A name as two brands compare it: ignoring case and the space around it. */
export const sameBrand = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The id of the workspace's brand of this name (names are unique per type), or `null`. Rejects when the read fails.
 * The read is never served from the cache: a brand created a moment ago, perhaps in another tab, has to be found.
 */
export async function findBrandId(queryClient: QueryClient, workspaceId: string, name: string): Promise<string | null> {
  const found = await queryClient.fetchQuery({
    ...apiQuery(WORKSPACE_ENTITIES, {
      params: { path: { workspace_id: workspaceId }, query: { 'filter[q]': name } },
    }),
    staleTime: 0,
  });
  return (
    found.data.find((entity) => entity.entity_type === 'brand' && sameBrand(entity.canonical_name, name))?.entity_id ??
    null
  );
}
