import { describe, expect, it } from 'vitest';

import { MAX_SIBLINGS, parentOf, siblingKeys, siblingsOf } from './related-model';
import { NO_TOPIC, topicDescendants } from '@/features/prompts/prompt-model';
import { engine, term, topicRow, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { TopicSummaryRow } from '@/lib/api/types';

/**
 * SEO has Technical SEO and Content under it; Technical SEO has Speed under it. Sales stands beside SEO at the top.
 */
const TREE = [
  term('seo', 'SEO'),
  term('technical', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('content', 'Content', 'seo', 'SEO / Content'),
  term('speed', 'Speed', 'technical', 'SEO / Technical SEO / Speed'),
  term('sales', 'Sales'),
];
const DESCENDANTS = topicDescendants(TREE, []);
const CODES = ['chatgpt_web', 'gemini_web'] as const;

const rowOf = (key: string, name: string, prompts: number, mention: [k: number, n: number] | null): TopicSummaryRow =>
  topicRow(
    key,
    name,
    prompts,
    mention === null
      ? []
      : [
          engine('chatgpt_web', { mentioned: weighted(mention[0], mention[1], prompts) }),
          engine('gemini_web', { mentioned: weighted(mention[0], mention[1], prompts) }),
        ],
  );
const summaryOf = (topics: readonly TopicSummaryRow[]) => ({ topics, prompts: [] });

describe('parentOf: the topic above a topic, from the descendants alone', () => {
  it('finds the parent as the smallest other topic that holds it', () => {
    expect(parentOf('speed', DESCENDANTS)).toBe('technical');
    expect(parentOf('technical', DESCENDANTS)).toBe('seo');
    expect(parentOf('content', DESCENDANTS)).toBe('seo');
  });

  it('is null for a top level topic and for one the descendants do not hold', () => {
    expect(parentOf('seo', DESCENDANTS)).toBeNull();
    expect(parentOf('sales', DESCENDANTS)).toBeNull();
    expect(parentOf('unknown', DESCENDANTS)).toBeNull();
  });
});

describe('siblingKeys: the topics that share a parent', () => {
  it('lists the topics that share its parent', () => {
    expect(siblingKeys('technical', DESCENDANTS)).toEqual(['content']);
    expect(siblingKeys('content', DESCENDANTS)).toEqual(['technical']);
  });

  it('lists the other top level topics for a top level topic', () => {
    expect(siblingKeys('seo', DESCENDANTS)).toEqual(['sales']);
  });

  it('is empty for a topic with no sibling and for the prompts without a topic', () => {
    expect(siblingKeys('speed', DESCENDANTS)).toEqual([]);
    expect(siblingKeys(NO_TOPIC, DESCENDANTS)).toEqual([]);
  });

  it('is null while the descendants do not hold the topic: they are not read', () => {
    expect(siblingKeys('technical', new Map())).toBeNull();
  });
});

describe('siblingsOf: the siblings as the tab lists them', () => {
  it('lists each sibling with its prompts and its mention rate averaged over the engines', () => {
    const summary = summaryOf([rowOf('technical', 'Technical SEO', 4, [3, 8]), rowOf('content', 'Content', 6, [4, 8])]);
    const result = siblingsOf('technical', summary, DESCENDANTS, CODES);
    expect(result?.more).toBe(0);
    expect(result?.shown).toHaveLength(1);
    expect(result?.shown[0]).toMatchObject({ key: 'content', name: 'Content', promptCount: 6 });
    expect(result?.shown[0]?.mention).toMatchObject({ state: 'ok', value: 0.5, engines: 2 });
    // The engines that take part in the average, for the counts behind it
    expect(result?.shown[0]?.counting.map((entry) => entry.code)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('leaves an engine under 4 valid answers out of the average and out of the counts', () => {
    const topic = topicRow('content', 'Content', 6, [
      engine('chatgpt_web', { mentioned: weighted(4, 8, 6) }),
      engine('gemini_web', { mentioned: weighted(1, 3, 6) }),
    ]);
    const [content] = siblingsOf('technical', summaryOf([topic]), DESCENDANTS, CODES)?.shown ?? [];
    expect(content?.mention).toMatchObject({ state: 'ok', value: 0.5, engines: 1 });
    expect(content?.counting.map((entry) => entry.code)).toEqual(['chatgpt_web']);
  });

  it('orders by prompts, caps at 10 and counts the rest', () => {
    const tree = [
      term('root', 'Root'),
      term('me', 'Me', 'root'),
      ...Array.from({ length: 13 }, (_, at) =>
        term(`s${String(at)}`, `Sibling ${String(at).padStart(2, '0')}`, 'root'),
      ),
    ];
    const descendants = topicDescendants(tree, []);
    const summary = summaryOf(
      Array.from({ length: 13 }, (_, at) =>
        rowOf(`s${String(at)}`, `Sibling ${String(at).padStart(2, '0')}`, at + 1, [1, 4]),
      ),
    );
    const result = siblingsOf('me', summary, descendants, CODES);
    expect(result?.shown).toHaveLength(MAX_SIBLINGS);
    expect(MAX_SIBLINGS).toBe(10);
    expect(result?.shown.map((entry) => entry.promptCount)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4]);
    expect(result?.more).toBe(3);
  });

  it('breaks a tie of prompts by name, and leaves a sibling the summary has no row for out', () => {
    const tree = [
      term('root', 'Root'),
      term('me', 'Me', 'root'),
      term('b', 'B', 'root'),
      term('a', 'A', 'root'),
      term('c', 'C', 'root'),
    ];
    const summary = summaryOf([rowOf('b', 'B', 2, [1, 4]), rowOf('a', 'A', 2, [1, 4])]);
    const result = siblingsOf('me', summary, topicDescendants(tree, []), CODES);
    expect(result?.shown.map((entry) => entry.name)).toEqual(['A', 'B']);
  });

  it('says a mention rate of an unanswered sibling is not there, never 0', () => {
    const summary = summaryOf([rowOf('technical', 'Technical SEO', 4, null), rowOf('content', 'Content', 6, null)]);
    expect(siblingsOf('technical', summary, DESCENDANTS, CODES)?.shown[0]?.mention).toMatchObject({
      state: 'none',
      value: null,
    });
  });

  it('is null while descendants or the summary are not read', () => {
    expect(siblingsOf('technical', summaryOf([]), new Map(), CODES)).toBeNull();
    expect(siblingsOf('technical', undefined, DESCENDANTS, CODES)).toBeNull();
  });
});
