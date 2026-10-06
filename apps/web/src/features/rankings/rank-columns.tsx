'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { BestRankView, RankChangeView, RankCellView, RankingUrlView, StaleMarker, useRankTips } from './rank-cells';
import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { rankDisplay, rowChangeDisplay, urlDisplay } from '@/lib/format';

/** The ids of the rank columns: the API's sort fields, except the ranking URL, which does not sort. */
export const RANK_COLUMN_IDS = {
  rank: 'current_rank',
  change: 'rank_change',
  url: 'ranking_url',
  best: 'best_rank',
  updated: 'last_observed_at',
} as const;

export interface RankColumns {
  rank: DataTableColumn<TrackedKeywordRow>;
  change: DataTableColumn<TrackedKeywordRow>;
  url: DataTableColumn<TrackedKeywordRow>;
  best: DataTableColumn<TrackedKeywordRow>;
  updated: DataTableColumn<TrackedKeywordRow>;
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
  const tips = useRankTips(timeZone);
  return useMemo((): RankColumns => {
    const pending: UnknownValue = { label: t('pending'), tooltip: t('pendingTooltip') };
    const display = (row: TrackedKeywordRow): ReturnType<typeof rankDisplay> =>
      rankDisplay(row.state.current, row.state.is_stale, row.state.consecutive_failures);
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
          width: 72,
          cell: (row) => <RankCellView display={display(row)} />,
          cellTip: (row) => tips.rank(display(row), row.state.change.previous_rank),
        },
      ),
      change: col.rankDelta<TrackedKeywordRow>(
        RANK_COLUMN_IDS.change,
        (row) => (row.state.change.label === 'numeric' ? row.state.change.value : null),
        {
          header: t('change'),
          headerTooltip: t('changeTooltip'),
          priority: 1,
          // The header "Change" with its sort arrow needs 84 px: the type's 72 px cut it to "Cha"
          width: 88,
          cell: (row) => <RankChangeView display={rowChangeDisplay(row.state.current, row.state.change)} />,
          cellTip: (row) => tips.change(row.state.change, row.state.current),
        },
      ),
      url: col.url<TrackedKeywordRow>(RANK_COLUMN_IDS.url, () => null, {
        header: t('rankingUrl'),
        priority: 2,
        width: 180,
        sortable: false,
        cell: (row) => <RankingUrlView display={urlDisplay(row.state.current, row.state.ranking_url_count)} />,
        cellTip: (row) => tips.url(urlDisplay(row.state.current, row.state.ranking_url_count), display(row)),
      }),
      best: col.rank<TrackedKeywordRow>(RANK_COLUMN_IDS.best, (row) => row.state.best_rank, {
        header: t('bestRank'),
        headerTooltip: t('bestRankTooltip'),
        priority: 3,
        width: 80,
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
  }, [t, common, tips, timeZone]);
}
