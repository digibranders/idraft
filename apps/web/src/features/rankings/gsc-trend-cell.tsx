'use client';

import type { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { GscMetric } from './gsc-counts';
import { trendDirection, type TrendDirection } from './gsc-trend';
import type { CellTip } from '@/components/app/data-table/types';
import { SparklineCell, type SparklineTone } from '@/components/app/sparkline/sparkline-cell';
import { formatInteger } from '@/lib/format';

export type GscTrendTranslate = ReturnType<typeof useTranslations<'rankings.gscTrend'>>;

const TONE: Readonly<Record<TrendDirection, SparklineTone>> = {
  up: 'positive',
  down: 'negative',
  flat: 'reference',
  insufficient: 'reference',
};

export interface GscTrendWords {
  /** The graph's accessible name: the movement in words, so the colour is never the only sign of it. */
  label: string;
  tone: SparklineTone;
  /** The cell's tooltip: the movement, then the totals of the two halves compared. */
  tip: CellTip;
}

export function gscTrendWords(t: GscTrendTranslate, buckets: readonly number[], metric: GscMetric): GscTrendWords {
  const reading = trendDirection(buckets, metric);
  const label =
    reading.direction === 'insufficient'
      ? t('insufficient', { metric })
      : reading.direction === 'flat'
        ? t('flat', { metric })
        : reading.percent === null
          ? t('upFromNone', { metric })
          : t(reading.direction, { metric, percent: reading.percent });
  return {
    label,
    tone: TONE[reading.direction],
    tip: {
      content: label,
      detail: t('halves', { earlier: formatInteger(reading.earlier), later: formatInteger(reading.later) }),
    },
  };
}

/** A Search Console count with the graph of its 4-day buckets beside it. */
export function GscTrendCell({
  value,
  buckets,
  words,
}: {
  value: number;
  buckets: readonly number[];
  words: GscTrendWords;
}): ReactElement {
  return (
    <span className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate num">{formatInteger(value)}</span>
      <SparklineCell values={buckets} label={words.label} tone={words.tone} />
    </span>
  );
}
