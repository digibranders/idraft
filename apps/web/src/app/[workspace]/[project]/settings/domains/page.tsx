import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { DomainsScreen } from '@/features/entities';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('domains') };
}

/** Project settings > Domains: the domains of the project's entities, by role. */
export default async function DomainsPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/domains'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <DomainsScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      workspaceSlug={membership.workspace.slug}
      projectSlug={current.slug}
    />
  );
}
