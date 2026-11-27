import { describe, expect, it } from 'vitest';

import { clampWidth, limitsOf, parseWidths, widthForKey, widthOfColumn, widthsDiffer } from './board-widths';

const LIMITS = limitsOf(100);

describe('limitsOf', () => {
  it('takes 60 percent for the least (at least 56) and double for the widest (360 to 560)', () => {
    expect(limitsOf(100)).toEqual({ least: 60, default: 100, widest: 360 });
    expect(limitsOf(80).least).toBe(56);
    expect(limitsOf(40)).toEqual({ least: 40, default: 40, widest: 360 });
    expect(limitsOf(300).widest).toBe(560);
  });

  it('keeps the limits a column names', () => {
    expect(limitsOf(100, 90, 120)).toEqual({ least: 90, default: 100, widest: 120 });
  });
});

describe('widthForKey', () => {
  it('moves by 16 px, 48 with Shift, inside the limits', () => {
    expect(widthForKey('ArrowRight', false, 100, LIMITS)).toBe(116);
    expect(widthForKey('ArrowLeft', false, 100, LIMITS)).toBe(84);
    expect(widthForKey('ArrowRight', true, 100, LIMITS)).toBe(148);
    expect(widthForKey('ArrowLeft', true, 70, LIMITS)).toBe(60);
    expect(widthForKey('ArrowRight', true, 350, LIMITS)).toBe(360);
  });

  it('goes to the least, the widest and the default', () => {
    expect(widthForKey('Home', false, 100, LIMITS)).toBe(60);
    expect(widthForKey('End', false, 100, LIMITS)).toBe(360);
    expect(widthForKey('Enter', false, 200, LIMITS)).toBe(100);
  });

  it('ignores every other key', () => {
    expect(widthForKey('a', false, 100, LIMITS)).toBeNull();
    expect(widthForKey('Tab', false, 100, LIMITS)).toBeNull();
  });
});

describe('clampWidth', () => {
  it('rounds and keeps a width inside the limits', () => {
    expect(clampWidth(10, LIMITS)).toBe(60);
    expect(clampWidth(999, LIMITS)).toBe(360);
    expect(clampWidth(100.4, LIMITS)).toBe(100);
  });
});

describe('parseWidths', () => {
  it('reads saved widths and drops what is not a number', () => {
    expect(parseWidths('{"a":120,"b":"x","c":null}')).toEqual({ a: 120 });
  });

  it('gives no widths for nothing, damaged text or a list', () => {
    expect(parseWidths(null)).toEqual({});
    expect(parseWidths('{oops')).toEqual({});
    expect(parseWidths('[1,2]')).toEqual({});
  });
});

describe('widthOfColumn and widthsDiffer', () => {
  const fixed = { id: 'a', width: 100 };
  const flexible = { id: 'b', width: null };
  const columns = [fixed, flexible];

  it('uses the default, the saved width within the limits, and no width for the flexible column', () => {
    expect(widthOfColumn(fixed, {})).toBe(100);
    expect(widthOfColumn(fixed, { a: 140 })).toBe(140);
    expect(widthOfColumn(fixed, { a: 5000 })).toBe(360);
    expect(widthOfColumn(flexible, { b: 140 })).toBeNull();
  });

  it('differs only while a column is not at its default', () => {
    expect(widthsDiffer(columns, {})).toBe(false);
    expect(widthsDiffer(columns, { a: 100 })).toBe(false);
    expect(widthsDiffer(columns, { a: 120 })).toBe(true);
    expect(widthsDiffer(columns, { b: 120 })).toBe(false);
  });
});
