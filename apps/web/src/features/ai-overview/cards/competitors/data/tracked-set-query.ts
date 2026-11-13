import type { ProjectRef } from '../../../data/overview-queries';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';

const ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities' as const;

/**
 * `GET {P}/entities`: what the prompts summary does not carry for a tracked brand, its colour slot
 * (`color_index`) and the day it joined the project (`added_at`). The same request and key as the entities screens
 * and the prompts feature make, so it is one cache entry; a card reads it through `useTrackedSet`.
 */
export const trackedSetQuery = (project: ProjectRef): ApiQueryOptions<typeof ENTITIES> =>
  apiQuery(ENTITIES, { params: { path: { workspace_id: project.workspaceId, project_id: project.projectId } } });
