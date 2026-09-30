import 'server-only';

import { unwrap } from '@/lib/api/client';
import { serverApi } from '@/lib/api/server';
import type { components } from '@/lib/api/schema';
import type { MeMembership } from '@/lib/api/types';
import { canOpenProject } from '@/lib/permissions/permissions';

type Project = components['schemas']['Project'];

/** The most the API gives in one page (19 section 2.5, `limit`). */
const PAGE_SIZE = 200;
/** A bound on the pages read, so an API that kept answering could not keep a render waiting. */
const MAX_PAGES = 50;

/**
 * Every active or paused project of the membership's workspace that the member can open, read page by
 * page until the API's `total`. The API lists only the projects the member may open; `project_ids` is
 * applied as well, so the app never links to a project the API would answer 404 for. A workspace's project
 * limit is set by an operator and has no upper bound, so one page is not enough.
 */
export async function projectsOfMembership(membership: MeMembership): Promise<Project[]> {
  const client = await serverApi();
  const projects: Project[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, page: info } = await unwrap(
      client.GET('/api/v1/workspaces/{workspace_id}/projects', {
        params: {
          path: { workspace_id: membership.workspace.workspace_id },
          query: { offset: page * PAGE_SIZE, limit: PAGE_SIZE },
        },
      }),
    );
    projects.push(...data);
    if (data.length === 0 || projects.length >= info.total) break;
  }
  return projects.filter((project) => canOpenProject(membership.project_ids, project.project_id));
}
