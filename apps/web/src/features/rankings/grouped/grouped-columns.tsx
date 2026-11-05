'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import type { GroupData, GroupedRow } from './grouped-rows';
import type { PairedRow } from '../keyword-pairs';
import { RANK_COLUMN_IDS } from '../rank-columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Button } from '@/components/ui/button';
import { Truncate } from '@/components/ui/truncate';
import { EMPTY_VALUE, formatCurrency, formatInteger, formatTableDateTime } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { cn } from '@/lib/utils';

export interface GroupedColumnOptions {
  /** The project's time zone, for the Updated column. */
  timeZone: string;
  /** Called with the id of the group whose "Show all" row was used. */
  onShowAll: (groupId: string) => void;
}

/**
 * The keyword columns for the By group view (12-tables.md section 16). A keyword row shows what its keyword
 * column shows; a group row shows the group's sums and counts in the columns where they mean something and
 * nothing in the others; a "Show all" row holds only its button. The table is in group order, so no column
 * sorts. The disclosure chevron is the table's own, drawn in the identity cell of a group row.
 */
export function useGroupedColumns(
  keywordColumns: readonly DataTableColumn<PairedRow>[],
  { timeZone, onShowAll }: GroupedColumnOptions,
): readonly DataTableColumn<GroupedRow>[] {
  const t = useTranslations('rankings.grouped');
  return useMemo(() => {
    const identityCell = (group: GroupData): ReactNode => (
      <span className="flex min-w-0 items-baseline gap-2">
        <Truncate text={group.label} className="text-foreground" />
        <span className="shrink-0 num font-normal text-foreground-tertiary">
          {t('keywordCount', { count: group.measures.size })}
        </span>
      </span>
    );
    const figureCell = (id: string, group: GroupData): ReactNode => {
      const { measures } = group;
      switch (id) {
        case RANK_COLUMN_IDS.rank:
          return (
            <span className={cn('num', measures.top10 === 0 && 'text-foreground-tertiary')}>
              {t('inTop10', { count: measures.top10 })}
            </span>
          );
        case 'search_volume':
          return <span className="num">{formatInteger(measures.volume)}</span>;
        case 'cpc_usd':
          return measures.cpc === null ? (
            <span className="text-foreground-tertiary">{t('unknown')}</span>
          ) : (
            <span className="num">{formatCurrency(measures.cpc)}</span>
          );
        case RANK_COLUMN_IDS.aio:
          return (
            <span className={cn('num', measures.cited === 0 && 'text-foreground-tertiary')}>
              {t('cited', { count: measures.cited })}
            </span>
          );
        case RANK_COLUMN_IDS.updated:
          return measures.updated === null ? (
            <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>
          ) : (
            <span className="num text-foreground-tertiary">{formatTableDateTime(measures.updated, timeZone)}</span>
          );
        default:
          return null;
      }
    };
    return keywordColumns.map((column): DataTableColumn<GroupedRow> => {
      const identity = column.identity === true;
      const keywordLabel = column.cellLabel;
      // A row header is named by its row; another cell has a name of its own only on a keyword row
      const cellLabel = (row: GroupedRow): string => {
        switch (row.kind) {
          case 'keyword':
            return keywordLabel?.(row.row) ?? row.row.keyword.text;
          case 'group':
            return identity
              ? `${row.group.label}, ${t('keywordCount', { count: row.group.measures.size })}`
              : column.header;
          case 'more':
            return identity ? t('showAll', { count: row.hidden }) : column.header;
        }
      };
      return {
        ...column,
        sortValue: undefined,
        cellTip: (row) => (row.kind === 'keyword' ? column.cellTip?.(row.row) : undefined),
        cellLabel: identity || keywordLabel !== undefined ? cellLabel : undefined,
        // The identity cell of a "Show all" row holds a button
        hasControls: identity ? true : column.hasControls,
        cell: (row) => {
          if (row.kind === 'keyword') return column.cell(row.row);
          if (row.kind === 'group') return identity ? identityCell(row.group) : figureCell(column.id, row.group);
          if (!identity) return null;
          return (
            <Button {...CELL_CONTROL} variant="link" size="sm" onClick={() => onShowAll(row.groupId)}>
              {t('showAll', { count: row.hidden })}
            </Button>
          );
        },
      };
    });
  }, [keywordColumns, t, timeZone, onShowAll]);
}
