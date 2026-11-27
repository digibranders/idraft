import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { CannScreen } from '@/features/cannibalization';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

/**
 * SEO > Cannibalization, both tabs (docs/33 section 7): the project shell serves loading and error; the page finds the
 * project among those the member can open. The tab is the route, and the scope, view and filters live in the address,
 * so the page reads no search parameter. The keyword inspector is composed here once its feature exists.
 */
export async function CannibalizationRoute({
  params,
  tab,
}: {
  params: Promise<{ workspace: string; project: string }>;
  tab: 'cannibalization' | 'switching';
}): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <CannScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{ id: current.project_id, slug: current.slug, name: current.name }}
      tab={tab}
    />
  );
}
