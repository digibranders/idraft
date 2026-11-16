import { describe, expect, it } from 'vitest';

import { orderDistribution } from './order-distribution';
import type { FactsRow, PositionCounts } from './types';
import type { EngineSummaryWithFacts } from './types';

function row(code: string, position: PositionCounts | null | undefined): FactsRow {
  const engine = { engine_code: code, ...(position === undefined ? {} : { position }) } as EngineSummaryWithFacts;
  return { engines: [engine] };
}

describe('orderDistribution', () => {
  it('is not collected when the counts carry no order counts, and never derives shares from the mean', () => {
    const reading = orderDistribution(
      [row('chatgpt_web', { rank_sum: 12, ordered_answers: 8, mentions: 9, answers: 20 })],
      'chatgpt_web',
    );
    expect(reading).toMatchObject({ state: 'not_collected', shares: null, mean: null });
  });

  it('is not collected when the backend sends no position at all', () => {
    expect(orderDistribution([row('chatgpt_web', undefined)], 'chatgpt_web').state).toBe('not_collected');
    expect(orderDistribution([], 'chatgpt_web').state).toBe('not_collected');
  });

  it('says too few under 4 ordered answers', () => {
    const reading = orderDistribution(
      [row('gemini_web', { rank_sum: 6, ordered_answers: 3, mentions: 3, answers: 10, by_order: [1, 1, 1, 0] })],
      'gemini_web',
    );
    expect(reading).toMatchObject({ state: 'too_few', shares: null, ordered: 3 });
  });

  it('turns the order counts of the rows added up into four shares and the mean of the same answers', () => {
    const reading = orderDistribution(
      [
        row('chatgpt_web', { rank_sum: 7, ordered_answers: 4, mentions: 5, answers: 12, by_order: [2, 1, 1, 0] }),
        row('chatgpt_web', { rank_sum: 9, ordered_answers: 4, mentions: 4, answers: 8, by_order: [1, 1, 1, 1] }),
        row('gemini_web', { rank_sum: 99, ordered_answers: 99, mentions: 99, answers: 99, by_order: [99, 0, 0, 0] }),
      ],
      'chatgpt_web',
    );
    if (reading.state !== 'ok') throw new Error('expected an ok reading');
    expect(reading.counts).toEqual([3, 2, 2, 1]);
    expect(reading.ordered).toBe(8);
    expect(reading.shares).toEqual([3 / 8, 2 / 8, 2 / 8, 1 / 8]);
    expect(reading.mean).toBe(16 / 8);
  });
});
