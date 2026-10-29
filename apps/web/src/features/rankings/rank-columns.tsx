'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { BestRankView, RankCellView, RankingUrlView, StaleMarker, useRankTips } from './rank-cells';
import { SerpFeatureListView, AioStatusView } from './feature-cells';
import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { aioDisplay, rankDisplay, rowChangeDisplay, urlDisplay } from '@/lib/format';
import { featureListDisplay, isFeatureType, FEATURE_MESSAGE_KEYS } from '@/lib/keywords/serp-features';

/** The ids of the rank columns: the API's sort fields, except the ranking URL, which does not sort. */
export const RANK_COLUMN_IDS = {
  rank: 'current_rank',
  url: 'ranking_url',
  best: 'best_rank',
  updated: 'last_observed_at',
  features: 'serp_features',
  aio: 'aio',
} as const;

export interface RankColumns {
  rank: DataTableColumn<TrackedKeywordRow>;
  url: DataTableColumn<TrackedKeywordRow>;
  best: DataTableColumn<TrackedKeywordRow>;
  updated: DataTableColumn<TrackedKeywordRow>;
  features: DataTableColumn<TrackedKeywordRow>;
  aio: DataTableColumn<TrackedKeywordRow>;
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
  const tips = useRankTips(timeZone);
  return useMemo((): RankColumns => {
    const pending: UnknownValue = { label: t('pending'), tooltip: t('pendingTooltip') };
    const display = (row: TrackedKeywordRow): ReturnType<typeof rankDisplay> =>
      rankDisplay(row.state.current, row.state.is_stale, row.state.consecutive_failures);
    const aioTip = (row: TrackedKeywordRow): CellTip | undefined => {
      if (row.state.current.state === 'failed') {
        return { content: aioT('failedTooltip') };
      }
      const disp = aioDisplay(row.state.aio, row.state.current.state);
      switch (disp.kind) {
        case 'notLoaded':
          return { content: aioT('notLoadedTooltip') };
        case 'unknown':
          return { content: aioT('unknownTooltip') };
        case 'pending':
          return { content: aioT('pendingTooltip') };
        case 'cited':
          return disp.position !== null
            ? { content: aioT('citedTooltip', { position: disp.position }) }
            : { content: aioT('citedNoPosition') };
        case 'notCited':
        case 'absent':
          return undefined;
      }
    };
    const featureTip = (row: TrackedKeywordRow): CellTip | undefined => {
      if (row.state.current.state === 'not_checked') {
        return { content: features('pendingTooltip') };
      }
      if (row.state.current.state === 'failed') {
        return { content: features('failedTooltip') };
      }
      const featDisplay = featureListDisplay(row.state.feature_types_present, row.state.owned_feature_types);
      if (featDisplay.all.length === 0) {
        return { content: features('noneTooltip') };
      }
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
    return {
      rank: col.rank<TrackedKeywordRow>(
        RANK_COLUMN_IDS.rank,
        (row) => {
          const shown = display(row);
          return shown.kind === 'ranked' ? shown.rank : null;
        },
        {
          header: t('rank'),
          headerTooltip: t('rankTooltip'),
          priority: 1,
          width: 104,
          minWidth: 96,
          cell: (row) => (
            <RankCellView display={display(row)} change={rowChangeDisplay(row.state.current, row.state.change)} />
          ),
          cellTip: (row) => tips.rank(display(row), row.state.change, row.state.current),
        },
      ),
      url: col.url<TrackedKeywordRow>(RANK_COLUMN_IDS.url, () => null, {
        header: t('rankingUrl'),
        priority: 2,
        width: 180,
        sortable: false,
        defaultVisible: false,
        hasControls: true,
        cell: (row) => <RankingUrlView display={urlDisplay(row.state.current, row.state.ranking_url_count)} />,
        cellTip: (row) => tips.url(urlDisplay(row.state.current, row.state.ranking_url_count), display(row)),
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
          />
        ),
        cellTip: (row) => aioTip(row),
      }),
      best: col.rank<TrackedKeywordRow>(RANK_COLUMN_IDS.best, (row) => row.state.best_rank, {
        header: t('bestRank'),
        headerTooltip: t('bestRankTooltip'),
        priority: 3,
        // "BEST RANK" with its sort arrow needs 112 px
        width: 112,
        defaultVisible: false,
        cell: (row) => <BestRankView best={row.state.best_rank} state={row.state.current.state} />,
        cellTip: (row) => (row.state.best_rank === null ? tips.best(row.state.current.state) : undefined),
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
        unknown: (row) =>
          row.state.current.state === 'failed' ? { label: t('failed'), tooltip: t('failedTooltip') } : pending,
      }),
    };
  }, [t, common, features, aioT, tips, timeZone]);
}
