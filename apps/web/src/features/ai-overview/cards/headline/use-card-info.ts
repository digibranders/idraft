'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import type { CardInfo } from '@/components/app/chart/card-info';

/** The info texts of the headline: the hero's and each tile's, what it shows and then how it is counted. */
export type InfoKey =
  'hero' | 'mention' | 'sov' | 'citation' | 'position' | 'recommendation' | 'sentiment' | 'prompts' | 'traffic';

export function useInfoOf(): (key: InfoKey) => CardInfo {
  const t = useTranslations('aiOverview.headline.info');
  return useCallback((key) => ({ what: t(`${key}.what`), how: t(`${key}.how`) }), [t]);
}
