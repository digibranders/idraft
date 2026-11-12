/** What the tree keys need to know of a row: its level, and whether it is a group (`expanded` null: it is not). */
export interface TreeRowFacts {
  level: 1 | 2 | 3;
  expanded: boolean | null;
}

/** What a tree key does: open or close the group row, or move to another row. `null`: the grid moves between cells. */
export type TreeKeyResult = { kind: 'toggle' } | { kind: 'move'; row: number } | null;

/** The row a row sits under: the nearest earlier row with a lower level. */
export function parentIndex(rows: readonly TreeRowFacts[], index: number): number | null {
  const level = rows[index]?.level;
  if (level === undefined) return null;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const above = rows[candidate];
    if (above !== undefined && above.level < level) return candidate;
  }
  return null;
}

/**
 * The tree keys of 20-accessibility.md section 6.7. Right opens a closed group, or moves from an open one to its
 * first row; Left closes an open group, or moves from a row, or a closed group below level 1, to its parent.
 */
export function treeKey(rows: readonly TreeRowFacts[], index: number, key: 'ArrowRight' | 'ArrowLeft'): TreeKeyResult {
  const row = rows[index];
  if (row === undefined) return null;
  if (key === 'ArrowRight') {
    if (row.expanded === null) return null;
    if (!row.expanded) return { kind: 'toggle' };
    return rows[index + 1]?.level === row.level + 1 ? { kind: 'move', row: index + 1 } : null;
  }
  if (row.expanded === true) return { kind: 'toggle' };
  const parent = row.level > 1 ? parentIndex(rows, index) : null;
  return parent === null ? null : { kind: 'move', row: parent };
}

/** The rows a row sits under, the nearest first. */
export function ancestorIndexes(rows: readonly TreeRowFacts[], index: number): number[] {
  const ancestors: number[] = [];
  for (let parent = parentIndex(rows, index); parent !== null; parent = parentIndex(rows, parent)) {
    ancestors.push(parent);
  }
  return ancestors;
}
