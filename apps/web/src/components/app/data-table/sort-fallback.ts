import type { SortKey } from '@/lib/tables/table-state';

/**
 * The sort a table draws and applies (`DataTableProps.sortFallback`): `sort` itself, or `fallback` when a key of `sort`
 * is on a column that is not shown. A table in tree or server mode does not sort its rows; its caller does, so it
 * orders them by this result with the ids of the columns shown, and the header indicator then agrees with the rows.
 */
export function effectiveSort(
  sort: readonly SortKey[],
  fallback: readonly SortKey[] | undefined,
  shownIds: readonly string[],
): readonly SortKey[] {
  return fallback !== undefined && sort.some((key) => !shownIds.includes(key.id)) ? fallback : sort;
}
