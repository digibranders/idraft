import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { RunsScreen } from '@/features/operations';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('runs');
  return { title: t('pageTitle') };
}

/**
 * Operations > Runs of the project (11-navigation.md section 1.1): the project shell is the layout above,
 * its `loading.tsx` and `error.tsx` serve this page. The project is the route, so the page finds it among
 * those the member can open (the layout answers 404 for any other, and this page does not rely on it, as
 * layouts and pages render in parallel). Viewing runs needs `data:read`, which every role but billing
 * holds; the screen says so to a member without it.
 */
export default async function RunsPage({ params }: PageProps<'/[workspace]/[project]/ops/runs'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <RunsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{ id: current.project_id, slug: current.slug, name: current.name, timeZone: current.timezone }}
    />
  );
}
