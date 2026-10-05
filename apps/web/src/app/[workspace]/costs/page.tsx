import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CostsScreen } from '@/features/costs';
import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('costs');
  return { title: t('pageTitle') };
}

/**
 * Workspace Costs (11-navigation.md section 1): inside the workspace shell, with the projects the member can
 * open, for the names of the cost rows and the Project filter. The screen decides what a member without
 * `costs:read` sees.
 */
export default async function CostsPage({ params }: PageProps<'/[workspace]/costs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('costs')]);
  const projects = await projectsOfMembership(membership);
  return (
    <WorkspaceShell workspace={{ slug: membership.workspace.slug, name: membership.workspace.name }} page={t('title')}>
      <CostsScreen
        workspaceId={membership.workspace.workspace_id}
        workspaceSlug={membership.workspace.slug}
        projects={projects.map((project) => ({ id: project.project_id, slug: project.slug, name: project.name }))}
      />
    </WorkspaceShell>
  );
}
