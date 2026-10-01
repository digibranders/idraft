import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { NewProjectPage } from '@/features/onboarding';
import { listedProjectsOf } from '@/features/projects/server';
import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { canCreateProjects } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata({ params }: PageProps<'/[workspace]/onboarding'>): Promise<Metadata> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('onboarding')]);
  return { title: t('pageTitle', { workspace: membership.workspace.name }) };
}

/**
 * New project (20 section 5.1, step 1). Only a member who may create projects and sees every project can;
 * for anyone else the page does not exist, as the API answers them `403` before reading the request.
 */
export default async function OnboardingPage({ params }: PageProps<'/[workspace]/onboarding'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  if (!canCreateProjects(membership)) notFound();
  const accountSettings = listedProjectsOf(membership).then(
    ([first]): Route | null => (first === undefined ? null : projectPath(workspace, first.slug, '/settings/profile')),
    () => null,
  );
  return (
    <WorkspaceShell workspace={membership.workspace.name} accountSettings={accountSettings}>
      <NewProjectPage workspace={{ id: membership.workspace.workspace_id, slug: membership.workspace.slug }} />
    </WorkspaceShell>
  );
}
