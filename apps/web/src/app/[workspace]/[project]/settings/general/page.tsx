import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ProjectGeneralScreen } from '@/features/project-settings';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.groups');
  return { title: t('project') };
}

/** Project settings > General, with the project as the API has it now. */
export default async function ProjectGeneralPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/general'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return <ProjectGeneralScreen project={current} workspaceSlug={membership.workspace.slug} />;
}
