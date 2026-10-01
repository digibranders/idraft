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

import type { DataTableColumn } from './types';
import type { SortKey } from '@/lib/tables/table-state';

const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
});
const TEXT_TYPES = new Set(['keyword', 'text', 'badge', 'status']);

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
  const helper = createColumnHelper<typeof FEATURES, TRow>();
  const sortable = columns.filter((column) => column.sortValue !== undefined);
  const definitions = helper.columns(
    sortable.map((column) =>
      helper.accessor((row: TRow) => column.sortValue?.(row) ?? undefined, {
        id: column.id,
        sortUndefined: 'last',
        sortFn: TEXT_TYPES.has(column.type) ? 'text' : 'basic',
      }),
    ),
  );
  const known = new Set(sortable.map((column) => column.id));
  const table = useTable({
    features: FEATURES,
    columns: definitions,
    data: [...rows],
    getRowId: (row: TRow) => getRowId(row),
    manualSorting: manual,
    state: { sorting: sort.filter((key) => known.has(key.id)).map((key) => ({ id: key.id, desc: key.desc })) },
  });
  return table.getRowModel().rows.map((row) => row.original);
}
