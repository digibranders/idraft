import { describe, expect, it } from 'vitest';

import { OVERSCAN, rangeGaps, rowWindow, SCROLL_STEP, scrollToRow, WINDOW_FROM } from './row-window';

describe('rowWindow', () => {
  it('renders every row of a small table', () => {
    expect(rowWindow({ count: WINDOW_FROM, rowHeight: 40, scrollTop: 900, viewport: 400, keep: null })).toEqual([
      { start: 0, end: WINDOW_FROM },
    ]);
  });

  it('renders the rows in view plus the overscan', () => {
    expect(rowWindow({ count: 1000, rowHeight: 40, scrollTop: 4000, viewport: 400, keep: null })).toEqual([
      { start: 100 - OVERSCAN, end: 100 + 11 + OVERSCAN },
    ]);
  });

  it('stops at the ends of the table', () => {
    expect(rowWindow({ count: 1000, rowHeight: 32, scrollTop: 0, viewport: 320, keep: null })[0]?.start).toBe(0);
    expect(rowWindow({ count: 1000, rowHeight: 32, scrollTop: 40_000, viewport: 320, keep: null })).toEqual([
      { start: 1000, end: 1000 },
    ]);
  });

  it('renders a focused row far from the view on its own, not the rows between', () => {
    expect(rowWindow({ count: 10_000, rowHeight: 40, scrollTop: 360_000, viewport: 400, keep: 0 })).toEqual([
      { start: 0, end: 1 },
      { start: 9000 - OVERSCAN, end: 9000 + 11 + OVERSCAN },
    ]);
    expect(rowWindow({ count: 1000, rowHeight: 40, scrollTop: 0, viewport: 400, keep: 900 })).toEqual([
      { start: 0, end: 21 },
      { start: 900, end: 901 },
    ]);
  });

  it('joins a focused row next to the view to it', () => {
    expect(rowWindow({ count: 1000, rowHeight: 40, scrollTop: 0, viewport: 400, keep: 21 })).toEqual([
      { start: 0, end: 22 },
    ]);
    expect(rowWindow({ count: 1000, rowHeight: 40, scrollTop: 4000, viewport: 400, keep: 89 })).toEqual([
      { start: 89, end: 121 },
    ]);
  });

  it('still covers the view when the scroll offset is rounded down by a step', () => {
    for (const rowHeight of [32, 40]) {
      const scrollTop = 50_000 + SCROLL_STEP - 1;
      const [range] = rowWindow({
        count: 10_000,
        rowHeight,
        scrollTop: Math.floor(scrollTop / SCROLL_STEP) * SCROLL_STEP,
        viewport: 600,
        keep: null,
      });
      expect((range?.end ?? 0) * rowHeight).toBeGreaterThanOrEqual(scrollTop + 600);
    }
  });
});

describe('rangeGaps', () => {
  it('gives the space before each range and after the last', () => {
    expect(
      rangeGaps(
        [
          { start: 0, end: 1 },
          { start: 90, end: 121 },
        ],
        1000,
        40,
      ),
    ).toEqual([0, 89 * 40, 879 * 40]);
  });
});

describe('scrollToRow', () => {
  const at = (row: number, scrollTop: number): number | null =>
    scrollToRow({ row, rowHeight: 40, scrollTop, viewport: 400, header: 40 });

  it('scrolls up to a row above the view, and down to one below the header line', () => {
    expect(at(2, 400)).toBe(80);
    expect(at(20, 0)).toBe(840 - 400 + 40);
  });

  it('leaves the scroll alone for a row in view', () => {
    expect(at(3, 0)).toBeNull();
  });
});
