import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { EnginesScreen } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('engines') };
}

/** Project settings > Engines: which AI engines ask the project's prompts, and in which countries. */
export default async function EnginesPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/engines'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <EnginesScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      workspaceSlug={membership.workspace.slug}
      projectSlug={current.slug}
      defaultCountryIso={current.default_location?.country_iso ?? null}
    />
  );
}
