import { describe, expect, it } from 'vitest';

import { buildTopicTree, groupsOf } from './topic-tree';
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
  row(null, 'No group'),
];
const shape = (branches: ReturnType<typeof buildTopicTree<Row>>): [string, string[]][] =>
  branches.map((branch) => [branch.row.name, branch.children.map((child) => child.name)]);

describe('buildTopicTree', () => {
  it('puts a topic that has a parent under it, once, and lists the rest at the top level in the order given', () => {
    expect(shape(buildTopicTree(ROWS, TREE))).toEqual([
      ['Compliance', ['RBI', 'SEBI']],
      ['Pricing', []],
      ['No group', []],
    ]);
  });

  it('gives a topic below the second level no row of its own: its row is read in its second level topic', () => {
    const all = buildTopicTree(ROWS, TREE).flatMap((branch) => [branch.row, ...branch.children]);
    expect(all.map((entry) => entry.name)).not.toContain('Cyber');
  });

  it('lists every topic at the top level while the trees are not read', () => {
    expect(shape(buildTopicTree(ROWS, []))).toEqual([
      ['RBI', []],
      ['Compliance', []],
      ['Cyber', []],
      ['Pricing', []],
      ['SEBI', []],
      ['No group', []],
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
});

describe('groupsOf', () => {
  interface Counted extends Row {
    prompt_count: number;
  }
  const counted = (term_id: string | null, name: string, prompt_count: number): Counted => ({
    term_id,
    name,
    prompt_count,
  });
  const names = (rows: readonly Counted[], keep?: (id: string | null) => boolean): string[] =>
    groupsOf(buildTopicTree(rows, TREE, keep)).map((group) => group.name);

  it('lists the topics that have a prompt and none with a prompt below them: the children of a parent, the topic alone otherwise', () => {
    const rows = [
      counted('compliance', 'Compliance', 9),
      counted('rbi', 'RBI', 5),
      counted('sebi', 'SEBI', 4),
      counted('pricing', 'Pricing', 3),
      counted(null, 'No group', 2),
    ];
    expect(names(rows)).toEqual(['RBI', 'SEBI', 'Pricing']);
  });

  it('leaves out a topic the API lists with no prompt: a parent whose only topics below are empty is a group', () => {
    const rows = [counted('compliance', 'Compliance', 6), counted('rbi', 'RBI', 0), counted('sebi', 'SEBI', 6)];
    expect(names(rows)).toEqual(['SEBI']);
    expect(names([counted('compliance', 'Compliance', 6), counted('rbi', 'RBI', 0)])).toEqual(['Compliance']);
    expect(names([counted('compliance', 'Compliance', 0), counted('rbi', 'RBI', 0)])).toEqual([]);
  });

  it('follows a topic filter: the kept topics only, and a kept parent shows its groups', () => {
    const rows = [counted('compliance', 'Compliance', 9), counted('rbi', 'RBI', 5), counted('pricing', 'Pricing', 3)];
    expect(names(rows, (id) => id === 'pricing')).toEqual(['Pricing']);
    expect(names(rows, (id) => id === 'compliance' || id === 'rbi')).toEqual(['RBI']);
  });

  it('has no group for the prompts without a topic, and none before the rows are read', () => {
    expect(names([counted(null, 'No group', 4)])).toEqual([]);
    expect(groupsOf([])).toEqual([]);
  });
});
