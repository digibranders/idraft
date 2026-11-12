'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { trendDirection, trendPoints, type TrendDirection, type TrendPoint } from './trend-model';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { SparklineCell, type SparklineTone } from '@/components/app/sparkline/sparkline-cell';
import type { EngineSummary, ProjectEngine } from '@/lib/api/types';
import { formatBusinessDate, formatPercent } from '@/lib/format';

/** The id of the Trend column, in the address's `cols` and the column chooser. */
export const TREND_COLUMN_ID = 'trend';

const TONE: Readonly<Record<TrendDirection, SparklineTone>> = {
  up: 'positive',
  down: 'negative',
  flat: 'reference',
};

type Translate = ReturnType<typeof useTranslations<'prompts.columns'>>;

const percent = (value: number): string => formatPercent(value, { decimals: 0 });

/** The graph's accessible name: the rate of each week in words, a week without one saying so. */
function labelOf(t: Translate, points: readonly TrendPoint[]): string {
  const known = points.some((point) => point.value !== null);
  return known
    ? t('trendLabel', {
        rates: points.map((point) => (point.value === null ? t('trendGap') : percent(point.value))).join(', '),
      })
    : t('trendLabelNone');
}

/** The cell's tooltip: the first and the last week with a rate, and which way it went. */
function tipOf(t: Translate, points: readonly TrendPoint[]): CellTip {
  const known = points.flatMap((point) => (point.value === null ? [] : [{ ...point, value: point.value }]));
  const first = known[0];
  const last = known.at(-1);
  if (first === undefined || last === undefined) return { content: t('trendNone') };
  const date = (weekStart: string): string => formatBusinessDate(weekStart, { withYear: false });
  return {
    content:
      first === last
        ? t('trendSingle', { value: percent(first.value), date: date(first.weekStart) })
        : t('trendRange', {
            first: percent(first.value),
            firstDate: date(first.weekStart),
            last: percent(last.value),
            lastDate: date(last.weekStart),
          }),
    detail: t('trendDirection', { direction: trendDirection(points) }),
  };
}

/**
 * Trend (parity spec G29): a sparkline of the weekly mention rate over the engines shown, for each week of the
 * window (the summary read with `include=series`: 5 weeks for 28 days, 14 for 90). A week with no rate is a gap in
 * the line, never 0. Its color follows the direction (and the tooltip and the accessible name say it in words). The
 * cell is blank while the series is not there (not loaded, a failed read, an older API), and the column does not
 * sort. Priority 2: it shows from 1280 px, and below that waits in the column chooser's reach. `cellsOf` must keep
 * its identity between renders (a module-level function).
 */
export function useTrendColumn<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
): DataTableColumn<TRow> {
  const t = useTranslations('prompts.columns');
  return useMemo(() => {
    const codes = engines.map((engine) => engine.engine.engine_code);
    return col.sparkline<TRow>(TREND_COLUMN_ID, {
      header: t('trend'),
      headerTooltip: t('trendHeaderTip'),
      priority: 2,
      width: 96,
      cell: (row) => {
        const points = trendPoints(codes, cellsOf(row));
        return points === null ? null : (
          <SparklineCell
            values={points.map((point) => point.value)}
            label={labelOf(t, points)}
            tone={TONE[trendDirection(points)]}
          />
        );
      },
      cellTip: (row) => {
        const points = trendPoints(codes, cellsOf(row));
        return points === null ? undefined : tipOf(t, points);
      },
    });
  }, [engines, cellsOf, t]);
}
