import { describe, expect, it } from 'vitest';

import { buildTopicTree, countTopicRows, sortTopicTree } from './topic-tree';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

const term = (termId: string, name: string, parentId: string | null, path: string): NamedTerm => ({
  termId,
  name,
  parentId,
  path,
});

/** Compliance above RBI and SEBI; RBI above Cyber, which is the third level; Pricing on its own. */
const TREE: readonly NamedTerm[] = [
  term('compliance', 'Compliance', null, 'Compliance'),
  term('rbi', 'RBI', 'compliance', 'Compliance / RBI'),
  term('cyber', 'Cyber', 'rbi', 'Compliance / RBI / Cyber'),
  term('sebi', 'SEBI', 'compliance', 'Compliance / SEBI'),
  term('pricing', 'Pricing', null, 'Pricing'),
];

interface Row {
  term_id: string | null;
  name: string;
}
const row = (term_id: string | null, name: string): Row => ({ term_id, name });
/** The API's rows: a row for every topic that has prompts and for every topic above one. */
const ROWS: readonly Row[] = [
  row('rbi', 'RBI'),
  row('compliance', 'Compliance'),
  row('cyber', 'Cyber'),
  row('pricing', 'Pricing'),
  row('sebi', 'SEBI'),
  row(null, 'No topic'),
];
const shape = (branches: ReturnType<typeof buildTopicTree<Row>>): [string, string[]][] =>
  branches.map((branch) => [branch.row.name, branch.children.map((child) => child.name)]);

describe('buildTopicTree', () => {
  it('puts a topic that has a parent under it, once, and lists the rest at the top level in the order given', () => {
    expect(shape(buildTopicTree(ROWS, TREE))).toEqual([
      ['Compliance', ['RBI', 'SEBI']],
      ['Pricing', []],
      ['No topic', []],
    ]);
  });

  it('gives a topic below the second level no row of its own: its row is read in its second level topic', () => {
    const all = buildTopicTree(ROWS, TREE).flatMap((branch) => [branch.row, ...branch.children]);
    expect(all.map((entry) => entry.name)).not.toContain('Cyber');
    expect(countTopicRows(buildTopicTree(ROWS, TREE))).toBe(5);
  });

  it('lists every topic at the top level while the trees are not read', () => {
    expect(shape(buildTopicTree(ROWS, []))).toEqual([
      ['RBI', []],
      ['Compliance', []],
      ['Cyber', []],
      ['Pricing', []],
      ['SEBI', []],
      ['No topic', []],
    ]);
  });

  it('keeps the row of the parent and of a child that the filter keeps, and the row of no topic only without a filter', () => {
    const keep = (kept: string[]) => (id: string | null) => id !== null && kept.includes(id);
    expect(shape(buildTopicTree(ROWS, TREE, keep(['compliance', 'rbi', 'cyber', 'sebi'])))).toEqual([
      ['Compliance', ['RBI', 'SEBI']],
    ]);
    expect(shape(buildTopicTree(ROWS, TREE, keep(['pricing'])))).toEqual([['Pricing', []]]);
  });

  it('shows a child alone at the top level when only the child is kept, as its parent is not', () => {
    const keep = (id: string | null): boolean => id === 'rbi' || id === 'cyber';
    expect(shape(buildTopicTree(ROWS, TREE, keep))).toEqual([['RBI', []]]);
  });

  it('shows the second level row for a topic below it that is the only one kept, so the filter never empties the table', () => {
    expect(shape(buildTopicTree(ROWS, TREE, (id) => id === 'cyber'))).toEqual([['RBI', []]]);
  });

  it('keeps a topic whose row has no term in the trees at the top level', () => {
    const rows = [...ROWS, row('later', 'Later')];
    expect(shape(buildTopicTree(rows, TREE)).at(-1)).toEqual(['Later', []]);
  });

  it('counts a parent row once, not its children again', () => {
    expect(countTopicRows(buildTopicTree(ROWS, TREE))).toBe(5);
    expect(countTopicRows([])).toBe(0);
  });
});

describe('sortTopicTree', () => {
  const byName = (rows: readonly Row[]): Row[] => [...rows].sort((a, b) => a.name.localeCompare(b.name));

  it('sorts the top level among itself and the children among their siblings, never moving a child out of its parent', () => {
    const sorted = sortTopicTree(buildTopicTree(ROWS, TREE), byName);
    expect(shape(sorted)).toEqual([
      ['Compliance', ['RBI', 'SEBI']],
      ['No topic', []],
      ['Pricing', []],
    ]);
    const descending = sortTopicTree(buildTopicTree(ROWS, TREE), (rows) => byName(rows).reverse());
    expect(shape(descending)).toEqual([
      ['Pricing', []],
      ['No topic', []],
      ['Compliance', ['SEBI', 'RBI']],
    ]);
  });
});
