import { describe, expect, it } from 'vitest';

import { nextOffset, previousOffset, rangeOf } from './offset-paging';

describe('offset paging', () => {
  it('goes forward while rows remain', () => {
    expect(nextOffset(0, 100, 250)).toBe(100);
    expect(nextOffset(200, 100, 250)).toBeNull();
    expect(nextOffset(100, 100, 200)).toBeNull();
  });

  it('stops where the API stops taking an offset (100000), even when the list is longer', () => {
    expect(nextOffset(99_900, 100, 200_000)).toBe(100_000);
    expect(nextOffset(100_000, 100, 200_000)).toBeNull();
    expect(nextOffset(99_950, 100, 200_000)).toBeNull();
  });

  it('goes back to the page before, never below the first', () => {
    expect(previousOffset(0, 100)).toBeNull();
    expect(previousOffset(50, 100)).toBe(0);
    expect(previousOffset(300, 100)).toBe(200);
  });

  it('names the rows of a page', () => {
    expect(rangeOf(100, 50, 250)).toEqual({ from: 101, to: 150, total: 250 });
    expect(rangeOf(0, 0, 0)).toEqual({ from: 0, to: 0, total: 0 });
  });
});
