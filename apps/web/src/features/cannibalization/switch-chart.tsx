'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { CannRead } from './cann-reads';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CategorySeries } from '@/lib/charts/category-chart';
import type { CannSwitchList } from '@/lib/api/types';
import { formatChartDate, formatInteger } from '@/lib/format';

/**
 * Switches per week (docs/33 section 7.3): stacked columns by what the new page did to the rank, with the Table view of
 * the frame as the alternative. A week with many switches across many keywords is the visible sign of a Google update.
 */
export function SwitchChart({ read, days }: { read: CannRead<CannSwitchList>; days: number }): ReactElement {
  const t = useTranslations('cannibalization.chart');
  const weeks = read.data?.weeks;
  const categories = useMemo(() => (weeks ?? []).map((week) => formatChartDate(week.starts_on)), [weeks]);
  const series = useMemo(
    (): CategorySeries[] => [
      {
        id: 'improved',
        name: t('improved'),
        role: { kind: 'brand' },
        values: (weeks ?? []).map((week) => week.improved),
      },
      { id: 'same', name: t('same'), role: { kind: 'other' }, values: (weeks ?? []).map((week) => week.same) },
      {
        id: 'dropped',
        name: t('dropped'),
        role: { kind: 'palette', index: 3 },
        values: (weeks ?? []).map((week) => week.dropped),
      },
    ],
    [weeks, t],
  );
  const empty = weeks !== undefined && weeks.every((week) => week.improved + week.same + week.dropped === 0);
  const summary = t('summary', {
    days,
    weeks: (weeks ?? [])
      .map((week, index) =>
        t('week', {
          label: categories[index] ?? '',
          improved: week.improved,
          same: week.same,
          dropped: week.dropped,
        }),
      )
      .join('; '),
  });
  const common = {
    title: t('title'),
    variant: 'inspector' as const,
    meta: t('meta'),
    info: { what: t('info.what'), how: t('info.how') },
    height: 140 as const,
    summary,
    kind: 'bar' as const,
    categories,
    categoryHeader: t('weekOf'),
    series,
    formatValue: formatInteger,
    stacked: true,
  };
  return (
    <CardInfoProvider>
      <div className="shrink-0 border-b border-border-subtle px-4 py-2">
        {read.status === 'error' ? (
          <ChartFrame
            {...common}
            status="error"
            error={{
              title: t('errorTitle'),
              reason: t('errorReason'),
              errorId: read.errorId,
              onRetry: read.retry,
              retrying: read.retrying,
              retryLabel: t('retry'),
            }}
          />
        ) : empty ? (
          <ChartFrame {...common} status="empty" empty={{ title: t('emptyTitle'), reason: t('emptyReason') }} />
        ) : (
          <ChartFrame {...common} status={weeks === undefined ? 'loading' : read.refetching ? 'refetching' : 'ready'} />
        )}
      </div>
    </CardInfoProvider>
  );
}
