import { describe, expect, it } from 'vitest';

import { engineValue } from './engine-values';
import type { TopicNode } from './model-types';
import { exportCells, orderRows, topicEngineRows } from './topic-rows';
import { NO_TOPIC } from './topic-nodes';
import { engine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';

const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** A topic node whose engines have the given `[k, n]` of valid answers (null: the engine has no cells). */
function nodeOf(
  name: string,
  promptCount: number,
  counts: readonly ([number, number] | null)[],
  over: Partial<TopicNode> = {},
): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount,
    engines: counts.flatMap((count, place) =>
      count === null ? [] : [engine(CODES[place] ?? 'x', { mentioned: weighted(count[0], count[1], promptCount) })],
    ),
    members: null,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

describe('topicEngineRows', () => {
  it('one value per asked engine in the fixed order', () => {
    // The node lists Gemini before ChatGPT; the row follows the codes asked
    const node = nodeOf('A', 4, [], {
      engines: [
        engine('gemini_web', { mentioned: weighted(4, 10, 4) }),
        engine('chatgpt_web', { mentioned: weighted(6, 10, 4) }),
      ],
    });
    const [row] = topicEngineRows([node], CODES, 'mentioned');
    expect(row?.values.map((value) => value.code)).toEqual([...CODES]);
    expect(row?.values.map((value) => value.value)).toEqual([0.6, 0.4, null]);
    expect(row?.values[2]?.state).toBe('none');
    expect(row?.node).toBe(node);
  });

  it('only the asked engines get a value', () => {
    const [row] = topicEngineRows(
      [
        nodeOf('A', 4, [
          [6, 10],
          [4, 10],
          [2, 10],
        ]),
      ],
      ['gemini_web'],
      'mentioned',
    );
    expect(row?.values.map((value) => value.code)).toEqual(['gemini_web']);
  });

  it('the average is the equal weight of engines with a rate and says how many', () => {
    // 0.8 and 0.4 have a rate; 1 of 2 answers is too few and takes no part, and is not counted as 0
    const [row] = topicEngineRows(
      [
        nodeOf('A', 4, [
          [8, 10],
          [4, 10],
          [1, 2],
        ]),
      ],
      CODES,
      'mentioned',
    );
    expect(row?.average.engines).toBe(2);
    expect(row?.average.value).toBeCloseTo(0.6, 12);
    const [one] = topicEngineRows([nodeOf('B', 4, [[8, 10], null, [1, 2]])], CODES, 'mentioned');
    expect(one?.average.engines).toBe(1);
    expect(one?.average.value).toBeCloseTo(0.8, 12);
  });

  it('the gap is null under two engines with a rate', () => {
    const [one] = topicEngineRows([nodeOf('A', 4, [[8, 10], null, [1, 2]])], CODES, 'mentioned');
    expect(one?.gap).toBeNull();
    expect(one?.spread).toBeNull();
    const [two] = topicEngineRows(
      [
        nodeOf('B', 4, [
          [8, 10],
          [4, 10],
        ]),
      ],
      CODES,
      'mentioned',
    );
    expect(two?.gap).toBeCloseTo(40, 10);
    expect(two?.spread?.best?.code).toBe('chatgpt_web');
  });
});

describe('orderRows', () => {
  // r1: two engines, 30 and 10 percent, a gap of 20 points; r2: one engine at 60 percent, so no gap;
  // r3: one engine at 90 percent and one with too few answers, so no gap either
  const r1 = nodeOf('r1', 5, [
    [3, 10],
    [1, 10],
  ]);
  const r2 = nodeOf('r2', 9, [[6, 10]]);
  const r3 = nodeOf('r3', 7, [], {
    engines: [
      engine('chatgpt_web', { mentioned: weighted(9, 10, 7) }),
      engine('gemini_web', { mentioned: weighted(1, 2, 7) }),
    ],
  });
  const rows = topicEngineRows([r1, r2, r3], CODES, 'mentioned');
  const names = (ordered: readonly { node: TopicNode }[]): string[] => ordered.map((row) => row.node.name);

  it('orders by prompts, by rate and by gap, rows without a value last', () => {
    expect(names(orderRows(rows, 'prompts', false))).toEqual(['r2', 'r3', 'r1']);
    // r1 averages 0.2, r2 0.6, r3 0.9 (its second engine has too few answers)
    expect(names(orderRows(rows, 'rate', false))).toEqual(['r3', 'r2', 'r1']);
    // Only r1 has two engines with a rate; r2 and r3 have no gap and come last, by name
    expect(names(orderRows(rows, 'gap', false))).toEqual(['r1', 'r2', 'r3']);
  });

  it('the no topic row is last whatever the order', () => {
    const none = nodeOf(
      'Prompts without a topic',
      99,
      [
        [9, 10],
        [9, 10],
      ],
      { key: NO_TOPIC, termId: null },
    );
    const all = topicEngineRows([none, r1, r2, r3], CODES, 'mentioned');
    for (const order of ['prompts', 'rate', 'gap'] as const) {
      expect(orderRows(all, order, false).at(-1)?.node.key).toBe(NO_TOPIC);
    }
  });

  it('a tie goes to the name', () => {
    const a = nodeOf('Alpha', 5, [[5, 10]]);
    const b = nodeOf('Beta', 5, [[5, 10]]);
    const tied = topicEngineRows([b, a], CODES, 'mentioned');
    expect(names(orderRows(tied, 'prompts', false))).toEqual(['Alpha', 'Beta']);
    expect(names(orderRows(tied, 'rate', false))).toEqual(['Alpha', 'Beta']);
  });

  it('topLevelOnly leaves out the rows below a top level topic', () => {
    const child = nodeOf('child', 50, [[5, 10]], { level: 2, parentKey: 'r1' });
    const mixed = topicEngineRows([child, r1], CODES, 'mentioned');
    expect(names(orderRows(mixed, 'prompts', true))).toEqual(['r1']);
    expect(names(orderRows(mixed, 'prompts', false))).toEqual(['child', 'r1']);
  });

  it('does not change the rows it is given', () => {
    const before = names(rows);
    orderRows(rows, 'rate', false);
    expect(names(rows)).toEqual(before);
  });
});

describe('exportCells', () => {
  const valueOf = (cells: Parameters<typeof engineValue>[0]): ReturnType<typeof engineValue> =>
    engineValue(cells, 'chatgpt_web', 'mentioned');

  it('writes a known rate as a percent number with its answers and status ok', () => {
    const value = valueOf([engine('chatgpt_web', { mentioned: weighted(6, 10, 4) })]);
    expect(exportCells(value)).toEqual([60, 10, 'ok']);
  });

  it('an unknown rate is an empty cell and the status says why, never 0', () => {
    expect(exportCells(valueOf([]))).toEqual([null, 0, 'no_answers']);
    expect(exportCells(valueOf([engine('chatgpt_web', { mentioned: weighted(1, 3, 2) })]))).toEqual([
      null,
      3,
      'insufficient',
    ]);
    const noValid = valueOf([engine('chatgpt_web', { mentioned: { ...weighted(0, 0, 0), n_observations: 5 } })]);
    expect(exportCells(noValid)).toEqual([null, 0, 'no_valid_answers']);
  });
});
