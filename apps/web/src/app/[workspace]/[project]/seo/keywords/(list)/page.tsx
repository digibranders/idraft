import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('navigation.items');
  return { title: t('rankings') };
}

/** SEO > Keywords: the layout renders the screen, so that the import route can open over it. */
export default function KeywordsPage(): ReactNode {
  return null;
}
