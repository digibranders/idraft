import { describe, expect, it } from 'vitest';

import { MAX_RELATED, otherGroups } from './related-model';
import { topicDescendants } from '@/features/prompts/prompt-model';
import { engine, term, topicRow, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { TopicSummaryRow } from '@/lib/api/types';

/** Compliance above RBI and SEBI; Pricing and Cloud stand alone: the groups are RBI, SEBI, Pricing and Cloud. */
const TREE = [
  term('compliance', 'Compliance'),
  term('rbi', 'RBI', 'compliance', 'Compliance / RBI'),
  term('sebi', 'SEBI', 'compliance', 'Compliance / SEBI'),
  term('pricing', 'Pricing'),
  term('cloud', 'Cloud'),
];
const DESCENDANTS = topicDescendants(TREE, []);
const CODES = ['chatgpt_web', 'gemini_web'];

const rowOf = (key: string, name: string, prompts: number, k = 4, n = 8): TopicSummaryRow =>
  topicRow(key, name, prompts, [
    engine('chatgpt_web', { mentioned: weighted(k, n, prompts) }),
    engine('gemini_web', { mentioned: weighted(k, n, prompts) }),
  ]);
const SUMMARY = {
  topics: [
    rowOf('compliance', 'Compliance', 11),
    rowOf('rbi', 'RBI', 6),
    rowOf('sebi', 'SEBI', 5),
    rowOf('pricing', 'Pricing', 6, 1, 3),
    rowOf('cloud', 'Cloud', 2),
  ],
  prompts: [],
};

const names = (key: string): string[] | undefined =>
  otherGroups(key, SUMMARY, TREE, DESCENDANTS, CODES)?.map((group) => group.name);

describe('otherGroups: the groups beside a group, there being no parent', () => {
  it('lists the other groups of the scope, most prompts first and a tie by name, never the parent or the group itself', () => {
    expect(names('rbi')).toEqual(['Pricing', 'SEBI', 'Cloud']);
    expect(names('pricing')).toEqual(['RBI', 'SEBI', 'Cloud']);
  });

  it('gives each its prompts and its mention rate with the platforms that took part', () => {
    const [pricing] = otherGroups('rbi', SUMMARY, TREE, DESCENDANTS, CODES) ?? [];
    expect(pricing?.promptCount).toBe(6);
    expect(pricing?.mention.state).toBe('insufficient');
    const [, sebi] = otherGroups('rbi', SUMMARY, TREE, DESCENDANTS, CODES) ?? [];
    expect(sebi?.mention.state).toBe('ok');
    expect(sebi?.counting.map((entry) => entry.code)).toEqual(CODES);
  });

  it('lists five at most', () => {
    const many = Array.from({ length: 8 }, (_, at) => rowOf(`g${at}`, `Group ${at}`, 3));
    const tree = many.map((row) => term(row.term_id ?? '', row.name ?? ''));
    const found = otherGroups('none', { topics: many, prompts: [] }, tree, topicDescendants(tree, []), CODES);
    expect(found).toHaveLength(MAX_RELATED);
  });

  it('is null while the summary is not read, and empty when no other group is in scope', () => {
    expect(otherGroups('rbi', undefined, TREE, DESCENDANTS, CODES)).toBeNull();
    const alone = { topics: [rowOf('cloud', 'Cloud', 2)], prompts: [] };
    expect(otherGroups('cloud', alone, TREE, DESCENDANTS, CODES)).toEqual([]);
  });
});
