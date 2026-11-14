import { describe, expect, it } from 'vitest';

import {
  NO_TOPIC,
  buildTopicNodes,
  leavesOf,
  overlapCount,
  topLevelOf,
  topicDescendants,
  topicMembers,
  topicsBelow,
  type BuildTopicNodesArgs,
} from './topic-nodes';
import { promptRow, term, topicRow } from '@/features/prompts/topics-by-engine/cells-fixtures';

// SEO has Technical SEO and Local SEO under it; Crawling is under Technical SEO (a third level); Paid Search stands alone
const TREE = [
  term('seo', 'SEO'),
  term('tech', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('crawl', 'Crawling', 'tech', 'SEO / Technical SEO / Crawling'),
  term('local', 'Local SEO', 'seo', 'SEO / Local SEO'),
  term('ads', 'Paid Search'),
];
const DESCENDANTS = topicDescendants(TREE, []);

const TOPICS = [
  topicRow(null, null, 1),
  topicRow('seo', 'SEO', 5),
  topicRow('tech', 'Technical SEO', 3),
  topicRow('crawl', 'Crawling', 1),
  topicRow('local', 'Local SEO', 2),
  topicRow('ads', 'Paid Search', 4),
];
const PROMPTS = [
  promptRow('p1', 'best crawl budget tools', ['crawl']),
  promptRow('p2', 'technical audit checklist', ['tech']),
  promptRow('p3', 'local pack ranking factors', ['local']),
  promptRow('p4', 'google ads agency pricing', ['ads']),
  promptRow('p5', 'what is seo', ['seo']),
  promptRow('p6', 'unfiled question', []),
];

const args = (over: Partial<BuildTopicNodesArgs> = {}): BuildTopicNodesArgs => ({
  topics: TOPICS,
  prompts: PROMPTS,
  tree: TREE,
  descendants: DESCENDANTS,
  kept: null,
  noTopicName: 'Prompts without a topic',
  ...over,
});

describe('topicMembers and topicsBelow', () => {
  it('a prompt rolls up to every topic above it', () => {
    const ids = (termId: string | null): string[] | undefined =>
      topicMembers(termId, PROMPTS, DESCENDANTS)?.map((prompt) => prompt.prompt_id);
    expect(ids('crawl')).toEqual(['p1']);
    expect(ids('tech')).toEqual(['p1', 'p2']);
    expect(ids('seo')).toEqual(['p1', 'p2', 'p3', 'p5']);
    expect(ids(null)).toEqual(['p6']);
  });

  it('topicsBelow keeps the chosen topic and the ones below it', () => {
    expect([...topicsBelow(['tech'], DESCENDANTS)].sort()).toEqual(['crawl', 'tech']);
    expect([...topicsBelow(['seo'], DESCENDANTS)].sort()).toEqual(['crawl', 'local', 'seo', 'tech']);
    // A topic the tree does not hold stands for itself
    expect([...topicsBelow(['unknown'], DESCENDANTS)]).toEqual(['unknown']);
  });

  it('members are null while the tree does not hold the topic', () => {
    const empty = topicDescendants([], []);
    expect(topicMembers('tech', PROMPTS, empty)).toBeNull();
    // The prompts without a topic need no tree
    expect(topicMembers(null, PROMPTS, empty)?.map((prompt) => prompt.prompt_id)).toEqual(['p6']);
  });
});

describe('buildTopicNodes', () => {
  it('a third level topic stands for its second level topic', () => {
    const nodes = buildTopicNodes(args());
    const seo = nodes.find((node) => node.key === 'seo');
    expect(seo?.children.map((node) => node.name)).toEqual(['Technical SEO', 'Local SEO']);
    expect(nodes.flatMap((node) => node.children).some((node) => node.key === 'crawl')).toBe(false);
    expect(nodes.some((node) => node.key === 'crawl')).toBe(false);
  });

  it('nests two levels with the path, the level and the parent of each node', () => {
    const nodes = buildTopicNodes(args());
    const seo = nodes.find((node) => node.key === 'seo');
    const tech = seo?.children[0];
    expect(seo).toMatchObject({ termId: 'seo', level: 1, parentKey: null, path: ['SEO'], promptCount: 5 });
    expect(tech).toMatchObject({
      termId: 'tech',
      level: 2,
      parentKey: 'seo',
      path: ['SEO', 'Technical SEO'],
      promptCount: 3,
    });
    expect(tech?.members?.map((prompt) => prompt.prompt_id)).toEqual(['p1', 'p2']);
    expect(tech?.children).toEqual([]);
  });

  it('the row of no topic has key __none and comes last', () => {
    const nodes = buildTopicNodes(args());
    const last = nodes[nodes.length - 1];
    expect(NO_TOPIC).toBe('__none');
    expect(last).toMatchObject({
      key: '__none',
      termId: null,
      name: 'Prompts without a topic',
      level: 1,
      parentKey: null,
      promptCount: 1,
    });
    expect(last?.members?.map((prompt) => prompt.prompt_id)).toEqual(['p6']);
    expect(nodes.filter((node) => node.key === NO_TOPIC)).toHaveLength(1);
  });

  it('kept narrows rows to the chosen subtree', () => {
    const nodes = buildTopicNodes(args({ kept: topicsBelow(['seo'], DESCENDANTS) }));
    expect(nodes.map((node) => node.key)).toEqual(['seo']);
    expect(nodes[0]?.children.map((node) => node.key)).toEqual(['tech', 'local']);
  });

  it('a child whose parent is not kept stands at the top level', () => {
    const nodes = buildTopicNodes(args({ kept: topicsBelow(['tech'], DESCENDANTS) }));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ key: 'tech', level: 1, parentKey: null, path: ['SEO', 'Technical SEO'] });
  });

  it('members are null while the tree does not hold the topic', () => {
    const nodes = buildTopicNodes(args({ tree: [], descendants: topicDescendants([], []) }));
    const [seo] = nodes;
    expect(seo?.members).toBeNull();
    // Without the tree every topic row stands at the top level
    expect(nodes.every((node) => node.level === 1)).toBe(true);
  });

  it('lists the top level rows in the order the API gave them', () => {
    const nodes = buildTopicNodes(args());
    expect(nodes.map((node) => node.key)).toEqual(['seo', 'ads', '__none']);
  });
});

describe('leavesOf and topLevelOf', () => {
  it('leavesOf gives rows with no children and top level rows without children', () => {
    expect(leavesOf(buildTopicNodes(args())).map((node) => node.key)).toEqual(['tech', 'local', 'ads']);
  });

  it('leavesOf and topLevelOf leave out the no topic row', () => {
    const nodes = buildTopicNodes(args());
    expect(leavesOf(nodes).some((node) => node.key === NO_TOPIC)).toBe(false);
    expect(topLevelOf(nodes).map((node) => node.key)).toEqual(['seo', 'ads']);
  });
});

describe('overlapCount', () => {
  it('counts a prompt in two top level topics once', () => {
    const prompts = [
      promptRow('both', 'in two topics', ['tech', 'ads']),
      promptRow('three', 'in three topics', ['local', 'ads']),
      promptRow('one', 'in one topic', ['tech']),
      // Two topics of the same top level topic are one top level topic
      promptRow('same', 'under one parent', ['tech', 'local']),
      promptRow('none', 'no topic', []),
    ];
    const nodes = buildTopicNodes(args({ prompts }));
    expect(overlapCount(prompts, nodes)).toBe(2);
  });

  it('is zero when no prompt is in two top level topics', () => {
    expect(overlapCount(PROMPTS, buildTopicNodes(args()))).toBe(0);
  });
});
