import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CannibalizationRoute } from './cannibalization-route';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('cannibalization');
  return { title: t('title') };
}

/** SEO > Cannibalization (docs/33 section 7.1: `/seo/cannibalization`). The Switching tab is the sibling route. */
export default function CannibalizationPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/cannibalization'>): Promise<ReactNode> {
  return CannibalizationRoute({ params, tab: 'cannibalization' });
}
