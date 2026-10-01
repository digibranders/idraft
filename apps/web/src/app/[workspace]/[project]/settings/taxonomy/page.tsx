import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { TaxonomyScreen } from '@/features/taxonomy';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('taxonomy') };
}

/** Project settings > Taxonomy: the vocabularies the project sees and their terms. */
export default async function TaxonomyPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/taxonomy'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return <TaxonomyScreen workspaceId={membership.workspace.workspace_id} projectId={current.project_id} />;
}
