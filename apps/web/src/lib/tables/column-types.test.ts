import { describe, expect, it } from 'vitest';

import { COLUMN_TYPES, resolveWidths, type SizedColumn } from './column-types';

const sized = (id: string, type: keyof typeof COLUMN_TYPES): SizedColumn => ({ id, ...COLUMN_TYPES[type] });

const COLUMNS: SizedColumn[] = [
  sized('select', 'select'),
  sized('keyword', 'keyword'),
  sized('volume', 'volume'),
  sized('kd', 'count'),
  sized('added', 'date'),
];
const FIXED = 40 + 88 + 88 + 120;

describe('rank, change and URL column types (12-tables.md section 5)', () => {
  it('gives a rank 64 px, right aligned, best (lowest) first', () => {
    expect(COLUMN_TYPES.rank).toEqual({
      width: 64,
      min: 56,
      max: 80,
      align: 'right',
      defaultDesc: false,
      flex: false,
    });
  });

  it('gives a rank change 84 to 88 px, which the header "Change" with its sort arrow needs, right aligned, the biggest improvement first', () => {
    expect(COLUMN_TYPES.rankDelta).toEqual({
      width: 88,
      min: 84,
      max: 88,
      align: 'right',
      defaultDesc: true,
      flex: false,
    });
  });

  it('keeps the Change column at 84 px or more however tight the table is, so its header is never cut', () => {
    const rankColumns = [
      sized('keyword', 'keyword'),
      sized('rank', 'rank'),
      sized('change', 'rankDelta'),
      sized('url', 'url'),
      sized('volume', 'volume'),
      sized('kd', 'count'),
      sized('cpc', 'currency'),
      sized('updated', 'date'),
    ];
    for (const available of [600, 900, 1100, 1300]) {
      expect(resolveWidths(rankColumns, available).get('change')).toBeGreaterThanOrEqual(84);
    }
  });

  it('gives a URL 260 px, left aligned, A to Z, without taking the identity column place', () => {
    expect(COLUMN_TYPES.url).toEqual({
      width: 260,
      min: 180,
      max: 480,
      align: 'left',
      defaultDesc: false,
      flex: false,
    });
  });
});

describe('resolveWidths', () => {
  it('gives the flex column what the others leave, so the table fills its panel', () => {
    expect(resolveWidths(COLUMNS, FIXED + 300).get('keyword')).toBe(300);
    expect(resolveWidths(COLUMNS, 2000).get('keyword')).toBe(2000 - FIXED);
  });

  it('shrinks the flex column to its minimum before the others', () => {
    const widths = resolveWidths(COLUMNS, FIXED + 200);
    expect(widths.get('keyword')).toBe(200);
    expect(widths.get('volume')).toBe(88);
  });

  it('then shrinks the others toward their minimums in proportion, and no further', () => {
    const narrow = resolveWidths(COLUMNS, FIXED + 200 - 20);
    expect(narrow.get('keyword')).toBe(200);
    // 20 px over, from 48 px of room (16 px in each of three columns): each gives 5/12 of its own room
    expect(narrow.get('volume')).toBe(81);
    expect(narrow.get('added')).toBe(113);
    expect(narrow.get('select')).toBe(40);
    const tiny = resolveWidths(COLUMNS, 300);
    expect(tiny.get('volume')).toBe(72);
    expect(tiny.get('added')).toBe(104);
    // What still does not fit scrolls sideways
    expect([...tiny.values()].reduce((sum, width) => sum + width, 0)).toBeGreaterThan(300);
  });
});
