import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CostsScreen } from '@/features/costs';
import { projectsWithArchivedOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('costs');
  return { title: t('pageTitle') };
}

/**
 * Costs inside the project shell (11-navigation.md section 1.1): the project shell is the layout above,
 * its `loading.tsx` and `error.tsx` serve this page. The data is the workspace's, not the project's, so
 * the page lists every project the member can open, for the names of the cost rows and the Project filter,
 * which starts empty. The screen decides what a member without `costs:read` sees.
 */
export default async function CostsPage({ params }: PageProps<'/[workspace]/[project]/costs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  const projects = await projectsWithArchivedOfMembership(membership);
  return (
    <CostsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projects={projects.map((project) => ({
        id: project.project_id,
        slug: project.slug,
        name: project.name,
        archived: project.status === 'archived',
      }))}
    />
  );
}
