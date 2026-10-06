import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { RunsScreen } from '@/features/operations';
import { projectsOfMembership } from '@/lib/projects/server';
import { queryOf, runsPath, withQuery } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('runs');
  return { title: t('pageTitle') };
}

/**
 * The workspace's own Runs route, kept for links made before Runs moved into the project shell: it goes to
 * Runs of the project the link named in its `project` key (a slug), when the member can open that one, and
 * otherwise of the first project the member can open. The other keys (the month, the filters, an open run)
 * are kept; `project` is not, since the project is the route now. Only a member who can open no project
 * stays here, in the workspace shell, where Runs says there is nothing to show.
 */
export default async function RunsPage({
  params,
  searchParams,
}: PageProps<'/[workspace]/ops/runs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const query = await searchParams;
  const { membership } = await requireMembership(workspace);
  const projects = await projectsOfMembership(membership);
  const named = typeof query.project === 'string' ? query.project : undefined;
  const target = projects.find((candidate) => candidate.slug === named) ?? projects[0];
  if (target !== undefined) redirect(withQuery(runsPath(workspace, target.slug), queryOf(query, ['project'])));
  return (
    <RunsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={null}
    />
  );
}
