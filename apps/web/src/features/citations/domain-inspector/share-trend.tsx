'use client';

import { LineChart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import type { DomainDetailRead } from './domain-reads';
import { engineRole, shareTrend, type TrendCell } from './share-trend-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { EngineCode, SourceDomainDetailData } from '@/lib/citations/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatDateRange, formatPercent } from '@/lib/format';

export interface ShareTrendProps {
  domain: string;
  /** `null` while the read has nothing. */
  data: SourceDomainDetailData | null;
  /** The window the read covers, for the meta line. */
  range: { from: string; to: string };
  /** The engines with their names; an engine of the read that is not here is named by its code. */
  engines: readonly { code: EngineCode; label: string }[];
  /** How the domain's read is going: this card loads and fails with it, on its own. */
  read: Pick<DomainDetailRead, 'status' | 'errorId' | 'retry' | 'retrying'>;
  /** A read is on its way while the chart is on screen: it stays, marked busy. */
  refetching: boolean;
}

/** The height the inspector's charts are drawn at. */
const CHART_HEIGHT = 180;

interface TooltipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}
interface DrawnSeries {
  id?: string;
  name?: string;
  color?: string;
}

/**
 * The weekly share of the domain's citations on each engine (WB-DOM-03): one line for each engine, never pooled (a
 * share over the engines together would hide which engine cites the domain), a gap for a week the engine has no
 * unit in, and the count behind every point in its tooltip and in the Table view. The chart is an image named by its
 * title and described by its summary; the Table view is its full alternative.
 */
export function ShareTrend({ domain, data, range, engines, read, refetching }: ShareTrendProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const common = useTranslations('common');
  const locale = useLocale();
  const trend = useMemo(() => (data === null ? null : shareTrend(data)), [data]);
  const labelOf = useCallback(
    (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code,
    [engines],
  );
  const formatValue = useCallback((value: number): string => formatPercent(value, { locale }), [locale]);
  /** The words of one point: the same in the tooltip and in the table. */
  const pointText = useCallback(
    (value: number, cell: TrendCell): string =>
      t('trendCellShare', { share: formatValue(value), units: cell.units, total: cell.total }),
    [t, formatValue],
  );

  const categories = useMemo(() => (trend?.weeks ?? []).map((week) => formatChartDate(week)), [trend]);
  const series = useMemo(
    (): CategorySeries[] =>
      (trend?.series ?? []).map((entry) => ({
        id: entry.code,
        name: labelOf(entry.code),
        role: engineRole(entry.code),
        values: entry.values,
      })),
    [trend, labelOf],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const entry = trend?.series.find((candidate) => candidate.code === seriesId);
      const value = entry?.values[index];
      const cell = entry?.cells[index];
      return value == null || cell == null ? null : pointText(value, cell);
    },
    [trend, pointText],
  );
  /** The tooltip says each point with its count, best share first; an engine with no figure that week has no row. */
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> => {
      const drawn = (option.series as DrawnSeries[] | undefined) ?? [];
      const baseTooltip = (option.tooltip as Record<string, unknown> | undefined) ?? {};
      const formatter = (params: readonly TooltipParam[]): string => {
        const [first] = params;
        const index = first?.dataIndex ?? -1;
        const rows = drawn
          .flatMap((line) => {
            const entry = trend?.series.find((candidate) => candidate.code === line.id);
            const value = entry?.values[index];
            const cell = entry?.cells[index];
            return value == null || cell == null ? [] : [{ line, value, cell }];
          })
          .sort((a, b) => b.value - a.value)
          .map(({ line, value, cell }) =>
            tipRowHtml(line.color ?? tokens.other, line.name ?? '', pointText(value, cell), tokens),
          );
        return `${tipTitleHtml(first?.axisValueLabel ?? categories[index] ?? '')}${rows.join('')}`;
      };
      return { ...option, tooltip: { ...baseTooltip, formatter } };
    },
    [trend, categories, pointText],
  );

  const title = t('trendTitle');
  const status = data === null ? (read.status === 'error' ? 'error' : 'loading') : trend === null ? 'empty' : 'ready';
  if (status !== 'ready' || trend === null) {
    return (
      <InspectorSection
        title={title}
        icon={LineChart}
        status={status === 'ready' ? 'loading' : status}
        error={
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={read.errorId}
            onRetry={read.retry}
            retrying={read.retrying}
            retryLabel={common('retry')}
          />
        }
        empty={
          <EmptyState variant="inline" title={t('trendEmptyTitle')} reason={t('trendEmptyReason')} headingLevel={3} />
        }
      />
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        title={title}
        variant="inspector"
        meta={t('trendMeta', { range: formatDateRange(range.from, range.to) })}
        footnote={<p>{t('trendGapNote')}</p>}
        kind="line"
        categories={categories}
        categoryHeader={t('trendWeek')}
        cellText={cellText}
        series={series}
        formatValue={formatValue}
        height={CHART_HEIGHT}
        summary={t('trendSummary', { domain, weeks: trend.weeks.length, engines: trend.series.length })}
        status={refetching ? 'refetching' : 'ready'}
        extendOption={extendOption}
      />
    </div>
  );
}
