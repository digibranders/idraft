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

/** `resolveWidths` as it was before the `capIdentity` option (origin/develop 7ea0818), the reference for every other table. */
function legacyResolveWidths(columns: readonly SizedColumn[], available: number): Map<string, number> {
  const widths = new Map(columns.map((column) => [column.id, column.width]));
  const flex = columns.find((column) => column.flex);
  const fixedTotal = columns.reduce((sum, column) => sum + (column.flex ? 0 : column.width), 0);
  if (flex !== undefined) {
    widths.set(flex.id, Math.max(flex.min, available - fixedTotal));
  }
  const total = (): number => [...widths.values()].reduce((sum, width) => sum + width, 0);
  const excess = total() - available;
  if (excess <= 0) return widths;
  const shrinkable = columns.filter((column) => !column.flex && column.width > column.min);
  const room = shrinkable.reduce((sum, column) => sum + (column.width - column.min), 0);
  if (room === 0) return widths;
  const ratio = Math.min(1, excess / room);
  for (const column of shrinkable) {
    widths.set(column.id, Math.round(column.width - (column.width - column.min) * ratio));
  }
  return widths;
}

const own = (id: string, type: keyof typeof COLUMN_TYPES, width: number, min?: number): SizedColumn => ({
  id,
  ...COLUMN_TYPES[type],
  width,
  min: min ?? COLUMN_TYPES[type].min,
});

/** The column sets of real tables, as the DataTable sizes them: Runs, Rankings by default, a chooser with few columns. */
const LEGACY_SETS: readonly (readonly SizedColumn[])[] = [
  // Runs (features/operations/run-columns.ts)
  [
    sized('workload', 'keyword'),
    own('status', 'status', 168),
    own('tasks', 'text', 200),
    own('trigger', 'badge', 128),
    own('cost', 'currency', 144),
    own('created', 'date', 240),
  ],
  // Runs with three columns chosen
  [sized('workload', 'keyword'), own('status', 'status', 168), own('created', 'date', 120)],
  // Rankings, default columns (features/rankings/keyword-columns.tsx)
  [
    sized('select', 'select'),
    sized('keyword', 'keyword'),
    own('rank', 'rank', 112, 112),
    own('volume', 'volume', 96),
    own('kd', 'count', 72),
    own('intent', 'text', 96),
    own('features', 'features', 120),
    own('aio', 'aiOverview', 112, 112),
    own('cpc', 'currency', 112),
    own('trend', 'sparkline', 96),
    own('group', 'text', 104),
    own('tags', 'text', 104),
    own('updated', 'date', 160),
    own('added', 'date', 112),
    sized('actions', 'actions'),
  ],
  COLUMNS,
];

describe('rank, change and URL column types (12-tables.md section 5)', () => {
  it('gives a rank 64 px, left aligned, best (lowest) first', () => {
    expect(COLUMN_TYPES.rank).toEqual({
      width: 80,
      min: 80,
      max: 136,
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

  it('keeps a resized identity column (no flex column) at its width, the others shrinking before it', () => {
    const resized: SizedColumn = { id: 'keyword', ...COLUMN_TYPES.keyword, width: 360, min: 360, flex: false };
    const others = COLUMNS.filter((column) => column.id !== 'keyword');
    expect(resolveWidths([resized, ...others], 2000).get('keyword')).toBe(360);
    const tight = resolveWidths([resized, ...others], 360 + FIXED - 16);
    expect(tight.get('keyword')).toBe(360);
    expect(tight.get('added')).toBeLessThan(120);
  });

  it('leaves a column whose own width is above its type maximum at that width', () => {
    const wide: SizedColumn = { id: 'wide', ...COLUMN_TYPES.date, width: 200 };
    expect(resolveWidths([...COLUMNS, wide], 2400).get('wide')).toBe(200);
    expect(resolveWidths([...COLUMNS, wide], 2400, { capIdentity: true }).get('wide')).toBe(200);
  });

  it('gives every set the same widths as before the capIdentity option, when it is not asked for', () => {
    for (const set of LEGACY_SETS) {
      for (let available = 300; available <= 2400; available += 37) {
        expect(resolveWidths(set, available)).toEqual(legacyResolveWidths(set, available));
      }
    }
  });
});

describe('resolveWidths with capIdentity (the By group table)', () => {
  it('fills the panel as usual up to the flex maximum', () => {
    expect(resolveWidths(COLUMNS, FIXED + 300, { capIdentity: true })).toEqual(resolveWidths(COLUMNS, FIXED + 300));
    expect(resolveWidths(COLUMNS, FIXED + 480, { capIdentity: true }).get('keyword')).toBe(480);
  });

  it('past the flex maximum, widens the others toward their maximums in proportion', () => {
    // 48 px past 480, from 96 px of room (24 in volume, 32 in KD, 40 in the date column): each takes half
    const widths = resolveWidths(COLUMNS, FIXED + 480 + 48, { capIdentity: true });
    expect(widths.get('keyword')).toBe(480);
    expect(widths.get('volume')).toBe(108);
    expect(widths.get('kd')).toBe(104);
    expect(widths.get('added')).toBe(140);
    expect(widths.get('select')).toBe(40);
  });

  it('takes no column past its maximum; the flex column takes what is left, so there is no gap', () => {
    const widths = resolveWidths(COLUMNS, 2000, { capIdentity: true });
    expect(widths.get('volume')).toBe(120);
    expect(widths.get('kd')).toBe(120);
    expect(widths.get('added')).toBe(160);
    expect(widths.get('select')).toBe(40);
    expect([...widths.values()].reduce((sum, width) => sum + width, 0)).toBe(2000);
  });

  it('shrinks as the default does when the set does not fit', () => {
    expect(resolveWidths(COLUMNS, 300, { capIdentity: true })).toEqual(resolveWidths(COLUMNS, 300));
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
