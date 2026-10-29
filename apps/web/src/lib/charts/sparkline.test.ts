import { describe, expect, it } from 'vitest';

import { SPARK_HEIGHT, SPARK_WIDTH, sparklineGeometry, sparklineSummary } from './sparkline';

const ranked = (rank: number) => ({ rank, state: 'ranked' as const });
const beyond = { rank: null, state: 'beyond_depth' as const };

describe('sparkline geometry', () => {
  it('puts rank 1 at the top and rank 20 at the bottom, inside the padding', () => {
    const { segments } = sparklineGeometry([ranked(1), ranked(20)]);
    const [first, second] = segments[0] ?? [];
    expect(first).toEqual({ x: 2.5, y: 2.5 });
    expect(second).toEqual({ x: SPARK_WIDTH - 2.5, y: SPARK_HEIGHT - 2.5 });
  });

  it('keeps a deeper rank on the bottom edge', () => {
    const { segments } = sparklineGeometry([ranked(1), ranked(45)]);
    expect(segments[0]?.[1]?.y).toBe(SPARK_HEIGHT - 2.5);
  });

  it('breaks the line at a check beyond the depth', () => {
    const { segments } = sparklineGeometry([ranked(3), ranked(4), beyond, ranked(5)]);
    expect(segments.map((segment) => segment.length)).toEqual([2, 1]);
  });

  it('marks the last point only when the last check ranked', () => {
    expect(sparklineGeometry([ranked(3), ranked(4)]).last).not.toBeNull();
    expect(sparklineGeometry([ranked(3), beyond]).last).toBeNull();
  });

  it('centres a single point', () => {
    expect(sparklineGeometry([ranked(10)]).segments).toEqual([[{ x: SPARK_WIDTH / 2, y: expect.any(Number) }]]);
  });

  it('has nothing to draw without points', () => {
    expect(sparklineGeometry([])).toEqual({ segments: [], last: null });
  });
});

describe('sparkline summary', () => {
  it('says where the rank started and ended, the best, and how many checks were beyond the depth', () => {
    expect(sparklineSummary([ranked(9), beyond, ranked(3), ranked(4)])).toEqual({
      checks: 4,
      first: 9,
      last: 4,
      best: 3,
      beyond: 1,
    });
  });

  it('has no ranks when every check was beyond the depth', () => {
    expect(sparklineSummary([beyond, beyond])).toEqual({ checks: 2, first: null, last: null, best: null, beyond: 2 });
  });
});
