import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { InsightsScreen } from '@/features/ai-overview';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('aiInsights');
  return { title: t('title') };
}

/**
 * AI > Insights: what the project can act on in AI visibility, in full. The project shell above serves this page's
 * loading and error states; the page finds the project among those the member can open, as the Overview does.
 */
export default async function InsightsPage({
  params,
}: PageProps<'/[workspace]/[project]/ai/insights'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <InsightsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
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
