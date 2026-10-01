import { describe, expect, it } from 'vitest';

import {
  formatEnumList,
  formatRange,
  formatText,
  isActiveFilter,
  parseEnumList,
  parseRange,
  parseText,
  sameFilterValue,
} from './filter-values';

const INTENTS = new Set(['commercial', 'transactional', 'informational']);

describe('enum lists', () => {
  it('keeps known ids once, in the order given', () => {
    expect(parseEnumList('transactional,spam,commercial,transactional', INTENTS)).toEqual([
      'transactional',
      'commercial',
    ]);
    expect(formatEnumList(['commercial', 'informational'])).toBe('commercial,informational');
  });

  it('is no filter when nothing known is left', () => {
    expect(parseEnumList('spam', INTENTS)).toBeNull();
    expect(parseEnumList(null, INTENTS)).toBeNull();
  });
});

describe('ranges', () => {
  it('reads both ends, or one end open, and writes them back', () => {
    expect(parseRange('1000..10000')).toEqual({ min: 1000, max: 10_000 });
    expect(parseRange('1000..')).toEqual({ min: 1000, max: null });
    expect(parseRange('..50')).toEqual({ min: null, max: 50 });
    expect(formatRange({ min: 1000, max: null })).toBe('1000..');
  });

  it('drops anything that is not a range of whole numbers in order', () => {
    expect(parseRange('..')).toBeNull();
    expect(parseRange('50..10')).toBeNull();
    expect(parseRange('1.5..3')).toBeNull();
    expect(parseRange('abc')).toBeNull();
    expect(parseRange('99999999999999999999..')).toBeNull();
  });
});

describe('text', () => {
  it('reads an operator and its text, keeping colons in the text', () => {
    expect(parseText('contains:crm')).toEqual({ operator: 'contains', text: 'crm' });
    expect(parseText('equals:a:b')).toEqual({ operator: 'equals', text: 'a:b' });
    expect(formatText({ operator: 'starts_with', text: 'best' })).toBe('starts_with:best');
  });

  it('drops an unknown operator or empty text', () => {
    expect(parseText('matches:crm')).toBeNull();
    expect(parseText('contains:  ')).toBeNull();
    expect(parseText('crm')).toBeNull();
  });
});

describe('sameFilterValue and isActiveFilter', () => {
  it('compares lists as sets and ranges and text by value', () => {
    expect(sameFilterValue({ kind: 'enum', values: ['a', 'b'] }, { kind: 'enum', values: ['b', 'a'] })).toBe(true);
    expect(sameFilterValue({ kind: 'range', min: 1, max: null }, { kind: 'range', min: 1, max: 2 })).toBe(false);
    expect(sameFilterValue(null, null)).toBe(true);
    expect(sameFilterValue({ kind: 'enum', values: [] }, null)).toBe(false);
  });

  it('treats an empty list, an open range and blank text as no filter', () => {
    expect(isActiveFilter({ kind: 'enum', values: [] })).toBe(false);
    expect(isActiveFilter({ kind: 'range', min: null, max: null })).toBe(false);
    expect(isActiveFilter({ kind: 'text', operator: 'contains', text: ' ' })).toBe(false);
    expect(isActiveFilter({ kind: 'range', min: 0, max: null })).toBe(true);
  });
});
