import { describe, expect, it } from 'vitest';

import { cell, competitor, engine, entityCells, own, pool, week, weighted } from './cells-fixtures';
import {
  averageEntityLines,
  averagePoints,
  enginePoints,
  entityLines,
  isStale,
  poolNote,
  type TopicPoint,
} from './series-model';
import { wilsonInterval } from '@/lib/stats';

const POOL = pool(4, '2026-10-05', '2026-11-01');

/** The points of the first engine's series for `metric`, which a test expects to exist. */
const pointsOf = (weeks: ReturnType<typeof week>[], metric: 'mentioned' | 'share_of_voice' = 'mentioned') => {
  const points = enginePoints(engine('chatgpt_web', { series: weeks }), metric);
  if (points === null) throw new Error('The series has no points');
  return points;
};

describe('enginePoints: the weekly points of a topic on one engine', () => {
  it('reads a pooled topic point with its pool weeks, window and the prompts of its own week', () => {
    const [point] = pointsOf([week('2026-10-26', { mentioned: weighted(3, 10, 4), prompts: 2, pool: POOL })]);
    expect(point).toEqual({
      weekStart: '2026-10-26',
      value: 0.3,
      k: 3,
      n: 10,
      // The prompts that answered in that week alone, not the pooled four weeks
      prompts: 2,
      pooled: true,
      showsPool: true,
      weeks: 4,
      window: POOL.window,
      band: wilsonInterval(3, 10),
      thin: false,
    });
  });

  it('does not word a point pooled over its own week alone as a pool, while keeping the flag the API gave', () => {
    // The first points of a window pool 1 week: the API flags them, but they hold nothing but their own week
    const [point] = pointsOf([
      week('2026-10-05', { mentioned: weighted(3, 10, 4), prompts: 2, pool: pool(1, '2026-10-05', '2026-10-11') }),
    ]);
    expect(point).toMatchObject({ pooled: true, weeks: 1, showsPool: false });
  });

  it('reads an unpooled point as its own week', () => {
    const [point] = pointsOf([week('2026-10-26', { mentioned: weighted(6, 12, 11), prompts: 11 })]);
    expect(point).toMatchObject({ pooled: false, weeks: 1, window: null, prompts: 11, n: 12, k: 6, value: 0.5 });
  });

  it('puts the Wilson band on the pooled answers from 4 answers', () => {
    const [point] = pointsOf([week('2026-10-26', { mentioned: weighted(1, 4, 2), prompts: 2 })]);
    expect(point?.band).toEqual(wilsonInterval(1, 4));
    expect(point?.thin).toBe(false);
  });

  it('makes a point under 4 answers hollow with no band, keeping its value', () => {
    const [point] = pointsOf([week('2026-10-26', { mentioned: weighted(1, 3, 2), prompts: 2 })]);
    expect(point).toMatchObject({ thin: true, band: null, n: 3, value: 1 / 3 });
  });

  it('makes a week with no valid answer a gap, never 0', () => {
    const [point] = pointsOf([week('2026-10-26', { mentioned: weighted(0, 0, 0, 2), prompts: 0 })]);
    expect(point).toMatchObject({ value: null, k: null, n: 0, band: null, thin: false });
    // A cell that really is 0 of 8 is a rate of 0, not a gap
    const [zero] = pointsOf([week('2026-10-26', { mentioned: weighted(0, 8, 3), prompts: 3 })]);
    expect(zero).toMatchObject({ value: 0, k: 0, n: 8 });
  });

  it('makes a cell with unreadable counts a gap', () => {
    const unreadable = [
      // More successes than answers, and a count that is not whole
      week('2026-10-05', { mentioned: { ...weighted(5, 3, 2), pooled: { successes: 5, trials: 3 } } }),
      week('2026-10-12', { mentioned: { ...weighted(1, 6, 2), pooled: { successes: 1.5, trials: 6 } } }),
      // Answers that are not whole, and a negative number of them
      week('2026-10-26', { mentioned: { ...weighted(1, 6, 2), pooled: { successes: 1, trials: 6.5 } } }),
      week('2026-11-02', { mentioned: { ...weighted(0, 6, 2), pooled: { successes: 0, trials: -1 } } }),
      // A cell with no `pooled` counts its answers in its denominator and numerator: they must be whole
      week('2026-10-19', { mentioned: cell(1.5, 6) }),
    ];
    const points = pointsOf(unreadable);
    expect(points).toHaveLength(unreadable.length);
    for (const point of points) {
      expect(point).toMatchObject({ value: null, k: null, n: 0, band: null, thin: false });
    }
  });

  it('does not apply the whole number guard of a prompt point to the numerator of a topic point', () => {
    // 2 prompts at 1 of 3 and 1 of 1 answers: the numerator is a sum of rates, 1.333..., and the point is still read
    const topic = { ...weighted(2, 4, 2), numerator: 1 / 3 + 1 };
    const [point] = pointsOf([week('2026-10-26', { mentioned: topic, prompts: 2 })]);
    expect(point).toMatchObject({ k: 2, n: 4, value: 0.5 });
    expect(point?.band).toEqual(wilsonInterval(2, 4));
  });

  it('reads share of voice by the answers that name a brand, with no count of successes and no band', () => {
    const [point] = pointsOf([week('2026-10-26', { share_of_voice: cell(2.5, 5), prompts: 3 })], 'share_of_voice');
    expect(point).toMatchObject({ value: 0.5, k: null, n: 5, band: null, thin: false, prompts: 3 });
  });

  it('has no points when the engine has no series', () => {
    expect(enginePoints(undefined, 'mentioned')).toBeNull();
    expect(enginePoints(engine('chatgpt_web'), 'mentioned')).toBeNull();
    expect(enginePoints(engine('chatgpt_web', { series: null }), 'mentioned')).toBeNull();
  });
});

describe('poolNote: how many points of a chart show several weeks together', () => {
  it('counts the pooled points of a series, over the points that show a value', () => {
    const points = pointsOf([
      week('2026-10-05', { mentioned: weighted(3, 10, 4), prompts: 2, pool: POOL }),
      week('2026-10-12', { mentioned: weighted(6, 12, 11), prompts: 11 }),
      week('2026-10-19', { mentioned: weighted(0, 0, 0), prompts: 0, pool: POOL }),
      week('2026-10-26', { mentioned: weighted(2, 8, 3), prompts: 3, pool: POOL }),
    ]);
    // The pooled week with no valid answer shows nothing, so it is neither pooled nor a point
    expect(poolNote(points)).toEqual({ pooled: 2, total: 3 });
    expect(poolNote([])).toEqual({ pooled: 0, total: 0 });
  });

  it('does not count a point pooled over 1 week, which holds nothing but its own week', () => {
    const points = pointsOf([
      week('2026-10-05', { mentioned: weighted(3, 10, 4), prompts: 2, pool: pool(1, '2026-10-05', '2026-10-11') }),
      week('2026-10-12', { mentioned: weighted(2, 8, 3), prompts: 3, pool: pool(2, '2026-10-05', '2026-10-18') }),
    ]);
    expect(poolNote(points)).toEqual({ pooled: 1, total: 2 });
  });
});

describe('averagePoints: the engines of a topic week by week', () => {
  const a = pointsOf([
    week('2026-10-05', { mentioned: weighted(4, 10, 3), prompts: 3 }),
    week('2026-10-12', { mentioned: weighted(2, 10, 3), prompts: 3, pool: POOL }),
    week('2026-10-19', { mentioned: weighted(5, 10, 3), prompts: 3 }),
  ]);
  const b = pointsOf([
    week('2026-10-05', { mentioned: weighted(6, 10, 2), prompts: 2 }),
    // Too few answers for a rate: this engine takes no part in the average of that week
    week('2026-10-12', { mentioned: weighted(3, 3, 2), prompts: 2 }),
    week('2026-10-19', { mentioned: weighted(0, 0, 0), prompts: 0 }),
  ]);

  it('says a week shows a pool only when a point that took part holds more than its own week', () => {
    const one = pointsOf([
      week('2026-10-12', { mentioned: weighted(4, 10, 3), prompts: 3, pool: pool(1, '2026-10-12', '2026-10-18') }),
    ]);
    const [alone] = averagePoints([one]);
    expect(alone).toMatchObject({ pooled: true, showsPool: false, weeks: 1 });
    const [together] = averagePoints([one, a.slice(1, 2)]);
    expect(together).toMatchObject({ pooled: true, showsPool: true, weeks: 4 });
  });

  it('averages engines per week with equal weight over the engines that have a point', () => {
    const [first, second, third] = averagePoints([a, b]);
    expect(first).toMatchObject({ weekStart: '2026-10-05', value: 0.5, n: 20, prompts: 3, pooled: false });
    // Only the first engine has a rate in the second week: its value, not half of it
    expect(second).toMatchObject({ weekStart: '2026-10-12', value: 0.2, n: 10, pooled: true, weeks: 4 });
    expect(third).toMatchObject({ weekStart: '2026-10-19', value: 0.5, n: 10 });
  });

  it('never counts an engine without a point as 0, and leaves a week no engine has a rate in as a gap', () => {
    const lone: TopicPoint[] = b.slice(2);
    expect(averagePoints([lone])[0]).toMatchObject({ weekStart: '2026-10-19', value: null, n: 0, k: null, band: null });
    expect(averagePoints([])).toEqual([]);
  });

  it('keeps the weeks in order when the engines hold different weeks', () => {
    const late = pointsOf([week('2026-10-26', { mentioned: weighted(5, 10, 3), prompts: 3 })]);
    expect(averagePoints([late, a]).map((point) => point.weekStart)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
  });
});

describe('entityLines: the own brand and the most mentioned competitors week by week', () => {
  const tracked = [
    own('own', 'Acme'),
    competitor('beta', 'Beta'),
    competitor('gamma', 'Gamma'),
    competitor('delta', 'Delta'),
  ];
  const series = [
    week('2026-10-05', {
      prompts: 3,
      entities: [
        entityCells('own', weighted(2, 10, 3)),
        entityCells('beta', weighted(5, 10, 3)),
        entityCells('gamma', weighted(1, 10, 3)),
      ],
    }),
    week('2026-10-12', {
      prompts: 2,
      pool: POOL,
      // Beta is not named at all this week: no cell, a gap and not a 0
      entities: [entityCells('own', weighted(3, 10, 3)), entityCells('gamma', weighted(4, 10, 3))],
    }),
  ];
  const cells = engine('chatgpt_web', {
    series,
    entities: [
      entityCells('own', weighted(5, 20, 3)),
      entityCells('beta', weighted(5, 20, 3)),
      entityCells('gamma', weighted(5, 10, 3)),
      entityCells('delta', weighted(0, 10, 3)),
    ],
  });

  it('builds an entity line per tracked entity from the week entity cells', () => {
    const lines = entityLines(cells, tracked, 3);
    const acme = lines.find((line) => line.entityId === 'own');
    expect(acme).toMatchObject({ name: 'Acme', role: 'own' });
    expect(acme?.points.map((point) => point.value)).toEqual([0.2, 0.3]);
    expect(acme?.points[1]).toMatchObject({ pooled: true, weeks: 4, window: POOL.window, prompts: 2, n: 10, k: 3 });
  });

  it('leaves an entity missing from a week as a gap', () => {
    const beta = entityLines(cells, tracked, 3).find((line) => line.entityId === 'beta');
    expect(beta?.points[0]).toMatchObject({ value: 0.5, n: 10 });
    expect(beta?.points[1]).toMatchObject({
      weekStart: '2026-10-12',
      value: null,
      k: null,
      n: 0,
      band: null,
      thin: false,
    });
  });

  it('orders lines own first then the top competitors, never a competitor with 0 mentions', () => {
    // Gamma is mentioned more than Beta over the window, Delta not at all
    expect(entityLines(cells, tracked, 3).map((line) => line.entityId)).toEqual(['own', 'gamma', 'beta']);
    expect(entityLines(cells, tracked, 1).map((line) => line.entityId)).toEqual(['own', 'gamma']);
  });

  it('has no lines without a series or without entity cells', () => {
    expect(entityLines(undefined, tracked, 3)).toEqual([]);
    expect(entityLines(engine('chatgpt_web', { series: null, entities: cells.entities ?? null }), tracked, 3)).toEqual(
      [],
    );
    // With a series but no entity cells there is nothing to draw
    expect(entityLines(engine('chatgpt_web', { series }), tracked, 3)).toEqual([]);
  });
});

describe('averageEntityLines: own against the top competitors, the engines of equal weight', () => {
  const tracked = [own('own', 'Acme'), competitor('beta', 'Beta'), competitor('gamma', 'Gamma')];
  /** An engine with a rate over the window and two weekly points, the entity cells given as `[id, week 1, week 2]`. */
  const onEngine = (code: string, rows: readonly (readonly [id: string, first: number, second: number])[]) =>
    engine(code, {
      mentioned: weighted(5, 10, 5),
      entities: rows.map(([id, first, second]) =>
        entityCells(id, weighted(Math.round(((first + second) / 2) * 10), 10, 5)),
      ),
      series: [
        week('2026-10-05', {
          prompts: 3,
          entities: rows.map(([id, first]) => entityCells(id, weighted(Math.round(first * 10), 10, 3))),
        }),
        week('2026-10-12', {
          prompts: 4,
          pool: POOL,
          entities: rows.map(([id, , second]) => entityCells(id, weighted(Math.round(second * 10), 10, 4))),
        }),
      ],
    });
  const engines = [
    onEngine('chatgpt_web', [
      ['own', 0.2, 0.4],
      ['beta', 0.6, 0.8],
      ['gamma', 0.1, 0],
    ]),
    onEngine('gemini_web', [
      ['own', 0.4, 0.4],
      ['beta', 0.2, 0.4],
      ['gamma', 0.3, 0.2],
    ]),
  ];

  it('averages each entity over the engines week by week and says how many took part', () => {
    const lines = averageEntityLines(engines, tracked, 3);
    expect(lines.map((line) => line.entityId)).toEqual(['own', 'beta', 'gamma']);
    const beta = lines.find((line) => line.entityId === 'beta');
    expect(beta?.points[0]?.value).toBeCloseTo(0.4, 9);
    expect(beta?.points[1]?.value).toBeCloseTo(0.6, 9);
    // The answers of both engines are behind the average, and the pooled point says its pool
    expect(beta?.points[1]).toMatchObject({
      n: 20,
      pooled: true,
      weeks: 4,
      window: POOL.window,
      prompts: 4,
      band: null,
    });
  });

  it('draws no band on an average and leaves an engine without a point out of it', () => {
    const lone = [engines[0] ?? engine('chatgpt_web'), engine('gemini_web', { mentioned: weighted(5, 10, 5) })];
    const own0 = averageEntityLines(lone, tracked, 3).find((line) => line.entityId === 'own');
    // Only ChatGPT has series and entity cells: its own line, not averaged with a 0
    expect(own0?.points.map((point) => point.value)).toEqual([0.2, 0.4]);
  });

  it('has no lines when no engine has a series with entity cells', () => {
    expect(averageEntityLines([], tracked, 3)).toEqual([]);
    expect(averageEntityLines([engine('chatgpt_web', { mentioned: weighted(5, 10, 5) })], tracked, 3)).toEqual([]);
  });
});

describe('isStale: a topic with no valid answer for a week', () => {
  const NOW = new Date('2026-11-12T12:00:00Z');

  it('is stale from 7 days after the last valid answer', () => {
    expect(isStale('2026-11-05T12:00:00Z', NOW)).toBe(true);
    expect(isStale('2026-10-01T02:00:00Z', NOW)).toBe(true);
  });

  it('is not stale inside the week', () => {
    expect(isStale('2026-11-05T12:00:01Z', NOW)).toBe(false);
    expect(isStale('2026-11-12T02:00:00Z', NOW)).toBe(false);
  });

  it('says nothing for a topic with no last valid answer or one that cannot be read', () => {
    expect(isStale(null, NOW)).toBe(false);
    expect(isStale('not a date', NOW)).toBe(false);
  });
});
