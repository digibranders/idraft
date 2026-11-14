import { describe, expect, it } from 'vitest';

import { ancestorIndexes, parentIndex, treeKey, type TreeRowFacts } from './tree-rows';

const group = (level: 1 | 2, expanded: boolean): TreeRowFacts => ({ level, expanded });
const leaf = (level: 1 | 2 | 3): TreeRowFacts => ({ level, expanded: null });

// 0 topic (open), 1 subtopic (open), 2 prompt, 3 prompt, 4 subtopic (closed), 5 plain level 2 row, 6 topic (closed), 7 plain level 1 row
const ROWS: TreeRowFacts[] = [
  group(1, true),
  group(2, true),
  leaf(3),
  leaf(3),
  group(2, false),
  leaf(2),
  group(1, false),
  leaf(1),
];

describe('parentIndex', () => {
  it('finds the nearest lower level row as parent', () => {
    expect(parentIndex(ROWS, 2)).toBe(1);
    expect(parentIndex(ROWS, 3)).toBe(1);
    expect(parentIndex(ROWS, 1)).toBe(0);
    expect(parentIndex(ROWS, 4)).toBe(0);
    expect(parentIndex(ROWS, 5)).toBe(0);
  });

  it('has no parent for a level 1 row, a missing row, or a row with no lower level row before it', () => {
    expect(parentIndex(ROWS, 0)).toBeNull();
    expect(parentIndex(ROWS, 6)).toBeNull();
    expect(parentIndex(ROWS, 99)).toBeNull();
    expect(parentIndex([leaf(2), leaf(3)], 1)).toBe(0);
    expect(parentIndex([leaf(3), leaf(3)], 1)).toBeNull();
  });
});

describe('treeKey', () => {
  it('opens a closed group with Right, moves into an open one, and does nothing on a leaf', () => {
    expect(treeKey(ROWS, 4, 'ArrowRight')).toEqual({ kind: 'toggle' });
    expect(treeKey(ROWS, 6, 'ArrowRight')).toEqual({ kind: 'toggle' });
    expect(treeKey(ROWS, 0, 'ArrowRight')).toEqual({ kind: 'move', row: 1 });
    expect(treeKey(ROWS, 1, 'ArrowRight')).toEqual({ kind: 'move', row: 2 });
    expect(treeKey(ROWS, 2, 'ArrowRight')).toBeNull();
    expect(treeKey(ROWS, 7, 'ArrowRight')).toBeNull();
  });

  it('does not move into an open group whose next row is not one level below it', () => {
    expect(treeKey([group(1, true), group(1, false)], 0, 'ArrowRight')).toBeNull();
    expect(treeKey([group(1, true)], 0, 'ArrowRight')).toBeNull();
    expect(treeKey([group(1, true), leaf(3)], 0, 'ArrowRight')).toBeNull();
    expect(treeKey([group(2, true), leaf(2)], 0, 'ArrowRight')).toBeNull();
  });

  it('closes an open group with Left, goes to the parent from a leaf or a closed level 2 group, and returns null on a closed level 1 group', () => {
    expect(treeKey(ROWS, 0, 'ArrowLeft')).toEqual({ kind: 'toggle' });
    expect(treeKey(ROWS, 1, 'ArrowLeft')).toEqual({ kind: 'toggle' });
    expect(treeKey(ROWS, 2, 'ArrowLeft')).toEqual({ kind: 'move', row: 1 });
    expect(treeKey(ROWS, 4, 'ArrowLeft')).toEqual({ kind: 'move', row: 0 });
    expect(treeKey(ROWS, 5, 'ArrowLeft')).toEqual({ kind: 'move', row: 0 });
    expect(treeKey(ROWS, 6, 'ArrowLeft')).toBeNull();
    expect(treeKey(ROWS, 7, 'ArrowLeft')).toBeNull();
  });

  it('does nothing for a row that is not there', () => {
    expect(treeKey(ROWS, 99, 'ArrowRight')).toBeNull();
    expect(treeKey(ROWS, -1, 'ArrowLeft')).toBeNull();
  });
});

describe('ancestorIndexes', () => {
  it('lists ancestors nearest first', () => {
    expect(ancestorIndexes(ROWS, 2)).toEqual([1, 0]);
    expect(ancestorIndexes(ROWS, 4)).toEqual([0]);
    expect(ancestorIndexes(ROWS, 0)).toEqual([]);
    expect(ancestorIndexes(ROWS, 99)).toEqual([]);
  });
});
