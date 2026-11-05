'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import {
  applySelectionChange,
  groupedRows,
  selectionOf,
  type GroupSort,
  type GroupedRow,
  type GroupedSelection,
} from './grouped-rows';
import type { GroupTarget } from './group-actions';
import { useGroupedColumns } from './grouped-columns';
import { hiddenInGroups, mergeHidden, visibleForView, type KeywordsView } from './view-columns';
import { keywordText } from '../keyword-columns';
import { idsOfPair, type PairedRow } from '../keyword-pairs';
import type { ListMode } from '../rankings-queries';
import type { ColumnState, DataTableColumn, RecordAction, RowTree } from '@/components/app/data-table/types';

/** The orders the "Sort groups" menu offers, each in the direction it reads best in. */
export const GROUP_SORTS = {
  size: { by: 'size', desc: true },
  name: { by: 'name', desc: false },
  volume: { by: 'volume', desc: true },
  rank: { by: 'rank', desc: false },
} as const satisfies Record<string, GroupSort>;
export type GroupSortId = keyof typeof GROUP_SORTS;

const NONE: ReadonlySet<string> = new Set();

/** The rows whose keyword holds the search, as the flat table searches in memory. */
export function searchedRows(rows: readonly PairedRow[], search: string): readonly PairedRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return needle === '' ? rows : rows.filter((row) => keywordText(row).toLocaleLowerCase().includes(needle));
}

/** Group rows at level 1 in their order; the keyword and "Show all" rows of an open group at level 2 under it. */
export function treeOf(rows: readonly GroupedRow[]): Map<string, Omit<RowTree, 'label'>> {
  const tree = new Map<string, Omit<RowTree, 'label'>>();
  const groups = rows.filter((row) => row.kind === 'group');
  let groupAt = 0;
  let children: GroupedRow[] = [];
  const close = (): void => {
    children.forEach((row, index) =>
      tree.set(row.id, {
        level: 2,
        setSize: children.length,
        posInSet: index + 1,
        ...(row.kind === 'more' ? { selectable: false } : {}),
      }),
    );
    children = [];
  };
  for (const row of rows) {
    if (row.kind !== 'group') {
      children.push(row);
      continue;
    }
    close();
    groupAt += 1;
    tree.set(row.id, { level: 1, expanded: row.expanded, setSize: groups.length, posInSet: groupAt });
  }
  close();
  return tree;
}

/**
 * The tracked ids of the keyword rows among the table's ids, in order, each once: the order the inspector
 * steps in. Group and "Show all" rows are left out, and a keyword listed under two groups counts where it first is.
 */
export function keywordOrder(rows: readonly GroupedRow[], ids: readonly string[]): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const order = new Set<string>();
  for (const id of ids) {
    const row = byId.get(id);
    if (row?.kind === 'keyword') order.add(row.row.tracked_keyword_id);
  }
  return [...order];
}

/** Chosen keywords, a keyword counted once whichever of its devices' ids is chosen. */
export function chosenCount(chosen: ReadonlySet<string>, members: ReadonlyMap<string, readonly string[]>): number {
  return new Set([...chosen].map((id) => members.get(id)?.[0] ?? id)).size;
}

/** Chosen keywords in view that no row shows, as their group is closed or they wait behind "Show all". */
export function unrenderedCount(
  rows: readonly GroupedRow[],
  inView: readonly PairedRow[],
  chosen: ReadonlySet<string>,
): number {
  const rendered = new Set(rows.flatMap((row) => (row.kind === 'keyword' ? [row.row.tracked_keyword_id] : [])));
  return inView.filter((row) => !rendered.has(row.tracked_keyword_id) && idsOfPair(row).some((id) => chosen.has(id)))
    .length;
}

/**
 * The bulk actions of the flat view, for the By group view: whatever rows the table hands over (group rows
 * among them), an action reaches the chosen keywords, those of closed groups included. `rows` are the list's
 * rows of the device shown; the flat actions add the other device's ids themselves.
 */
export function keywordActions(
  actions: readonly RecordAction<PairedRow>[],
  rows: readonly PairedRow[],
  chosen: ReadonlySet<string>,
): RecordAction<GroupedRow>[] {
  return actions.map((action) => ({
    ...action,
    onSelect: () =>
      action.onSelect(
        rows.filter((row) => idsOfPair(row).some((id) => chosen.has(id))),
        { ids: chosen, allMatching: false },
      ),
  }));
}

/**
 * The view the table shows, or `null` while that is not known yet (the table then stays in its loading state,
 * so a project with groups never shows the flat table first). Server mode is always flat; a view chosen in the
 * URL (or by the screen's caller) wins otherwise; without one, By group when the project has a group.
 * `groupCount` is `null` while the project's groups load, and 0 when they failed to load.
 */
export function viewToShow({
  chosen,
  mode,
  groupCount,
}: {
  chosen: KeywordsView | null;
  mode: ListMode | null;
  groupCount: number | null;
}): KeywordsView | null {
  if (mode === 'server' || chosen === 'flat') return 'flat';
  if (mode === null) return null;
  if (chosen === 'groups') return 'groups';
  if (groupCount === null) return null;
  return groupCount > 0 ? 'groups' : 'flat';
}

const groupedRowId = (row: GroupedRow): string => row.id;

export interface GroupedTableOptions {
  /** The list's rows for the device shown; none while the flat view shows, so nothing is grouped for it. */
  rows: readonly PairedRow[];
  /** The search of the page, already debounced: the tree does not search, so the rows are searched here. */
  search: string;
  /** The screen's chosen tracked ids, one per ticked keyword row, as in the flat view. */
  chosen: ReadonlySet<string>;
  onChosenChange: (ids: ReadonlySet<string>) => void;
  /** Both devices' ids under each tracked id (`memberIds`). */
  members: ReadonlyMap<string, readonly string[]>;
  /** The flat view's columns, as shown; By group leaves out those a group has no figure for. */
  keywordColumns: readonly DataTableColumn<PairedRow>[];
  timeZone: string;
  /** The URL's column list (`null` for the defaults), and what keeps a new one. */
  visible: readonly string[] | null;
  onColumnsChange: (visible: readonly string[] | null) => void;
  /** A keyword row's name, as the flat view gives it. */
  keywordRowName: (row: PairedRow) => string;
  /** Opens a keyword row, as the flat view does. */
  onKeywordOpen: (row: PairedRow, intent: 'inspector' | 'new-tab') => void;
  /** The tracked id open in the inspector. */
  openId: string | null;
  /** Takes the inspector's order: the tracked ids of the keyword rows shown. */
  onOrderChange: (ids: readonly string[]) => void;
  /** The group open in the inspector. */
  openGroupId: string | null;
  /** The menu of a group row; keyword and "Show all" rows have none. */
  groupActions: (target: GroupTarget) => readonly RecordAction<GroupedRow>[];
}

/** The props of the By group `DataTable` that are not shared with the flat one. */
export interface GroupedTableProps {
  columns: readonly DataTableColumn<GroupedRow>[];
  getRowId: (row: GroupedRow) => string;
  rows: readonly GroupedRow[];
  total: number;
  columnState: ColumnState;
  rowTree: (row: GroupedRow) => RowTree | undefined;
  onToggleGroup: (row: GroupedRow) => void;
  rowName: (row: GroupedRow) => string;
  onRowOpen: (row: GroupedRow, intent: 'inspector' | 'new-tab') => void;
  activeRowId: string | null;
  onRowOrderChange: (ids: readonly string[]) => void;
  rowActions: (row: GroupedRow) => readonly RecordAction<GroupedRow>[];
}

export interface GroupedTable {
  table: GroupedTableProps;
  sort: GroupSortId;
  setSort: (sort: GroupSortId) => void;
  selection: GroupedSelection & {
    selectedCount: number;
    unrenderedCount: number;
    onChange: (ids: ReadonlySet<string>) => void;
  };
  /** Whether a tracked id is the shown row of a keyword in view (its group may be closed). */
  inView: (trackedId: string) => boolean;
}

/**
 * The state and the derived rows of the By group view: which groups are open (the first one until a group is
 * toggled, and every group with a match while a search is on) and show all their keywords, the order of the
 * groups, and the selection as the table sees it.
 */
export function useGroupedTable({
  rows,
  search,
  chosen,
  onChosenChange,
  members,
  keywordColumns,
  timeZone,
  visible,
  onColumnsChange,
  keywordRowName,
  onKeywordOpen,
  openId,
  onOrderChange,
  openGroupId,
  groupActions,
}: GroupedTableOptions): GroupedTable {
  const t = useTranslations('rankings.grouped');
  const [expanded, setExpanded] = useState<ReadonlySet<string> | null>(null);
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(NONE);
  const [sort, setSort] = useState<GroupSortId>('size');
  const needle = search.trim().toLocaleLowerCase();
  const searched = useMemo(() => searchedRows(rows, needle), [rows, needle]);
  const notGroupedLabel = t('notGrouped');
  const searching = needle !== '';
  const grouped = useMemo(() => {
    const build = (open: ReadonlySet<string>): GroupedRow[] =>
      groupedRows({ rows: searched, notGroupedLabel, expanded: open, showAll, sort: GROUP_SORTS[sort] });
    const groupIds = build(NONE).flatMap((row) => (row.kind === 'group' ? [row.group.groupId] : []));
    // Until a group is toggled, the first group in the order shown is open. A search opens every group left,
    // and the groups as they were come back when it is cleared
    const base = expanded ?? new Set(groupIds.slice(0, 1));
    return { list: build(searching ? new Set(groupIds) : base), base };
  }, [searched, notGroupedLabel, expanded, showAll, sort, searching]);
  const list = grouped.list;

  const tree = useMemo(() => treeOf(list), [list]);
  const rowTree = useCallback(
    (row: GroupedRow): RowTree | undefined => {
      const facts = tree.get(row.id);
      if (facts === undefined || row.kind !== 'group') return facts;
      const words = { label: row.group.label, count: row.group.measures.size };
      return { ...facts, label: row.expanded ? t('collapse', words) : t('expand', words) };
    },
    [tree, t],
  );
  const base = grouped.base;
  const onToggleGroup = useCallback(
    (row: GroupedRow): void => {
      // While a search is on every group with a match stays open
      if (row.kind !== 'group' || searching) return;
      const next = new Set(base);
      if (next.has(row.group.groupId)) next.delete(row.group.groupId);
      else next.add(row.group.groupId);
      setExpanded(next);
    },
    [base, searching],
  );
  const onShowAll = useCallback((groupId: string): void => {
    setShowAll((current) => new Set(current).add(groupId));
  }, []);

  const picked = useMemo(() => selectionOf(list, chosen), [list, chosen]);
  const selection = useMemo(
    () => ({
      ...picked,
      selectedCount: chosenCount(chosen, members),
      unrenderedCount: unrenderedCount(list, searched, chosen),
      onChange: (next: ReadonlySet<string>) =>
        onChosenChange(applySelectionChange(chosen, picked.selectedIds, next, list)),
    }),
    [picked, chosen, members, list, searched, onChosenChange],
  );
  const keywordCount = useMemo(() => new Set(searched.map((row) => row.keyword.keyword_id)).size, [searched]);
  const shownIds = useMemo(() => new Set(searched.map((row) => row.tracked_keyword_id)), [searched]);

  const columnSource = useMemo(() => keywordColumns.filter((column) => !hiddenInGroups(column.id)), [keywordColumns]);
  const columns = useGroupedColumns(columnSource, { timeZone, onShowAll });
  const flatDefaults = useMemo(
    () => keywordColumns.filter((column) => column.defaultVisible !== false).map((column) => column.id),
    [keywordColumns],
  );
  const rowName = (row: GroupedRow): string => {
    if (row.kind === 'keyword') return keywordRowName(row.row);
    if (row.kind === 'more') return t('showAll', { count: row.hidden });
    return t('groupName', { label: row.group.label, count: row.group.measures.size });
  };

  return {
    table: {
      columns,
      getRowId: groupedRowId,
      rows: list,
      total: keywordCount,
      columnState: {
        visible: visibleForView(visible, 'groups'),
        onChange: (next) => onColumnsChange(mergeHidden(visible, next, flatDefaults, 'groups')),
      },
      rowTree,
      onToggleGroup,
      rowName,
      // A group row only toggles (the table does that); a "Show more" row, wherever it is used, shows the rest
      onRowOpen: (row, intent) => {
        if (row.kind === 'keyword') onKeywordOpen(row.row, intent);
        else if (row.kind === 'more') onShowAll(row.groupId);
      },
      activeRowId:
        openGroupId !== null
          ? (list.find((row) => row.kind === 'group' && row.group.groupId === openGroupId)?.id ?? null)
          : openId === null
            ? null
            : (list.find((row) => row.kind === 'keyword' && row.row.tracked_keyword_id === openId)?.id ?? null),
      onRowOrderChange: (ids) => onOrderChange(keywordOrder(list, ids)),
      rowActions: (row) =>
        row.kind === 'group'
          ? groupActions({ groupId: row.group.groupId, label: row.group.label, memberIds: row.group.memberIds })
          : [],
    },
    sort,
    setSort,
    selection,
    inView: (trackedId) => shownIds.has(trackedId),
  };
}
