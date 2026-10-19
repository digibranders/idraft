import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CostsScreen } from '@/features/costs';
import { projectsOfMembership, projectsWithArchivedOfMembership } from '@/lib/projects/server';
import { costsPath, queryOf, withQuery } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('costs');
  return { title: t('pageTitle') };
}

/**
 * The workspace's own Costs route, kept for links made before Costs moved into the project shell: it goes
 * to Costs of the first project the member can open, with the query string kept (the month, the tab and
 * the filters, the Project filter's `project` among them, which is the project's id and not a slug).
 * Only a member who can open no project stays here, in the workspace shell, and Costs works without one.
 * The screen decides what a member without `costs:read` sees.
 */
export default async function CostsPage({ params, searchParams }: PageProps<'/[workspace]/costs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  const [first] = await projectsOfMembership(membership);
  if (first !== undefined) redirect(withQuery(costsPath(workspace, first.slug), queryOf(await searchParams)));
  // No project to open: the archived ones still have costs, which the page names
  const projects = await projectsWithArchivedOfMembership(membership);
  return (
    <CostsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      workspaceName={membership.workspace.name}
      projectSlug={null}
      projects={projects.map((project) => ({
        id: project.project_id,
        slug: project.slug,
        name: project.name,
        archived: project.status === 'archived',
      }))}
    />
  );
}
