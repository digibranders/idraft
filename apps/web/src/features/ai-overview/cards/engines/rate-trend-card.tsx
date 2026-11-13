'use client';

import type { ReactElement } from 'react';

import { TrendFrame } from './trend-frame';
import { isTrendMetric, type TrendMetric } from './trend-model';
import { useCardData } from './use-card-data';
import type { CardProps } from '@/features/layouts';

/** The name of the downloaded file, without its extension. */
const FILE_NAME = 'rates-by-engine-over-time';

const metricOf = (value: string | undefined): TrendMetric =>
  value !== undefined && isTrendMetric(value) ? value : 'mention';

/**
 * Rates by engine over time (CH-01, WB-OV-05): one small chart per asked engine on one scale, with a Series menu
 * for the metric. The card's saved Metric option is where the menu starts; the viewer's choice is not saved.
 */
export default function RateTrendCard({ item, options }: CardProps): ReactElement {
  const data = useCardData({ previous: 'optional', include: ['series'] });
  const saved = metricOf(options.metric);
  return (
    <TrendFrame
      // A new saved option starts the menu again from it
      key={saved}
      itemId={item.id}
      data={data}
      engines={data.asked}
      metric={saved}
      switchable
      height={140}
      fileName={FILE_NAME}
    />
  );
}
