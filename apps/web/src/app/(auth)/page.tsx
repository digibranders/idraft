import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { HomeScreen } from '@/features/session';
import { homeOutcome } from '@/features/session/server';
import { getMe } from '@/lib/session/server';
import { isInvitationFailure } from '@/lib/routes/home-notices';
import { firstParam, type SearchParams } from '@/lib/url/search-params';

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const t = await getTranslations('session');
  const failure = firstParam((await searchParams).invitation);
  return { title: isInvitationFailure(failure) ? t('invitation.title') : t('noWorkspace.title') };
}

/** `/`: opens the person's first workspace, or says why it cannot (`homeOutcome`). */
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const outcome = homeOutcome(await getMe(), firstParam((await searchParams).invitation));
  if (outcome.kind === 'redirect') redirect(outcome.to);
  return <HomeScreen {...outcome.props} />;
}
