import { useTranslations } from 'next-intl';

import type { CardInfo } from '@/components/app/chart/card-info';

/** The charts of the Competitors page that carry an "i" button; each id is a key of `competitors.info`. */
export type ChartInfoId =
  | 'mentionsByBrand'
  | 'mentionsByPlatform'
  | 'mentionsTrend'
  | 'citationsByBrand'
  | 'citationsByPlatform'
  | 'sovByBrand'
  | 'sovByPlatform'
  | 'sovTrend'
  | 'sovChange'
  | 'sovSplit'
  | 'citationsSplit'
  | 'lostSplit'
  | 'visibilityByPlatform'
  | 'seoRankSplit'
  | 'seoTop10'
  | 'seoBuckets';

/** What a chart of the page shows and how it is counted, by chart id. */
export function useChartInfo(): (id: ChartInfoId) => CardInfo {
  const t = useTranslations('competitors.info');
  return (id) => ({ what: t(`${id}.what`), how: t(`${id}.how`) });
}
