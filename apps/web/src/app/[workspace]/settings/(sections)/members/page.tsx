import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { MembersPage as MembersAndInvitations } from '@/features/workspace-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('members') };
}

/** Workspace settings > Members and roles, with the invitations for members who manage them. */
export default function MembersPage(): ReactNode {
  return <MembersAndInvitations />;
}
