import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';

import { ProjectListSkeleton } from '@/features/projects/project-list';
import { listedProjectsOf } from '@/features/projects/server';
import { WorkspaceProjects } from '@/features/projects/workspace-projects';
import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata({ params }: PageProps<'/[workspace]'>): Promise<Metadata> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('projects')]);
  return { title: t('pageTitle', { workspace: membership.workspace.name }) };
}

/** The workspace root: the shell at once, and the projects the member can open as they arrive. */
export default async function WorkspacePage({ params }: PageProps<'/[workspace]'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  return (
    <WorkspaceShell workspace={{ slug: membership.workspace.slug, name: membership.workspace.name }}>
      <Suspense fallback={<ProjectListSkeleton />}>
        <WorkspaceProjects membership={membership} projects={listedProjectsOf(membership)} />
      </Suspense>
    </WorkspaceShell>
  );
}
