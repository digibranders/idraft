import { describe, expect, it } from 'vitest';

import { namedAnswers, orderDistribution } from './order-distribution';
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
      [
        row('gemini_web', {
          rank_sum: 6,
          ordered_answers: 3,
          mentions: 3,
          answers: 10,
          by_order: { counts: [1, 1, 1, 0], rank_sum: 6 },
        }),
      ],
      'gemini_web',
    );
    expect(reading).toMatchObject({ state: 'too_few', shares: null, ordered: 3 });
  });

  it('turns the order counts of the rows added up into four shares and the mean of the same answers', () => {
    const reading = orderDistribution(
      [
        row('chatgpt_web', {
          rank_sum: 7,
          ordered_answers: 4,
          mentions: 5,
          answers: 12,
          by_order: { counts: [2, 1, 1, 0], rank_sum: 7 },
        }),
        row('chatgpt_web', {
          rank_sum: 9,
          ordered_answers: 4,
          mentions: 4,
          answers: 8,
          by_order: { counts: [1, 1, 1, 1], rank_sum: 9 },
        }),
        row('gemini_web', {
          rank_sum: 99,
          ordered_answers: 99,
          mentions: 99,
          answers: 99,
          by_order: { counts: [99, 0, 0, 0], rank_sum: 99 },
        }),
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

describe('namedAnswers', () => {
  it('adds the answers that name the brand over the rows of one platform', () => {
    const rows = [
      row('chatgpt_web', { rank_sum: 1, ordered_answers: 1, mentions: 5, answers: 9 }),
      row('chatgpt_web', { rank_sum: 1, ordered_answers: 1, mentions: 2, answers: 9 }),
      row('gemini_web', { rank_sum: 1, ordered_answers: 1, mentions: 40, answers: 90 }),
      row('chatgpt_web', undefined),
    ];
    expect(namedAnswers(rows, 'chatgpt_web')).toBe(7);
    expect(namedAnswers(rows, 'google_ai_mode')).toBe(0);
  });
});
