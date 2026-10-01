/**
 * Where the grid's one focused cell moves on a key (20-accessibility.md section 6.3, navigation mode). Row
 * `-1` is the header row; body rows count from 0. Columns are the visible ones, in order.
 */

export interface GridCell {
  row: number;
  column: number;
}

export interface GridSize {
  rows: number;
  columns: number;
  /** The number of fully visible rows, for Page Up and Page Down. */
  pageRows: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The cell `key` moves to, or `null` when the key does not move focus. */
export function moveFocus(cell: GridCell, key: string, size: GridSize, { ctrl }: { ctrl: boolean }): GridCell | null {
  const lastRow = size.rows - 1;
  const lastColumn = size.columns - 1;
  const step = Math.max(1, size.pageRows - 1);
  switch (key) {
    case 'ArrowRight':
      return { row: cell.row, column: clamp(cell.column + 1, 0, lastColumn) };
    case 'ArrowLeft':
      return { row: cell.row, column: clamp(cell.column - 1, 0, lastColumn) };
    // Up from the first body row reaches the header row, and no further
    case 'ArrowDown':
      return { row: clamp(cell.row + 1, -1, lastRow), column: cell.column };
    case 'ArrowUp':
      return { row: clamp(cell.row - 1, -1, lastRow), column: cell.column };
    case 'Home':
      return ctrl ? { row: -1, column: 0 } : { row: cell.row, column: 0 };
    case 'End':
      return ctrl ? { row: lastRow, column: lastColumn } : { row: cell.row, column: lastColumn };
    case 'PageDown':
      return { row: clamp(cell.row + step, -1, lastRow), column: cell.column };
    case 'PageUp':
      return { row: clamp(cell.row - step, -1, lastRow), column: cell.column };
    default:
      return null;
  }
}

/** The ids from `anchor` to `target` in list order, both included; just the target when the anchor is gone. */
export function rangeOf(ids: readonly string[], anchor: string | null, target: string): string[] {
  const to = ids.indexOf(target);
  if (to === -1) return [];
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  if (from === -1) return [target];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}
