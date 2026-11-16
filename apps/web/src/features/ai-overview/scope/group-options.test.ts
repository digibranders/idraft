import { describe, expect, it } from 'vitest';

import { chosenGroup, groupChoices } from './group-options';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

const term = (termId: string, name: string, parentId: string | null, path: string): NamedTerm => ({
  termId,
  name,
  parentId,
  path,
});

const TREE = [
  term('seo', 'SEO', null, 'SEO'),
  term('technical', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('paid', 'Paid search', null, 'Paid search'),
];

describe('groupChoices', () => {
  it('is one flat list, All groups first, a topic below another named by its path', () => {
    expect(groupChoices(TREE, 'All groups')).toEqual([
      { termId: null, label: 'All groups' },
      { termId: 'seo', label: 'SEO' },
      { termId: 'technical', label: 'SEO / Technical SEO' },
      { termId: 'paid', label: 'Paid search' },
    ]);
  });

  it('is All groups alone for a project with no topic', () => {
    expect(groupChoices([], 'All groups')).toEqual([{ termId: null, label: 'All groups' }]);
  });
});

describe('chosenGroup', () => {
  const choices = groupChoices(TREE, 'All groups');
  it('finds the topic of an id', () => {
    expect(chosenGroup(choices, 'paid').label).toBe('Paid search');
  });
  it('reads no id, and an id the tree does not hold, as All groups', () => {
    expect(chosenGroup(choices, null).label).toBe('All groups');
    expect(chosenGroup(choices, 'gone').label).toBe('All groups');
  });
});
