import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PromptsScreen } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('prompts');
  return { title: t('title') };
}

/**
 * AI > Topics & Prompts (11-navigation.md section 1.1, ADR-DS-022). The project shell above serves this page's
 * loading and error states; the page finds the project among those the member can open, as Runs does. A prompt
 * opens in the right inspector (`?inspect=prompt:{id}`), so slice 1 has no page of its own for one.
 */
export default async function PromptsPage({
  params,
}: PageProps<'/[workspace]/[project]/ai/prompts'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <PromptsScreen
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
