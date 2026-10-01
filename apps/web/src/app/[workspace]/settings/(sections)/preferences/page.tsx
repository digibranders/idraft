import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PreferencesScreen } from '@/features/account';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('preferences') };
}

export default function PreferencesPage(): ReactNode {
  return <PreferencesScreen />;
}
