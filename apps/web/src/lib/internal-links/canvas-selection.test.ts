import { describe, expect, it } from 'vitest';

import { boxesIn, clampMove, keepOffsets, toggleSelected, withOffsets, withoutKeys } from './canvas-selection';

describe('canvas selection', () => {
  const boxes = new Map([
    ['a', { left: 0, top: 0, width: 240, height: 42 }],
    ['b', { left: 400, top: 0, width: 240, height: 42 }],
    ['c', { left: 0, top: 100, width: 240, height: 42 }],
  ]);

  it('finds the cards a selection box touches', () => {
    expect(boxesIn(boxes, { left: -10, top: -10, width: 300, height: 60 })).toEqual(['a']);
    expect(boxesIn(boxes, { left: 100, top: 20, width: 400, height: 100 }).sort()).toEqual(['a', 'b', 'c']);
    expect(boxesIn(boxes, { left: 700, top: 0, width: 10, height: 10 })).toEqual([]);
  });

  it('adds a card with Shift or Cmd and takes it away the second time', () => {
    expect([...toggleSelected(new Set(['a']), 'b')]).toEqual(['a', 'b']);
    expect([...toggleSelected(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });

  it('does not change the set it was given', () => {
    const before = new Set(['a']);
    toggleSelected(before, 'b');
    expect([...before]).toEqual(['a']);
  });

  it('moves a card and the cards selected with it by the same distance', () => {
    const moved = withOffsets(new Map([['a', { dx: 5, dy: 5 }]]), ['a', 'b'], 10, -4);
    expect(moved.get('a')).toEqual({ dx: 15, dy: 1 });
    expect(moved.get('b')).toEqual({ dx: 10, dy: -4 });
  });

  it('keeps only the keys that are still on the canvas', () => {
    const kept = withoutKeys(new Set(['a', 'b', 'x']), new Set(['a', 'b', 'c']));
    expect([...kept]).toEqual(['a', 'b']);
  });

  it('keeps the offsets of the cards that are still on the canvas, and the same map when none went', () => {
    const offsets = new Map([
      ['a', { dx: 1, dy: 2 }],
      ['x', { dx: 3, dy: 4 }],
    ]);
    expect([...keepOffsets(offsets, new Set(['a', 'b']))]).toEqual([['a', { dx: 1, dy: 2 }]]);
    expect(keepOffsets(offsets, new Set(['a', 'x']))).toBe(offsets);
  });

  it('clamps a move so every moved card stays inside the content', () => {
    const limits = new Map([
      ['a', { left: 10, top: 20, width: 100, height: 40 }],
      ['b', { left: 300, top: 0, width: 100, height: 40 }],
    ]);
    const content = { width: 500, height: 200 };
    // b can go 100 to the right (400 to 500), a would go to 600: the shared delta is held to b's room
    expect(clampMove(limits, new Map(), content, 900, 0)).toEqual({ dx: 100, dy: 0 });
    // a can go 10 to the left, b 300: held to a's room
    expect(clampMove(limits, new Map(), content, -900, 5)).toEqual({ dx: -10, dy: 5 });
    // the offset a card already has counts
    expect(clampMove(limits, new Map([['b', { dx: 60, dy: 0 }]]), content, 900, 0)).toEqual({ dx: 40, dy: 0 });
    // an unmeasured content (no layout yet) is not a limit
    expect(clampMove(limits, new Map(), { width: 0, height: 0 }, 900, -900)).toEqual({ dx: 900, dy: -900 });
  });

  it('returns the same set when every key is still there', () => {
    const selected = new Set(['a']);
    expect(withoutKeys(selected, new Set(['a']))).toBe(selected);
  });
});
