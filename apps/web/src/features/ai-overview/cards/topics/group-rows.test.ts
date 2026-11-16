import { describe, expect, it } from 'vitest';

import { CELL_OF_MEASURE, forMeasure, groupCoverage, groupRows, groupsOf, isCountedMeasure } from './group-rows';
import { engineCells, promptRow, topicRow } from './topic-card-test-kit';
import { buildTopicNodes, topicDescendants } from './topic-nodes';
import type { PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import { term } from '@/features/prompts/topics-by-engine/cells-fixtures';

// SEO has Technical SEO and Local SEO under it; Paid Search stands alone
const TREE = [
  term('seo', 'SEO'),
  term('tech', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('local', 'Local SEO', 'seo', 'SEO / Local SEO'),
  term('ads', 'Paid Search'),
];

const OUTCOMES = { both: [3, 10], named: [2, 10], cited: [1, 10], neither: [4, 10] } as const;

const chatgpt = (over: Parameters<typeof engineCells>[1] = { mentioned: [5, 10] }) => engineCells('chatgpt_web', over);

const nodesOf = (topics: TopicSummaryRow[], prompts: PromptSummaryRow[] = []) =>
  buildTopicNodes({
    topics,
    prompts,
    tree: TREE,
    descendants: topicDescendants(TREE, []),
    kept: null,
    noTopicName: 'Prompts without a group',
  });

const TOPICS = [
  topicRow('seo', 'SEO', 5, [chatgpt()]),
  topicRow('tech', 'Technical SEO', 3, [
    chatgpt({ mentioned: [6, 10], cited: [2, 10], outcomes: OUTCOMES, prompts: 3 }),
  ]),
  topicRow('local', 'Local SEO', 2, [chatgpt()]),
  topicRow('ads', 'Paid Search', 4, [chatgpt()]),
  topicRow(null, null, 1, [chatgpt()]),
];

describe('groupRows', () => {
  it('is one flat level: the groups that have no group below them, in tree order, and no row of no group', () => {
    const rows = groupRows(nodesOf(TOPICS), ['chatgpt_web'], 'mention');
    expect(rows.map((row) => row.node.name)).toEqual(['Technical SEO', 'Local SEO', 'Paid Search']);
  });

  it('reads AI visibility from the outcome cells: named and cited, named only and cited only over the valid answers', () => {
    const [tech] = groupRows(nodesOf(TOPICS), ['chatgpt_web'], 'visibility');
    const [value] = tech?.values ?? [];
    expect(value?.state).toBe('ok');
    expect(value?.value).toBeCloseTo(0.6);
    expect(value?.successes).toBe(6);
    expect(value?.answers).toBe(10);
  });

  it('reads the mention, citation and share of voice cells for the other measures', () => {
    const at = (measure: 'mention' | 'citation' | 'sov') =>
      groupRows(nodesOf(TOPICS), ['chatgpt_web'], measure)[0]?.values[0]?.value;
    expect(at('mention')).toBeCloseTo(0.6);
    expect(at('citation')).toBeCloseTo(0.2);
    expect(CELL_OF_MEASURE.sov).toBe('share_of_voice');
    expect(isCountedMeasure('sov')).toBe(false);
    expect(isCountedMeasure('visibility')).toBe(true);
  });

  it('is unknown, never 0, when the outcome cells hold no answer', () => {
    const [local] = groupRows(nodesOf(TOPICS), ['chatgpt_web'], 'visibility').filter(
      (row) => row.node.name === 'Local SEO',
    );
    expect(local?.values[0]?.state).toBe('none');
    expect(local?.values[0]?.value).toBeNull();
    expect(local?.average.state).toBe('none');
  });

  it('averages the platforms with equal weight, never by pooled counts, and leaves out a platform with too few answers', () => {
    const topics = [
      topicRow('ads', 'Paid Search', 4, [
        engineCells('chatgpt_web', { mentioned: [8, 10], prompts: 4 }),
        engineCells('gemini_web', { mentioned: [10, 100], prompts: 4 }),
        engineCells('google_ai_mode', { mentioned: [2, 3], prompts: 4 }),
      ]),
    ];
    const [ads] = groupRows(nodesOf(topics), ['chatgpt_web', 'gemini_web', 'google_ai_mode'], 'mention');
    // (0.8 + 0.1) / 2, not (8 + 10) / 110; AI Mode has 3 answers and takes no part
    expect(ads?.average.value).toBeCloseTo(0.45);
    expect(ads?.average.engines).toBe(2);
    expect(ads?.values[2]?.state).toBe('insufficient');
  });
});

describe('groupsOf', () => {
  it('leaves out a topic with no prompt, so a topic whose sub-topics are empty is a group itself', () => {
    const topics = [
      topicRow('seo', 'SEO', 5, [chatgpt()]),
      topicRow('tech', 'Technical SEO', 0, [chatgpt()]),
      topicRow('local', 'Local SEO', 0, [chatgpt()]),
      topicRow('ads', 'Paid Search', 4, [chatgpt()]),
    ];
    expect(groupsOf(nodesOf(topics)).map((node) => node.name)).toEqual(['SEO', 'Paid Search']);
  });
});

describe('forMeasure', () => {
  it('puts the visibility cell where the mention cell is and leaves the other measures as they are', () => {
    const engines = [chatgpt({ mentioned: [6, 10], outcomes: OUTCOMES })];
    expect(forMeasure(engines, 'visibility')[0]?.mentioned.numerator).toBe(6);
    expect(forMeasure(engines, 'mention')).toBe(engines);
  });
});

describe('groupCoverage', () => {
  it('counts the prompts that are in more than one group and the ones in none that is a row', () => {
    const prompts = [
      promptRow('p1', 'one', ['tech'], []),
      promptRow('p2', 'two', ['tech', 'ads'], []),
      promptRow('p3', 'three', ['seo'], []),
      promptRow('p4', 'four', [], []),
    ];
    const nodes = nodesOf(TOPICS, prompts);
    // p3 is only in SEO, which has groups below it and is no row; p4 has no group
    expect(groupCoverage(prompts, nodes)).toEqual({ overlapping: 1, outside: 2 });
  });
});
