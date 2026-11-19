import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { InternalLinksScreen } from '@/features/internal-links';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('internalLinks');
  return { title: t('title') };
}

/**
 * SEO > Internal links (spec 7). The project shell above serves this page's loading and error states; the tab,
 * filters, scope and journey live in the address, so the page reads no search parameter.
 */
export default async function InternalLinksPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/internal-links'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <InternalLinksScreen
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
