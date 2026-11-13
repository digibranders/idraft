import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { BudgetsScreen } from '@/features/workspace-settings/budgets';
import { projectsWithArchivedOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('budgets') };
}

/**
 * Workspace settings > Budgets and usage outside any project. The quotas are read through the first project the
 * member can open (the route needs one); a member who can open none sees them as not available. The screen decides
 * what a member without `costs:read` sees.
 */
export default async function BudgetsPage({ params }: PageProps<'/[workspace]/settings/budgets'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  // The archived projects too: a budget of one is still listed, by name
  const projects = await projectsWithArchivedOfMembership(membership);
  const first = projects.find((project) => project.status !== 'archived');
  return (
    <BudgetsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projects={projects.map((project) => ({ id: project.project_id, slug: project.slug, name: project.name }))}
      limitsProjectId={first?.project_id ?? null}
    />
  );
}
