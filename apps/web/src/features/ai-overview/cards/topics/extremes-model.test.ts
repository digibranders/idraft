import { describe, expect, it } from 'vitest';

import { MIN_GROUPS_TO_RANK, extremesExportRow, extremesFileName, extremesOf } from './extremes-model';
import { groupRows } from './group-rows';
import { engineCells, topicRow } from './topic-card-test-kit';
import { buildTopicNodes, topicDescendants } from './topic-nodes';
import type { TopicSummaryRow } from '@/lib/api/types';

/** A group with a mention rate of `k` in 10 answers on ChatGPT, and as many prompts as `prompts`. */
const group = (id: string, k: number, prompts = 5): TopicSummaryRow =>
  topicRow(id, id.toUpperCase(), prompts, [engineCells('chatgpt_web', { mentioned: [k, 10], prompts })]);

function rowsOf(topics: TopicSummaryRow[]) {
  const nodes = buildTopicNodes({
    topics,
    prompts: [],
    tree: [],
    descendants: topicDescendants(
      [],
      topics.flatMap((topic) => (topic.term_id === null ? [] : [topic.term_id])),
    ),
    kept: null,
    noTopicName: '',
  });
  return groupRows(nodes, ['chatgpt_web'], 'mention');
}

const rates = (list: { value: number }[]): number[] => list.map((entry) => Math.round(entry.value * 10));

describe('extremesOf', () => {
  it('needs at least 4 groups with a rate', () => {
    const result = extremesOf(rowsOf([group('a', 9), group('b', 5), group('c', 2)]));
    expect(MIN_GROUPS_TO_RANK).toBe(4);
    expect(result.enough).toBe(false);
    expect(result.strongest).toEqual([]);
    expect(result.weakest).toEqual([]);
  });

  it('takes at most half of the groups, so no group is on both sides, strongest high to low and weakest low to high', () => {
    const result = extremesOf(rowsOf(['a', 'b', 'c', 'd', 'e'].map((id, place) => group(id, 9 - place * 2))));
    expect(result.enough).toBe(true);
    expect(rates(result.strongest)).toEqual([9, 7]);
    expect(rates(result.weakest)).toEqual([1, 3]);
    const names = [...result.strongest, ...result.weakest].map((entry) => entry.row.node.key);
    expect(new Set(names).size).toBe(names.length);
  });

  it('shows 3 a side from 6 groups and 5 a side from 12', () => {
    const six = extremesOf(rowsOf(Array.from({ length: 6 }, (_, place) => group(`g${String(place)}`, place))));
    expect(six.strongest).toHaveLength(3);
    const twelve = extremesOf(rowsOf(Array.from({ length: 12 }, (_, place) => group(`g${String(place)}`, place % 10))));
    expect(twelve.strongest).toHaveLength(5);
    expect(twelve.weakest).toHaveLength(5);
  });

  it('breaks a tie by prompts, then by name, and leaves a group with no rate out of the ranking and last in the table', () => {
    const topics = [
      group('a', 5, 2),
      group('b', 5, 9),
      group('c', 1),
      group('d', 8),
      topicRow('z', 'Z', 3, [engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 3 })]),
    ];
    const result = extremesOf(rowsOf(topics));
    expect(result.rated).toBe(4);
    expect(result.strongest.map((entry) => entry.row.node.name)).toEqual(['D', 'B']);
    expect(result.all.at(-1)?.node.name).toBe('Z');
  });

  it('writes an unknown rate as an empty cell with its state, never 0', () => {
    const [unknown] = rowsOf([topicRow('z', 'Z', 3, [engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 3 })])]);
    expect(unknown && extremesExportRow(unknown)).toEqual(['Z', 3, null, 0, 'none']);
    const [known] = rowsOf([group('a', 6)]);
    expect(known && extremesExportRow(known)).toEqual(['A', 5, 60, 1, 'ok']);
  });

  it('names the file by the measure', () => {
    expect(extremesFileName('visibility')).toBe('strongest-weakest-groups-visibility');
  });
});
