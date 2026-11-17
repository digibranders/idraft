import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PageTiersScreen } from '@/features/workspace-settings/page-tiers';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('tiers') };
}

/** Workspace settings > Page tiers outside any project (spec 5.1). */
export default async function TiersPage({ params }: PageProps<'/[workspace]/settings/tiers'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  return <PageTiersScreen workspaceId={membership.workspace.workspace_id} />;
}
