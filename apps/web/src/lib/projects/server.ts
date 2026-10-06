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
 * The projects of the membership's workspace that the member can open, read page by page until the API's
 * `total`. The API lists only the projects the member may open; `project_ids` is applied as well, so the
 * app never links to a project the API would answer 404 for. A workspace's project limit is set by an
 * operator and has no upper bound, so one page is not enough. `statuses` is the API's `filter[status_in]`;
 * without it the API gives the active and paused ones.
 */
async function readProjects(membership: MeMembership, statuses?: readonly string[]): Promise<Project[]> {
  const client = await serverApi();
  const { items } = await readAllPages(
    (offset, limit) =>
      unwrap(
        client.GET('/api/v1/workspaces/{workspace_id}/projects', {
          params: {
            path: { workspace_id: membership.workspace.workspace_id },
            query: { offset, limit, ...(statuses === undefined ? {} : { 'filter[status_in]': [...statuses] }) },
          },
        }),
      ),
    (project) => project.project_id,
  );
  return items.filter((project) => canOpenProject(membership.project_ids, project.project_id));
}

/**
 * Every active or paused project of the membership's workspace that the member can open. Once per request
 * and membership: the project layout and a settings page share the answer.
 */
export const projectsOfMembership = cache((membership: MeMembership): Promise<Project[]> => readProjects(membership));

/**
 * The same with the archived projects too: Costs lists what an archived project spent, which the cost
 * routes still include, so its rows are named and its Project filter offered.
 */
export const projectsWithArchivedOfMembership = cache((membership: MeMembership): Promise<Project[]> =>
  readProjects(membership, ['active', 'paused', 'archived']),
);
