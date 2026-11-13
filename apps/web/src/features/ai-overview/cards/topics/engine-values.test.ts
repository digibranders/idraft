import { describe, expect, it } from 'vitest';

import {
  SAME_RATE,
  bestEngine,
  bestWorst,
  compareEngines,
  engineGapOf,
  engineValue,
  type EngineValue,
} from './engine-values';
import { cell, engine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';

const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** Values of one metric for the engines in order, each `[k, n]` of valid answers. */
const valuesOf = (...counts: ([number, number] | null)[]): EngineValue[] =>
  counts.map((count, place) =>
    engineValue(
      count === null ? [] : [engine(CODES[place] ?? 'x', { mentioned: weighted(count[0], count[1], 3) })],
      CODES[place] ?? 'x',
      'mentioned',
    ),
  );

describe('engineValue', () => {
  it('an unknown rate is null and never 0', () => {
    const [absent] = valuesOf(null);
    expect(absent).toMatchObject({ state: 'none', value: null, answers: 0, successes: null, reason: 'noAnswers' });
    const noCell = engineValue([engine('chatgpt_web')], 'chatgpt_web', 'mentioned');
    expect(noCell.value).toBeNull();
    expect(noCell.state).toBe('none');
  });

  it('under 4 valid answers is insufficient with no value', () => {
    const [thin] = valuesOf([2, 3]);
    expect(thin).toMatchObject({ state: 'insufficient', value: null, answers: 3, successes: 2 });
  });

  it('no valid answer is none with its reason', () => {
    const cells = [engine('chatgpt_web', { mentioned: cell(0, 0, 5) })];
    expect(engineValue(cells, 'chatgpt_web', 'mentioned')).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noneValid',
      observations: 5,
    });
  });

  it('a rate with enough answers has its value, its counts and the prompts it weights', () => {
    const [ok] = valuesOf([6, 10]);
    expect(ok).toMatchObject({ state: 'ok', value: 0.6, answers: 10, successes: 6, prompts: 3, reason: null });
  });

  it('share of voice counts the answers that name a brand', () => {
    const cells = [
      engine('chatgpt_web', {
        mentioned: weighted(5, 10, 3),
        // 3.5 shares over 6 answers that name a brand, out of 10 valid answers
        share_of_voice: { value: 3.5 / 6, numerator: 3.5, denominator: 6, n_observations: 10, pooled: null },
      }),
    ];
    const value = engineValue(cells, 'chatgpt_web', 'share_of_voice');
    expect(value).toMatchObject({ state: 'ok', answers: 6, successes: null, prompts: 3 });
    expect(value.value).toBeCloseTo(3.5 / 6, 12);
  });
});

describe('bestEngine, bestWorst and engineGapOf', () => {
  it('bestWorst needs two engines with a rate', () => {
    expect(bestWorst(valuesOf([6, 10]))).toBeNull();
    expect(bestWorst(valuesOf([6, 10], [2, 3]))).toBeNull();
    expect(bestWorst(valuesOf([6, 10], null, [2, 10]))).toMatchObject({ counted: 2, leftOut: ['gemini_web'] });
    expect(engineGapOf(valuesOf([6, 10]))).toBeNull();
  });

  it('a best rate of 0 has no best engine', () => {
    const values = valuesOf([0, 10], [0, 10]);
    expect(bestWorst(values)?.best).toBeNull();
    expect(bestEngine(values)).toBeNull();
    expect(bestEngine(valuesOf([0, 10], [3, 10]))?.code).toBe('gemini_web');
  });

  it('a tie goes to the engine shown first', () => {
    const tie = bestWorst(valuesOf([5, 10], [5, 10], [2, 10]));
    expect(tie?.best?.code).toBe('chatgpt_web');
    expect(tie?.worst.code).toBe('google_ai_mode');
    const allEqual = bestWorst(valuesOf([5, 10], [5, 10]));
    expect(allEqual?.best?.code).toBe('chatgpt_web');
    expect(allEqual?.worst.code).toBe('chatgpt_web');
    expect(allEqual?.spread).toBeLessThanOrEqual(SAME_RATE * 100);
  });

  it('spread is exact, not the difference of two rounded percents', () => {
    // 45.6 percent and 12.3 percent show as 46 and 12, a difference of 34; the exact gap is 33.3
    const result = bestWorst(valuesOf([456, 1000], [123, 1000]));
    expect(result?.spread).toBeCloseTo(33.3, 10);
    expect(engineGapOf(valuesOf([456, 1000], [123, 1000]))).toBeCloseTo(33.3, 10);
  });
});

describe('compareEngines', () => {
  it('says within, detectable or too few from counts only', () => {
    const detectable = compareEngines(valuesOf([90, 100], [10, 100]), 'mentioned');
    expect(detectable).toMatchObject({ kind: 'gap', test: 'detectable' });
    const within = compareEngines(valuesOf([52, 100], [48, 100]), 'mentioned');
    expect(within).toMatchObject({ kind: 'gap', test: 'within' });
    // A third engine with too few answers makes the row too thin to claim a difference in words
    const tooFew = compareEngines(valuesOf([90, 100], [10, 100], [1, 2]), 'mentioned');
    expect(tooFew).toMatchObject({ kind: 'gap', test: 'too-few', leftOut: ['google_ai_mode'] });
    expect(compareEngines(valuesOf([90, 100], [10, 100]), 'share_of_voice')).toMatchObject({
      kind: 'gap',
      test: 'share',
    });
  });

  it('says none under two engines with a rate, zero when the best is 0 and equal when they are the same', () => {
    expect(compareEngines(valuesOf([6, 10]), 'mentioned')).toMatchObject({ kind: 'none' });
    expect(compareEngines(valuesOf([0, 10], [0, 10]), 'mentioned')).toMatchObject({ kind: 'zero' });
    expect(compareEngines(valuesOf([5, 10], [5, 10]), 'mentioned')).toMatchObject({ kind: 'equal', value: 0.5 });
  });
});
