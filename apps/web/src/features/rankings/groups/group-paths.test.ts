import { describe, expect, it } from 'vitest';

import { findGroup, missingNames, pathProblem, splitPath } from './group-paths';

const groups = [
  { group_id: 'g-blog', parent_id: null, name: 'Blog', path: 'Blog' },
  { group_id: 'g-guides', parent_id: 'g-blog', name: 'Guides', path: 'Blog/Guides' },
  { group_id: 'g-services', parent_id: null, name: 'Services', path: 'Services' },
];

describe('group paths', () => {
  it('splits a typed path into trimmed names', () => {
    expect(splitPath(' Blog / How to ')).toEqual(['Blog', 'How to']);
    expect(splitPath('Blog')).toEqual(['Blog']);
  });

  it('names what is wrong with a typed path', () => {
    expect(pathProblem('')).toBe('empty');
    expect(pathProblem('Blog//Guides')).toBe('empty');
    expect(pathProblem(`Blog/${'a'.repeat(101)}`)).toBe('too_long');
    expect(pathProblem(Array.from({ length: 11 }, (_, index) => `L${String(index)}`).join('/'))).toBe('too_deep');
    expect(pathProblem('Blog/Guides')).toBeNull();
  });

  it('finds a group by its path in any case', () => {
    expect(findGroup(groups, ['blog', 'GUIDES'])?.group_id).toBe('g-guides');
    expect(findGroup(groups, ['Blog', 'News'])).toBeNull();
  });

  it('lists the names still missing below the deepest group that exists', () => {
    expect(missingNames(groups, ['Blog', 'Guides', 'SEO', 'Local'])).toEqual({
      parentId: 'g-guides',
      names: ['SEO', 'Local'],
    });
    expect(missingNames(groups, ['News'])).toEqual({ parentId: null, names: ['News'] });
    expect(missingNames(groups, ['services'])).toEqual({ parentId: 'g-services', names: [] });
  });
});
