import { describe, expect, it } from 'vitest';

import { wholePercents } from './largest-remainder';

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe('wholePercents', () => {
  it('writes shares that add up to 1 as whole percents that add up to 100', () => {
    // Rounded one by one these are 54, 40, 6 and 1, which is 101
    const shares = [0.536, 0.395, 0.0555, 0.0135];
    expect(shares.map((share) => Math.round(share * 100))).toEqual([54, 40, 6, 1]);
    expect(sum(wholePercents(shares))).toBe(100);
    expect(wholePercents(shares)).toEqual([54, 39, 6, 1]);
  });

  it('gives the left over points to the largest remainders, the first of equal ones first', () => {
    expect(wholePercents([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
  });

  it('keeps shares that are already whole', () => {
    expect(wholePercents([0.5, 0.25, 0.25, 0])).toEqual([50, 25, 25, 0]);
  });

  it('rounds one by one when the shares do not add up to 1', () => {
    expect(wholePercents([0.333, 0.333])).toEqual([33, 33]);
    expect(wholePercents([])).toEqual([]);
  });
});
