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
const withPath = (name: string, path: string): string => `${name}, ${path}`;

describe('topicOptions', () => {
  it('flattens the topic vocabulary to options with their paths, in the tree order', () => {
    expect(topicOptions(TREE, withPath)).toEqual([
      { value: 'seo', label: 'SEO' },
      { value: 'technical', label: 'Technical SEO' },
      { value: 'crawling', label: 'Crawling' },
      { value: 'paid', label: 'Paid search' },
    ]);
  });

  it('tells two topics of one name apart by their paths and leaves the others alone', () => {
    const tree = [
      SEO,
      term('seo-local', 'Local', 'seo', 'SEO / Local'),
      term('svc', 'Services', null, 'Services'),
      term('svc-local', 'Local', 'svc', 'Services / Local'),
    ];
    expect(topicOptions(tree, withPath).map((option) => option.label)).toEqual([
      'SEO',
      'Local, SEO / Local',
      'Services',
      'Local, Services / Local',
    ]);
  });
});

describe('topicField', () => {
  const words = { label: 'Topic', withPath };

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
