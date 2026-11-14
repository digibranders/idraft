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
 * Workspace settings > Budgets and usage inside the project shell. The data is the workspace's, not the
 * project's, so the page lists every project the member can open; the quotas are read through the project in
 * the route. The screen decides what a member without `costs:read` sees.
 */
export default async function BudgetsPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/budgets'>): Promise<ReactNode> {
  const { workspace, project: projectSlug } = await params;
  const { membership } = await requireMembership(workspace);
  const projects = await projectsWithArchivedOfMembership(membership);
  // The route's project, else the first one the member can open
  const limits =
    projects.find((project) => project.slug === projectSlug) ??
    projects.find((project) => project.status !== 'archived');
  return (
    <BudgetsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projects={projects.map((project) => ({ id: project.project_id, slug: project.slug, name: project.name }))}
      limitsProjectId={limits?.project_id ?? null}
    />
  );
}
