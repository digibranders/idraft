import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { isSignInNotice, SignInForm } from '@/features/auth';
import { firstParam, type SearchParams } from '@/lib/url/search-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login');
  return { title: t('title') };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  // `next` is checked by safeNextPath when it is followed, not here
  return <SignInForm next={firstParam(params.next)} notice={isSignInNotice(notice) ? notice : null} />;
}
