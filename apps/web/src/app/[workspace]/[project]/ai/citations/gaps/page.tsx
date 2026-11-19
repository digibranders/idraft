import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CitationsRoute } from '../citations-route';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('citations');
  return { title: t('title') };
}

/** AI > Citations, Gap analysis (brief 3.1: `/ai/citations/gaps`). */
export default function CitationsGapsPage({
  params,
}: PageProps<'/[workspace]/[project]/ai/citations/gaps'>): Promise<ReactNode> {
  return CitationsRoute({ params, tab: 'gaps' });
}
