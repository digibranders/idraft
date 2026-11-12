import { describe, expect, it } from 'vitest';

import { statsRow } from './stats-model';
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
