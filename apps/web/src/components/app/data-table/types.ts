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
  /**
   * How the action is drawn. The destructive group draws destructive; an action that belongs last but loses
   * nothing (Archive, which has Undo) sets `default` to stay neutral.
   */
  tone?: 'default' | 'destructive' | undefined;
  /** Shown in place of a shortcut; the item stays focusable. */
  disabledReason?: string | null | undefined;
  /**
   * `rows` are the loaded rows the action applies to. `scope` holds every selected id, including rows the
   * search hides or another page holds, and whether every matching row is selected: the action then sends
   * the filters, not ids.
   */
  onSelect: (rows: readonly TRow[], scope: ActionScope) => void;
}

/** A cell's tooltip text. */
export interface CellTip {
  /** The first line. */
  content: string;
  /** A second line in a lighter color. */
  detail?: string | undefined;
  /** What assistive technology reads after the cell's own text; the lines of the tooltip when not given. */
  description?: string | undefined;
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

/** A header cell over the adjacent shown columns that share it (24-page-templates.md 9.5). `label` is already translated. */
export interface ColumnGroup {
  id: string;
  label: string;
}

/** A column as `col.*` builds it. Screens never set widths, alignment or formatting by hand. */
export interface DataTableColumn<TRow> {
  id: string;
  type: ColumnType;
  /** The header label, and the column's name in the chooser and the options menu. */
  header: string;
  /** The definition of an abbreviated or methodological header ("KD", "Volume" as an estimate). */
  headerTooltip?: string | undefined;
  /**
   * The tooltip of a row's cell, when it has one (the reason for "Pending", the detail of a keyword). The
   * table puts it on the cell itself, which is what holds the focus: it opens when the cell takes keyboard
   * focus and is the cell's description for assistive technology.
   */
  cellTip?: ((row: TRow) => CellTip | undefined) | undefined;
  /**
   * A cell's accessible name, for a cell that holds controls: their names would otherwise become part of it,
   * and the identity cell's name is what is read with every other cell of the row. Not given: the cell is
   * named by its content, as always.
   */
  cellLabel?: ((row: TRow) => string) | undefined;
  /**
   * The column's cells hold controls marked with `CELL_CONTROL` (a copy button, a link), which F2 reaches. The
   * table's hint mentions F2 only when a column shown has them, since on other tables the key does nothing.
   */
  hasControls?: boolean | undefined;
  priority: ColumnPriority;
  /** The screen's default width, between the type's minimum and maximum. */
  width?: number | undefined;
  /** The narrowest the column may be squeezed to, when its header needs more than its type's minimum. */
  minWidth?: number | undefined;
  /** The group header over this column and the adjacent shown columns that share it; drawn only with `columnGroups`. */
  group?: ColumnGroup | undefined;
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
  /** Rows drawn as partly selected (a group with some of its keywords chosen). */
  indeterminateIds?: ReadonlySet<string> | undefined;
  /** What the bulk bar counts when it is not the number of ids (keywords chosen, not rows). */
  selectedCount?: number | undefined;
  /**
   * What the bulk bar and the live announcement say in place of "{count} selected", for a screen whose choice is of
   * something other than rows ("2 topics selected, 7 prompts"). Given with `selectedCount`.
   */
  selectedLabel?: string | undefined;
  /**
   * Clear in the bulk bar, when emptying the table's selected ids would leave a choice behind: ids chosen through
   * rows that are not drawn (a partly chosen topic that is closed). Without it Clear is `onChange(new Set())`.
   */
  onClear?: (() => void) | undefined;
  /**
   * In a tree, the header checkbox, a range and the "select all loaded" name cover the group rows too, not only the
   * rows inside groups: for a tree whose group rows are chosen things (topics) and not only containers.
   */
  headerCoversGroups?: boolean | undefined;
  /** Selectable rows the table does not render (the keywords of closed groups): they are not "hidden by filters". */
  unrenderedCount?: number | undefined;
}

/** The place of a row in a tree table (`DataTableProps.rowTree`). */
export interface RowTree {
  /** 1 for a group row, 2 for a row inside one. */
  level: 1 | 2;
  /** Group rows only: whether its rows are shown. A level 1 row without it has no rows to show, and is an ordinary row. */
  expanded?: boolean | undefined;
  /** Rows at this level in the group it belongs to, and this row's place among them (aria-setsize, aria-posinset). */
  setSize: number;
  posInSet: number;
  /**
   * A row with `false` (a "Show all" row) draws no checkbox and is not part of a range, a select-all or the
   * "select all N loaded" count. Group rows never are, whatever this says: only level 2 rows are counted.
   */
  selectable?: boolean | undefined;
  /** Group rows only: the whole accessible name of the disclosure button ("Expand CRM group, 42 keywords"); the row's name with Expand or Collapse when not given. */
  label?: string | undefined;
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
  /**
   * The tree facts of a row. A table with this prop is a `treegrid`: it shows the rows in the order given
   * (no sorting and no search of its own, the caller sends group rows and their rows already in display
   * order), toggles a group row on click, Enter, and Right and Left Arrow from the row's first cell, and
   * draws a disclosure button in the identity cell of a group row.
   */
  rowTree?: ((row: TRow) => RowTree | undefined) | undefined;
  /** Called to open or close a group row. */
  onToggleGroup?: ((row: TRow) => void) | undefined;
  /** A slot at the end of the toolbar, before density and columns: the view switch. */
  toolbarEnd?: ReactNode;
  /** Opt in to the compact toolbar (`DataTableToolbar` `compact`): the sort summary is drawn from 1440 px, not 1280. */
  compactToolbar?: boolean;
  /**
   * Hold the identity column at its type maximum while the other columns can still widen toward theirs
   * (`resolveWidths` with `capIdentity`): for a table that shows few columns, the By group view.
   */
  identityCap?: boolean;
  /** Opt in: draw a group row over columns that share a `group`. Off: one header row, as before. */
  columnGroups?: boolean;
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
   * A row that belongs to the viewer's own site or brand (the own result in a SERP) is drawn on the accent
   * tint. Visual only: the row's cells must say who it is in words, and the keyboard, selection and names
   * are the same for every row.
   */
  rowTone?: ((row: TRow) => 'own' | undefined) | undefined;
  /**
   * The ids of the rows the table shows, in its order (searched and sorted in client mode), each time it
   * changes: the inspector's position and J and K follow it. In tree mode it reports every rendered row id,
   * group rows included.
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
