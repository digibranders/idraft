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
import { keywordText } from '../keyword-columns';
import { idsOfPair, type PairedRow } from '../keyword-pairs';
import type { RecordAction, RowTree } from '@/components/app/data-table/types';

/** The orders the "Sort groups" menu offers, each in the direction it reads best in. */
export const GROUP_SORTS = {
  size: { by: 'size', desc: true },
  name: { by: 'name', desc: false },
  volume: { by: 'volume', desc: true },
  rank: { by: 'rank', desc: false },
} as const satisfies Record<string, GroupSort>;
export type GroupSortId = keyof typeof GROUP_SORTS;

const NONE: ReadonlySet<string> = new Set();

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

export interface GroupedTableOptions {
  /** The list's rows for the device shown. */
  rows: readonly PairedRow[];
  /** The search of the page, already debounced: the tree does not search, so the rows are searched here. */
  search: string;
  /** The screen's chosen tracked ids, one per ticked keyword row, as in the flat view. */
  chosen: ReadonlySet<string>;
  onChosenChange: (ids: ReadonlySet<string>) => void;
  /** Both devices' ids under each tracked id (`memberIds`). */
  members: ReadonlyMap<string, readonly string[]>;
}

export interface GroupedTable {
  rows: readonly GroupedRow[];
  /** Distinct keywords in view. */
  keywordCount: number;
  rowTree: (row: GroupedRow) => RowTree | undefined;
  onToggleGroup: (row: GroupedRow) => void;
  /** Stable, for `useGroupedColumns`. */
  onShowAll: (groupId: string) => void;
  sort: GroupSortId;
  setSort: (sort: GroupSortId) => void;
  selection: GroupedSelection & {
    selectedCount: number;
    unrenderedCount: number;
    onChange: (ids: ReadonlySet<string>) => void;
  };
  /** The inspector's order from the ids the table reports. */
  keywordOrder: (ids: readonly string[]) => string[];
  /** The table's id of the row of a tracked id: its first copy, or `null` when no row shows it. */
  rowIdOf: (trackedId: string | null) => string | null;
  /** Whether a tracked id is the shown row of a keyword in view (its group may be closed). */
  inView: (trackedId: string) => boolean;
}

/**
 * The state and the derived rows of the By group view: which groups are open (the first one until a group is
 * toggled) and show all their keywords, the order of the groups, and the selection as the table sees it.
 */
export function useGroupedTable({ rows, search, chosen, onChosenChange, members }: GroupedTableOptions): GroupedTable {
  const t = useTranslations('rankings.grouped');
  const [expanded, setExpanded] = useState<ReadonlySet<string> | null>(null);
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(NONE);
  const [sort, setSort] = useState<GroupSortId>('size');
  const needle = search.trim().toLocaleLowerCase();
  const searched = useMemo(
    () => (needle === '' ? rows : rows.filter((row) => keywordText(row).toLocaleLowerCase().includes(needle))),
    [rows, needle],
  );
  const notGroupedLabel = t('notGrouped');
  const grouped = useMemo(() => {
    const build = (open: ReadonlySet<string>): GroupedRow[] =>
      groupedRows({ rows: searched, notGroupedLabel, expanded: open, showAll, sort: GROUP_SORTS[sort] });
    if (expanded !== null) return { list: build(expanded), open: expanded };
    // Until a group is toggled, the first group in the order shown is open
    const collapsed = build(NONE);
    const first = collapsed[0];
    if (first?.kind !== 'group') return { list: collapsed, open: NONE };
    const open = new Set([first.group.groupId]);
    return { list: build(open), open };
  }, [searched, notGroupedLabel, expanded, showAll, sort]);
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
  const open = grouped.open;
  const onToggleGroup = useCallback(
    (row: GroupedRow): void => {
      if (row.kind !== 'group') return;
      const next = new Set(open);
      if (next.has(row.group.groupId)) next.delete(row.group.groupId);
      else next.add(row.group.groupId);
      setExpanded(next);
    },
    [open],
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

  return {
    rows: list,
    keywordCount,
    rowTree,
    onToggleGroup,
    onShowAll,
    sort,
    setSort,
    selection,
    keywordOrder: (ids) => keywordOrder(list, ids),
    rowIdOf: (trackedId) =>
      trackedId === null
        ? null
        : (list.find((row) => row.kind === 'keyword' && row.row.tracked_keyword_id === trackedId)?.id ?? null),
    inView: (trackedId) => shownIds.has(trackedId),
  };
}
