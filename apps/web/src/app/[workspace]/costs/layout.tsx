import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { requireMembership } from '@/lib/session/server';

/**
 * Workspace Costs (11-navigation.md section 1) inside the workspace shell. The shell is this segment's
 * layout, below which `error.tsx` and `loading.tsx` render, so a failed or loading page keeps it, as
 * Settings does.
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
