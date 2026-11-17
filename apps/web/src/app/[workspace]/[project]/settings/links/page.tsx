import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { InternalLinksSettingsScreen } from '@/features/project-settings';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('links') };
}

/** Project settings > Internal links (spec 7.8). */
export default async function LinksSettingsPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/links'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <InternalLinksSettingsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projectId={current.project_id}
      projectSlug={current.slug}
      host={current.primary_domain?.host ?? ''}
      timeZone={current.timezone}
    />
  );
}
