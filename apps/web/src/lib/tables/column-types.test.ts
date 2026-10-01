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

describe('resolveWidths', () => {
  it('gives the flex column what the others leave, up to its maximum', () => {
    expect(resolveWidths(COLUMNS, FIXED + 300).get('keyword')).toBe(300);
    expect(resolveWidths(COLUMNS, 2000).get('keyword')).toBe(480);
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
