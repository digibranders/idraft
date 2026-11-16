import type { SortKey } from '@/lib/tables/table-state';

const NO_SORT: readonly SortKey[] = [];

/**
 * The sort a table draws and applies (`DataTableProps.sortFallback`): `sort` itself, or `fallback` when a key of `sort`
 * is on a column that is not shown. When a column of the fallback is not shown either, the rows keep the order they
 * were given in and no header is marked: a sort the header cannot show is never applied. A table in tree or server mode
 * does not sort its rows; its caller does, so it orders them by this result with the ids of the columns shown, and the
 * header indicator then agrees with the rows.
 */
export function effectiveSort(
  sort: readonly SortKey[],
  fallback: readonly SortKey[] | undefined,
  shownIds: readonly string[],
): readonly SortKey[] {
  if (fallback === undefined || sort.every((key) => shownIds.includes(key.id))) return sort;
  return fallback.every((key) => shownIds.includes(key.id)) ? fallback : NO_SORT;
}
