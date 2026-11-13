import { describe, expect, it } from 'vitest';

import { topicField, topicOptions, topicsKeptOf } from './topic-options';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

const term = (termId: string, name: string, parentId: string | null, path: string): NamedTerm => ({
  termId,
  name,
  parentId,
  path,
});

const SEO = term('seo', 'SEO', null, 'SEO');
const TECHNICAL = term('technical', 'Technical SEO', 'seo', 'SEO / Technical SEO');
const CRAWLING = term('crawling', 'Crawling', 'technical', 'SEO / Technical SEO / Crawling');
const PAID = term('paid', 'Paid search', null, 'Paid search');
const TREE = [SEO, TECHNICAL, CRAWLING, PAID];
const below = (label: string): string => `${label} (includes subtopics)`;

describe('topicOptions', () => {
  it('flattens the topic vocabulary to options, a topic below another named by its path', () => {
    expect(topicOptions(TREE, below)).toEqual([
      { value: 'seo', label: 'SEO (includes subtopics)' },
      { value: 'technical', label: 'SEO / Technical SEO (includes subtopics)' },
      { value: 'crawling', label: 'SEO / Technical SEO / Crawling' },
      { value: 'paid', label: 'Paid search' },
    ]);
  });

  it('says which topics include others, so choosing a parent is no surprise', () => {
    const labels = topicOptions(TREE, below).map((option) => option.label);
    expect(labels.filter((label) => label.endsWith('(includes subtopics)'))).toHaveLength(2);
  });

  it('tells two topics of one name apart by their paths and writes no dash', () => {
    const tree = [
      SEO,
      term('seo-local', 'Local', 'seo', 'SEO / Local'),
      term('svc', 'Services', null, 'Services'),
      term('svc-local', 'Local', 'svc', 'Services / Local'),
    ];
    const labels = topicOptions(tree, below).map((option) => option.label);
    expect(labels).toEqual([
      'SEO (includes subtopics)',
      'SEO / Local',
      'Services (includes subtopics)',
      'Services / Local',
    ]);
    // Letters, spaces, slashes and brackets only: no dash of any kind
    expect(labels.join('')).toMatch(/^[A-Za-z /()]*$/);
  });
});

describe('topicField', () => {
  const words = { label: 'Topic', below };

  it('is a single choice enum named Topic whose options are the tree', () => {
    const field = topicField({ ...words, tree: TREE, pending: false });
    expect(field).toMatchObject({ id: 'topic', kind: 'enum', multi: false, label: 'Topic', optionsLoading: false });
    expect(field.options).toHaveLength(4);
  });

  it('is loading while the tree is not read, so the topic of a link is kept and not dropped', () => {
    const field = topicField({ ...words, tree: [], pending: true });
    expect(field.optionsLoading).toBe(true);
    expect(field.options).toEqual([]);
  });
});

describe('topicsKeptOf', () => {
  it('is nothing without a topic', () => {
    expect(topicsKeptOf(TREE, null, false)).toBeNull();
  });

  it('is the topic and every topic below it', () => {
    expect(topicsKeptOf(TREE, 'seo', false)).toEqual(new Set(['seo', 'technical', 'crawling']));
    expect(topicsKeptOf(TREE, 'crawling', false)).toEqual(new Set(['crawling']));
  });

  it('cannot tell while the tree is not read', () => {
    expect(topicsKeptOf([], 'seo', true)).toBeNull();
  });

  it('lets a topic the read tree does not hold stand for itself', () => {
    expect(topicsKeptOf(TREE, 'loose', false)).toEqual(new Set(['loose']));
  });
});
