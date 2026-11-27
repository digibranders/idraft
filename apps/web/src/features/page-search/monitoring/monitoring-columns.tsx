'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import { CannibalizationCell } from './cannibalization-cell';
import { MetricValueCell, type MetricChange } from './metric-value-cell';
import { cannibalizationSortValue, queriesSortValue } from './monitoring-rows';
import { QueriesCell } from './queries-cell';
import { attentionOrder, healthTone } from '../health';
import { HEALTH_KEYS } from '../panel/verdict';
import { relativeChange } from '../panel/metric-tiles';
import type { PageNumbers, TrackedPageRow } from '../types';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  EMPTY_VALUE,
  formatCompact,
  formatDecimal,
  formatMetricDelta,
  formatPercent,
  type MetricDeltaInput,
} from '@/lib/format';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageTier } from '@/lib/internal-links/types';

type Column = DataTableColumn<TrackedPageRow>;

/** A change of a plain number between the periods: the app's delta formatter chooses the tone. */
const deltaOf = (value: number, unit: MetricDeltaInput['unit'], detectable: boolean): MetricDeltaInput => ({
  value,
  unit,
  polarity: 'higher_is_better',
  isDetectable: detectable ? true : null,
});

/** A change drawn beside a value: the formatter's text and tone, and what it is against. */
const changeOf = (input: MetricDeltaInput, tip: string | undefined): MetricChange => {
  const { text, tone } = formatMetricDelta(input);
  return { text, tone, tip };
};

/** The sort number of a tier; a code the API never sends sorts last instead of throwing inside the render. */
function tierNumber(tier: PageTier | null): number | null {
  try {
    return tierPosition(tier);
  } catch {
    return null;
  }
}

export interface MonitoringColumnContext {
  /** `null` while the tiers load. */
  tiers: readonly PageTier[] | null;
  /** The days of the period and of the period compared with; `null` before the first answer. */
  days: { current: number; before: number } | null;
  /** Search Console is still loading the first days: no row has numbers. */
  pending: boolean;
  /** The project's Cannibalization page, or `null` while the app has none. */
  cannibalizationHref: Route | null;
  /** At least one row has a Cannibalization value, so the column is drawn. */
  showCannibalization: boolean;
}

/**
 * The Monitoring columns (spec 10.1): Page, Tier, Health, Clicks, Impressions, CTR, Average position, Queries,
 * Cannibalization (only once the API fills it) and Trend. A number cell is its value and its change in the smaller
 * type step (`MetricValueCell`). A row whose history is not fetched, or any row while Search Console is loading,
 * draws skeletons and sorts last (`null` sort values).
 */
export function useMonitoringColumns({
  tiers,
  days,
  pending,
  cannibalizationHref,
  showCannibalization,
}: MonitoringColumnContext): Column[] {
  const t = useTranslations('monitoring');
  const p = useTranslations('pageSearch');
  const before = days?.before;
  const current = days?.current;
  return useMemo((): Column[] => {
    const span = current === undefined || before === undefined ? null : { current, before };
    const loading = (row: TrackedPageRow): boolean => pending || row.history === 'loading';
    const numbers = (row: TrackedPageRow): PageNumbers | null => (loading(row) ? null : row.current);
    const skeleton = <Skeleton shape="text-12" widthPct={64} />;
    const missing = (text: string): ReactNode => <span className="text-foreground-tertiary">{text}</span>;
    const noImpressions = p('states.noImpressions');

    const custom = (
      id: string,
      type: Column['type'],
      header: string,
      cell: Column['cell'],
      extra: Partial<Column> = {},
    ): Column => ({ id, type, header, cell, priority: 1, defaultVisible: true, ...extra });

    const countColumn = (id: 'clicks' | 'impressions'): Column =>
      custom(
        id,
        'volumeTrend',
        p(`metrics.${id}`),
        (row) => {
          if (loading(row)) return skeleton;
          if (row.current === null) return missing(EMPTY_VALUE);
          const earlier = row.previous?.[id] ?? null;
          const relative = span === null ? null : relativeChange(row.current[id], earlier, span);
          return (
            <MetricValueCell
              value={formatCompact(row.current[id])}
              change={
                relative === null || earlier === null
                  ? null
                  : changeOf(deltaOf(relative, 'relative', false), p('beforeValue', { value: formatCompact(earlier) }))
              }
            />
          );
        },
        { width: 152, sortValue: (row) => numbers(row)?.[id] ?? null },
      );

    const ctr = custom(
      'ctr',
      'volumeTrend',
      p('metrics.ctr'),
      (row) => {
        if (loading(row)) return skeleton;
        if (row.current === null || row.current.ctr === null) return missing(EMPTY_VALUE);
        const earlier = row.previous?.ctr ?? null;
        return (
          <MetricValueCell
            value={formatPercent(row.current.ctr)}
            change={
              earlier === null
                ? null
                : changeOf(
                    deltaOf(row.current.ctr - earlier, 'points', false),
                    p('beforeValue', { value: formatPercent(earlier) }),
                  )
            }
          />
        );
      },
      {
        width: 152,
        sortValue: (row) => numbers(row)?.ctr ?? null,
        cellTip: (row) =>
          !loading(row) && row.current !== null && row.current.ctr === null ? { content: noImpressions } : undefined,
      },
    );

    const position = custom(
      'position',
      'rank',
      p('metrics.position'),
      (row) => {
        if (loading(row)) return skeleton;
        if (row.current === null || row.current.position === null) return missing(EMPTY_VALUE);
        const earlier = row.previous?.position ?? null;
        // A lower position number is better, so the improvement is the earlier position minus this one
        const improved = earlier === null ? null : earlier - row.current.position;
        const places = improved === null ? null : formatDecimal(Math.abs(improved), 1);
        return (
          <MetricValueCell
            value={formatDecimal(row.current.position, 1)}
            change={
              improved === null || places === null || places === formatDecimal(0, 1)
                ? null
                : {
                    text: p(improved > 0 ? 'positionImproved' : 'positionSlipped', { places }),
                    tone: formatMetricDelta(deltaOf(improved, 'count', true)).tone,
                    tip: p('beforeValue', { value: formatDecimal(earlier, 1) }),
                  }
            }
          />
        );
      },
      {
        width: 136,
        minWidth: 136,
        sortValue: (row) => numbers(row)?.position ?? null,
        cellTip: (row) =>
          !loading(row) && row.current !== null && row.current.position === null
            ? { content: noImpressions }
            : undefined,
      },
    );

    const tierOf = (row: TrackedPageRow): PageTier | null =>
      row.tier_id === null ? null : (tiers?.find((one) => one.tier_id === row.tier_id) ?? null);

    return [
      {
        ...col.keyword<TrackedPageRow>('page', (row) => row.path, { header: t('columns.page') }),
        // The full address is the tooltip, with the title under it
        cellTip: (row) => ({ content: row.url, detail: row.title ?? undefined }),
      },
      // `rank` sorts by number, which a `badge` column does not: it compares text, and `10` would come before `2`
      custom(
        'tier',
        'rank',
        t('columns.tier'),
        (row) =>
          row.tier_id !== null && tiers === null ? <Skeleton shape="badge" /> : <TierBadge tier={tierOf(row)} />,
        { width: 104, minWidth: 104, priority: 2, sortValue: (row) => tierNumber(tierOf(row)) },
      ),
      custom(
        'health',
        'rank',
        t('columns.health'),
        (row) => {
          if (loading(row)) return <Skeleton shape="badge" />;
          if (row.health === null) return missing(EMPTY_VALUE);
          const name = p(`health.${HEALTH_KEYS[row.health.verdict]}`);
          return <Badge tone={healthTone(row.health.verdict)}>{name}</Badge>;
        },
        {
          width: 136,
          minWidth: 136,
          sortValue: (row) => (loading(row) || row.health === null ? null : attentionOrder(row.health)),
        },
      ),
      countColumn('clicks'),
      countColumn('impressions'),
      ctr,
      position,
      custom(
        'queries',
        'volumeTrend',
        t('columns.queries'),
        (row) => <QueriesCell queries={row.queries} loading={loading(row)} />,
        {
          headerTooltip: t('columns.queriesTip'),
          width: 152,
          sortValue: (row) => (loading(row) ? null : queriesSortValue(row)),
        },
      ),
      ...(showCannibalization
        ? [
            custom(
              'cannibalization',
              'volume',
              t('columns.cannibalization'),
              (row) =>
                loading(row) ? (
                  <Skeleton shape="badge" />
                ) : (
                  <CannibalizationCell value={row.cannibalization ?? null} path={row.path} href={cannibalizationHref} />
                ),
              { width: 120, sortValue: (row) => (loading(row) ? null : cannibalizationSortValue(row)) },
            ),
          ]
        : []),
      col.sparkline<TrackedPageRow>('trend', {
        header: t('columns.trend'),
        priority: 3,
        cell: (row) =>
          loading(row) || row.trend === null ? (
            <Skeleton shape="sparkline" />
          ) : (
            <SparklineCell values={row.trend} label={t('trendLabel', { path: row.path })} kind="count" />
          ),
      }),
    ];
  }, [t, p, tiers, current, before, pending, cannibalizationHref, showCannibalization]);
}
