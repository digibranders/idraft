import { describe, expect, it } from 'vitest';

import { graphemeBoundaryBefore } from './graphemes';

/** Text built from code points, so this file stays ASCII. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
/** "e" and a combining acute accent: one character on screen, two code points. */
const E_ACUTE = cp(0x65, 0x301);
/** A family of three joined with zero width joiners: one character on screen, eight UTF-16 units. */
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
/** The flag of India: two regional indicators, one character on screen. */
const FLAG = cp(0x1f1ee, 0x1f1f3);

describe('graphemeBoundaryBefore', () => {
  it('is the index itself where it falls between two characters', () => {
    expect(graphemeBoundaryBefore('abcd', 2)).toBe(2);
    expect(graphemeBoundaryBefore('abcd', 0)).toBe(0);
    expect(graphemeBoundaryBefore('abcd', 4)).toBe(4);
  });

  it('moves back from the middle of a base letter and its combining mark', () => {
    const text = `ab${E_ACUTE}cd`;
    expect(graphemeBoundaryBefore(text, 3)).toBe(2);
    expect(graphemeBoundaryBefore(text, 4)).toBe(4);
  });

  it('moves back from inside a joined emoji, which no index within it can cut', () => {
    const text = `a${FAMILY}b`;
    for (let at = 2; at < 1 + FAMILY.length; at += 1) expect(graphemeBoundaryBefore(text, at)).toBe(1);
    expect(graphemeBoundaryBefore(text, 1 + FAMILY.length)).toBe(1 + FAMILY.length);
  });

  it('moves back from between the two halves of a flag', () => {
    const text = `a${FLAG}b`;
    expect(graphemeBoundaryBefore(text, 3)).toBe(1);
    expect(graphemeBoundaryBefore(text, 5)).toBe(5);
  });

  it('keeps an index past the end at the end, and an index below 0 at 0', () => {
    expect(graphemeBoundaryBefore('abc', 10)).toBe(3);
    expect(graphemeBoundaryBefore('abc', -2)).toBe(0);
    expect(graphemeBoundaryBefore('', 0)).toBe(0);
  });
});
