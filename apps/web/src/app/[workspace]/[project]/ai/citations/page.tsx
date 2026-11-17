import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CitationsRoute } from './citations-route';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('citations');
  return { title: t('title') };
}

/** AI > Citations, Cited pages (brief 3.1: `/ai/citations`). The Gap analysis tab is the sibling route `gaps`. */
export default function CitationsPage({
  params,
}: PageProps<'/[workspace]/[project]/ai/citations'>): Promise<ReactNode> {
  return CitationsRoute({ params, tab: 'pages' });
}
