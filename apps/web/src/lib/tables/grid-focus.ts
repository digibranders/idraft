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

/**
 * What a control inside a cell (a copy button, a link) carries: the table finds it by the attribute when F2
 * puts the cell in widget mode (20-accessibility.md section 6.3), and its place in the tab order is out,
 * since the grid has one tab stop. A click and a screen reader's own commands still reach it.
 */
export const CELL_CONTROL = { 'data-cell-control': '', tabIndex: -1 } as const;
/** The selector of the controls `CELL_CONTROL` marks. */
export const CELL_CONTROL_SELECTOR = '[data-cell-control]';

/**
 * The control Tab (or Shift+Tab with `backwards`) goes to in widget mode, as an index among `count` controls
 * in DOM order, wrapping at both ends. `index` is the control that has focus, `-1` when none does. `-1` back
 * when there is no control to go to.
 */
export function stepControl(count: number, index: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (index < 0) return backwards ? count - 1 : 0;
  return (index + (backwards ? count - 1 : 1)) % count;
}

/** The ids from `anchor` to `target` in list order, both included; just the target when the anchor is gone. */
export function rangeOf(ids: readonly string[], anchor: string | null, target: string): string[] {
  const to = ids.indexOf(target);
  if (to === -1) return [];
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  if (from === -1) return [target];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}
