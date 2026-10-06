import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { requireMembership } from '@/lib/session/server';

/**
 * Workspace Costs (11-navigation.md section 1) inside the workspace shell, for a member who can open no
 * project. The shell is this segment's layout, below which `error.tsx` renders, so a failed page keeps it,
 * as Settings does. There is no `loading.tsx`: the page redirects every member who has a project, and a
 * Suspense boundary would put this shell and a skeleton in the first bytes, with the redirect behind them.
 */
export default async function CostsLayout({ children, params }: LayoutProps<'/[workspace]/costs'>): Promise<ReactNode> {
  const { workspace } = await params;
  const [{ membership }, t] = await Promise.all([requireMembership(workspace), getTranslations('costs')]);
  return (
    <WorkspaceShell workspace={{ slug: membership.workspace.slug, name: membership.workspace.name }} page={t('title')}>
      {children}
    </WorkspaceShell>
  );
}
