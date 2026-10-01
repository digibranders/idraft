/**
 * A data table's state as plain data, and how it is written in the URL (12-tables.md sections 8, 10 and
 * 11): the sort (`?sort=-search_volume,keyword`), the visible columns in order (`?cols=keyword,volume`) and
 * the density. Unknown column ids are dropped, so an old link never breaks a table.
 */

/** One sort key: a column id and its direction. */
export interface SortKey {
  id: string;
  desc: boolean;
}

export type Density = 'default' | 'compact';

export const DENSITIES: readonly Density[] = ['default', 'compact'];

/** A table sorts by at most this many keys (12-tables.md section 8). */
export const MAX_SORT_KEYS = 2;

/** `-search_volume,keyword` as sort keys; ids outside `known` and repeats are dropped. */
export function parseSort(value: string | null | undefined, known: ReadonlySet<string>): SortKey[] {
  if (value === null || value === undefined || value.trim() === '') return [];
  const keys: SortKey[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    const desc = trimmed.startsWith('-');
    const id = desc ? trimmed.slice(1) : trimmed;
    if (!known.has(id) || keys.some((key) => key.id === id)) continue;
    keys.push({ id, desc });
    if (keys.length === MAX_SORT_KEYS) break;
  }
  return keys;
}

/** Sort keys as the URL writes them: `-` before a descending key, keys joined by commas. */
export const formatSort = (sort: readonly SortKey[]): string =>
  sort.map((key) => `${key.desc ? '-' : ''}${key.id}`).join(',');

export const sameSort = (a: readonly SortKey[], b: readonly SortKey[]): boolean =>
  a.length === b.length && a.every((key, index) => key.id === b[index]?.id && key.desc === b[index].desc);

/**
 * The sort after a click on a column header (12-tables.md section 8): the first click sorts in the
 * column's default direction, the second reverses it, the third returns to the table's default sort.
 * With `additive` (Shift+click) the column becomes or stays the second key, at most two keys.
 */
export function nextSort(
  current: readonly SortKey[],
  column: { id: string; defaultDesc: boolean },
  { additive, tableDefault }: { additive: boolean; tableDefault: readonly SortKey[] },
): SortKey[] {
  const existing = current.find((key) => key.id === column.id);
  const next: SortKey | null =
    existing === undefined
      ? { id: column.id, desc: column.defaultDesc }
      : existing.desc === column.defaultDesc
        ? { id: column.id, desc: !existing.desc }
        : null;
  if (!additive) return next === null ? [...tableDefault] : [next];
  const others = current.filter((key) => key.id !== column.id);
  if (next === null) return others.length === 0 ? [...tableDefault] : others;
  // The clicked column keeps its place when it is already a key, and joins last otherwise
  const kept = existing === undefined ? [...others, next] : current.map((key) => (key.id === column.id ? next : key));
  return kept.slice(-MAX_SORT_KEYS);
}

/**
 * `keyword,volume,kd` as visible column ids in order; ids outside `known` and repeats are dropped, and the
 * `required` ones (the identity column) are always there, first. `null` when the URL names no columns.
 */
export function parseColumns(
  value: string | null | undefined,
  known: ReadonlySet<string>,
  required: readonly string[],
): string[] | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const ids: string[] = [...required];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (known.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export const formatColumns = (ids: readonly string[]): string => ids.join(',');

export const parseDensity = (value: string | null | undefined): Density =>
  value === 'compact' ? 'compact' : 'default';
