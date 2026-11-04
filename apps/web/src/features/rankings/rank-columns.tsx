'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { BestRankView, RankCellView, RankingUrlView, StaleMarker, useRankTips } from './rank-cells';
import { SerpFeatureListView, AioStatusView, CompetitorRankView } from './feature-cells';
import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import type { PairedRow } from './keyword-pairs';
import type { EntityRef, TrackedKeywordRow } from '@/lib/api/types';
import { sparklineSummary } from '@/lib/charts/sparkline';
import {
  aioDisplay,
  formatDetailDateTime,
  formatRankCell,
  formatTableDate,
  rankDisplay,
  rowChangeDisplay,
  urlDisplay,
} from '@/lib/format';
import { featureListDisplay, isFeatureType, FEATURE_MESSAGE_KEYS } from '@/lib/keywords/serp-features';

/** The ids of the rank columns: the API's sort fields, except the ranking URL, which does not sort. */
export const RANK_COLUMN_IDS = {
  /** The desktop rank keeps the API's sort field, so a link with `sort=current_rank` still sorts. */
  rank: 'current_rank',
  rankMobile: 'rank_mobile',
  url: 'ranking_url',
  best: 'best_rank',
  updated: 'last_observed_at',
  features: 'serp_features',
  aio: 'aio',
  trend: 'trend',
} as const;

export interface RankColumns {
  rankDesktop: DataTableColumn<PairedRow>;
  rankMobile: DataTableColumn<PairedRow>;
  url: DataTableColumn<TrackedKeywordRow>;
  best: DataTableColumn<TrackedKeywordRow>;
  updated: DataTableColumn<TrackedKeywordRow>;
  features: DataTableColumn<TrackedKeywordRow>;
  aio: DataTableColumn<TrackedKeywordRow>;
  trend: DataTableColumn<TrackedKeywordRow>;
}

/**
 * The columns of what the API knows about a keyword's rank (24-page-templates.md section 9.3, columns 2 to 4
 * and 11): Rank and Change always, the ranking URL from 1280 px, Best rank in the chooser, Updated from
 * 1680 px. Every cell is made from `row.state` alone, and what a value is is decided in `lib/format`: the
 * sort values here are the displayed ones, with `null` (sorted last both ways) for a keyword that has none.
 */
export function useRankColumns(timeZone: string): RankColumns {
  const t = useTranslations('rankings.rank');
  const common = useTranslations('common');
  const features = useTranslations('rankings.features');
  const aioT = useTranslations('rankings.aio');
  const trendT = useTranslations('rankings.trend');
  const tips = useRankTips(timeZone);
  return useMemo((): RankColumns => {
    const pending: UnknownValue = { label: t('pending'), tooltip: t('pendingTooltip') };
    const display = (row: TrackedKeywordRow): ReturnType<typeof rankDisplay> =>
      rankDisplay(row.state.current, row.state.is_stale, row.state.consecutive_failures, {
        dropUnconfirmed: row.state.drop_unconfirmed,
        check: row.state.check,
      });
    // The AI Overview cell says what it shows; only its failure is an icon that needs words
    const aioTip = (row: TrackedKeywordRow): CellTip | undefined =>
      row.state.current.state === 'failed' ? { content: aioT('failedTooltip') } : undefined;
    // The SERP feature icons carry no words: the tooltip names them, and says which are the site's own
    const featureTip = (row: TrackedKeywordRow): CellTip | undefined => {
      if (row.state.current.state === 'not_checked' || row.state.current.state === 'failed') return undefined;
      const featDisplay = featureListDisplay(row.state.feature_types_present, row.state.owned_feature_types);
      if (featDisplay.all.length === 0) return undefined;
      const shortLabelOf = (type: string): string =>
        isFeatureType(type) ? features(`types.${FEATURE_MESSAGE_KEYS[type]}`) : type;
      const content = featDisplay.all.map((slot) => shortLabelOf(slot.type)).join(', ');
      const owned = featDisplay.all.filter((slot) => slot.owned);
      const detail =
        owned.length > 0
          ? features('yours', { features: owned.map((slot) => shortLabelOf(slot.type)).join(', ') })
          : undefined;
      return { content, detail };
    };
    /** A device's rank and its change, from the row of that device; "Not tracked" where there is none. */
    const rankColumn = (device: 'desktop' | 'mobile'): DataTableColumn<PairedRow> =>
      col.rank<PairedRow>(
        device === 'desktop' ? RANK_COLUMN_IDS.rank : RANK_COLUMN_IDS.rankMobile,
        (row) => {
          const own = row.devices[device];
          const shown = own === null ? null : display(own);
          return shown !== null && shown.kind === 'ranked' ? shown.rank : null;
        },
        {
          header: t(device === 'desktop' ? 'rankDesktop' : 'rankMobile'),
          priority: 1,
          // "Desktop" with its sort arrow and the column menu needs more than a rank's usual width
          width: 128,
          minWidth: 128,
          cell: (row) => {
            const own = row.devices[device];
            return own === null ? (
              <span className="text-foreground-tertiary">{t('notTracked')}</span>
            ) : (
              <RankCellView
                display={display(own)}
                change={rowChangeDisplay(own.state.current, own.state.change)}
                timeZone={timeZone}
              />
            );
          },
        },
      );
    return {
      rankDesktop: rankColumn('desktop'),
      rankMobile: rankColumn('mobile'),
      url: col.url<TrackedKeywordRow>(RANK_COLUMN_IDS.url, () => null, {
        header: t('rankingUrl'),
        priority: 2,
        width: 180,
        sortable: false,
        defaultVisible: false,
        hasControls: true,
        cell: (row) => <RankingUrlView display={urlDisplay(row.state.current, row.state.ranking_url_count)} />,
        cellTip: (row) => tips.url(urlDisplay(row.state.current, row.state.ranking_url_count)),
      }),
      features: col.features<TrackedKeywordRow>(RANK_COLUMN_IDS.features, () => null, {
        header: features('column'),
        headerTooltip: features('columnTooltip'),
        priority: 3,
        width: 120,
        sortable: false,
        cell: (row) => (
          <SerpFeatureListView
            display={featureListDisplay(row.state.feature_types_present, row.state.owned_feature_types)}
            state={row.state.current.state}
            stale={row.state.is_stale}
            lastSuccessfulCheck={
              row.state.last_observed_at ? formatDetailDateTime(row.state.last_observed_at, timeZone) : null
            }
          />
        ),
        cellTip: (row) => featureTip(row),
      }),
      aio: col.aiOverview<TrackedKeywordRow>(RANK_COLUMN_IDS.aio, () => null, {
        header: aioT('column'),
        headerTooltip: aioT('columnTooltip'),
        priority: 2,
        width: 104,
        sortable: false,
        cell: (row) => (
          <AioStatusView
            display={aioDisplay(row.state.aio, row.state.current.state)}
            state={row.state.current.state}
            stale={row.state.is_stale}
            lastSuccessfulCheck={
              row.state.last_observed_at ? formatDetailDateTime(row.state.last_observed_at, timeZone) : null
            }
          />
        ),
        cellTip: (row) => aioTip(row),
      }),
      trend: col.sparkline<TrackedKeywordRow>(RANK_COLUMN_IDS.trend, {
        header: trendT('column'),
        priority: 2,
        width: 96,
        cell: (row) => {
          const points = row.sparkline?.points ?? [];
          const label = ((): string => {
            if (row.state.current.state === 'failed') return trendT('labelFailed');
            if (row.state.current.state === 'not_checked' || points.length === 0) return trendT('labelEmpty');
            const summary = sparklineSummary(points);
            if (summary.first === null) return trendT('labelNone', { checks: summary.checks });
            const latest = points.at(-1);
            const lastRankStr =
              latest?.state === 'beyond_depth'
                ? formatRankCell({ rank: null, depth: latest.depth })
                : String(summary.last ?? summary.first);
            const base = trendT('label', {
              checks: summary.checks,
              first: summary.first,
              last: lastRankStr,
              best: summary.best ?? summary.first,
            });
            return summary.beyond > 0 ? `${base}, ${trendT('labelBeyond', { count: summary.beyond })}` : base;
          })();
          return <SparklineCell points={points} label={label} />;
        },
        cellTip: (row) => {
          const points = row.sparkline?.points ?? [];
          if (points.length === 0) return undefined;
          const last7 = points
            .slice(-7)
            .map((point) => {
              const d = formatTableDate(point.t, timeZone);
              const r = formatRankCell({ rank: point.rank, depth: point.depth });
              return trendT('tipPoint', { date: d, rank: r });
            })
            .join(', ');
          return {
            content: trendT('tipTitle'),
            detail: last7,
          };
        },
      }),
      best: col.rank<TrackedKeywordRow>(RANK_COLUMN_IDS.best, (row) => row.state.best_rank, {
        header: t('bestRank'),
        priority: 3,
        // "BEST RANK" with its sort arrow needs 112 px
        width: 112,
        defaultVisible: false,
        cell: (row) => <BestRankView best={row.state.best_rank} state={row.state.current.state} />,
      }),
      updated: col.date<TrackedKeywordRow>(RANK_COLUMN_IDS.updated, (row) => row.state.last_observed_at, {
        header: t('updated'),
        headerTooltip: common('timesIn', { timeZone }),
        priority: 4,
        timeZone,
        secondary: true,
        width: 160,
        // The marker follows the API's `is_stale` and nothing else
        marker: (row) => (row.state.is_stale ? <StaleMarker /> : null),
        cellTip: (row) => (row.state.is_stale ? tips.stale(row.state.last_observed_at) : undefined),
        unknown: (row) => (row.state.current.state === 'failed' ? { label: t('failed') } : pending),
      }),
    };
  }, [t, common, features, aioT, trendT, tips, timeZone]);
}

/**
 * Competitor rank columns: one column per project competitor, ordered by color_index ascending then name.
 * Default visible for the first competitor only.
 */
export function useCompetitorColumns(competitors: readonly EntityRef[]): DataTableColumn<TrackedKeywordRow>[] {
  return useMemo(() => {
    const sorted = [...competitors].sort((a, b) => {
      const aColor = a.color_index ?? Number.MAX_SAFE_INTEGER;
      const bColor = b.color_index ?? Number.MAX_SAFE_INTEGER;
      if (aColor !== bColor) return aColor - bColor;
      return a.canonical_name.localeCompare(b.canonical_name);
    });

    return sorted.map((competitor, idx) => {
      const id = `competitor_${competitor.entity_id}`;
      return col.competitor<TrackedKeywordRow>(id, {
        header: competitor.canonical_name,
        priority: 4,
        width: 120,
        sortable: false,
        defaultVisible: idx === 0,
        cell: (row) => {
          const entry = row.competitor_ranks?.find((cr) => cr.entity.entity_id === competitor.entity_id);
          return (
            <CompetitorRankView
              entry={entry}
              name={competitor.canonical_name}
              colorIndex={competitor.color_index}
              position={idx}
            />
          );
        },
      });
    });
  }, [competitors]);
}
