import { describe, expect, it } from 'vitest';

import { chosenColumns, columnsAtTier, moveColumn, toggleColumn, type ColumnVisibilityMeta } from './visible-columns';

const COLUMNS: ColumnVisibilityMeta[] = [
  { id: 'keyword', priority: 1, identity: true, defaultVisible: true },
  { id: 'volume', priority: 2, identity: false, defaultVisible: true },
  { id: 'kd', priority: 3, identity: false, defaultVisible: true },
  { id: 'cpc', priority: 4, identity: false, defaultVisible: false },
  { id: 'added', priority: 1, identity: false, defaultVisible: true },
];

describe('chosenColumns', () => {
  it('uses the defaults until the person chooses, with the identity column first', () => {
    expect(chosenColumns(COLUMNS, null)).toEqual(['keyword', 'volume', 'kd', 'added']);
    expect(chosenColumns(COLUMNS, ['cpc', 'gone', 'volume', 'keyword'])).toEqual(['keyword', 'cpc', 'volume']);
  });
});

describe('columnsAtTier', () => {
  it('drops what the viewport is too narrow for, never the identity column', () => {
    expect(columnsAtTier(COLUMNS, null, 1)).toEqual(['keyword', 'added']);
    expect(columnsAtTier(COLUMNS, null, 2)).toEqual(['keyword', 'volume', 'added']);
    expect(columnsAtTier(COLUMNS, null, 4)).toEqual(['keyword', 'volume', 'kd', 'added']);
    expect(columnsAtTier(COLUMNS, ['cpc'], 4)).toEqual(['keyword', 'cpc']);
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
