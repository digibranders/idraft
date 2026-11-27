'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { chartOf } from '../series';
import type { MetricKey, PageNumbers, SearchWindow, SeriesPoint } from '../types';
import { METRICS } from './use-panel-state';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { Button } from '@/components/ui/button';
import type { CategorySeries, SeriesRole } from '@/lib/charts/category-chart';
import {
  formatChartDate,
  formatCompact,
  formatDateRange,
  formatDecimal,
  formatInteger,
  formatPercent,
} from '@/lib/format';

const HEIGHT = 140;
const CURRENT_ID = 'current';
const PREVIOUS_ID = 'previous';
const REFERENCE: SeriesRole = { kind: 'reference' };

/**
 * A lower position is better, so its axis runs downwards and a better position is higher on the chart. The rank
 * chart's own axis (`rankAxis`) draws depth bands for ranks 1 to 20, which an average over a period does not have.
 */
const invertedAxis = (option: Record<string, unknown>): Record<string, unknown> => ({
  ...option,
  yAxis: { ...(option['yAxis'] as Record<string, unknown>), inverse: true },
});

const axisFormat = (metric: MetricKey, value: number): string => {
  switch (metric) {
    case 'clicks':
    case 'impressions':
      return formatCompact(value);
    case 'ctr':
      return formatPercent(value);
    case 'position':
      return formatDecimal(value, 1);
  }
};

const totalOf = (metric: MetricKey, current: PageNumbers): string => {
  switch (metric) {
    case 'clicks':
    case 'impressions':
      return formatInteger(current[metric]);
    case 'ctr':
      return formatPercent(current.ctr);
    case 'position':
      return formatDecimal(current.position, 1);
  }
};

export interface MetricChartsProps {
  current: PageNumbers;
  series: readonly SeriesPoint[];
  previousSeries: readonly SeriesPoint[];
  window: SearchWindow;
  compareWindow: SearchWindow | null;
  metrics: readonly MetricKey[];
  onToggle: (metric: MetricKey) => void;
  status: 'ready' | 'refetching';
}

/** One row of four toggles picks the metrics; each ticked metric is a line chart of the period and the period compared with. */
export function MetricCharts({
  current,
  series,
  previousSeries,
  window,
  compareWindow,
  metrics,
  onToggle,
  status,
}: MetricChartsProps): ReactElement {
  const t = useTranslations('pageSearch');
  const period = formatDateRange(window.from, window.to);
  const before =
    compareWindow === null ? t('compare.previousPeriod') : formatDateRange(compareWindow.from, compareWindow.to);
  const previous = useMemo(() => (previousSeries.length === 0 ? null : previousSeries), [previousSeries]);
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t('overTime')} className="flex flex-wrap gap-2">
        {METRICS.map((metric) => {
          const ticked = metrics.includes(metric);
          return (
            <Button
              key={metric}
              size="sm"
              aria-pressed={ticked}
              disabled={ticked && metrics.length === 1}
              onClick={() => {
                onToggle(metric);
              }}
            >
              {t(`metrics.${metric}`)}
            </Button>
          );
        })}
      </div>
      {metrics.map((metric) => {
        const lines = chartOf(series, previous, metric);
        const frameSeries: CategorySeries[] = [
          { id: CURRENT_ID, name: period, role: { kind: 'brand' }, values: lines.current },
          ...(lines.previous === null
            ? []
            : [{ id: PREVIOUS_ID, name: before, role: REFERENCE, values: lines.previous }]),
        ];
        return (
          <ChartFrame
            key={metric}
            kind="line"
            variant="inspector"
            status={status}
            height={HEIGHT}
            title={t(`metrics.${metric}`)}
            categoryHeader={t('categoryHeader')}
            categories={lines.categories.map((date) => formatChartDate(date))}
            series={frameSeries}
            formatValue={(value) => axisFormat(metric, value)}
            summary={t('chartSummary', {
              metric: t(`metrics.${metric}`),
              period,
              total: totalOf(metric, current),
            })}
            {...(metric === 'position' ? { extendOption: invertedAxis } : {})}
          />
        );
      })}
    </div>
  );
}
