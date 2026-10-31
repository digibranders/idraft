import { describe, expect, it } from 'vitest';

import {
  formatColumns,
  formatSort,
  nextSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type SortKey,
} from './table-state';

const KNOWN = new Set(['keyword', 'search_volume', 'keyword_difficulty', 'priority']);
const DEFAULT: SortKey[] = [{ id: 'search_volume', desc: true }];
const VOLUME = { id: 'search_volume', defaultDesc: true };
const KEYWORD = { id: 'keyword', defaultDesc: false };

describe('parseSort and formatSort', () => {
  it('reads keys with their direction and writes them back the same', () => {
    const sort = parseSort('-search_volume,keyword', KNOWN);
    expect(sort).toEqual([
      { id: 'search_volume', desc: true },
      { id: 'keyword', desc: false },
    ]);
    expect(formatSort(sort)).toBe('-search_volume,keyword');
  });

  it('drops unknown and repeated columns, and keeps at most two keys', () => {
    expect(parseSort('-rank,keyword,keyword,-priority,search_volume', KNOWN)).toEqual([
      { id: 'keyword', desc: false },
      { id: 'priority', desc: true },
    ]);
    expect(parseSort('', KNOWN)).toEqual([]);
    expect(parseSort(null, KNOWN)).toEqual([]);
  });

  it('compares two sorts', () => {
    expect(sameSort(DEFAULT, [{ id: 'search_volume', desc: true }])).toBe(true);
    expect(sameSort(DEFAULT, [{ id: 'search_volume', desc: false }])).toBe(false);
    expect(sameSort(DEFAULT, [])).toBe(false);
  });
});

describe('nextSort', () => {
  const click = (current: SortKey[], column = KEYWORD, additive = false): SortKey[] =>
    nextSort(current, column, { additive, tableDefault: DEFAULT });

  it('sorts in the column default direction, reverses, then returns to the table default', () => {
    const first = click(DEFAULT);
    expect(first).toEqual([{ id: 'keyword', desc: false }]);
    const second = click(first);
    expect(second).toEqual([{ id: 'keyword', desc: true }]);
    expect(click(second)).toEqual(DEFAULT);
  });

  it('adds a second key with Shift, keeps it in place when clicked again, and drops it on the third click', () => {
    const two = click(DEFAULT, KEYWORD, true);
    expect(two).toEqual([
      { id: 'search_volume', desc: true },
      { id: 'keyword', desc: false },
    ]);
    const reversed = click(two, KEYWORD, true);
    expect(reversed).toEqual([
      { id: 'search_volume', desc: true },
      { id: 'keyword', desc: true },
    ]);
    expect(click(reversed, KEYWORD, true)).toEqual(DEFAULT);
  });

  it('keeps at most two keys, the newest last', () => {
    const two = click(DEFAULT, KEYWORD, true);
    expect(click(two, { id: 'priority', defaultDesc: false }, true)).toEqual([
      { id: 'keyword', desc: false },
      { id: 'priority', desc: false },
    ]);
  });

  it('returns to the table default when the only key of a Shift sort is cleared', () => {
    const only: SortKey[] = [{ id: 'search_volume', desc: false }];
    expect(click(only, VOLUME, true)).toEqual(DEFAULT);
  });
});

describe('parseColumns and parseDensity', () => {
  it('keeps the required column first and drops unknown and repeated ids', () => {
    expect(parseColumns('priority,rank,keyword,priority,search_volume', KNOWN, ['keyword'])).toEqual([
      'keyword',
      'priority',
      'search_volume',
    ]);
    expect(formatColumns(['keyword', 'priority'])).toBe('keyword,priority');
    expect(parseColumns(null, KNOWN, ['keyword'])).toBeNull();
  });

  it('keeps a chosen density and opens in compact otherwise', () => {
    expect(parseDensity('compact')).toBe('compact');
    expect(parseDensity('default')).toBe('default');
    expect(parseDensity('dense')).toBe('compact');
    expect(parseDensity(null)).toBe('compact');
  });
});
