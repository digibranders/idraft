import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { RankingsRoute } from '@/features/rankings';
import { PageSkeleton } from '@/features/shell/page-skeleton';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

/**
 * SEO > Keywords and the import over it. The screen lives here, not in the pages, so that opening or
 * closing `/seo/keywords/import` leaves the table, its scroll and a write in progress as they are. The
 * pages render nothing; `RankingsRoute` reads which one is current.
 */
export default async function KeywordsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspace: string; project: string }>;
}): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RankingsRoute
        workspaceSlug={workspace}
        projectSlug={project}
        workspaceId={membership.workspace.workspace_id}
        projectId={current.project_id}
        timeZone={current.timezone}
        defaults={{ location: current.default_location, languageCode: current.default_language_code }}
      >
        {children}
      </RankingsRoute>
    </Suspense>
  );
}
