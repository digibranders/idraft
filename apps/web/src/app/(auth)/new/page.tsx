import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { NewWorkspaceScreen } from '@/features/onboarding';
import { NEW_WORKSPACE_PATH, signInPath } from '@/lib/routes/paths';
import { getMe } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding.workspace');
  return { title: t('pageTitle') };
}

/**
 * Create a workspace, for a platform operator (`new` is a reserved workspace slug, so the route is free).
 * Anyone else gets the 404 page: while sign-up is by invitation, the API refuses them.
 */
export default async function NewWorkspacePage(): Promise<ReactNode> {
  const me = await getMe();
  if (me === null) redirect(signInPath(NEW_WORKSPACE_PATH));
  if (!me.user.is_platform_operator) notFound();
  return <NewWorkspaceScreen />;
}
