import { describe, expect, it } from 'vitest';

import { averagePoints, enginePoints, poolNote, type TopicPoint } from './topic-points';
import { cell, engine, pool, week, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';

/** The points of an engine whose series is `weeks`. */
const pointsOf = (...weeks: ReturnType<typeof week>[]): TopicPoint[] => {
  const points = enginePoints(engine('chatgpt_web', { series: weeks }), 'mentioned');
  if (points === null) throw new Error('the series is missing');
  return points;
};

describe('enginePoints', () => {
  it('is null for a read without a series', () => {
    expect(enginePoints(engine('chatgpt_web'), 'mentioned')).toBeNull();
    expect(enginePoints(undefined, 'mentioned')).toBeNull();
  });

  it('a week without a valid answer is a gap with value null', () => {
    const [point] = pointsOf(week('2026-10-12', { mentioned: cell(0, 0, 4) }));
    expect(point).toMatchObject({ value: null, k: null, n: 0, band: null, thin: false });
  });

  it('a point under 4 answers is thin with no band', () => {
    const [point] = pointsOf(week('2026-10-12', { mentioned: weighted(1, 3, 2), prompts: 2 }));
    expect(point).toMatchObject({ thin: true, band: null, n: 3, k: 1 });
    expect(point?.value).toBeCloseTo(1 / 3, 12);
  });

  it('a point with enough answers has the Wilson band of the pooled counts', () => {
    const [point] = pointsOf(week('2026-10-12', { mentioned: weighted(6, 10, 4), prompts: 4 }));
    expect(point).toMatchObject({ thin: false, n: 10, k: 6, prompts: 4 });
    expect(point?.band?.low).toBeLessThan(0.6);
    expect(point?.band?.high).toBeGreaterThan(0.6);
  });

  it('a pooled point reports its weeks and window', () => {
    const [point] = pointsOf(
      week('2026-10-12', {
        mentioned: weighted(6, 10, 4),
        prompts: 4,
        pool: pool(4, '2026-09-21', '2026-10-18'),
      }),
    );
    expect(point).toMatchObject({
      pooled: true,
      weeks: 4,
      showsPool: true,
      window: { from: '2026-09-21', to: '2026-10-18', timezone: 'UTC' },
    });
  });

  it('a pooled point of one week is its own week and does not say it is pooled', () => {
    const [point] = pointsOf(
      week('2026-10-12', { mentioned: weighted(6, 10, 4), prompts: 4, pool: pool(1, '2026-10-12', '2026-10-18') }),
    );
    expect(point).toMatchObject({ pooled: true, weeks: 1, showsPool: false });
  });

  it('a point with counts that cannot be real is a gap', () => {
    const more: ReturnType<typeof cell> = { ...weighted(6, 10, 4), pooled: { successes: 11, trials: 10 } };
    const fraction: ReturnType<typeof cell> = { ...weighted(6, 10, 4), pooled: { successes: 2, trials: 9.5 } };
    const negative: ReturnType<typeof cell> = { ...weighted(6, 10, 4), pooled: { successes: -1, trials: 10 } };
    const points = pointsOf(
      week('2026-10-05', { mentioned: more }),
      week('2026-10-12', { mentioned: fraction }),
      week('2026-10-19', { mentioned: negative }),
    );
    expect(points.map((point) => point.value)).toEqual([null, null, null]);
  });

  it('share of voice has no count of successes and counts the answers that name a brand', () => {
    const share = { value: 0.5, numerator: 3, denominator: 6, n_observations: 9, pooled: null };
    const points = enginePoints(
      engine('chatgpt_web', { series: [week('2026-10-12', { share_of_voice: share })] }),
      'share_of_voice',
    );
    expect(points?.[0]).toMatchObject({ value: 0.5, k: null, n: 6, band: null });
  });
});

describe('averagePoints', () => {
  /** A week with `k` of 10 valid answers over 4 prompts. */
  const full = (k: number): ReturnType<typeof week> =>
    week('2026-10-12', { mentioned: weighted(k, 10, 4), prompts: 4 });

  it('takes only engines with a rate and never counts a 0', () => {
    const rated = pointsOf(full(6));
    // Thin: 1 of 3 is a value that is not shown, so it takes no part
    const thin = pointsOf(week('2026-10-12', { mentioned: weighted(1, 3, 2), prompts: 2 }));
    const gap = pointsOf(week('2026-10-12', { mentioned: cell(0, 0, 3), prompts: 2 }));
    const [average] = averagePoints([rated, thin, gap]);
    expect(average?.value).toBeCloseTo(0.6, 12);
    expect(average?.n).toBe(10);
    expect(average?.band).toBeNull();
  });

  it('is the equal weight mean of the engines that show a rate', () => {
    const [average] = averagePoints([pointsOf(full(6)), pointsOf(full(2))]);
    expect(average?.value).toBeCloseTo(0.4, 12);
    expect(average?.n).toBe(20);
  });

  it('a week no engine has a rate in is a gap', () => {
    const empty = pointsOf(week('2026-10-12', { mentioned: cell(0, 0, 3) }));
    expect(averagePoints([empty, empty])[0]?.value).toBeNull();
  });

  it('says it is pooled when a point that took part is, with its widest pool', () => {
    const pooled = pointsOf(
      week('2026-10-12', { mentioned: weighted(6, 10, 4), prompts: 4, pool: pool(3, '2026-09-28', '2026-10-18') }),
    );
    const [average] = averagePoints([pooled, pointsOf(full(2))]);
    expect(average).toMatchObject({ pooled: true, weeks: 3, showsPool: true });
  });
});

describe('poolNote', () => {
  it('counts pooled points of the shown ones', () => {
    const points = pointsOf(
      week('2026-10-05', { mentioned: weighted(6, 10, 4), pool: pool(4, '2026-09-14', '2026-10-11') }),
      week('2026-10-12', { mentioned: weighted(6, 10, 4) }),
      week('2026-10-19', { mentioned: cell(0, 0, 3) }),
    );
    expect(poolNote(points)).toEqual({ pooled: 1, total: 2 });
  });
});
