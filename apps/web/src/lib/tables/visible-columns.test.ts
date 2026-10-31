import { describe, expect, it } from 'vitest';

import { chosenColumns, columnsFitting, moveColumn, toggleColumn, type ColumnVisibilityMeta } from './visible-columns';

const COLUMNS: ColumnVisibilityMeta[] = [
  { id: 'keyword', priority: 1, identity: true, defaultVisible: true, width: 280 },
  { id: 'volume', priority: 2, identity: false, defaultVisible: true, width: 100 },
  { id: 'kd', priority: 3, identity: false, defaultVisible: true, width: 100 },
  { id: 'cpc', priority: 4, identity: false, defaultVisible: false, width: 100 },
  { id: 'added', priority: 1, identity: false, defaultVisible: true, width: 100 },
];

describe('chosenColumns', () => {
  it('uses the defaults until the person chooses, with the identity column first', () => {
    expect(chosenColumns(COLUMNS, null)).toEqual(['keyword', 'volume', 'kd', 'added']);
    expect(chosenColumns(COLUMNS, ['cpc', 'gone', 'volume', 'keyword'])).toEqual(['keyword', 'cpc', 'volume']);
  });
});

describe('columnsFitting', () => {
  it('keeps the identity column and the priority 1 columns however narrow the room', () => {
    expect(columnsFitting(COLUMNS, null, 0, 1)).toEqual(['keyword', 'added']);
  });

  it('adds the other default columns by priority while they fit, in their own order', () => {
    expect(columnsFitting(COLUMNS, null, 200, 1)).toEqual(['keyword', 'volume', 'added']);
    expect(columnsFitting(COLUMNS, null, 300, 1)).toEqual(['keyword', 'volume', 'kd', 'added']);
    expect(columnsFitting(COLUMNS, null, 1000, 1)).toEqual(['keyword', 'volume', 'kd', 'added']);
  });

  it('counts the width the columns already kept take', () => {
    expect(columnsFitting(COLUMNS, null, 199, 1)).toEqual(['keyword', 'added']);
  });

  it('keeps what the viewport tier allows even when it does not fit, as before', () => {
    expect(columnsFitting(COLUMNS, null, 0, 2)).toEqual(['keyword', 'volume', 'added']);
    expect(columnsFitting(COLUMNS, null, 0, 4)).toEqual(['keyword', 'volume', 'kd', 'added']);
  });

  it('shows every column the person chose, whatever the room', () => {
    expect(columnsFitting(COLUMNS, ['cpc', 'kd', 'volume'], 0, 1)).toEqual(['keyword', 'cpc', 'kd', 'volume']);
  });
});

describe('moveColumn and toggleColumn', () => {
  it('moves a column one place, never before the identity column or past the end', () => {
    expect(moveColumn(COLUMNS, null, 'kd', -1)).toEqual(['keyword', 'kd', 'volume', 'added']);
    expect(moveColumn(COLUMNS, null, 'volume', -1)).toEqual(['keyword', 'volume', 'kd', 'added']);
    expect(moveColumn(COLUMNS, null, 'added', 1)).toEqual(['keyword', 'volume', 'kd', 'added']);
    expect(moveColumn(COLUMNS, null, 'keyword', 1)).toEqual(['keyword', 'volume', 'kd', 'added']);
  });

  it('shows a column last, hides one, and never hides the identity column', () => {
    expect(toggleColumn(COLUMNS, null, 'cpc', true)).toEqual(['keyword', 'volume', 'kd', 'added', 'cpc']);
    expect(toggleColumn(COLUMNS, null, 'kd', false)).toEqual(['keyword', 'volume', 'added']);
    expect(toggleColumn(COLUMNS, null, 'keyword', false)).toEqual(['keyword', 'volume', 'kd', 'added']);
  });
});
