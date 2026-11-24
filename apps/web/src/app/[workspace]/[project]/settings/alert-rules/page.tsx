import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AlertRulesScreen } from '@/features/alerts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('alertRules') };
}

/** Project settings > Alert rules: what changes raise an alert, and the recent alerts. */
export default async function AlertRulesPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/alert-rules'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <AlertRulesScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      timeZone={current.timezone}
    />
  );
}
