import { describe, expect, it } from 'vitest';

import { OVERSCAN, rowWindow, scrollToRow, WINDOW_FROM } from './row-window';

describe('rowWindow', () => {
  it('renders every row of a small table', () => {
    expect(rowWindow({ count: WINDOW_FROM, rowHeight: 40, scrollTop: 900, viewport: 400, keep: null })).toEqual({
      start: 0,
      end: WINDOW_FROM,
      before: 0,
      after: 0,
    });
  });

  it('renders the rows in view plus the overscan, with the space of the others around them', () => {
    const window = rowWindow({ count: 1000, rowHeight: 40, scrollTop: 4000, viewport: 400, keep: null });
    expect(window.start).toBe(100 - OVERSCAN);
    expect(window.end).toBe(100 + 11 + OVERSCAN);
    expect(window.before).toBe(window.start * 40);
    expect(window.after).toBe((1000 - window.end) * 40);
  });

  it('stops at the ends of the table', () => {
    expect(rowWindow({ count: 1000, rowHeight: 32, scrollTop: 0, viewport: 320, keep: null }).start).toBe(0);
    expect(rowWindow({ count: 1000, rowHeight: 32, scrollTop: 40_000, viewport: 320, keep: null }).end).toBe(1000);
  });

  it('keeps the focused row rendered, wherever it is', () => {
    const window = rowWindow({ count: 1000, rowHeight: 40, scrollTop: 4000, viewport: 400, keep: 3 });
    expect(window.start).toBe(3);
    expect(window.before).toBe(120);
    expect(rowWindow({ count: 1000, rowHeight: 40, scrollTop: 0, viewport: 400, keep: 900 }).end).toBe(901);
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
