import { describe, expect, it } from 'vitest';

import { promptRow, term, topicRow } from './cells-fixtures';
import { topicHeads, type TopicHeadsArgs } from './topic-rows';
import { NO_TOPIC, topicDescendants, topicsBelow } from '@/features/prompts/prompt-model';

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
  noTopicName: 'No topic',
  ...over,
});

const names = (heads: readonly { name: string; children: readonly { name: string }[] }[]): string[] =>
  heads.map((entry) => `${entry.name}[${entry.children.map((child) => child.name).join(',')}]`);

describe('topicHeads: the topic rows of the page as plain heads', () => {
  it('lists the top level topics with their children under them', () => {
    const heads = topicHeads(args());
    expect(names(heads)).toEqual(['SEO[Technical SEO,Local SEO]', 'Paid Search[]', 'No topic[]']);
    const [seo] = heads;
    expect(seo?.path).toBe('SEO');
    expect(seo?.parent).toBeNull();
    expect(seo?.promptCount).toBe(5);
    const child = seo?.children[0];
    expect(child?.path).toBe('SEO / Technical SEO');
    expect(child?.parent).toBe('SEO');
    // The prompts a parent holds are those of the topics below it
    expect(seo?.members?.map((member) => member.prompt_id)).toEqual(['p1', 'p2', 'p4']);
    expect(child?.members?.map((member) => member.prompt_id)).toEqual(['p1']);
  });

  it('takes the path of a topic from the tree, which owns the way a path is written', () => {
    const tree = [term('seo', 'SEO'), term('tech', 'Technical SEO', 'seo', 'SEO > Technical SEO')];
    const [seo] = topicHeads(args({ tree, descendants: topicDescendants(tree, []) }));
    expect(seo?.children[0]?.path).toBe('SEO > Technical SEO');
  });

  it('keeps only the topics a filter keeps and the topics below them', () => {
    const kept = topicsBelow(['seo'], DESCENDANTS);
    expect(names(topicHeads(args({ kept, filtering: true })))).toEqual(['SEO[Technical SEO,Local SEO]']);
    // A chosen child stands at the top level: a filter never leaves an empty table
    const child = topicsBelow(['tech'], DESCENDANTS);
    expect(names(topicHeads(args({ kept: child, filtering: true })))).toEqual(['Technical SEO[]']);
  });

  it('finds a topic by its name or by the text of one of its prompts', () => {
    expect(names(topicHeads(args({ search: 'paid' })))).toEqual(['Paid Search[]']);
    // By a prompt of a child: the parent stays to hold it, with the child that matched
    expect(names(topicHeads(args({ search: 'crawl budget' })))).toEqual(['SEO[Technical SEO]']);
    expect(topicHeads(args({ search: 'no such text' }))).toEqual([]);
    // A name of a parent keeps every topic under it
    expect(names(topicHeads(args({ search: 'seo' })))).toEqual(['SEO[Technical SEO,Local SEO]']);
  });

  it('puts No topic last and never under a parent', () => {
    const first = { ...SUMMARY, topics: [topicRow(null, null, 1), ...SUMMARY.topics.slice(0, 4)] };
    const heads = topicHeads(args({ summary: first }));
    expect(heads.at(-1)?.key).toBe(NO_TOPIC);
    expect(heads.at(-1)?.name).toBe('No topic');
    expect(heads.at(-1)?.children).toEqual([]);
    expect(heads.at(-1)?.members?.map((member) => member.prompt_id)).toEqual(['p5']);
  });

  it('is empty before the summary is read', () => {
    expect(topicHeads(args({ summary: undefined }))).toEqual([]);
  });
});
