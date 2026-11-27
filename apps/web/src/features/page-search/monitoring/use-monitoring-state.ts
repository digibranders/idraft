'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo, useState } from 'react';

import {
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

/** Attention first: Lost traffic, then the other verdicts as `attentionOrder` ranks them. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'health', desc: false }];

/** The column the table cannot do without. */
const REQUIRED_COLUMNS = ['page'];

const TABLE_KEYS = { sort: parseAsString, density: parseAsString, cols: parseAsString };

export interface MonitoringState {
  sort: readonly SortKey[];
  /** The default sort writes nothing to the address. */
  setSort: (keys: readonly SortKey[]) => void;
  density: Density;
  setDensity: (density: Density) => void;
  /** `null`: the table's default columns. */
  visible: readonly string[] | null;
  setVisible: (visible: readonly string[] | null) => void;
  /** Path or title; kept in the page, not in the address. */
  search: string;
  setSearch: (search: string) => void;
}

/**
 * What the table keeps in the address (the sort, the density and the columns) and the search text. The period and the
 * comparison are `usePanelState`'s keys, read by the screen, which needs them before it has any columns.
 */
export function useMonitoringState(knownColumns: ReadonlySet<string>): MonitoringState {
  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });
  const [search, setSearch] = useState('');

  const sort = useMemo(() => {
    const read = parseSort(table.sort, knownColumns);
    return read.length > 0 ? read : DEFAULT_SORT;
  }, [table.sort, knownColumns]);
  const setSort = useCallback(
    (keys: readonly SortKey[]): void => {
      void setTable({ sort: keys.length === 0 || sameSort(keys, DEFAULT_SORT) ? null : formatSort(keys) });
    },
    [setTable],
  );
  const setDensity = useCallback(
    (density: Density): void => {
      void setTable({ density: density === 'compact' ? null : density });
    },
    [setTable],
  );
  const visible = useMemo(() => parseColumns(table.cols, knownColumns, REQUIRED_COLUMNS), [table.cols, knownColumns]);
  const setVisible = useCallback(
    (visible: readonly string[] | null): void => {
      void setTable({ cols: visible === null ? null : formatColumns(visible) });
    },
    [setTable],
  );

  return {
    sort,
    setSort,
    density: parseDensity(table.density),
    setDensity,
    visible,
    setVisible,
    search,
    setSearch,
  };
}
