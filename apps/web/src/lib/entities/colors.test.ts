import { describe, expect, it } from 'vitest';

import { entityColorOf, nextCompetitorColor, placeCompetitorColors } from './colors';

describe('nextCompetitorColor', () => {
  it('gives a new competitor the first free color of 2 to 6, then the neutral one', () => {
    expect(nextCompetitorColor([{ color_index: 1 }])).toBe(2);
    expect(nextCompetitorColor([{ color_index: 1 }, { color_index: 2 }, { color_index: 4 }])).toBe(3);
    expect(nextCompetitorColor([1, 2, 3, 4, 5, 6].map((color_index) => ({ color_index })))).toBeNull();
  });
});

describe('entityColorOf', () => {
  it('keeps 1 to 6 and gives nothing for a color past them or not read yet', () => {
    expect([1, 2, 3, 4, 5, 6].map(entityColorOf)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([0, 7, 2.5, null, undefined].map(entityColorOf)).toEqual([null, null, null, null, null]);
  });
});

describe('placeCompetitorColors', () => {
  const item = (id: string, stored: number | null): { id: string; stored: number | null } => ({ id, stored });

  it('keeps a stored color, and an earlier competitor holding it keeps it from a later one', () => {
    const placed = placeCompetitorColors([item('a', 3), item('b', 3), item('c', 9), item('d', null)]);
    expect([...placed]).toEqual([
      ['a', 3],
      ['b', 2],
      ['c', 4],
      ['d', 5],
    ]);
  });

  it('gives the free colors in the order asked for, and nothing once the five are held', () => {
    const placed = placeCompetitorColors(
      [item('z', null), item('a', null), item('m', 2), item('x', null), item('y', null), item('w', null)],
      (left, right) => left.id.localeCompare(right.id),
    );
    expect([...placed]).toEqual([
      ['m', 2],
      ['a', 3],
      ['w', 4],
      ['x', 5],
      ['y', 6],
    ]);
    expect(placed.has('z')).toBe(false);
  });
});
