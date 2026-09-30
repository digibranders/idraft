import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';

import { ProjectListSkeleton } from '@/features/projects/project-list';
import { listedProjectsOf } from '@/features/projects/server';
import { WorkspaceProjects } from '@/features/projects/workspace-projects';
import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { projectPath } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata({ params }: PageProps<'/[workspace]'>): Promise<Metadata> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('projects')]);
  return { title: t('pageTitle', { workspace: membership.workspace.name }) };
}

/**
 * The workspace root: the shell at once, and the projects the member can open as they arrive. The account
 * menu's Account settings goes to the first of them.
 */
export default async function WorkspacePage({ params }: PageProps<'/[workspace]'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  const projects = listedProjectsOf(membership);
  const accountSettings = projects.then(
    ([first]): Route | null => (first === undefined ? null : projectPath(workspace, first.slug, '/settings/profile')),
    () => null,
  );
  return (
    <WorkspaceShell workspace={membership.workspace.name} accountSettings={accountSettings}>
      <Suspense fallback={<ProjectListSkeleton />}>
        <WorkspaceProjects membership={membership} projects={projects} />
      </Suspense>
    </WorkspaceShell>
  );
}
