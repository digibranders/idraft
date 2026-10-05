import { describe, expect, it } from 'vitest';

import {
  ancestorsOf,
  flattenGroups,
  moveTargets,
  subtreeHeight,
  subtreeIds,
  toTreeNodes,
  type GroupNode,
} from './group-tree';

const tree: GroupNode[] = [
  {
    group_id: 'a',
    parent_id: null,
    name: 'Blog',
    path: 'Blog',
    keyword_count: 3,
    created_at: '',
    children: [
      {
        group_id: 'b',
        parent_id: 'a',
        name: 'Guides',
        path: 'Blog/Guides',
        keyword_count: 2,
        created_at: '',
        children: [
          {
            group_id: 'd',
            parent_id: 'b',
            name: 'SEO',
            path: 'Blog/Guides/SEO',
            keyword_count: 1,
            created_at: '',
            children: [],
          },
        ],
      },
    ],
  },
  {
    group_id: 'c',
    parent_id: null,
    name: 'Services',
    path: 'Services',
    keyword_count: 0,
    created_at: '',
    children: [],
  },
];

const [blog] = tree;
if (blog === undefined) throw new Error('The fixture has no first group');

describe('group tree', () => {
  it('flattens depth first', () => {
    expect(flattenGroups(tree).map((group) => group.group_id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('lists a group and everything under it', () => {
    expect([...subtreeIds(blog)]).toEqual(['a', 'b', 'd']);
  });

  it('lists the groups above one, root first', () => {
    expect(ancestorsOf(tree, 'b')).toEqual(['a']);
    expect(ancestorsOf(tree, 'd')).toEqual(['a', 'b']);
    expect(ancestorsOf(tree, 'c')).toEqual([]);
    expect(ancestorsOf(tree, 'unknown')).toEqual([]);
  });

  it('makes tree view nodes with the count as detail', () => {
    const nodes = toTreeNodes(tree, (count) => `${String(count)} kw`);
    expect(nodes[0]).toMatchObject({ id: 'a', label: 'Blog', detail: '3 kw' });
    expect(nodes[0]?.children[0]).toMatchObject({ id: 'b', label: 'Guides', detail: '2 kw' });
  });

  it('counts the levels of a subtree', () => {
    expect(subtreeHeight(blog)).toBe(3);
    expect(subtreeHeight(tree[1] ?? blog)).toBe(1);
  });
});

/** A chain of `levels` groups, each under the one before: `L1`, `L1/L2`, and so on. */
function chain(levels: number): GroupNode {
  let node: GroupNode | null = null;
  for (let level = levels; level >= 1; level -= 1) {
    const names = Array.from({ length: level }, (_, index) => `L${String(index + 1)}`);
    node = {
      group_id: `l${String(level)}`,
      parent_id: level === 1 ? null : `l${String(level - 1)}`,
      name: `L${String(level)}`,
      path: names.join('/'),
      keyword_count: 0,
      created_at: '',
      children: node === null ? [] : [node],
    };
  }
  if (node === null) throw new Error('A chain needs one level');
  return node;
}

describe('where a group can move', () => {
  it('leaves out groups that would push the moved subtree past 10 levels', () => {
    // Blog is 3 levels tall: under a group at level 7 it ends at level 10, under one at level 8 at level 11
    const deep = chain(8);
    const all = [...flattenGroups([deep]), ...flattenGroups([blog])];
    const targets = moveTargets(all, blog).map((group) => group.group_id);
    expect(targets).toContain('l7');
    expect(targets).not.toContain('l8');
    // The group itself and everything under it never are
    expect(targets).not.toContain('a');
    expect(targets).not.toContain('b');
    expect(targets).not.toContain('d');
  });

  it('offers a group at level 9 to a group with no subgroups, and any group to a deep chain', () => {
    const all = [...flattenGroups([chain(9)]), ...flattenGroups([tree[1] ?? blog])];
    expect(moveTargets(all, tree[1] ?? blog).map((group) => group.group_id)).toContain('l9');
    // A level 10 group has no room under it for anything
    expect(
      moveTargets(flattenGroups([chain(10)]), { ...blog, children: [] }).map((group) => group.group_id),
    ).not.toContain('l10');
  });
});
