import { describe, expect, it } from 'vitest';

import { cell, engine, weighted } from './cells-fixtures';
import { compareEngines } from './comparison';
import { engineValue, type EngineValue } from './engine-values';
import type { MetricCell } from '@/lib/api/types';
import type { CellMetric } from '@/lib/rates/rate-model';

/** The engines `a`, `b`, `c` as values of `metric`; `null` is an engine the row has no answer on. */
const values = (metric: CellMetric, ...cells: (MetricCell | null)[]): EngineValue[] => {
  const codes = ['a', 'b', 'c'];
  const rows = cells.flatMap((entry, at) => (entry === null ? [] : [engine(codes[at] ?? 'z', { [metric]: entry })]));
  return codes.slice(0, cells.length).map((code) => engineValue(rows, code, metric));
};

/** Topic cells (prompt weighted, with the answers behind them) of `k` of `n` valid answers. */
const rate = (k: number, n: number): MetricCell => weighted(k, n, 3);

describe('compareEngines: the sentence about the gap between engines (WB-TPE-11)', () => {
  it('names best, weakest and the gap in points', () => {
    const result = compareEngines(values('mentioned', rate(6, 8), rate(2, 8), rate(4, 8)), 'mentioned');
    if (result.kind !== 'gap') throw new Error(`Expected a gap, got ${result.kind}`);
    expect(result.best.code).toBe('a');
    expect(result.worst.code).toBe('b');
    expect(result.points).toBeCloseTo(50, 10);
    expect(result.leftOut).toEqual([]);
  });

  it('says within normal variation when the unpaired interval holds 0', () => {
    // 5 of 10 against 4 of 10: a gap of 10 points that 10 answers each cannot tell from chance
    const result = compareEngines(values('mentioned', rate(5, 10), rate(4, 10)), 'mentioned');
    expect(result).toMatchObject({ kind: 'gap', test: 'within' });
  });

  it('says larger than normal variation when it excludes 0', () => {
    const result = compareEngines(values('mentioned', rate(90, 100), rate(50, 100)), 'mentioned');
    expect(result).toMatchObject({ kind: 'gap', test: 'detectable' });
  });

  it('gives no test for share of voice: its numerator is not a count of answers', () => {
    const result = compareEngines(values('share_of_voice', cell(9, 10), cell(2, 10)), 'share_of_voice');
    expect(result).toMatchObject({ kind: 'gap', test: 'share' });
    // The same counts as a mention rate are tested
    expect(compareEngines(values('mentioned', rate(9, 10), rate(2, 10)), 'mentioned')).toMatchObject({
      test: 'detectable',
    });
  });

  it('gives no test when an engine is thin', () => {
    const result = compareEngines(values('mentioned', rate(90, 100), rate(50, 100), rate(1, 3)), 'mentioned');
    expect(result).toMatchObject({ kind: 'gap', test: 'too-few', leftOut: ['c'] });
  });

  it('gives no test when the answers that count are not whole', () => {
    const odd = { ...rate(4, 8), pooled: { successes: 3.5, trials: 8 } };
    expect(compareEngines(values('mentioned', rate(90, 100), odd), 'mentioned')).toMatchObject({
      kind: 'gap',
      test: 'too-few',
    });
  });

  it('names the engines left out', () => {
    const result = compareEngines(values('mentioned', rate(6, 8), rate(2, 8), null), 'mentioned');
    expect(result).toMatchObject({ kind: 'gap', leftOut: ['c'] });
    const thin = compareEngines(values('mentioned', rate(6, 8), rate(1, 2), rate(2, 8)), 'mentioned');
    expect(thin.leftOut).toEqual(['b']);
  });

  it('says every engine is equal when the rates tie', () => {
    expect(compareEngines(values('mentioned', rate(4, 8), rate(2, 4), rate(8, 16)), 'mentioned')).toEqual({
      kind: 'equal',
      value: 0.5,
      leftOut: [],
    });
  });

  it('says nothing to compare under 2 engines', () => {
    expect(compareEngines(values('mentioned', rate(4, 8), null), 'mentioned')).toEqual({
      kind: 'none',
      leftOut: ['b'],
    });
    expect(compareEngines(values('mentioned', rate(4, 8), rate(1, 2)), 'mentioned')).toEqual({
      kind: 'none',
      leftOut: ['b'],
    });
    expect(compareEngines([], 'mentioned')).toEqual({ kind: 'none', leftOut: [] });
  });

  it('says no engine names the brand when the best is 0', () => {
    expect(compareEngines(values('mentioned', rate(0, 8), rate(0, 6)), 'mentioned')).toEqual({
      kind: 'zero',
      leftOut: [],
    });
  });
});
