'use client';

import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type RowData,
} from '@tanstack/react-table';
import { useMemo } from 'react';

import type { DataTableColumn } from './types';
import type { SortKey } from '@/lib/tables/table-state';

const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
});
const TEXT_TYPES = new Set(['keyword', 'text', 'badge', 'status', 'url']);

/**
 * The rows in the order `sort` asks for (12-tables.md section 8), sorted by TanStack Table in client mode;
 * in server mode the API sorted them, and they are kept as they came. A value of `null` sorts last in both
 * directions, as unknown values do. Columns without `sortValue` do not sort.
 */
export function useSortedRows<TRow extends RowData>({
  rows,
  columns,
  sort,
  manual,
  getRowId,
}: {
  rows: readonly TRow[];
  columns: readonly DataTableColumn<TRow>[];
  sort: readonly SortKey[];
  manual: boolean;
  getRowId: (row: TRow) => string;
}): TRow[] {
  // TanStack rebuilds its row models when the data, the columns or the sorting state is a new object, so
  // each is kept until what it is made from changes: a render for scrolling or focus sorts nothing
  const definitions = useMemo(() => {
    const helper = createColumnHelper<typeof FEATURES, TRow>();
    return helper.columns(
      columns
        .filter((column) => column.sortValue !== undefined)
        .map((column) =>
          helper.accessor((row: TRow) => column.sortValue?.(row) ?? undefined, {
            id: column.id,
            sortUndefined: 'last',
            sortFn: TEXT_TYPES.has(column.type) ? 'text' : 'basic',
          }),
        ),
    );
  }, [columns]);
  const sorting = useMemo(() => {
    const known = new Set(columns.filter((column) => column.sortValue !== undefined).map((column) => column.id));
    return sort.filter((key) => known.has(key.id)).map((key) => ({ id: key.id, desc: key.desc }));
  }, [columns, sort]);
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({
    features: FEATURES,
    columns: definitions,
    data,
    getRowId: (row: TRow) => getRowId(row),
    manualSorting: manual,
    state: { sorting },
  });
  const sorted = table.getRowModel().rows;
  return useMemo(() => sorted.map((row) => row.original), [sorted]);
}
