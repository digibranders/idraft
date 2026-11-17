import { describe, expect, it } from 'vitest';

import { positionOf, POSITION_MIN_LISTS } from './position';
import { engine, rowOf } from './test-helpers';
import type { PositionCounts } from './types';

const counts = (rank_sum: number, ordered_answers: number, mentions: number, answers: number): PositionCounts => ({
  rank_sum,
  ordered_answers,
  mentions,
  answers,
});

describe('positionOf', () => {
  it('is the mean rank of one engine: 1 is named first', () => {
    const reading = positionOf([rowOf(engine('chatgpt_web', { position: counts(9, 4, 6, 10) }))], ['chatgpt_web']);
    expect(reading).toMatchObject({
      state: 'ok',
      value: 2.25,
      used: 1,
      codes: ['chatgpt_web'],
      mentions: 6,
      ordered_answers: 4,
      answers: 10,
    });
  });

  it('averages the engines with equal weight, never one pooled mean', () => {
    // ChatGPT: 2 of 2 lists, mean 1. Gemini: 30 of 10 lists, mean 3. Pooled would be 32 / 12 = 2.67; equal weight is 2.
    const reading = positionOf(
      [
        rowOf(
          engine('chatgpt_web', { position: counts(2, 2, 2, 8) }),
          engine('gemini_web', { position: counts(30, 10, 10, 20) }),
        ),
      ],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(reading).toMatchObject({ state: 'ok', value: 2, used: 2, codes: ['chatgpt_web', 'gemini_web'] });
  });

  it('adds the counts of the rows of an engine before it takes the mean', () => {
    const rows = [
      rowOf(engine('chatgpt_web', { position: counts(1, 1, 1, 5) })),
      rowOf(engine('chatgpt_web', { position: counts(5, 1, 2, 5) })),
    ];
    expect(positionOf(rows, ['chatgpt_web'])).toMatchObject({ state: 'ok', value: 3, ordered_answers: 2, answers: 10 });
  });

  it(`leaves an engine out below ${String(POSITION_MIN_LISTS)} ordered answers and says which engines took part`, () => {
    const reading = positionOf(
      [
        rowOf(
          engine('chatgpt_web', { position: counts(1, 1, 3, 10) }),
          engine('gemini_web', { position: counts(6, 3, 5, 10) }),
        ),
      ],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(reading).toMatchObject({ state: 'ok', value: 2, used: 1, codes: ['gemini_web'] });
  });

  it('is unknown with a reason, never 0', () => {
    const one = (position: PositionCounts | null | undefined): ReturnType<typeof positionOf> =>
      positionOf([rowOf(engine('chatgpt_web', position === undefined ? {} : { position }))], ['chatgpt_web']);
    expect(one(undefined)).toMatchObject({ state: 'unknown', reason: 'not_collected' });
    expect(one(counts(0, 0, 0, 0))).toMatchObject({ state: 'unknown', reason: 'unobserved' });
    expect(one(counts(0, 0, 0, 3))).toMatchObject({ state: 'unknown', reason: 'too_few_answers' });
    expect(one(counts(0, 0, 0, 12))).toMatchObject({ state: 'unknown', reason: 'never_named' });
    expect(one(counts(1, 1, 4, 12))).toMatchObject({
      state: 'unknown',
      reason: 'too_few_lists',
      mentions: 4,
      ordered_answers: 1,
    });
    expect(one(null)).toMatchObject({ state: 'unknown', reason: 'not_collected' });
  });

  it('ignores engines outside the scope and rows that lack the engine', () => {
    const rows = [
      rowOf(engine('chatgpt_web', { position: counts(4, 2, 2, 6) })),
      rowOf(engine('gemini_web', { position: counts(30, 10, 10, 20) })),
    ];
    expect(positionOf(rows, ['chatgpt_web'])).toMatchObject({ state: 'ok', value: 2, answers: 6 });
  });
});
