import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { EntityEditor } from '@/features/entities';
import { projectsOfMembership } from '@/lib/projects/server';
import { isUuid } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('entities') };
}

/** One entity's editor, under Project settings > Entities and aliases. */
export default async function EntityEditorPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/entities/[entityId]'>): Promise<ReactNode> {
  const { workspace, project, entityId } = await params;
  // An address that cannot be an entity id is the 404 page, without asking the API
  if (!isUuid(entityId)) notFound();
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <EntityEditor
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      entityId={entityId}
      workspaceSlug={membership.workspace.slug}
      projectSlug={current.slug}
    />
  );
}
