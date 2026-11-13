/**
 * Keyboard row targets, drop index and width snapping (WP-15 plan 2.1 and 2.8). The packing itself is tested
 * in layouts.test.ts; these tests use the shape of the overview built-in: wide rows [8,4] [6,6] [6,6] [6,6],
 * medium rows [12] [6,6] [6,6] [6,6] [6].
 */
import { describe, expect, it } from 'vitest';
import { distinctSpans, dropIndex, keyboardTarget, rowOf, snapWidth, type MoveKey } from './rows';
import { WIDTHS, type CardItem, type Width } from './types';

const cardsOf = (...widths: Width[]): CardItem[] =>
  widths.map((width, index) => ({ id: `c${index}`, type: 'x', width }));

const OVERVIEW = cardsOf('two_thirds', 'third', 'half', 'half', 'half', 'half', 'half', 'half');

describe('rowOf', () => {
  it('counts rows from 1 at the wide breakpoint', () => {
    expect(rowOf(OVERVIEW, 'wide', 0)).toBe(1);
    expect(rowOf(OVERVIEW, 'wide', 1)).toBe(1);
    expect(rowOf(OVERVIEW, 'wide', 2)).toBe(2);
    expect(rowOf(OVERVIEW, 'wide', 7)).toBe(4);
  });

  it('packs for the breakpoint it is given', () => {
    expect(rowOf(OVERVIEW, 'medium', 1)).toBe(2);
    expect(rowOf(OVERVIEW, 'medium', 7)).toBe(5);
    expect(rowOf(OVERVIEW, 'narrow', 7)).toBe(8);
  });

  it('gives 0 for an index that is not a card', () => {
    expect(rowOf([], 'wide', 0)).toBe(0);
    expect(rowOf(OVERVIEW, 'wide', 8)).toBe(0);
    expect(rowOf(OVERVIEW, 'wide', -1)).toBe(0);
  });
});

describe('keyboardTarget', () => {
  it('moves one place with Left and Right and stops at the ends', () => {
    expect(keyboardTarget(OVERVIEW, 'wide', 3, 'ArrowLeft')).toBe(2);
    expect(keyboardTarget(OVERVIEW, 'wide', 3, 'ArrowRight')).toBe(4);
    expect(keyboardTarget(OVERVIEW, 'wide', 0, 'ArrowLeft')).toBeNull();
    expect(keyboardTarget(OVERVIEW, 'wide', 7, 'ArrowRight')).toBeNull();
  });

  it('moves Down to the card in the next row whose start column is nearest', () => {
    // Card 1 is the third at columns 9 to 12; row 2 starts at columns 1 and 7, so card 3 (7) is nearest.
    expect(keyboardTarget(OVERVIEW, 'wide', 1, 'ArrowDown')).toBe(3);
    expect(keyboardTarget(OVERVIEW, 'wide', 0, 'ArrowDown')).toBe(2);
    expect(keyboardTarget(OVERVIEW, 'wide', 3, 'ArrowDown')).toBe(5);
  });

  it('moves Up to the card in the row above whose start column is nearest', () => {
    expect(keyboardTarget(OVERVIEW, 'wide', 2, 'ArrowUp')).toBe(0);
    expect(keyboardTarget(OVERVIEW, 'wide', 3, 'ArrowUp')).toBe(1);
    expect(keyboardTarget(OVERVIEW, 'wide', 5, 'ArrowUp')).toBe(3);
  });

  it('prefers the earlier card when two are equally near', () => {
    // Row 2 starts at columns 1, 5 and 9; card 1 starts at column 7, two away from both 5 and 9.
    const cards = cardsOf('half', 'half', 'third', 'third', 'third');
    expect(keyboardTarget(cards, 'wide', 1, 'ArrowDown')).toBe(3);
    const thirdsAbove = cardsOf('third', 'third', 'third', 'half', 'half');
    expect(keyboardTarget(thirdsAbove, 'wide', 4, 'ArrowUp')).toBe(1);
  });

  it('has nowhere to go Up from the first row or Down from the last row', () => {
    expect(keyboardTarget(OVERVIEW, 'wide', 0, 'ArrowUp')).toBeNull();
    expect(keyboardTarget(OVERVIEW, 'wide', 1, 'ArrowUp')).toBeNull();
    expect(keyboardTarget(OVERVIEW, 'wide', 6, 'ArrowDown')).toBeNull();
    expect(keyboardTarget(OVERVIEW, 'wide', 7, 'ArrowDown')).toBeNull();
  });

  it('goes Home to the first card and End to the last', () => {
    expect(keyboardTarget(OVERVIEW, 'wide', 5, 'Home')).toBe(0);
    expect(keyboardTarget(OVERVIEW, 'wide', 2, 'End')).toBe(7);
    expect(keyboardTarget(OVERVIEW, 'wide', 0, 'Home')).toBeNull();
    expect(keyboardTarget(OVERVIEW, 'wide', 7, 'End')).toBeNull();
  });

  it('follows the packing of the breakpoint', () => {
    // Medium rows: [0] [1,2] [3,4] [5,6] [7]. Card 2 starts at column 7; row 3 starts at columns 1 and 7.
    expect(keyboardTarget(OVERVIEW, 'medium', 2, 'ArrowDown')).toBe(4);
    expect(keyboardTarget(OVERVIEW, 'medium', 2, 'ArrowUp')).toBe(0);
    expect(keyboardTarget(OVERVIEW, 'medium', 1, 'ArrowUp')).toBe(0);
    expect(keyboardTarget(OVERVIEW, 'medium', 6, 'ArrowDown')).toBe(7);
  });

  it('makes Up and Down the same as Left and Right when every card has a row of its own', () => {
    for (const from of [0, 3, 7]) {
      expect(keyboardTarget(OVERVIEW, 'narrow', from, 'ArrowUp')).toBe(
        keyboardTarget(OVERVIEW, 'narrow', from, 'ArrowLeft'),
      );
      expect(keyboardTarget(OVERVIEW, 'narrow', from, 'ArrowDown')).toBe(
        keyboardTarget(OVERVIEW, 'narrow', from, 'ArrowRight'),
      );
    }
    expect(keyboardTarget(OVERVIEW, 'narrow', 3, 'ArrowDown')).toBe(4);
    expect(keyboardTarget(OVERVIEW, 'narrow', 3, 'ArrowUp')).toBe(2);
  });

  it('treats a card without a width as full', () => {
    const cards: CardItem[] = [
      { id: 'a', type: 'x' },
      { id: 'b', type: 'x' },
    ];
    expect(keyboardTarget(cards, 'wide', 0, 'ArrowDown')).toBe(1);
    expect(keyboardTarget(cards, 'wide', 1, 'ArrowUp')).toBe(0);
  });

  it('has nowhere to go with no cards, one card or an index that is not a card', () => {
    const keys: MoveKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    for (const key of keys) {
      expect(keyboardTarget([], 'wide', 0, key)).toBeNull();
      expect(keyboardTarget(cardsOf('half'), 'wide', 0, key)).toBeNull();
      expect(keyboardTarget(OVERVIEW, 'wide', 8, key)).toBeNull();
      expect(keyboardTarget(OVERVIEW, 'wide', -1, key)).toBeNull();
    }
  });
});

describe('dropIndex', () => {
  it('gives the index the item takes once it has left its place', () => {
    expect(dropIndex(2, 5, false)).toBe(4);
    expect(dropIndex(2, 5, true)).toBe(5);
    expect(dropIndex(5, 2, false)).toBe(2);
    expect(dropIndex(5, 2, true)).toBe(3);
  });

  it('gives null when the item would not move', () => {
    expect(dropIndex(3, 3, true)).toBeNull();
    expect(dropIndex(3, 3, false)).toBeNull();
    expect(dropIndex(3, 2, true)).toBeNull();
    expect(dropIndex(3, 4, false)).toBeNull();
  });

  it('moves to the neighbours on either side', () => {
    expect(dropIndex(3, 2, false)).toBe(2);
    expect(dropIndex(3, 4, true)).toBe(4);
    expect(dropIndex(0, 7, true)).toBe(7);
    expect(dropIndex(7, 0, false)).toBe(0);
  });
});

describe('distinctSpans', () => {
  it('keeps one width of each span, the first, in the order given', () => {
    expect(distinctSpans(['third', 'half'], 'medium')).toEqual(['third']);
    expect(distinctSpans(['third', 'half'], 'wide')).toEqual(['third', 'half']);
    expect(distinctSpans(WIDTHS, 'medium')).toEqual(['third', 'two_thirds']);
    expect(distinctSpans(WIDTHS, 'narrow')).toEqual(['third']);
    expect(distinctSpans(['full', 'two_thirds', 'half'], 'wide')).toEqual(['full', 'two_thirds', 'half']);
  });

  it('gives nothing for no widths', () => {
    expect(distinctSpans([], 'wide')).toEqual([]);
  });
});

describe('snapWidth', () => {
  const allowed: Width[] = ['half', 'two_thirds', 'full'];
  const snapped = (columns: number): Width => snapWidth(allowed, 'wide', columns);

  it('snaps to the allowed width whose span is nearest, the narrower on a tie', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(snapped)).toEqual(Array<Width>(7).fill('half'));
    expect([8, 9, 10].map(snapped)).toEqual(Array<Width>(3).fill('two_thirds'));
    expect([11, 12].map(snapped)).toEqual(Array<Width>(2).fill('full'));
  });

  it('only ever returns an allowed width', () => {
    for (let columns = -2; columns <= 16; columns += 0.5) {
      expect(allowed).toContain(snapped(columns));
    }
  });

  it('snaps beyond the grid to the nearest end', () => {
    expect(snapped(0)).toBe('half');
    expect(snapped(40)).toBe('full');
  });

  it('does not depend on the order the widths are given in', () => {
    expect(snapWidth(['full', 'half', 'two_thirds'], 'wide', 7)).toBe('half');
    expect(snapWidth(['full', 'half', 'two_thirds'], 'wide', 10)).toBe('two_thirds');
  });

  it('keeps the first of widths that share a span at the breakpoint', () => {
    expect(snapWidth(['third', 'half'], 'medium', 6)).toBe('third');
    expect(snapWidth(['half', 'full'], 'narrow', 3)).toBe('half');
  });

  it('gives the only allowed width whatever the columns', () => {
    expect(snapWidth(['half'], 'wide', 12)).toBe('half');
  });

  it('refuses an empty list of widths', () => {
    expect(() => snapWidth([], 'wide', 6)).toThrow(RangeError);
  });
});
