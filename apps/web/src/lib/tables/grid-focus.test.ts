import { describe, expect, it } from 'vitest';

import { CELL_CONTROL, moveFocus, rangeOf, stepControl, type GridCell } from './grid-focus';

const SIZE = { rows: 50, columns: 6, pageRows: 11 };
const move = (cell: GridCell, key: string, ctrl = false): GridCell | null => moveFocus(cell, key, SIZE, { ctrl });

describe('moveFocus', () => {
  it('moves one cell with the arrows, without wrapping to the next row', () => {
    expect(move({ row: 3, column: 2 }, 'ArrowRight')).toEqual({ row: 3, column: 3 });
    expect(move({ row: 3, column: 5 }, 'ArrowRight')).toEqual({ row: 3, column: 5 });
    expect(move({ row: 3, column: 0 }, 'ArrowLeft')).toEqual({ row: 3, column: 0 });
    expect(move({ row: 49, column: 1 }, 'ArrowDown')).toEqual({ row: 49, column: 1 });
  });

  it('reaches the header row from the first body row, and stops there', () => {
    expect(move({ row: 0, column: 1 }, 'ArrowUp')).toEqual({ row: -1, column: 1 });
    expect(move({ row: -1, column: 1 }, 'ArrowUp')).toEqual({ row: -1, column: 1 });
    expect(move({ row: -1, column: 1 }, 'ArrowDown')).toEqual({ row: 0, column: 1 });
  });

  it('goes to the ends of the row, or of the table with Ctrl', () => {
    expect(move({ row: 7, column: 3 }, 'Home')).toEqual({ row: 7, column: 0 });
    expect(move({ row: 7, column: 3 }, 'End')).toEqual({ row: 7, column: 5 });
    expect(move({ row: 7, column: 3 }, 'Home', true)).toEqual({ row: -1, column: 0 });
    expect(move({ row: 7, column: 3 }, 'End', true)).toEqual({ row: 49, column: 5 });
  });

  it('pages by the visible rows less one', () => {
    expect(move({ row: 0, column: 2 }, 'PageDown')).toEqual({ row: 10, column: 2 });
    expect(move({ row: 45, column: 2 }, 'PageDown')).toEqual({ row: 49, column: 2 });
    expect(move({ row: 5, column: 2 }, 'PageUp')).toEqual({ row: -1, column: 2 });
  });

  it('ignores other keys', () => {
    expect(move({ row: 0, column: 0 }, 'a')).toBeNull();
  });
});

describe('rangeOf', () => {
  const IDS = ['a', 'b', 'c', 'd', 'e'];

  it('takes the ids between the anchor and the target in either direction', () => {
    expect(rangeOf(IDS, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeOf(IDS, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('takes the target alone without an anchor, and nothing for an unknown target', () => {
    expect(rangeOf(IDS, null, 'c')).toEqual(['c']);
    expect(rangeOf(IDS, 'zz', 'c')).toEqual(['c']);
    expect(rangeOf(IDS, 'a', 'zz')).toEqual([]);
  });
});

describe('stepControl', () => {
  it('goes on to the next control and wraps from the last to the first', () => {
    expect(stepControl(3, 0, false)).toBe(1);
    expect(stepControl(3, 2, false)).toBe(0);
  });

  it('goes back to the one before and wraps from the first to the last', () => {
    expect(stepControl(3, 2, true)).toBe(1);
    expect(stepControl(3, 0, true)).toBe(2);
  });

  it('stays on a cell with one control, and starts from the first or the last when focus is not on one', () => {
    expect(stepControl(1, 0, false)).toBe(0);
    expect(stepControl(1, 0, true)).toBe(0);
    expect(stepControl(4, -1, false)).toBe(0);
    expect(stepControl(4, -1, true)).toBe(3);
  });

  it('has nowhere to go without a control', () => {
    expect(stepControl(0, -1, false)).toBe(-1);
  });
});

describe('CELL_CONTROL', () => {
  it('marks a control the table reaches through its cell, and keeps it out of the tab order', () => {
    expect(CELL_CONTROL).toEqual({ 'data-cell-control': '', tabIndex: -1 });
  });
});
