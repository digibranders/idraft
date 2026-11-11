import { describe, expect, it } from 'vitest';

import { namedPaths } from './taxonomy-reads';
import type { TermNode } from '@/lib/api/types';

const node = (term_id: string, name: string, parent_id: string | null, children: TermNode[] = []): TermNode =>
  ({ term_id, name, parent_id, children }) as TermNode;

describe('the terms of a vocabulary tree', () => {
  it('lists each term depth first with its name, its parent and its place by name', () => {
    const tree = [
      node('seo', 'SEO', null, [node('tech', 'Technical SEO', 'seo', [node('crawl', 'Crawling', 'tech')])]),
      node('paid', 'Paid search', null),
    ];
    expect(namedPaths(tree)).toEqual([
      { termId: 'seo', name: 'SEO', parentId: null, path: 'SEO' },
      { termId: 'tech', name: 'Technical SEO', parentId: 'seo', path: 'SEO / Technical SEO' },
      { termId: 'crawl', name: 'Crawling', parentId: 'tech', path: 'SEO / Technical SEO / Crawling' },
      { termId: 'paid', name: 'Paid search', parentId: null, path: 'Paid search' },
    ]);
  });
});
