/**
 * Which columns a table shows (12-tables.md section 10, 19-responsive-behavior.md section 6.1): the
 * person's chosen set in their order, or the defaults, at every width: a narrow window scrolls sideways with
 * the identity column pinned (owner decision of 2026-10-30). The identity column is always shown, first.
 */

export interface ColumnVisibilityMeta {
  id: string;
  /** 1 to 4, how much the screen cares about the column (19-responsive-behavior.md section 6.1). */
  priority: 1 | 2 | 3 | 4;
  identity: boolean;
  defaultVisible: boolean;
}

/** The chosen columns in order: the defaults when nothing is chosen. */
export function chosenColumns(columns: readonly ColumnVisibilityMeta[], chosen: readonly string[] | null): string[] {
  const identity = columns.filter((column) => column.identity).map((column) => column.id);
  const known = new Set(columns.map((column) => column.id));
  const ids =
    chosen === null
      ? columns.filter((column) => column.defaultVisible).map((column) => column.id)
      : chosen.filter((id) => known.has(id));
  return [...identity, ...ids.filter((id) => !identity.includes(id))].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
}

/** The chosen set with `id` moved one place left or right; the identity column stays first. */
export function moveColumn(
  columns: readonly ColumnVisibilityMeta[],
  chosen: readonly string[] | null,
  id: string,
  direction: -1 | 1,
): string[] {
  const ids = chosenColumns(columns, chosen);
  const from = ids.indexOf(id);
  const to = from + direction;
  const identityCount = columns.filter((column) => column.identity).length;
  if (from < identityCount || to < identityCount || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The chosen set with `id` shown (added last) or hidden; the identity column cannot be hidden. */
export function toggleColumn(
  columns: readonly ColumnVisibilityMeta[],
  chosen: readonly string[] | null,
  id: string,
  visible: boolean,
): string[] {
  const ids = chosenColumns(columns, chosen);
  if (columns.find((column) => column.id === id)?.identity === true) return ids;
  if (visible) return ids.includes(id) ? ids : [...ids, id];
  return ids.filter((existing) => existing !== id);
}
