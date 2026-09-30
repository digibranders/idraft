import 'server-only';

import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { ProjectShell, type ShellProject } from './project-shell';
import { unwrap } from '@/lib/api/client';
import { serverApi } from '@/lib/api/server';
import { parseSidebarPreference, SIDEBAR_COOKIE } from '@/lib/navigation/sidebar-state';
import { canOpenProject } from '@/lib/permissions/permissions';
import { PATHNAME_HEADER, projectPath, signInPath } from '@/lib/routes/paths';
import { getMe, membershipOf } from '@/lib/session/server';

/** More than any plan's project quota: the switcher lists them all. */
const PROJECT_LIMIT = 200;

/**
 * The root of every page of a project (the `[workspace]/[project]` layout): finds the project by its slug
 * among those the member can open, and renders the shell around the page. A slug that is not there, or a
 * project outside the member's `project_ids`, is the 404 page, as the API answers for it (19 section 2.2).
 * The workspace layout above checks the membership too; layouts render in parallel, so this one does not
 * rely on it.
 */
export async function ProjectRoot({
  workspace,
  project,
  children,
}: Readonly<{ workspace: string; project: string; children: ReactNode }>): Promise<ReactNode> {
  const me = await getMe();
  if (me === null) {
    redirect(signInPath((await headers()).get(PATHNAME_HEADER) ?? projectPath(workspace, project)));
  }
  const membership = membershipOf(me, workspace);
  if (membership === null) notFound();
  const client = await serverApi();
  const { data } = await unwrap(
    client.GET('/api/v1/workspaces/{workspace_id}/projects', {
      params: { path: { workspace_id: membership.workspace.workspace_id }, query: { limit: PROJECT_LIMIT } },
    }),
  );
  const projects: ShellProject[] = data
    .filter((candidate) => canOpenProject(membership.project_ids, candidate.project_id))
    .map((candidate) => ({
      id: candidate.project_id,
      slug: candidate.slug,
      name: candidate.name,
      timeZone: candidate.timezone,
    }));
  const current = projects.find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  const sidebar = parseSidebarPreference((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return (
    <ProjectShell
      workspace={{ slug: membership.workspace.slug, name: membership.workspace.name }}
      project={current}
      projects={projects}
      sidebarPreference={sidebar}
    >
      {children}
    </ProjectShell>
  );
}
