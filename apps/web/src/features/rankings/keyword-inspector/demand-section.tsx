'use client';

import { useQuery } from '@tanstack/react-query';
import { ChartColumn } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { metricsHistoryQuery, type KeywordDetail } from './inspector-queries';
import { SectionError } from './section-error';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatInteger, formatMonth, formatRelativeChange } from '@/lib/format';

const COMPETITION_KEY = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' } as const;

/**
 * Volume, keyword difficulty and CPC as the inspector's key-value strip (23-application-patterns.md
 * section 4.2; the rank items join with rank collection). Before Labs answers, each reads "Pending"; after
 * an answer without the value, "No data" (12-tables.md section 7.3).
 */
export function KeywordMetricStrip({ detail }: { detail: KeywordDetail | null }): ReactElement {
  const t = useTranslations('rankings.inspector.metrics');
  const metrics = detail?.metrics ?? null;
  const unknownItem = (id: string, label: string): MetricStripItem =>
    metrics === null
      ? { id, label, value: t('pending'), unknown: { kind: 'pending' }, context: t('pendingNote') }
      : { id, label, value: t('noData'), unknown: { kind: 'not-applicable' }, context: t('noDataNote') };

  const items: MetricStripItem[] = [];
  const volume = metrics?.search_volume ?? null;
  if (metrics === null || volume === null || volume.value === null) items.push(unknownItem('volume', t('volume')));
  else {
    items.push({
      id: 'volume',
      label: t('volume'),
      labelAddon: volume.is_estimate ? (
        <Badge tone="info" variant="text">
          {t('estimate')}
        </Badge>
      ) : undefined,
      value: formatInteger(volume.value),
      context: monthOf(metrics.data_month, (month) => t('volumeNote', { month })) ?? t('volumeNoteUndated'),
    });
  }
  const difficulty = metrics?.keyword_difficulty ?? null;
  if (metrics === null || difficulty === null) items.push(unknownItem('difficulty', t('difficulty')));
  else {
    const level = metrics.competition_level;
    items.push({
      id: 'difficulty',
      label: t('difficulty'),
      value: formatInteger(difficulty),
      context:
        level === null
          ? t('competitionUnknown')
          : t('difficultyNote', { level: t(`competition.${COMPETITION_KEY[level]}`) }),
    });
  }
  const cpc = metrics?.cpc_usd ?? null;
  if (metrics === null || cpc === null) items.push(unknownItem('cpc', t('cpc')));
  else items.push({ id: 'cpc', label: t('cpc'), value: formatCurrency(Number(cpc)), context: t('cpcNote') });
  const groups: MetricStripGroup[] = [{ id: 'demand', items }];

  return <MetricStrip size="sm" label={t('label')} groups={groups} status={detail === null ? 'loading' : 'ready'} />;
}

/** `2026-08-01` as "Aug 2026" through `format`, or `null` without a month. */
function monthOf(dataMonth: string | null, format: (month: string) => string): string | null {
  if (dataMonth === null) return null;
  const [year, month] = dataMonth.split('-').map(Number);
  return year === undefined || month === undefined || Number.isNaN(year) || Number.isNaN(month)
    ? null
    : format(formatMonth(year, month));
}

/**
 * Searches by month from the keyword's latest Labs snapshot, as a bar chart with its table view
 * (15-data-visualization.md, 16 section 2.4 "Chart card"), with the trend and whether demand is seasonal.
 */
export function VolumeByMonth({ workspaceId, detail }: { workspaceId: string; detail: KeywordDetail }): ReactElement {
  const t = useTranslations('rankings.inspector.demand');
  const history = useQuery(metricsHistoryQuery(workspaceId, detail));
  const data = history.data?.data ?? null;
  const months = useMemo(
    () => [...(data?.snapshots.at(-1)?.monthly_searches ?? [])].sort((a, b) => a.year - b.year || a.month - b.month),
    [data],
  );
  const series = useMemo(
    () => [
      {
        id: 'searches',
        name: t('series'),
        role: { kind: 'brand' as const },
        values: months.map((m) => m.search_volume),
      },
    ],
    [t, months],
  );
  const categories = useMemo(() => months.map((m) => formatMonth(m.year, m.month)), [months]);
  const formatValue = useCallback((value: number) => formatInteger(value), []);

  if (data === null || months.length === 0) {
    return (
      <InspectorSection
        title={t('title')}
        icon={ChartColumn}
        status={history.isPending ? 'loading' : history.isError ? 'error' : 'empty'}
        error={
          <SectionError
            title={t('failed')}
            error={history.error}
            onRetry={() => void history.refetch()}
            retrying={history.isFetching}
          />
        }
        empty={<EmptyState variant="inline" title={t('empty')} reason={t('emptyReason')} headingLevel={3} />}
      />
    );
  }

  const known = months.flatMap((m) => (m.search_volume === null ? [] : [m.search_volume]));
  const trend = data.trend.value;
  const meta =
    trend === null
      ? t('meta', { count: months.length })
      : t('metaWithTrend', { count: months.length, trend: formatRelativeChange(trend) });
  const seasonal = data.seasonality.is_seasonal;
  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        title={t('title')}
        variant="inspector"
        meta={meta}
        footnote={seasonal === null ? undefined : seasonal ? t('seasonal') : t('notSeasonal')}
        kind="bar"
        categories={categories}
        categoryHeader={t('category')}
        series={series}
        formatValue={formatValue}
        height={180}
        summary={t('summary', {
          from: categories[0] ?? '',
          to: categories.at(-1) ?? '',
          min: formatInteger(known.length === 0 ? null : Math.min(...known)),
          max: formatInteger(known.length === 0 ? null : Math.max(...known)),
        })}
        status="ready"
      />
    </div>
  );
}
