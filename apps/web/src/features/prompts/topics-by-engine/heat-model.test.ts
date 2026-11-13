import { describe, expect, it } from 'vitest';

import { engine, head, weighted } from './cells-fixtures';
import { heatInput, heatOrder, heatOrderText, parseHeatOrder, showsAverage } from './heat-model';
import { NO_TOPIC } from '@/features/prompts/prompt-model';

const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

/** A topic with its mention rate on each engine, `[k, n]` or `null` for no cell; the prompt weights are the same. */
const topic = (key: string, name: string, promptCount: number, ...counts: ([number, number] | null)[]) =>
  head(key, name, {
    promptCount,
    engines: counts.flatMap((count, at) =>
      count === null ? [] : [engine(CODES[at] ?? 'other', { mentioned: weighted(count[0], count[1], 2) })],
    ),
  });

const keys = (heads: readonly { key: string }[]): string[] => heads.map((entry) => entry.key);

describe('heatOrder: the order of the rows of the heat map', () => {
  const heads = [
    topic('b', 'Beta', 5, [5, 8], [5, 8]),
    topic('a', 'Alpha', 5, [2, 8], [6, 8]),
    topic('big', 'Gamma', 9, [1, 8], [1, 8]),
    head(NO_TOPIC, 'No topic', { promptCount: 20, engines: [engine('chatgpt_web', { mentioned: weighted(8, 8, 2) })] }),
  ];

  it('orders by prompts, then by name, and puts No topic last', () => {
    expect(keys(heatOrder(heads, 'prompts', 'mentioned', CODES))).toEqual(['big', 'a', 'b', NO_TOPIC]);
  });

  it('orders by the average rate of the chosen metric, a topic without one last', () => {
    const none = topic('none', 'Delta', 7);
    expect(keys(heatOrder([...heads, none], 'avg_rate', 'mentioned', CODES))).toEqual([
      'b',
      'a',
      'big',
      'none',
      NO_TOPIC,
    ]);
  });

  it('puts a measured average of 0 before a topic with no average', () => {
    const zero = topic('zero', 'Zeta', 7, [0, 8], [0, 8]);
    const none = topic('none', 'Alpha none', 7);
    // A measured 0 percent is a rate and an unknown average is not one: a fallback to 0 would tie them and go by name
    expect(keys(heatOrder([none, zero], 'avg_rate', 'mentioned', CODES))).toEqual(['zero', 'none']);
    expect(heatInput(zero, 'mentioned', CODES).average.value).toBe(0);
    expect(heatInput(none, 'mentioned', CODES).average.value).toBeNull();
  });

  it('orders by the engine gap, a topic without one last', () => {
    // Alpha 25% to 75% is a gap of 50 points, Beta and Gamma have 0 points; Delta has one engine, so no gap
    const lone = topic('lone', 'Delta', 7, [4, 8]);
    expect(keys(heatOrder([...heads, lone], 'engine_gap', 'mentioned', CODES))).toEqual([
      'a',
      'b',
      'big',
      'lone',
      NO_TOPIC,
    ]);
  });

  it('orders the children inside their parent and leaves them under it', () => {
    const parent = {
      ...topic('p', 'Parent', 4, [1, 8], [1, 8]),
      children: [topic('c1', 'Child one', 1, [1, 8], [1, 8]), topic('c2', 'Child two', 3, [1, 8], [1, 8])],
    };
    const [ordered] = heatOrder([parent], 'prompts', 'mentioned', CODES);
    expect(keys(ordered?.children ?? [])).toEqual(['c2', 'c1']);
  });
});

describe('heatInput: the values of a row', () => {
  it('gives a value per engine, the average and the gap', () => {
    const input = heatInput(topic('a', 'Alpha', 5, [2, 8], [6, 8]), 'mentioned', CODES);
    expect(input.values.map((value) => [value.code, value.state, value.value])).toEqual([
      ['chatgpt_web', 'ok', 0.25],
      ['gemini_web', 'ok', 0.75],
      ['google_ai_mode', 'none', null],
    ]);
    expect(input.average.value).toBe(0.5);
    expect(input.gap).toBeCloseTo(50, 9);
  });

  it('counts only the engines with a rate in the average', () => {
    // 3 of 8 is a rate, 2 of 3 is too few answers, so the average is over one engine
    const input = heatInput(topic('a', 'Alpha', 5, [3, 8], [2, 3]), 'mentioned', CODES);
    expect(input.average.engines).toBe(1);
    expect(input.average.value).toBe(0.375);
    expect(input.gap).toBeNull();
  });

  it('never turns an unknown average into 0', () => {
    const input = heatInput(topic('a', 'Alpha', 5), 'mentioned', CODES);
    expect(input.average.value).toBeNull();
    expect(input.average.state).toBe('none');
  });
});

describe('the average column and the order in the address', () => {
  it('shows the average from 2 engines', () => {
    expect(showsAverage(0)).toBe(false);
    expect(showsAverage(1)).toBe(false);
    expect(showsAverage(2)).toBe(true);
  });

  it('reads the order from the sort of the address and writes it back', () => {
    expect(parseHeatOrder(null)).toBe('prompts');
    expect(parseHeatOrder('avg_rate')).toBe('avg_rate');
    expect(parseHeatOrder('-engine_gap')).toBe('engine_gap');
    // An id of the table's columns is not an order of the heat map
    expect(parseHeatOrder('-mention')).toBe('prompts');
    expect(heatOrderText('prompts')).toBeNull();
    expect(heatOrderText('avg_rate')).toBe('avg_rate');
    expect(heatOrderText('engine_gap')).toBe('-engine_gap');
  });
});
