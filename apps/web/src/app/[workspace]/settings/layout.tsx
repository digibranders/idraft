import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { requireMembership } from '@/lib/session/server';

/**
 * Settings outside any project (11-navigation.md section 5): your account and the workspace, inside the
 * workspace shell. The account menu opens it from the workspace root, and it is the way in for a member
 * who can open no project yet. The settings navigation is the `(sections)` layout, below this segment's
 * error and loading states, so a failed or loading section keeps the shell, as in a project.
 */
export default async function WorkspaceSettingsLayout({
  children,
  params,
}: LayoutProps<'/[workspace]/settings'>): Promise<ReactNode> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('settings')]);
  return (
    <WorkspaceShell workspace={{ slug: membership.workspace.slug, name: membership.workspace.name }} page={t('title')}>
      {children}
    </WorkspaceShell>
  );
}
