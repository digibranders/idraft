import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { WorkspaceGeneralScreen } from '@/features/workspace-settings';
import { requireMembership } from '@/lib/session/server';
import { workspaceById } from '@/lib/workspaces/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.groups');
  return { title: t('workspace') };
}

/** Workspace settings > General, with the workspace as the API has it now. */
export default async function WorkspaceGeneralPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/workspace'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  return (
    <WorkspaceGeneralScreen workspace={await workspaceById(membership.workspace.workspace_id)} projectSlug={project} />
  );
}
