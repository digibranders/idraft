/**
 * Tests for the statistics the interface shows beside AI rates (docs/17-statistical-methodology.md):
 * Wilson intervals (section 3), the detectable change rule (section 6) and panel sizing (section 7.2).
 * Reference values are the ones published in that document.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_OBSERVATIONS,
  detectableChange,
  differenceInterval,
  equalWeightAverage,
  isDetectableChange,
  pooledCounts,
  promptWeightedRate,
  rateOf,
  rateState,
  requiredPrompts,
  wilsonInterval,
} from './index';

describe('wilsonInterval', () => {
  it('matches the published table for an observed rate of 50% (17 section 3.3)', () => {
    const table: Array<[number, number, number, number]> = [
      [5, 10, 0.24, 0.76],
      [10, 20, 0.3, 0.7],
      [15, 30, 0.33, 0.67],
      [50, 100, 0.4, 0.6],
      [500, 1000, 0.47, 0.53],
    ];
    for (const [k, n, low, high] of table) {
      const interval = wilsonInterval(k, n);
      expect(interval?.low).toBeCloseTo(low, 2);
      expect(interval?.high).toBeCloseTo(high, 2);
    }
  });

  it('stays inside 0 to 1 at the extremes, where the Wald interval does not', () => {
    expect(wilsonInterval(1, 1)?.low).toBeCloseTo(0.21, 2);
    expect(wilsonInterval(1, 1)?.high).toBe(1);
    expect(wilsonInterval(0, 5)?.low).toBe(0);
    expect(wilsonInterval(0, 5)?.high).toBeCloseTo(0.43, 2);
  });

  it('has no interval without observations or with impossible counts', () => {
    for (const [k, n] of [[0, 0], [3, 2], [-1, 4], [1.5, 4], [Number.NaN, 4]] as const) expect(wilsonInterval(k, n)).toBeNull();
  });
});

describe('rates', () => {
  it('tells a usable rate from an insufficient one and from no data', () => {
    expect(MIN_OBSERVATIONS).toBe(4);
    expect(rateState(0)).toBe('none');
    expect(rateState(3)).toBe('insufficient');
    expect(rateState(4)).toBe('ok');
    expect(rateOf({ k: 3, n: 3 })).toBeNull();
    expect(rateOf({ k: 8, n: 12 })).toBeCloseTo(0.667, 3);
    // Counts that cannot be real give no rate, as they give no interval
    expect(rateState(Number.NaN)).toBe('none');
    expect(rateOf({ k: 5, n: 4 })).toBeNull();
    expect(rateOf({ k: -1, n: 4 })).toBeNull();
    expect(promptWeightedRate([{ k: 5, n: 4 }, { k: 2, n: 4 }])).toBe(0.5);
  });

  it('pools counts, and weights prompts equally whatever their replicate count (17 section 4.1)', () => {
    const items = [{ k: 12, n: 12 }, { k: 0, n: 4 }, { k: 0, n: 0 }];
    expect(pooledCounts(items)).toEqual({ k: 12, n: 16 });
    // Pooled this is 75%; each prompt counting once it is (100% + 0%) / 2
    expect(promptWeightedRate(items)).toBe(0.5);
    expect(promptWeightedRate([{ k: 0, n: 0 }])).toBeNull();
  });

  it('averages engines with equal weight and says how many took part', () => {
    expect(equalWeightAverage([0.5, null, 0.7])).toEqual({ value: 0.6, used: 2 });
    expect(equalWeightAverage([null, null])).toEqual({ value: null, used: 0 });
  });
});

describe('detectable change (17 section 6)', () => {
  it('builds the Newcombe interval of a difference from the two Wilson intervals', () => {
    // Exact bounds: a symmetric (Wald) interval around the same difference gives other numbers
    const large = differenceInterval({ k: 398, n: 980 }, { k: 457, n: 980 });
    expect(large?.low).toBeCloseTo(-0.1038, 4);
    expect(large?.high).toBeCloseTo(-0.0163, 4);
    // Small samples are where the two methods part: this interval is not symmetric around 0.5
    const small = differenceInterval({ k: 4, n: 4 }, { k: 2, n: 4 });
    expect(small?.low).toBeCloseTo(-0.102, 3);
    expect(small?.high).toBeCloseTo(0.85, 3);
  });

  it('is detectable only when that interval excludes zero', () => {
    expect(isDetectableChange({ k: 398, n: 980 }, { k: 457, n: 980 })).toBe(true); // 6 points on 980
    expect(isDetectableChange({ k: 612, n: 1800 }, { k: 574, n: 1800 })).toBe(false); // 2 points on 1,800
    expect(isDetectableChange({ k: 8, n: 12 }, { k: 5, n: 12 })).toBe(false); // 25 points on 12: one prompt
    expect(isDetectableChange({ k: 12, n: 12 }, { k: 1, n: 12 })).toBe(true);
    // 4 of 4 against 2 of 4: the textbook interval would call this detectable, the score interval does not
    expect(isDetectableChange({ k: 4, n: 4 }, { k: 2, n: 4 })).toBe(false);
  });

  it('cannot be judged when either period is insufficient', () => {
    expect(isDetectableChange({ k: 3, n: 3 }, { k: 0, n: 12 })).toBeNull();
    expect(isDetectableChange({ k: 3, n: 12 }, { k: 0, n: 0 })).toBeNull();
  });
});

describe('panel sizing (17 section 7.2)', () => {
  it('reproduces the worked example: 25% of prompts flip, 5 points to detect', () => {
    expect(requiredPrompts(0.25, 0.05)).toBeCloseTo(782.5, 0);
  });

  it('inverts it: the change a panel of a given size can detect', () => {
    expect(detectableChange(200, 0.25)).toBeCloseTo(0.0985, 4);
    expect(detectableChange(783, 0.25)).toBeCloseTo(0.05, 3);
    expect(detectableChange(1000, 0.25)).toBeLessThan(0.05);
  });

  it('has no answer for an empty panel or a flip rate outside 0 to 1', () => {
    expect(detectableChange(0, 0.25)).toBeNull();
    expect(detectableChange(200, 0)).toBeNull();
    expect(detectableChange(200, 1.2)).toBeNull();
    expect(requiredPrompts(0.25, 0)).toBeNull();
    expect(requiredPrompts(0.04, 0.3)).toBeNull(); // a net change cannot exceed what the flipping prompts allow
  });
});
