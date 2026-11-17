import { describe, expect, it } from 'vitest';

import { chosenGroup, groupChoices, groupTerms } from './group-options';
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

describe('groupTerms', () => {
  const rows = (...held: [string, number][]): { term_id: string; prompt_count: number }[] =>
    held.map(([term_id, prompt_count]) => ({ term_id, prompt_count }));

  it('lists the topics that hold a prompt and have none below them, in the tree order', () => {
    // SEO rolls up its sub-topic, so it is above a group and not one; Paid search holds prompts and is a group
    expect(groupTerms(TREE, rows(['paid', 2], ['seo', 3], ['technical', 3])).map((term) => term.termId)).toEqual([
      'technical',
      'paid',
    ]);
  });

  it('leaves out a topic with no prompt, and a topic whose only sub-topics are empty is a group', () => {
    expect(groupTerms(TREE, rows(['paid', 0], ['seo', 2], ['technical', 0])).map((term) => term.termId)).toEqual([
      'seo',
    ]);
    expect(groupTerms(TREE, [])).toEqual([]);
  });
});

describe('chosenGroup', () => {
  const choices = groupChoices(TREE, 'All groups');
  it('finds the topic of an id', () => {
    expect(chosenGroup(choices, 'paid', 'Unknown group').label).toBe('Paid search');
  });
  it('reads no id as All groups', () => {
    expect(chosenGroup(choices, null, 'Unknown group').label).toBe('All groups');
  });
  it('names an id the tree does not hold neutrally, never by the id', () => {
    expect(chosenGroup(choices, 'gone', 'Unknown group')).toEqual({ termId: 'gone', label: 'Unknown group' });
  });
});
