import { describe, expect, it } from 'vitest';

import { boxesIn, toggleSelected, withOffsets, withoutKeys } from './canvas-selection';

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

  it('returns the same set when every key is still there', () => {
    const selected = new Set(['a']);
    expect(withoutKeys(selected, new Set(['a']))).toBe(selected);
  });
});
