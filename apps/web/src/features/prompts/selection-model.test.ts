import { describe, expect, it } from 'vitest';

import { applyRowChange, promptIdsOf, rowSelection, topicsChosen, type RowPrompts } from './selection-model';

/** t:a holds p1 and p2, t:b holds p2 and p3 (p2 is under both), the prompt row of p1, and a topic without prompts. */
const ROWS: RowPrompts = new Map([
  ['t:a', ['p1', 'p2']],
  ['t:b', ['p2', 'p3']],
  ['p:p1', ['p1']],
  ['t:empty', []],
]);

describe('the rows a choice of prompts selects', () => {
  it('selects a row whose prompts are all chosen and draws one with some of them as partly selected', () => {
    const { selectedIds, indeterminateIds } = rowSelection(new Set(['p1', 'p2']), ROWS);
    expect([...selectedIds].sort()).toEqual(['p:p1', 't:a']);
    expect([...indeterminateIds]).toEqual(['t:b']);
  });

  it('never selects a row that holds no prompt', () => {
    const { selectedIds, indeterminateIds } = rowSelection(new Set(['p1', 'p2', 'p3']), ROWS);
    expect(selectedIds.has('t:empty')).toBe(false);
    expect(indeterminateIds.has('t:empty')).toBe(false);
  });

  it('selects nothing for no choice', () => {
    const { selectedIds, indeterminateIds } = rowSelection(new Set(), ROWS);
    expect(selectedIds.size + indeterminateIds.size).toBe(0);
  });
});

describe('a change of the selected rows', () => {
  it('chooses the prompts of a row that was ticked, and takes those of a row that was unticked away', () => {
    const ticked = applyRowChange(new Set(), new Set(), new Set(['t:a']), ROWS);
    expect([...ticked].sort()).toEqual(['p1', 'p2']);
    const unticked = applyRowChange(ticked, new Set(['t:a']), new Set(), ROWS);
    expect(unticked.size).toBe(0);
  });

  it('counts a prompt of two topics once, and unticking one topic leaves the other partly selected', () => {
    const both = applyRowChange(new Set(), new Set(), new Set(['t:a', 't:b']), ROWS);
    expect([...both].sort()).toEqual(['p1', 'p2', 'p3']);
    const less = applyRowChange(both, new Set(['t:a', 't:b']), new Set(['t:b']), ROWS);
    expect([...less].sort()).toEqual(['p3']);
    expect([...rowSelection(less, ROWS).indeterminateIds]).toEqual(['t:b']);
  });

  it('keeps the prompts chosen through rows that are not in the table now', () => {
    const next = applyRowChange(new Set(['gone']), new Set(), new Set(['p:p1']), ROWS);
    expect([...next].sort()).toEqual(['gone', 'p1']);
  });
});

describe('the prompts behind several rows', () => {
  it('lists each prompt once, in the order of the rows', () => {
    expect(promptIdsOf(['t:b', 't:a', 'nothing'], ROWS)).toEqual(['p2', 'p3', 'p1']);
  });
});

describe('the topics a choice counts', () => {
  const tree = [
    {
      ids: ['p1', 'p2', 'p3'],
      children: [{ ids: ['p1', 'p2'] }, { ids: ['p3'] }],
    },
    { ids: ['p4'], children: [] },
    { ids: [], children: [] },
  ];

  it('counts a parent alone when all of its prompts are chosen, and not the topics below it', () => {
    expect(topicsChosen(tree, new Set(['p1', 'p2', 'p3']))).toBe(1);
  });

  it('counts the topics below a parent that is only partly chosen', () => {
    expect(topicsChosen(tree, new Set(['p1', 'p2']))).toBe(1);
    expect(topicsChosen(tree, new Set(['p1', 'p2', 'p3', 'p4']))).toBe(2);
    expect(topicsChosen(tree.slice(0, 1), new Set(['p3', 'p1']))).toBe(1);
  });

  it('counts no topic for prompts that fill none, nor for a topic without prompts', () => {
    expect(topicsChosen(tree, new Set(['p1']))).toBe(0);
    expect(topicsChosen(tree, new Set())).toBe(0);
  });
});
