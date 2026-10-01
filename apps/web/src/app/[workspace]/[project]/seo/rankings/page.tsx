import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { RankingsScreen } from '@/features/rankings';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('navigation.items');
  return { title: t('rankings') };
}

/** SEO > Rankings: the project's tracked keywords. */
export default async function RankingsPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/rankings'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <RankingsScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      timeZone={current.timezone}
    />
  );
}
