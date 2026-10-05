import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rankings');
  return { title: t('import.pageTitle') };
}

/** SEO > Rankings > Import: the layout renders Rankings with the import dialog open over it. */
export default function RankingsImportPage(): ReactNode {
  return null;
}
