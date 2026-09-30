import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { VerifyEmailScreen } from '@/features/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verifyEmail');
  return { title: t('checkingTitle') };
}

export default function VerifyEmailPage(): ReactNode {
  return <VerifyEmailScreen />;
}
