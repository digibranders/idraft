import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { RunsScreen } from '@/features/operations';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('runs');
  return { title: t('pageTitle') };
}

/**
 * Workspace Operations > Runs (11-navigation.md section 1): the workspace shell is the layout of this
 * segment. The page lists the projects the member can open, since the runs are listed one project at a time.
 * Viewing runs needs `data:read`, which every role but billing holds; the screen says so to a member without it.
 */
export default async function RunsPage({ params }: PageProps<'/[workspace]/ops/runs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  const projects = await projectsOfMembership(membership);
  return (
    <RunsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projects={projects.map((project) => ({
        id: project.project_id,
        slug: project.slug,
        name: project.name,
        timeZone: project.timezone,
      }))}
    />
  );
}
