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
  /**
   * Called with the id of the group whose "Show more" row was used. It must keep its identity between renders
   * (`useCallback`): it is a dependency of the memoised columns, which the table searches and sorts by.
   */
  onShowAll: (groupId: string) => void;
}

/**
 * The keyword columns for the By group view (12-tables.md section 16). A keyword row shows what its keyword
 * column shows; a group row shows the group's sums and counts in the columns where they mean something and
 * nothing in the others; a "Show more" row holds only its button. The table is in group order, so no column
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
    // What a group row shows in a column where a sum or count means something; null where it does not
    const figureOf = (
      id: string,
      { measures }: GroupData,
    ): { text: string; muted: boolean; number: boolean } | null => {
      switch (id) {
        case RANK_COLUMN_IDS.rank:
          return { text: t('inTop10', { count: measures.top10 }), muted: measures.top10 === 0, number: true };
        case 'search_volume':
          return { text: formatInteger(measures.volume), muted: false, number: true };
        case 'cpc_usd':
          return measures.cpc === null
            ? { text: t('unknown'), muted: true, number: false }
            : { text: formatCurrency(measures.cpc), muted: false, number: true };
        case RANK_COLUMN_IDS.aio:
          return { text: t('cited', { count: measures.cited }), muted: measures.cited === 0, number: true };
        case RANK_COLUMN_IDS.updated:
          return measures.updated === null
            ? { text: EMPTY_VALUE, muted: true, number: false }
            : { text: formatTableDateTime(measures.updated, timeZone), muted: true, number: true };
        default:
          return null;
      }
    };
    const figureCell = (id: string, group: GroupData): ReactNode => {
      const figure = figureOf(id, group);
      return figure === null ? null : (
        <span className={cn(figure.number && 'num', figure.muted && 'text-foreground-tertiary')}>{figure.text}</span>
      );
    };
    return keywordColumns.map((column): DataTableColumn<GroupedRow> => {
      const identity = column.identity === true;
      const keywordLabel = column.cellLabel;
      // A row header is named by its row. Another cell that has a name of its own keeps it on a keyword row; on a
      // group row it is the figure the cell shows, which a fixed name would hide, and nothing where it shows none
      const cellLabel = (row: GroupedRow): string => {
        switch (row.kind) {
          case 'keyword':
            return keywordLabel?.(row.row) ?? row.row.keyword.text;
          case 'group':
            return identity
              ? t('groupName', { label: row.group.label, count: row.group.measures.size })
              : (figureOf(column.id, row.group)?.text ?? '');
          case 'more':
            return identity ? t('showAll', { count: row.hidden }) : '';
        }
      };
      return {
        ...column,
        sortValue: undefined,
        cellTip: (row) => (row.kind === 'keyword' ? column.cellTip?.(row.row) : undefined),
        cellLabel: identity || keywordLabel !== undefined ? cellLabel : undefined,
        // The identity cell of a "Show more" row holds a button
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
