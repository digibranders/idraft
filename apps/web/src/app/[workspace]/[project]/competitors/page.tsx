import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AddCompetitorSlot } from './add-competitor-slot';
import { CompetitorsScreen } from '@/features/competitors';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitors');
  return { title: t('title') };
}

/**
 * Competitors (11-navigation.md section 1.1, DS 24 section 9.8). The project shell above serves this page's loading
 * and error states; the page finds the project among those the member can open, as Citations does. The tab, filters
 * and window live in the address, so the page reads no search parameter. The Add competitor dialog belongs to the
 * entities feature, so the page composes it into the screen as a slot.
 */
export default async function CompetitorsPage({
  params,
}: PageProps<'/[workspace]/[project]/competitors'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <CompetitorsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{ id: current.project_id, slug: current.slug, name: current.name, timeZone: current.timezone }}
      addCompetitorSlot={
        <AddCompetitorSlot
          workspaceId={membership.workspace.workspace_id}
          workspaceSlug={membership.workspace.slug}
          projectId={current.project_id}
          projectSlug={current.slug}
        />
      }
    />
  );
}
