'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { dayWorkloadSeries } from './cost-model';
import type { CategorySeries } from '@/lib/charts/category-chart';
import type { CostRow } from '@/lib/api/types';
import { formatChartDate } from '@/lib/format';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';

export interface SpendChart {
  categories: string[];
  series: CategorySeries[];
}

/**
 * The spend chart's categories and series from the `day, workload` rows of the days `from` to `to`. Both are
 * the same arrays until the rows or the days change: a chart handed new ones redraws, which closes the tooltip
 * of a reader who is hovering a bar whenever any query of the page settles.
 */
export function useSpendChart(rows: readonly CostRow[] | undefined, from: string, to: string): SpendChart {
  const t = useTranslations('costs');
  const workloadName = useWorkloadName();
  const other = t('other');
  return useMemo(() => {
    const { days, series } = dayWorkloadSeries(rows ?? [], { from, to }, workloadName, other);
    return { categories: days.map((day) => formatChartDate(day)), series };
  }, [rows, from, to, workloadName, other]);
}
