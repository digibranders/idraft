import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { MonitoringScreen } from '@/features/page-search';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('monitoring');
  return { title: t('title') };
}

/**
 * Pages > Monitoring (spec 10.1). The project shell above serves the loading and error states; the period and the
 * filters live in the address. The Pages tab strip and drawer are passed in (`tabs`, `onOpenPage`) when the Pages
 * shell is merged (spec 11); until then the shared inspector opens the page's search detail.
 */
export default async function MonitoringPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/pages/monitoring'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <MonitoringScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        host: current.primary_domain?.host ?? null,
      }}
    />
  );
}
