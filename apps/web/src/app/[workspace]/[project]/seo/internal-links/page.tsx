import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { InternalLinksScreen } from '@/features/internal-links';
import { PromptDrawerHost } from '@/features/prompts';
import { PAGES_REDIRECT_KEYS } from '@/lib/pages/url-state';
import { projectsOfMembership } from '@/lib/projects/server';
import { pagesTabPath, queryOf, withQuery } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('internalLinks');
  return { title: t('title') };
}

/**
 * SEO > Internal links (spec 7). The project shell above serves this page's loading and error states; the tab,
 * filters, scope and journey live in the address. The page reads the address only to move an old Pages tab address
 * to SEO > Pages > All pages (spec 5.3): `tab=pages`, or no tab with a key only that tab wrote. Every key but `tab`
 * goes with it, `inspect` and `itab` included.
 */
export default async function InternalLinksPage({
  params,
  searchParams,
}: PageProps<'/[workspace]/[project]/seo/internal-links'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const query = await searchParams;
  const moved =
    query.tab === 'pages' || (query.tab === undefined && PAGES_REDIRECT_KEYS.some((key) => query[key] !== undefined));
  if (moved) redirect(withQuery(pagesTabPath(workspace, project, 'all'), queryOf(query, ['tab'])));
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
