'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { RateTipWords } from '@/lib/charts/rate-tip';
import { formatInterval, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The words of a rate tooltip: the sentences from `chart.tip`, the numbers from the house formats. */
export function useRateTipWords(): RateTipWords {
  const t = useTranslations('chart.tip');
  return useMemo(
    () => ({
      value: (ratio) => formatPercent(ratio),
      answers: (k, n) => t('answers', { k, n }),
      interval: (band) => formatInterval(band.low, band.high),
      prompts: (count) => t('prompts', { count }),
      thin: (n) => t('thin', { n, min: MIN_OBSERVATIONS }),
      pooled: (weeks) => t('pooled', { weeks }),
      noAnswers: t('noAnswers'),
    }),
    [t],
  );
}
