import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.notFound');
  return { title: t('title') };
}

export default function NotFound(): ReactNode {
  const t = useTranslations('errors.notFound');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="type-page-title">{t('title')}</h1>
      <p className="type-body text-foreground-secondary">{t('description')}</p>
    </main>
  );
}
