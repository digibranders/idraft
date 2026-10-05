import { describe, expect, it } from 'vitest';

import { ancestorsOf, flattenGroups, subtreeIds, toTreeNodes, type GroupNode } from './group-tree';

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
});
