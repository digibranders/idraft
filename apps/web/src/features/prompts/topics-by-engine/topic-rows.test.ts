import { describe, expect, it } from 'vitest';

import { promptRow, term, topicRow } from './cells.test-fixtures';
import { topicHeads, type TopicHeadsArgs } from './topic-rows';
import { topicDescendants, topicsBelow } from '@/features/prompts/prompt-model';

const TREE = [
  term('seo', 'SEO'),
  term('tech', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('local', 'Local SEO', 'seo', 'SEO / Local SEO'),
  term('ads', 'Paid Search'),
];
const DESCENDANTS = topicDescendants(TREE, []);

const SUMMARY = {
  topics: [
    topicRow('seo', 'SEO', 5),
    topicRow('tech', 'Technical SEO', 3),
    topicRow('local', 'Local SEO', 2),
    topicRow('ads', 'Paid Search', 4),
    topicRow(null, null, 1),
  ],
  prompts: [
    promptRow('p1', 'best crawl budget tools', ['tech']),
    promptRow('p2', 'local pack ranking factors', ['local']),
    promptRow('p3', 'google ads agency pricing', ['ads']),
    promptRow('p4', 'what is a seo audit', ['seo']),
    promptRow('p5', 'unfiled question', []),
  ],
};

const args = (over: Partial<TopicHeadsArgs> = {}): TopicHeadsArgs => ({
  summary: SUMMARY,
  tree: TREE,
  descendants: DESCENDANTS,
  kept: new Set(),
  filtering: false,
  search: null,
  locale: 'en',
  ...over,
});

const names = (heads: readonly { name: string }[]): string[] => heads.map((entry) => entry.name);

describe('topicHeads: the groups of the page as plain heads', () => {
  it('lists the groups only: the topics with a prompt and none below them, no parent and no No group', () => {
    const heads = topicHeads(args());
    expect(names(heads)).toEqual(['Technical SEO', 'Local SEO', 'Paid Search']);
    expect(heads[0]?.promptCount).toBe(3);
    expect(heads[0]?.members?.map((member) => member.prompt_id)).toEqual(['p1']);
  });

  it('keeps only the groups a filter keeps: a kept parent shows its groups, a kept child alone shows itself', () => {
    expect(names(topicHeads(args({ kept: topicsBelow(['seo'], DESCENDANTS), filtering: true })))).toEqual([
      'Technical SEO',
      'Local SEO',
    ]);
    expect(names(topicHeads(args({ kept: topicsBelow(['tech'], DESCENDANTS), filtering: true })))).toEqual([
      'Technical SEO',
    ]);
  });

  it('finds a group by its name, which keeps all its prompts, or by the text of one of its prompts', () => {
    expect(names(topicHeads(args({ search: 'paid' })))).toEqual(['Paid Search']);
    expect(names(topicHeads(args({ search: 'crawl budget' })))).toEqual(['Technical SEO']);
    expect(topicHeads(args({ search: 'no such text' }))).toEqual([]);
  });

  it('is empty before the summary is read', () => {
    expect(topicHeads(args({ summary: undefined }))).toEqual([]);
  });
});
