import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PagesScreen } from '@/features/internal-links';
import { PromptDrawerHost } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pages');
  return { title: t('title') };
}

/**
 * SEO > Pages, Overview tab (spec 5.1). The project shell above serves this page's loading and error states; the
 * crawl, scope and filters live in the address, so the page reads no search parameter.
 */
export default async function PagesOverviewPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/pages'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <PagesScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      tab="overview"
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        host: current.primary_domain?.host ?? null,
      }}
      promptDrawer={
        <PromptDrawerHost
          workspaceId={membership.workspace.workspace_id}
          workspaceSlug={membership.workspace.slug}
          projectId={current.project_id}
          projectSlug={current.slug}
          timeZone={current.timezone}
        />
      }
    />
  );
}
