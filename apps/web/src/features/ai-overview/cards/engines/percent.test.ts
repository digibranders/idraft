import { describe, expect, it } from 'vitest';

import { percentNumber } from './percent';

describe('percentNumber', () => {
  it('turns a rate into a percent number to two places', () => {
    expect(percentNumber(0.3125)).toBe(31.25);
    expect(percentNumber(1)).toBe(100);
    expect(percentNumber(0)).toBe(0);
  });

  it('keeps the float noise of the multiplication out of the file', () => {
    expect(0.29 * 100).not.toBe(29);
    expect(percentNumber(0.29)).toBe(29);
    expect(percentNumber(0.1 + 0.2)).toBe(30);
  });

  it('keeps the sign of a change in points', () => {
    expect(percentNumber(-0.0875)).toBe(-8.75);
  });
});
