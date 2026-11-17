import type { SortKey } from '@/lib/tables/table-state';

/**
 * The sort a table applies (`DataTableProps.sortFallback`): `sort` itself, or `fallback` when a key of `sort` is on a
 * column that is not shown. The fallback keeps sorting the rows even when its own column is hidden (the Prompts page
 * keeps ordering by Mention rate with that column turned off); the header of a column that is not shown cannot carry
 * the indicator, so none is marked. A table in tree or server mode does not sort its rows; its caller does, so it
 * orders them by this result with the ids of the columns shown, and the header indicator then agrees with the rows.
 */
export function effectiveSort(
  sort: readonly SortKey[],
  fallback: readonly SortKey[] | undefined,
  shownIds: readonly string[],
): readonly SortKey[] {
  if (fallback === undefined || sort.every((key) => shownIds.includes(key.id))) return sort;
  return fallback;
}
