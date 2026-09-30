import 'server-only';

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ProjectShell, type ShellProject } from './project-shell';
import { parseSidebarPreference, SIDEBAR_COOKIE } from '@/lib/navigation/sidebar-state';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

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
  const { membership } = await requireMembership(workspace);
  const projects: ShellProject[] = (await projectsOfMembership(membership)).map((candidate) => ({
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
