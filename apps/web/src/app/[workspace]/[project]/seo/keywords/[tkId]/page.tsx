import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { KeywordDetailScreen } from '@/features/rankings';
import { projectsOfMembership } from '@/lib/projects/server';
import { isUuid } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('navigation.items');
  return { title: t('rankings') };
}

/**
 * SEO > Keywords > one tracked keyword. The list's layout does not wrap this page (the list lives in the
 * `(list)` route group), so the page is its own screen.
 */
export default async function KeywordDetailPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/keywords/[tkId]'>): Promise<ReactNode> {
  const { workspace, project, tkId } = await params;
  // An address that cannot be a tracked keyword's id is the 404 page, without asking the API
  if (!isUuid(tkId)) notFound();
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <KeywordDetailScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      workspaceSlug={membership.workspace.slug}
      projectSlug={current.slug}
      trackedKeywordId={tkId}
      timeZone={current.timezone}
    />
  );
}
