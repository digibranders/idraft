import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ReportsScreen } from '@/features/reports';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports');
  return { title: t('title') };
}

/**
 * Reports: the project's guest links and scheduled report emails. The project shell above serves this page's
 * loading and error states; the page finds the project among those the member can open, as Competitors does.
 */
export default async function ReportsPage({ params }: PageProps<'/[workspace]/[project]/reports'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <ReportsScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      project={{ name: current.name }}
      timeZone={current.timezone}
    />
  );
}
