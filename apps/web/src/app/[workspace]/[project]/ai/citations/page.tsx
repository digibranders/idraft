import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CitationsScreen } from '@/features/citations';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('citations');
  return { title: t('title') };
}

/**
 * AI > Citations (11-navigation.md section 1.1, DS 9.7). The project shell above serves this page's loading and
 * error states; the page finds the project among those the member can open, as Topics & Prompts does. The tab,
 * filters and window live in the address, so the page reads no search parameter.
 */
export default async function CitationsPage({
  params,
}: PageProps<'/[workspace]/[project]/ai/citations'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <CitationsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{ id: current.project_id, slug: current.slug, name: current.name, timeZone: current.timezone }}
    />
  );
}
