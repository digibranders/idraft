import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { IssuesScreen } from '@/features/internal-links';
import { PromptDrawerHost } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('issues');
  return { title: t('title') };
}

/**
 * Website audit > Issues (spec 7). The project shell above serves this page's loading and error states; the tab,
 * filters and open check live in the address, so the page reads no search parameter.
 */
export default async function IssuesPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/issues'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <IssuesScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
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
