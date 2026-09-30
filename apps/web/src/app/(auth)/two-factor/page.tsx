import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { TwoFactorForm } from '@/features/auth';
import { firstParam, type SearchParams } from '@/lib/url/search-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.twoFactor');
  return { title: t('title') };
}

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactNode> {
  // `next` is checked by safeNextPath when it is followed, not here
  return <TwoFactorForm next={firstParam((await searchParams).next)} />;
}
