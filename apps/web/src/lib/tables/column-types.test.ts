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
const FIXED = 40 + 96 + 88 + 120;

describe('rank, change and URL column types (12-tables.md section 5)', () => {
  it('gives a rank 64 px, left aligned, best (lowest) first', () => {
    expect(COLUMN_TYPES.rank).toEqual({
      width: 80,
      min: 80,
      max: 112,
      align: 'left',
      defaultDesc: false,
      flex: false,
    });
  });

  it('gives a rank change 96 px, which the header "CHANGE" with its sort arrow needs, left aligned, the biggest improvement first', () => {
    expect(COLUMN_TYPES.rankDelta).toEqual({
      width: 96,
      min: 96,
      max: 96,
      align: 'left',
      defaultDesc: true,
      flex: false,
    });
  });

  it('keeps the Change column at 96 px or more however tight the table is, so its header is never cut', () => {
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
      expect(resolveWidths(rankColumns, available).get('change')).toBeGreaterThanOrEqual(96);
    }
  });

  it('gives a URL 260 px, left aligned, A to Z, without taking the identity column place', () => {
    expect(COLUMN_TYPES.url).toEqual({
      width: 260,
      min: 160,
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
    expect(widths.get('volume')).toBe(96);
  });

  it('then shrinks the others toward their minimums in proportion, and no further', () => {
    const narrow = resolveWidths(COLUMNS, FIXED + 200 - 8);
    expect(narrow.get('keyword')).toBe(200);
    // 8 px over, from 32 px of room (16 px in KD and in the date column; volume is at its minimum): each gives a quarter
    expect(narrow.get('volume')).toBe(96);
    expect(narrow.get('kd')).toBe(84);
    expect(narrow.get('added')).toBe(116);
    expect(narrow.get('select')).toBe(40);
    const tiny = resolveWidths(COLUMNS, 300);
    expect(tiny.get('volume')).toBe(96);
    expect(tiny.get('kd')).toBe(72);
    expect(tiny.get('added')).toBe(104);
    // What still does not fit scrolls sideways
    expect([...tiny.values()].reduce((sum, width) => sum + width, 0)).toBeGreaterThan(300);
  });
});

describe('alignment (owner decision of 2026-10-29)', () => {
  it('left aligns every column type, numeric ones included, except the checkbox column and the row actions', () => {
    const aligned = Object.entries(COLUMN_TYPES).map(([type, spec]) => [type, spec.align]);
    expect(aligned.filter(([, align]) => align !== 'left')).toEqual([
      ['select', 'center'],
      ['actions', 'right'],
    ]);
  });
});

/**
 * Widths a sorted header needs with the capitals style (type-table-header, 0.04em tracking), its 14 px sort arrow,
 * 4 px gap and 12 px padding on each side, measured in Chrome on 2026-10-29 by e2e/flows/table-style.spec.ts.
 */
const MEASURED_HEADER_NEED: readonly [type: keyof typeof COLUMN_TYPES, label: string, need: number][] = [
  ['keyword', 'Keyword', 105],
  ['text', 'Group', 87],
  ['count', 'KD', 60],
  ['volume', 'Volume', 95],
  ['currency', 'CPC (USD)', 106],
  ['date', 'Finished', 101],
  ['badge', 'Intent', 86],
  ['status', 'Status', 89],
  ['rank', 'Rank', 78],
  ['rankDelta', 'Change', 95],
  ['url', 'Ranking URL', 127],
];

describe('minimum widths hold the capital header labels (owner decision of 2026-10-29)', () => {
  it('lets a column with a longer header name its own minimum, which the width resolver then respects', () => {
    const priority: SizedColumn = { id: 'priority', ...COLUMN_TYPES.count, width: 100, min: 100 };
    const widths = resolveWidths([sized('keyword', 'keyword'), priority], 300);
    expect(widths.get('priority')).toBe(100);
  });

  it.each(MEASURED_HEADER_NEED)('%s keeps %s whole at its minimum', (type, _label, need) => {
    expect(COLUMN_TYPES[type].min).toBeGreaterThanOrEqual(need);
    expect(COLUMN_TYPES[type].width).toBeGreaterThanOrEqual(COLUMN_TYPES[type].min);
    expect(COLUMN_TYPES[type].max).toBeGreaterThanOrEqual(COLUMN_TYPES[type].width);
  });
});
