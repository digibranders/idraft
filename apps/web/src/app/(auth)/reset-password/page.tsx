import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ResetPasswordScreen } from '@/features/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetRequest');
  return { title: t('title') };
}

export default function ResetPasswordPage(): ReactNode {
  return <ResetPasswordScreen />;
}
