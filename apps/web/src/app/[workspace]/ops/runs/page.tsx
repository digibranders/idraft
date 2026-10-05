import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { RunsScreen } from '@/features/operations';
import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('runs');
  return { title: t('pageTitle') };
}

/**
 * Workspace Operations > Runs (11-navigation.md section 1): inside the workspace shell, with the projects
 * the member can open, since the runs are listed one project at a time. Every role reads runs (`data:read`).
 */
export default async function RunsPage({ params }: PageProps<'/[workspace]/ops/runs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('runs')]);
  const projects = await projectsOfMembership(membership);
  return (
    <WorkspaceShell workspace={{ slug: membership.workspace.slug, name: membership.workspace.name }} page={t('title')}>
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
    </WorkspaceShell>
  );
}
