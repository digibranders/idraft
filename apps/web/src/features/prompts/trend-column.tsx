'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { trendDirection, trendPoints, type TrendPoint } from './trend-model';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import type { EngineSummary, ProjectEngine } from '@/lib/api/types';
import { formatBusinessDate, formatPercent } from '@/lib/format';

/** The id of the Trend column, in the address's `cols` and the column chooser. */
export const TREND_COLUMN_ID = 'trend';

/** A rate is drawn on a span of at least 20 points, so a move of a point or two stays flat (15-data-visualization.md section 9). */
const RATE_MIN_SPAN = 0.2;

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

/**
 * The cell's tooltip: the first and the last week with a rate, and, when there are two full weeks with enough
 * answers to compare, which way it went between them.
 */
function tipOf(t: Translate, points: readonly TrendPoint[]): CellTip {
  const known = points.flatMap((point) => (point.value === null ? [] : [{ ...point, value: point.value }]));
  const first = known[0];
  const last = known.at(-1);
  if (first === undefined || last === undefined) return { content: t('trendNone') };
  const date = (weekStart: string): string => formatBusinessDate(weekStart, { withYear: false });
  const direction = trendDirection(points);
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
    ...(direction === 'none' ? {} : { detail: t('trendDirection', { direction }) }),
  };
}

/**
 * One row's sparkline. Its weeks are worked out again only when the row's cells change, so the canvas is drawn
 * again only when the data does, not each time the table draws the row (choosing it, hovering it).
 */
function TrendCell({
  cells,
  codes,
}: {
  cells: readonly EngineSummary[] | undefined;
  codes: readonly string[];
}): ReactElement | null {
  const t = useTranslations('prompts.columns');
  const shown = useMemo(() => {
    const points = trendPoints(codes, cells);
    return points === null ? null : { values: points.map((point) => point.value), label: labelOf(t, points) };
  }, [cells, codes, t]);
  // Never red or green: the line is the reference gray whichever way the rate went (the words say which way)
  return shown === null ? null : (
    <SparklineCell values={shown.values} label={shown.label} tone="reference" minSpan={RATE_MIN_SPAN} />
  );
}

/**
 * Trend (parity spec G29): a sparkline of the weekly mention rate over the engines shown, for each week of the
 * window (the summary read with `include=series`: 5 weeks for 28 days, 14 for 90). A week with no rate is a gap in
 * the line, never 0. The line is gray; the accessible name lists the rate of each week and the tooltip says which way
 * it went, from full weeks with enough answers only. The cell is blank while the series is not there (not loaded, a
 * failed read, an older API), and the column does not sort. Priority 2: it shows from 1280 px, and below that waits
 * in the column chooser's reach. `cellsOf` must keep its identity between renders (a module-level function).
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
      cell: (row) => <TrendCell cells={cellsOf(row)} codes={codes} />,
      cellTip: (row) => {
        const points = trendPoints(codes, cellsOf(row));
        return points === null ? undefined : tipOf(t, points);
      },
    });
  }, [engines, cellsOf, t]);
}
