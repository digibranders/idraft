import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { RetentionScreen } from '@/features/project-settings';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('retention') };
}

/** Project settings > Data retention: how long the platform keeps each kind of raw data. Read only. */
export default async function RetentionPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/retention'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  // The page reads nothing of the project, but a project that is not the member's has no settings to open
  if ((await projectsOfMembership(membership)).every((candidate) => candidate.slug !== project)) notFound();
  return <RetentionScreen />;
}
