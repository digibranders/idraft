import { describe, expect, it } from 'vitest';

import { percentOf } from './percent';

const TINY = '<0.1%';

describe('percentOf', () => {
  it.each([
    [0, '0%'],
    [0.0004, TINY],
    [0.0005, '0.1%'],
    [0.003, '0.3%'],
    [0.009, '0.9%'],
    [0.01, '1%'],
    [0.5, '50%'],
    [1, '100%'],
  ])('prints %s as %s', (value, text) => {
    expect(percentOf(value, TINY)).toBe(text);
  });

  it('never prints a seen share as 0.0%', () => {
    expect(percentOf(1 / 2001, TINY)).not.toContain('0.0');
  });
});
