import { describe, expect, it } from 'vitest';

import { SENTIMENT_MIN, sentimentOf } from './sentiment';
import { engine, rowOf } from './test-helpers';
import type { SentimentCounts } from './types';

const tone = (positive: number, neutral: number, negative: number, mixed: number): SentimentCounts => ({
  positive,
  neutral,
  negative,
  mixed,
});
const SCOPE = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

describe('sentimentOf', () => {
  it('gives four shares that add up to 1, from the engines with enough classified mentions, equal weight', () => {
    // ChatGPT: 8 of 10 positive. Gemini: 2 of 10 positive. Pooled would also be 50%, so the next case tells them apart.
    const reading = sentimentOf(
      [
        rowOf(
          engine('chatgpt_web', { sentiment: tone(8, 1, 1, 0) }),
          engine('gemini_web', { sentiment: tone(2, 6, 1, 1) }),
        ),
      ],
      SCOPE,
    );
    expect(reading.state).toBe('ok');
    expect(reading.codes).toEqual(['chatgpt_web', 'gemini_web']);
    expect(reading.shares?.positive).toBeCloseTo(0.5);
    expect(reading.shares?.neutral).toBeCloseTo(0.35);
    const shares = Object.values(reading.shares ?? {});
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });

  it('weights engines equally, not by their mentions', () => {
    const reading = sentimentOf(
      [
        rowOf(
          engine('chatgpt_web', { sentiment: tone(100, 0, 0, 0) }),
          engine('gemini_web', { sentiment: tone(0, 4, 0, 0) }),
        ),
      ],
      SCOPE,
    );
    expect(reading.shares?.positive).toBeCloseTo(0.5);
  });

  it(`leaves an engine out below ${String(SENTIMENT_MIN)} classified mentions`, () => {
    const reading = sentimentOf(
      [
        rowOf(
          engine('chatgpt_web', { sentiment: tone(3, 0, 0, 0) }),
          engine('gemini_web', { sentiment: tone(0, 0, 5, 0) }),
        ),
      ],
      SCOPE,
    );
    expect(reading.codes).toEqual(['gemini_web']);
    expect(reading.shares?.negative).toBe(1);
  });

  it('adds the counts of the rows of an engine', () => {
    const rows = [
      rowOf(engine('chatgpt_web', { sentiment: tone(2, 0, 0, 0) })),
      rowOf(engine('chatgpt_web', { sentiment: tone(0, 2, 0, 0) })),
    ];
    expect(sentimentOf(rows, SCOPE)).toMatchObject({ state: 'ok', mentions: 4 });
    expect(sentimentOf(rows, SCOPE).shares?.positive).toBe(0.5);
  });

  it('names the states that are no number', () => {
    const answer = (...engines: ReturnType<typeof engine>[]): ReturnType<typeof sentimentOf> =>
      sentimentOf([rowOf(...engines)], SCOPE);
    // The backend sends nothing
    expect(answer(engine('chatgpt_web'))).toMatchObject({ state: 'not_collected', shares: null });
    // Only engines that do not classify (null)
    expect(answer(engine('google_ai_mode', { sentiment: null }))).toMatchObject({ state: 'none', shares: null });
    // Classified engines with no valid answer
    expect(answer(engine('chatgpt_web', { valid: 0, sentiment: tone(0, 0, 0, 0) }))).toMatchObject({
      state: 'unobserved',
    });
    // Too few classified mentions
    expect(answer(engine('chatgpt_web', { sentiment: tone(1, 1, 0, 0) }))).toMatchObject({
      state: 'insufficient',
      mentions: 2,
      answers: 10,
    });
  });

  it('is not collected when no row of the scope reports sentiment', () => {
    expect(sentimentOf([], SCOPE)).toMatchObject({ state: 'not_collected' });
  });
});
