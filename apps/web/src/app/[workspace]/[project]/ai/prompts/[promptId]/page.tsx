import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { DayCompareScreen } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { isUuid } from '@/lib/routes/paths';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('prompts.dayCompare');
  return { title: t('title') };
}

/**
 * AI > Prompts > one prompt. The page opens with Compare days; the rest of the prompt page (WP-52) joins it later. The
 * list's inspector stays the quick look: its History tab links here.
 */
export default async function PromptPage({
  params,
}: PageProps<'/[workspace]/[project]/ai/prompts/[promptId]'>): Promise<ReactNode> {
  const { workspace, project, promptId } = await params;
  // An address that cannot be a prompt's id is the 404 page, without asking the API
  if (!isUuid(promptId)) notFound();
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <DayCompareScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      workspaceSlug={membership.workspace.slug}
      projectSlug={current.slug}
      promptId={promptId}
      timeZone={current.timezone}
    />
  );
}
