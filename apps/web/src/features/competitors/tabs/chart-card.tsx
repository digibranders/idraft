'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { Read } from '../data/read-state';
import { ChartFrame, type ChartEmpty, type ChartError, type ChartHeight } from '@/components/app/chart/chart-frame';
import type { CategorySeries } from '@/lib/charts/category-chart';

/** A bar chart names every bar: the axis would otherwise skip labels that do not fit, leaving bars unnamed. */
function nameEveryBar(option: Record<string, unknown>): Record<string, unknown> {
  const axis = option['xAxis'];
  if (typeof axis !== 'object' || axis === null || Array.isArray(axis)) return option;
  const { axisLabel, data } = axis as { axisLabel?: Record<string, unknown>; data?: readonly unknown[] };
  // Names that would overlap lean over, so every one can be read in a narrow card
  const crowded = (data?.length ?? 0) > 3;
  return {
    ...option,
    xAxis: {
      ...axis,
      axisLabel: {
        ...axisLabel,
        interval: 0,
        width: crowded ? 90 : 72,
        overflow: 'truncate',
        ...(crowded ? { rotate: 30 } : {}),
      },
    },
  };
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

export type CardStatus =
  | { status: 'loading' | 'ready' | 'refetching'; error?: undefined; empty?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined };

/** The state of a card from the reads behind it: the first failed read is the error, any read still open is loading. */
export function useCardStatus(reads: readonly Read<unknown>[], isEmpty: boolean): CardStatus {
  const t = useTranslations('competitors.states');
  const common = useTranslations('common');
  const status = useTranslations('status.error');
  const failed = reads.find((read) => read.status === 'error');
  if (failed !== undefined) {
    return {
      status: 'error',
      error: {
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
      },
    };
  }
  if (reads.some((read) => read.status === 'loading' || read.status === 'idle')) return { status: 'loading' };
  if (isEmpty) return { status: 'empty', empty: { title: t('noDataTitle'), reason: t('noDataReason') } };
  return { status: reads.some((read) => read.status === 'refetching') ? 'refetching' : 'ready' };
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
  const state = useCardStatus(reads, isEmpty);
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
  if (state.status === 'error') return <ChartFrame {...shared} status="error" error={state.error} />;
  if (state.status === 'empty') return <ChartFrame {...shared} status="empty" empty={state.empty} />;
  return <ChartFrame {...shared} status={state.status} />;
}
