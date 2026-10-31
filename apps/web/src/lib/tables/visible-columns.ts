/**
 * Which columns a table shows (12-tables.md section 10, 19-responsive-behavior.md section 6.1): the
 * person's chosen set in their order, or the defaults, less the columns the viewport is too narrow for.
 * The identity column is always shown, first.
 */

export interface ColumnVisibilityMeta {
  id: string;
  /** 1 always shown; 2 to 4 join the defaults in that order while there is room for them. */
  priority: 1 | 2 | 3 | 4;
  identity: boolean;
  defaultVisible: boolean;
  /** The column's default width in pixels, what it takes from the room. */
  width: number;
}

/** The chosen columns in order, before the width tier: the defaults when nothing is chosen. */
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

/**
 * The columns to show in `room` pixels, the width left once the pinned identity column and the frame columns
 * are taken. A person's own choice is shown whole, and the table scrolls sideways. The defaults are not: the
 * columns the viewport's tier allows stay (priority 1 always; 2 from 1280 px, 3 from 1440 px, 4 from 1680 px),
 * then the others join by priority (then by place) while each still fits, so a narrow window shows what it has
 * room for and the identity column is never the one that takes the room.
 */
export function columnsFitting(
  columns: readonly ColumnVisibilityMeta[],
  chosen: readonly string[] | null,
  room: number,
  tier: 1 | 2 | 3 | 4,
): string[] {
  const ids = chosenColumns(columns, chosen);
  if (chosen !== null) return ids;
  const byId = new Map(columns.map((column) => [column.id, column]));
  const kept = new Set(ids.filter((id) => byId.get(id)?.identity === true || (byId.get(id)?.priority ?? 4) <= tier));
  let used = [...kept].reduce((sum, id) => sum + (byId.get(id)?.identity === true ? 0 : (byId.get(id)?.width ?? 0)), 0);
  const others = ids
    .filter((id) => !kept.has(id))
    .map((id, place) => ({ id, place, column: byId.get(id) }))
    .sort((a, b) => (a.column?.priority ?? 4) - (b.column?.priority ?? 4) || a.place - b.place);
  for (const { id, column } of others) {
    const width = column?.width ?? 0;
    if (used + width > room) continue;
    kept.add(id);
    used += width;
  }
  return ids.filter((id) => kept.has(id));
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
