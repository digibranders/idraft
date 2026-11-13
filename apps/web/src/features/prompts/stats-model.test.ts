import { describe, expect, it } from 'vitest';

import { statisticsContent, statsRow } from './stats-model';
import type { MetricCell } from '@/lib/api/types';
import { MIN_OBSERVATIONS, wilsonInterval } from '@/lib/stats';

const cell = (k: number, n: number, observations = n): MetricCell => ({
  numerator: k,
  denominator: n,
  n_observations: observations,
  value: n === 0 ? null : k / n,
});

describe('the statistics of one rate of one engine', () => {
  it('has the estimate, the 95 percent Wilson interval and the sample for enough valid answers', () => {
    expect(statsRow(cell(5, 8))).toEqual({
      state: 'ok',
      k: 5,
      n: 8,
      value: 5 / 8,
      interval: wilsonInterval(5, 8),
    });
  });

  it('keeps a rate of 0 or 100 percent with its interval, which does not collapse to a point', () => {
    const none = statsRow(cell(0, 8));
    expect(none.state).toBe('ok');
    expect(none.value).toBe(0);
    expect(none.interval?.low).toBe(0);
    expect(none.interval?.high).toBeGreaterThan(0);
    expect(statsRow(cell(8, 8)).interval?.high).toBe(1);
  });

  it('shows the sample and no interval below the minimum of valid answers', () => {
    const row = statsRow(cell(2, MIN_OBSERVATIONS - 1));
    expect(row).toEqual({ state: 'insufficient', k: 2, n: MIN_OBSERVATIONS - 1, value: null, interval: null });
  });

  it('is there, and says so, for answers that are none of them valid', () => {
    expect(statsRow(cell(0, 0, 3))).toEqual({ state: 'none', k: 0, n: 0, value: null, interval: null });
  });

  it('is there, and says so, for an engine with no cell at all or counts that cannot be real', () => {
    expect(statsRow(undefined).state).toBe('none');
    expect(statsRow(cell(9, 5)).state).toBe('none');
  });
});

describe('the content of the statistics panel for one rate of one engine', () => {
  const words = {
    metricName: 'Mention rate',
    engine: { code: 'gemini_web', name: 'Gemini' },
    scopeText: 'Sep 1 to Sep 28, 2026',
    definition: 'The share of valid answers that name your brand.',
    methodText: 'The interval is the 95 percent Wilson interval over the valid answers of this window.',
  };

  it('builds the statistics panel content of one rate of one engine', () => {
    const content = statisticsContent(statsRow(cell(5, 8)), words);
    const interval = wilsonInterval(5, 8);
    expect(content).toEqual({
      metricName: 'Mention rate',
      engine: { code: 'gemini_web', name: 'Gemini' },
      scopeText: 'Sep 1 to Sep 28, 2026',
      definition: words.definition,
      estimate: {
        value: 5 / 8,
        numerator: 5,
        denominator: 8,
        noun: 'answers',
        prompts: 1,
        observationWeighted: null,
        insufficient: null,
      },
      interval: { low: interval?.low, high: interval?.high, methodText: words.methodText },
      comparison: null,
      boundaries: [],
    });
  });

  it('says insufficient, with the valid answers and the minimum, and has no interval below the minimum', () => {
    const content = statisticsContent(statsRow(cell(2, MIN_OBSERVATIONS - 1)), words);
    expect(content.estimate.insufficient).toEqual({ valid: MIN_OBSERVATIONS - 1, required: MIN_OBSERVATIONS });
    expect(content.estimate.value).toBeNull();
    expect(content.estimate.numerator).toBe(2);
    expect(content.estimate.denominator).toBe(MIN_OBSERVATIONS - 1);
    expect(content.interval).toBeNull();
  });

  it('never says 0 of 0 for a rate with no valid answer', () => {
    const { estimate, interval } = statisticsContent(statsRow(undefined), words);
    expect(estimate).toMatchObject({ value: null, numerator: null, denominator: null, insufficient: null });
    expect(interval).toBeNull();
  });
});
