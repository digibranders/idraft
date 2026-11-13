import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AiSetupSlot } from './ai-setup-slot';
import { AiOverviewScreen } from '@/features/ai-overview';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('aiOverview');
  return { title: t('title') };
}

/**
 * AI > Overview (11-navigation.md section 1.1, 24-page-templates.md T1): the project's AI visibility. The project
 * shell above serves this page's loading and error states; the page finds the project among those the member can
 * open, as Topics & Prompts does.
 */
export default async function AiOverviewPage({ params }: PageProps<'/[workspace]/[project]/ai'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <AiOverviewScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      setupSlot={
        <AiSetupSlot
          workspaceId={membership.workspace.workspace_id}
          workspaceSlug={membership.workspace.slug}
          projectId={current.project_id}
          projectSlug={current.slug}
        />
      }
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        defaultLanguage: current.default_language_code,
        defaultCountryIso: current.default_location?.country_iso ?? null,
      }}
    />
  );
}
