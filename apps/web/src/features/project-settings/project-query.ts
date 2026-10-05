import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { Project } from '@/lib/api/types';

const PROJECT_PATH = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const SETTINGS_PATH = `${PROJECT_PATH}/settings` as const;

/** The query of one project, shared by the sections of its settings so a save updates them all. */
export const projectQuery = (
  project: Pick<Project, 'workspace_id' | 'project_id'>,
): ApiQueryOptions<typeof PROJECT_PATH> =>
  apiQuery(PROJECT_PATH, {
    params: { path: { workspace_id: project.workspace_id, project_id: project.project_id } },
  });

/**
 * The query of the project's settings document (`seo` defaults, 19 section 3.3). Add keywords reads the same
 * request, so a save here is the default it opens on.
 */
export const projectSettingsQuery = (
  project: Pick<Project, 'workspace_id' | 'project_id'>,
): ApiQueryOptions<typeof SETTINGS_PATH> =>
  apiQuery(SETTINGS_PATH, {
    params: { path: { workspace_id: project.workspace_id, project_id: project.project_id } },
  });
