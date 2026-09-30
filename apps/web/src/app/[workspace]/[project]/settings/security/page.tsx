import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SecurityScreen } from '@/features/account';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('security') };
}

export default function SecurityPage(): ReactNode {
  return <SecurityScreen />;
}
