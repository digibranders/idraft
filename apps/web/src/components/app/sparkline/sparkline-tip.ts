'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import type { CellTip } from '@/components/app/data-table/types';

/** How many of the latest points a sparkline's tip names (15-data-visualization.md section 9). */
export const SPARK_TIP_POINTS = 7;

export interface SparkTipPoint {
  /** The date as the table words it ("Oct 26"). */
  dateText: string;
  /** The value, finished by `@/lib/format` ("34%"). */
  valueText: string;
}

/**
 * For a column's `cellTip`, which the table opens on hover and on cell focus: the title, then the last 7 points
 * as "Oct 26: 34%", oldest first. A sparkline without points has no tip.
 */
export function useSparklineTip(): (title: string, points: readonly SparkTipPoint[]) => CellTip | undefined {
  const t = useTranslations('chart.sparkline');
  return useCallback(
    (title, points) =>
      points.length === 0
        ? undefined
        : {
            content: title,
            detail: points
              .slice(-SPARK_TIP_POINTS)
              .map(({ dateText, valueText }) => t('tipPoint', { date: dateText, value: valueText }))
              .join(', '),
          },
    [t],
  );
}
