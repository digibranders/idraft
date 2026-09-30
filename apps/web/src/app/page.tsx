import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export default function HomePage(): ReactNode {
  const t = useTranslations('app');
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <h1 className="type-page-title">{t('name')}</h1>
    </main>
  );
}
