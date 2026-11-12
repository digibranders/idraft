import { describe, expect, it } from 'vitest';

import {
  RATE_SPAN,
  SPARK_HEIGHT,
  SPARK_HEIGHT_COMPACT,
  SPARK_WIDTH,
  sparklineGeometry,
  sparklineSummary,
} from './sparkline';

describe('the sparkline sizes and the rate span', () => {
  it('has the compact height of the design system, and the rate span of 20 points', () => {
    expect(SPARK_HEIGHT_COMPACT).toBe(16);
    expect(RATE_SPAN).toBe(0.2);
  });
});

describe('sparklineGeometry on a fixed scale', () => {
  const scale = { low: 0, high: 100, invert: false };
  const ys = (values: readonly (number | null)[], fixed = scale): number[] =>
    (sparklineGeometry(values, SPARK_WIDTH, SPARK_HEIGHT, 0, fixed).segments[0] ?? []).map((point) => point.y);

  it('keeps two series of different ranges comparable: the same value is at the same height in both', () => {
    const [calm] = ys([25, 25, 25]);
    const [wide] = ys([25, 0, 100]);
    expect(calm).toBe(wide);
    // Without a scale the two would not agree
    const own = (values: readonly number[]): number =>
      sparklineGeometry(values, SPARK_WIDTH, SPARK_HEIGHT).segments[0]?.[0]?.y ?? 0;
    expect(own([25, 25, 25])).not.toBe(own([25, 0, 100]));
  });

  it('puts the low end of the scale at the bottom edge and the high end at the top edge', () => {
    const [bottom, top] = ys([0, 100]);
    expect(bottom).toBeGreaterThan(top ?? 0);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(SPARK_HEIGHT);
  });

  it('inverts a rank scale: rank 1 on the top edge and the deepest rank on the bottom edge', () => {
    const ranks = { low: 1, high: 20, invert: true };
    const upright = sparklineGeometry([1, 20], SPARK_WIDTH, SPARK_HEIGHT, 0, { low: 1, high: 20, invert: false });
    const inverted = sparklineGeometry([1, 20], SPARK_WIDTH, SPARK_HEIGHT, 0, ranks);
    const [one, deep] = (inverted.segments[0] ?? []).map((point) => point.y);
    expect(one).toBeLessThan(deep ?? 0);
    // The inverted scale is the upright one turned over
    const [upOne, upDeep] = (upright.segments[0] ?? []).map((point) => point.y);
    expect(one).toBe(upDeep);
    expect(deep).toBe(upOne);
  });

  it('breaks the line at a value outside the scale, and puts no last point on it', () => {
    const ranks = { low: 1, high: 20, invert: true };
    const { segments, last } = sparklineGeometry([3, 25, 4, 5], SPARK_WIDTH, SPARK_HEIGHT, 0, ranks);
    expect(segments.map((run) => run.length)).toEqual([1, 2]);
    expect(last).not.toBeNull();
    expect(sparklineGeometry([3, 4, 25], SPARK_WIDTH, SPARK_HEIGHT, 0, ranks).last).toBeNull();
  });

  it('draws a value on a scale of no span in the middle, and ignores the least span', () => {
    expect(ys([7, 7], { low: 7, high: 7, invert: false })).toEqual([SPARK_HEIGHT / 2, SPARK_HEIGHT / 2]);
    expect(sparklineGeometry([10, 90], SPARK_WIDTH, SPARK_HEIGHT, 5, scale)).toEqual(
      sparklineGeometry([10, 90], SPARK_WIDTH, SPARK_HEIGHT, 0, scale),
    );
  });
});

describe('sparklineGeometry', () => {
  it('puts the lowest month on the bottom edge and the highest on the top edge, higher volume higher up', () => {
    const { segments } = sparklineGeometry([100, 400, 250]);
    const [run] = segments;
    expect(run).toHaveLength(3);
    expect(run?.[1]?.y).toBeLessThan(run?.[2]?.y ?? 0);
    expect(run?.[2]?.y).toBeLessThan(run?.[0]?.y ?? 0);
    expect(run?.[1]?.y).toBeGreaterThan(0);
    expect(run?.[0]?.y).toBeLessThan(SPARK_HEIGHT);
  });

  it('scales each series to its own range, so a keyword of 50 searches and one of 50,000 draw alike', () => {
    expect(sparklineGeometry([50, 100, 75])).toEqual(sparklineGeometry([50_000, 100_000, 75_000]));
  });

  it('keeps a move smaller than the minimum span nearly flat and in the middle, as a rate of 40% and 41% is', () => {
    const wobble = [0.4, 0.41, 0.4, 0.41];
    const ys = (minSpan?: number): number[] =>
      (sparklineGeometry(wobble, SPARK_WIDTH, SPARK_HEIGHT, minSpan).segments[0] ?? []).map((point) => point.y);
    // Stretched to the box, a point of difference fills it
    expect(Math.max(...ys()) - Math.min(...ys())).toBeGreaterThan(10);
    // With a span of 20 points it is under a pixel, around the middle of the box
    const flat = ys(0.2);
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThan(1);
    expect(Math.abs((Math.max(...flat) + Math.min(...flat)) / 2 - SPARK_HEIGHT / 2)).toBeLessThan(0.5);
  });

  it('leaves a series that moves more than the minimum span as it was', () => {
    const rates = [0.2, 0.6, 0.4];
    expect(sparklineGeometry(rates, SPARK_WIDTH, SPARK_HEIGHT, 0.2)).toEqual(sparklineGeometry(rates));
  });

  it('draws a series that never moves in the middle of the box', () => {
    const { segments } = sparklineGeometry([300, 300, 300]);
    expect(segments[0]?.every((point) => point.y === SPARK_HEIGHT / 2)).toBe(true);
  });

  it('spreads the months over the width, oldest at the left', () => {
    const [run] = sparklineGeometry([1, 2, 3, 4]).segments;
    const xs = run?.map((point) => point.x) ?? [];
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBeGreaterThan(0);
    expect(xs.at(-1)).toBeLessThan(SPARK_WIDTH);
  });

  it('breaks the line at a month without a volume and keeps the runs on one scale', () => {
    const { segments } = sparklineGeometry([10, 20, null, 30, 40]);
    expect(segments.map((run) => run.length)).toEqual([2, 2]);
  });

  it('marks the last month only when it has a volume', () => {
    expect(sparklineGeometry([3, 4]).last).not.toBeNull();
    expect(sparklineGeometry([3, null]).last).toBeNull();
  });

  it('draws one month as a dot in the middle of the width', () => {
    expect(sparklineGeometry([10]).segments).toEqual([[{ x: SPARK_WIDTH / 2, y: SPARK_HEIGHT / 2 }]]);
  });

  it('draws nothing without a volume', () => {
    expect(sparklineGeometry([])).toEqual({ segments: [], last: null });
    expect(sparklineGeometry([null, null])).toEqual({ segments: [], last: null });
  });
});

describe('sparklineSummary', () => {
  it('reads the first and last month with a volume, and the peak', () => {
    expect(sparklineSummary([null, 900, 2400, 1300, null])).toEqual({ months: 5, first: 900, last: 1300, peak: 2400 });
  });

  it('has nothing to read where no month has a volume', () => {
    expect(sparklineSummary([null, null])).toEqual({ months: 2, first: null, last: null, peak: null });
    expect(sparklineSummary([])).toEqual({ months: 0, first: null, last: null, peak: null });
  });
});
