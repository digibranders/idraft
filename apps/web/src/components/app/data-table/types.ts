import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ColumnType } from '@/lib/tables/column-types';
import type { Density, SortKey } from '@/lib/tables/table-state';

/** One row or record action; the group fixes its place in a menu (16-drawers-dialogs-popovers.md 5.3). */
export interface RecordAction<TRow> {
  id: string;
  label: string;
  icon?: LucideIcon | undefined;
  group: 'open' | 'object' | 'copy' | 'destructive';
  /** Shown in place of a shortcut; the item stays focusable. */
  disabledReason?: string | null | undefined;
  /**
   * `rows` are the loaded rows the action applies to. `scope` holds every selected id, including rows the
   * search hides or another page holds, and whether every matching row is selected: the action then sends
   * the filters, not ids.
   */
  onSelect: (rows: readonly TRow[], scope: ActionScope) => void;
}

/** The actions of a row's menu: the same for every row, or chosen by the row. */
export type RowActions<TRow> = readonly RecordAction<TRow>[] | ((row: TRow) => readonly RecordAction<TRow>[]);

/** What a record action applies to beyond the rows at hand. */
export interface ActionScope {
  ids: ReadonlySet<string>;
  allMatching: boolean;
}

/** A visible-at-width tier (19-responsive-behavior.md section 6.1): 1 always, 2 from 1280 px, 3 from 1440 px, 4 from 1680 px. */
export type ColumnPriority = 1 | 2 | 3 | 4;

/** A column as `col.*` builds it. Screens never set widths, alignment or formatting by hand. */
export interface DataTableColumn<TRow> {
  id: string;
  type: ColumnType;
  /** The header label, and the column's name in the chooser and the options menu. */
  header: string;
  /** The definition of an abbreviated or methodological header ("KD", "Volume" as an estimate). */
  headerTooltip?: string | undefined;
  priority: ColumnPriority;
  /** The screen's default width, between the type's minimum and maximum. */
  width?: number | undefined;
  /** The identity column: the row header, always visible, pinned left. */
  identity?: boolean | undefined;
  /** Shown by default; the others wait in the column chooser. */
  defaultVisible?: boolean | undefined;
  /** The value a sort compares; a column without one does not sort. `null` sorts last both ways. */
  sortValue?: ((row: TRow) => string | number | null) | undefined;
  /** The cell's content: a cell component from `col.*`. */
  cell: (row: TRow) => ReactNode;
}

/** The visible columns in order; `null` means the table's defaults. */
export interface ColumnState {
  visible: readonly string[] | null;
  onChange: (visible: readonly string[] | null) => void;
}

/** Server mode (12-tables.md section 12): the caller sorts and pages above 10,000 rows. */
export interface ServerPaging {
  /** "Showing 1 to 200 of 48,210 keywords" */
  rangeText: string;
  /** The position of the page's first row in the whole list, from 0: rows are announced as "row 201 of 48,211". */
  offset: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  /** The sizes the list's API answers, when it caps `limit` below 500 (`/tracked-keywords` takes 200). */
  pageSizes?: readonly PageSize[] | undefined;
}

export type PageSize = 100 | 200 | 500;
export const PAGE_SIZES: readonly PageSize[] = [100, 200, 500];

export interface Selection {
  selectedIds: ReadonlySet<string>;
  onChange: (ids: ReadonlySet<string>) => void;
  /** Rows the filters match in all, when more exist than are loaded. */
  matchingTotal: number | null;
  /** Every row the filters match is selected, loaded or not; bulk actions then send the filters. */
  allMatching: boolean;
  onAllMatchingChange: (allMatching: boolean) => void;
}

export type TableStatus = 'loading' | 'ready' | 'refetching' | 'error' | 'empty' | 'filtered-empty';

/**
 * `columns`, `getRowId` and `searchText` should keep their identity between renders (defined at module
 * level, or memoized): the table searches and sorts again only when they, the rows or the sort change.
 */
export interface DataTableProps<TRow> {
  /** The grid's name ("Keywords"), as a visually hidden heading. */
  caption: string;
  itemNoun: { one: string; other: string };
  columns: readonly DataTableColumn<TRow>[];
  getRowId: (row: TRow) => string;
  /** The loaded rows: the whole list in client mode, the current page in server mode. */
  rows: readonly TRow[];
  /** Rows the filters match; `null` when unknown, which server mode announces as an unknown row count. */
  total: number | null;
  /** Server mode; without it the table sorts and searches the loaded rows itself. */
  server?: ServerPaging | undefined;
  /** Client mode while the background pages load: "Loading 1,200 of 4,812 keywords". */
  loadProgress?: { loaded: number; total: number } | null | undefined;
  sort: readonly SortKey[];
  onSortChange: (sort: readonly SortKey[]) => void;
  defaultSort: readonly SortKey[];
  density: Density;
  onDensityChange: (density: Density) => void;
  columnState: ColumnState;
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder: string;
  /** Client mode: the text a search looks in. */
  searchText?: ((row: TRow) => string) | undefined;
  selection?: Selection | undefined;
  bulkActions?: readonly RecordAction<TRow>[] | undefined;
  /**
   * The actions of a row's menu: one list for every row, or a function of the row for actions that not
   * every row has (a run that has ended cannot be cancelled). A row with no action shows no menu.
   */
  rowActions?: RowActions<TRow> | undefined;
  /** The name a row's checkbox and menu carry ("Select crm pricing", "Actions for crm pricing"). */
  rowName: (row: TRow) => string;
  onRowOpen?: ((row: TRow, intent: 'inspector' | 'new-tab') => void) | undefined;
  /** The row open in the inspector. */
  activeRowId?: string | null | undefined;
  /**
   * The ids of the rows the table shows, in its order (searched and sorted in client mode), each time it
   * changes: the inspector's position and J and K follow it.
   */
  onRowOrderChange?: ((ids: readonly string[]) => void) | undefined;
  status: TableStatus;
  /** Shown in the body for `error`: an `InlineError` with Retry. */
  errorState: ReactNode;
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
  /** Freshness in the footer: "Updated 12m ago". */
  footerNote?: string | undefined;
}
