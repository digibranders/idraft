'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { Read } from '../data/read-state';
import { ChartFrame, type ChartHeight } from '@/components/app/chart/chart-frame';
import type { CategorySeries } from '@/lib/charts/category-chart';

/** A bar chart names every bar: the axis would otherwise skip labels that do not fit, leaving bars unnamed. */
function nameEveryBar(option: Record<string, unknown>): Record<string, unknown> {
  const axis = option['xAxis'];
  if (typeof axis !== 'object' || axis === null || Array.isArray(axis)) return option;
  const label = (axis as { axisLabel?: Record<string, unknown> }).axisLabel ?? {};
  return { ...option, xAxis: { ...axis, axisLabel: { ...label, interval: 0, width: 72, overflow: 'truncate' } } };
}

export interface ChartCardProps {
  title: string;
  /** What the chart shows, for people who cannot see it. */
  summary: string;
  kind: 'line' | 'bar';
  categories: readonly string[];
  categoryHeader: string;
  series: readonly CategorySeries[];
  formatValue: (value: number) => string;
  height?: ChartHeight;
  stacked?: boolean;
  /** The reads behind the card: the worst of them is the card's state. */
  reads: readonly Read<unknown>[];
  /** Nothing to draw although the reads are ready. */
  isEmpty: boolean;
  fileName: string;
  meta?: string | undefined;
}

/** One chart of the page: the frame of the app's charts, with the page's loading, empty and error states. */
export function ChartCard({
  title,
  summary,
  kind,
  categories,
  categoryHeader,
  series,
  formatValue,
  height = 240,
  stacked,
  reads,
  isEmpty,
  fileName,
  meta,
}: ChartCardProps): ReactElement {
  const t = useTranslations('competitors.states');
  const common = useTranslations('common');
  const status = useTranslations('status.error');
  const failed = reads.find((read) => read.status === 'error');
  const loading = reads.some((read) => read.status === 'loading' || read.status === 'idle');
  const refetching = reads.some((read) => read.status === 'refetching');
  const shared = {
    title,
    summary,
    kind,
    categories,
    categoryHeader,
    series,
    formatValue,
    height,
    variant: 'panel' as const,
    meta,
    menu: { fileName, csv: true },
    ...(kind === 'bar' ? { extendOption: nameEveryBar } : {}),
    ...(stacked === undefined ? {} : { stacked }),
  };
  if (failed !== undefined) {
    return (
      <ChartFrame
        {...shared}
        status="error"
        error={{
          title: t('readFailedTitle'),
          reason: t('readFailedReason'),
          errorId:
            failed.errorId === null
              ? null
              : {
                  id: failed.errorId,
                  label: status('errorId', { id: failed.errorId }),
                  copyLabel: status('copyErrorId'),
                  copiedLabel: status('copied'),
                },
          onRetry: () => reads.forEach((read) => read.refetch()),
          retrying: false,
          retryLabel: common('retry'),
        }}
      />
    );
  }
  if (loading) return <ChartFrame {...shared} status="loading" />;
  if (isEmpty) {
    return <ChartFrame {...shared} status="empty" empty={{ title: t('noDataTitle'), reason: t('noDataReason') }} />;
  }
  return <ChartFrame {...shared} status={refetching ? 'refetching' : 'ready'} />;
}
