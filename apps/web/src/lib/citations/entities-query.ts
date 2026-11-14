import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { SourceScope } from './types';

const ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';

/**
 * `GET {P}/entities`: the project's tracked entities with their roles, for the names of competitors and of
 * "cited with". The same request as the entities screen's and the prompts feature's, so one cache entry.
 */
export const entitiesQuery = (scope: SourceScope): ApiQueryOptions<typeof ENTITIES> =>
  apiQuery(ENTITIES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });
