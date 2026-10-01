import 'server-only';

import { cache } from 'react';

import { unwrap } from '@/lib/api/client';
import { readAllPages } from '@/lib/api/pages';
import { serverApi } from '@/lib/api/server';
import type { components } from '@/lib/api/schema';
import type { MeMembership } from '@/lib/api/types';
import { canOpenProject } from '@/lib/permissions/permissions';

type Project = components['schemas']['Project'];

/**
 * Every active or paused project of the membership's workspace that the member can open, read page by
 * page until the API's `total`. The API lists only the projects the member may open; `project_ids` is
 * applied as well, so the app never links to a project the API would answer 404 for. A workspace's project
 * limit is set by an operator and has no upper bound, so one page is not enough. Once per request and
 * membership: the project layout and a settings page share the answer.
 */
export const projectsOfMembership = cache(async (membership: MeMembership): Promise<Project[]> => {
  const client = await serverApi();
  const { items } = await readAllPages(
    (offset, limit) =>
      unwrap(
        client.GET('/api/v1/workspaces/{workspace_id}/projects', {
          params: { path: { workspace_id: membership.workspace.workspace_id }, query: { offset, limit } },
        }),
      ),
    (project) => project.project_id,
  );
  return items.filter((project) => canOpenProject(membership.project_ids, project.project_id));
});
