'use client';

import type { RowData } from '@tanstack/react-table';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import type { RowLines } from './list-lines';
import {
  DataTableList,
  useListMode,
  type ListLine1,
  type ListLine2,
  type ListModeState,
} from '@/components/app/data-table/data-table-list';
import type { TableStatus } from '@/components/app/data-table/types';
import { Delta } from '@/components/app/metric/delta';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { EMPTY_VALUE } from '@/lib/format';
import type { SortKey } from '@/lib/tables/table-state';

/**
 * What the three Citations lists on a phone share (19-responsive-behavior.md section 6.7): the layout choice, the
 * toolbar and the conversion of a row's lines into the list's two lines. Each tab keeps its reads and its address;
 * the server sorts and leaves out rows below the minimum, so the list sorts and searches nothing itself.
 */

/** From this width the tabs are tables; the list layout (`LIST_MEDIA`) is the complement. */
export const TABLE_MEDIA = '(width >= 48rem)';

/**
 * `useListMode`, asked for both sides of the breakpoint: a harness that answers true to every query (a test stub of a
 * wide window) matches the narrow query too and must keep the table, as the Topics tab does.
 */
export function useCitationListLayout(): ListModeState {
  const state = useListMode();
  const wide = useMediaQuery(TABLE_MEDIA);
  return wide ? { ...state, mode: 'table', canSwitch: false } : state;
}

/** Line 1 of a row: the identity, and the value, which is n/a (and not spoken twice) when it cannot be told. */
export function firstLine({ identity, valueLabel, value }: RowLines): ListLine1 {
  return {
    identity,
    valueLabel,
    value:
      value === null ? (
        <span aria-hidden="true" className="text-foreground-tertiary">
          {EMPTY_VALUE}
        </span>
      ) : (
        value
      ),
  };
}

/** Line 2 of a row: its context, and a neutral change in points when there is one. */
export function secondLine({ context, delta }: RowLines): ListLine2 {
  return { context, delta: delta === null ? null : <Delta input={delta} size="sm" tip={false} /> };
}

// The server orders the rows, so the list has no column to sort by
const NO_COLUMNS: readonly [] = [];
const NO_SORT: readonly SortKey[] = [];
const SEARCH_MAX_LENGTH = 200;

/** What a list takes from its tab besides the rows. */
export interface ListChrome {
  status: TableStatus;
  search: string;
  onSearchChange: (search: string) => void;
  /** The row of the open record: marked as current. */
  activeRowId: string | null;
  /** The tab's own controls (order, minimum, the List and Table switch), at the end of the toolbar. */
  toolbarEnd: ReactNode;
  errorState: ReactNode;
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
}

export interface CitationListShellProps<TRow extends RowData> extends ListChrome {
  caption: string;
  itemNoun: { one: string; other: string };
  searchPlaceholder: string;
  /** The rows the tab lists, searched and in the order the server gave. */
  rows: readonly TRow[];
  getRowId: (row: TRow) => string;
  lines: (row: TRow) => RowLines;
  onRowOpen: (row: TRow) => void;
}

/** The list of a Citations tab below 768 px: two line rows, each one button that opens the record's inspector. */
export function CitationListShell<TRow extends RowData>({
  caption,
  itemNoun,
  searchPlaceholder,
  rows,
  getRowId,
  lines,
  onRowOpen,
  status,
  search,
  onSearchChange,
  activeRowId,
  toolbarEnd,
  errorState,
  emptyState,
  filteredEmptyState,
}: CitationListShellProps<TRow>): ReactElement {
  const table = useTranslations('dataTable');
  return (
    <DataTableList<TRow>
      caption={caption}
      itemNoun={itemNoun}
      columns={NO_COLUMNS}
      rows={rows}
      total={rows.length}
      getRowId={getRowId}
      sort={NO_SORT}
      // The tab searched the rows already, by their names
      search=""
      line1={(row) => firstLine(lines(row))}
      line2={(row) => secondLine(lines(row))}
      onRowOpen={onRowOpen}
      activeRowId={activeRowId}
      status={status}
      errorState={errorState}
      emptyState={emptyState}
      filteredEmptyState={filteredEmptyState}
      toolbar={
        <>
          <InputGroup leadingIcon={Search} size="sm" className="w-full min-w-0">
            <Input
              size="sm"
              // The group draws the border and the focus ring, so the field inside draws neither
              variant="bare"
              type="search"
              value={search}
              // The field also passes the event details, which the caller's callback does not take
              onValueChange={(next) => onSearchChange(next)}
              placeholder={searchPlaceholder}
              maxLength={SEARCH_MAX_LENGTH}
              aria-label={table('search')}
            />
          </InputGroup>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1">{toolbarEnd}</div>
        </>
      }
    />
  );
}
