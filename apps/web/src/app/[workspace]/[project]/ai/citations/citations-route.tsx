import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { CitationsScreen } from '@/features/citations';
import { PromptDrawerHost } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

/**
 * AI > Citations, both tabs (WP-77): the project shell serves loading and error; the page finds the project among
 * those the member can open, as Topics & Prompts does, and composes the prompt inspector, which another feature
 * owns, for the drawers to open in place. The tab, scope and search live in the address, so the page reads no search
 * parameter.
 */
export async function CitationsRoute({
  params,
  tab,
}: {
  params: Promise<{ workspace: string; project: string }>;
  tab: 'pages' | 'gaps';
}): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <CitationsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        ownDomain: current.primary_domain?.registrable_domain ?? null,
      }}
      tab={tab}
      promptDrawer={
        <PromptDrawerHost
          workspaceId={membership.workspace.workspace_id}
          projectId={current.project_id}
          timeZone={current.timezone}
        />
      }
    />
  );
}
