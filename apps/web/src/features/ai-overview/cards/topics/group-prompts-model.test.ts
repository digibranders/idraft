import { describe, expect, it } from 'vitest';

import { MAX_GROUP_PROMPTS, groupPrompts } from './group-prompts-model';
import { engineCells, promptRow } from './topic-card-test-kit';

const outcomes = (k: number, n: number) =>
  ({ both: [k, n], named: [0, n], cited: [0, n], neither: [n - k, n] }) as const;

describe('groupPrompts', () => {
  it('lists the prompts with a rate by mention rate, highest first, each rate an average of the platforms with a rate', () => {
    const prompts = [
      promptRow(
        'low',
        'low prompt',
        [],
        [engineCells('chatgpt_web', { mentioned: [1, 10], cited: [0, 10], outcomes: outcomes(1, 10) })],
      ),
      promptRow(
        'high',
        'high prompt',
        [],
        [
          engineCells('chatgpt_web', { mentioned: [8, 10], cited: [4, 10], outcomes: outcomes(8, 10) }),
          engineCells('gemini_web', { mentioned: [10, 100], cited: [10, 100], outcomes: outcomes(10, 100) }),
        ],
      ),
    ];
    const { ranked, left } = groupPrompts(prompts, ['chatgpt_web', 'gemini_web']);
    expect(ranked.map((row) => row.prompt.prompt_id)).toEqual(['high', 'low']);
    // (0.8 + 0.1) / 2 and not 18 of 110
    expect(ranked[0]?.mention.value).toBeCloseTo(0.45);
    expect(ranked[0]?.mention.engines).toBe(2);
    expect(ranked[0]?.citation.value).toBeCloseTo(0.25);
    expect(ranked[0]?.visibility.value).toBeCloseTo(0.45);
    expect(left).toBe(0);
  });

  it('does not list a prompt with fewer than 4 valid answers on every platform, and counts it', () => {
    const prompts = [
      promptRow(
        'thin',
        'thin prompt',
        [],
        [engineCells('chatgpt_web', { mentioned: [2, 3] }), engineCells('gemini_web', { mentioned: [3, 3] })],
      ),
      promptRow('none', 'no answer', [], []),
    ];
    const { ranked, left } = groupPrompts(prompts, ['chatgpt_web', 'gemini_web']);
    expect(ranked).toEqual([]);
    expect(left).toBe(2);
  });

  it('shows up to 15 and ranks them all', () => {
    const prompts = Array.from({ length: 20 }, (_, place) =>
      promptRow(
        `p${String(place)}`,
        `prompt ${String(place).padStart(2, '0')}`,
        [],
        [engineCells('chatgpt_web', { mentioned: [place % 10, 10] })],
      ),
    );
    const { ranked, listed } = groupPrompts(prompts, ['chatgpt_web']);
    expect(MAX_GROUP_PROMPTS).toBe(15);
    expect(ranked).toHaveLength(20);
    expect(listed).toHaveLength(15);
  });

  it('reads only the platforms asked', () => {
    const prompts = [
      promptRow(
        'p',
        'prompt',
        [],
        [engineCells('chatgpt_web', { mentioned: [9, 10] }), engineCells('gemini_web', { mentioned: [1, 10] })],
      ),
    ];
    expect(groupPrompts(prompts, ['gemini_web']).ranked[0]?.mention.value).toBeCloseTo(0.1);
  });
});
