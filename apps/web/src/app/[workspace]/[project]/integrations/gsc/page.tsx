import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { GscScreen } from '@/features/integrations';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations');
  return { title: t('pageTitle') };
}

/**
 * Integrations > Google Search Console of the project (24-page-templates.md section 9.12), inside the
 * project shell. It is also where Google returns the person after consent, with `?connection_id=` or
 * `?error=` (backend `IntegrationService.complete`), which the screen reads. The project is the route, so
 * the page finds it among those the member can open; the screen decides what a role without
 * `integrations:manage` may do.
 */
export default async function GscPage({
  params,
}: PageProps<'/[workspace]/[project]/integrations/gsc'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <GscScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projectId={current.project_id}
      projectSlug={current.slug}
      timeZone={current.timezone}
    />
  );
}
