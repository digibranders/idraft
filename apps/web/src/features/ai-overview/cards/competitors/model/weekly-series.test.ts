import { describe, expect, it } from 'vitest';

import {
  at,
  cell,
  competitor,
  engine,
  entityCells,
  id,
  own,
  pool,
  share,
  summaryOf,
  week,
  weighted,
} from './summary-fixtures';
import { trackedSetOf } from './tracked-set';
import type { WeeklyPoint } from './types';
import { foldOthers, rankSeries, weeklyMention, weeklyShares } from './weekly-series';
import type { WeekCells } from '@/lib/api/types';

const CODE = 'chatgpt_web';
const [FYNIX, HUBSPOT, ZOHO] = [id(1), id(2), id(3)];

/** A weekly point whose denominator `answers` all name a tracked brand: `numerators` are Fynix, HubSpot, Zoho. */
function weekOf(
  weekStart: string,
  answers: number,
  numerators: [number, number, number],
  pooled?: NonNullable<WeekCells['pool']>,
): WeekCells {
  return week(weekStart, {
    share: share(answers, answers),
    mentioned: weighted(numerators[0], answers, [numerators[0] / answers]),
    entities: [
      entityCells(FYNIX, weighted(numerators[0], answers, [numerators[0] / answers]), share(numerators[0], answers)),
      entityCells(HUBSPOT, weighted(numerators[1], answers, [numerators[1] / answers]), share(numerators[1], answers)),
      entityCells(ZOHO, weighted(numerators[2], answers, [numerators[2] / answers]), share(numerators[2], answers)),
    ],
    ...(pooled === undefined ? {} : { pool: pooled }),
  });
}

function summaryWith(series: WeekCells[], entities = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')]) {
  return summaryOf({ entities, total: [engine(CODE, { series })] });
}

function sharesOf(series: WeekCells[]) {
  const summary = summaryWith(series);
  const read = weeklyShares(summary, CODE, trackedSetOf(summary, null));
  if (read.status !== 'read') throw new Error('expected a read');
  return read.points;
}

/** A point written directly, for the rank tests. */
function point(
  weekStart: string,
  answers: number,
  numerators: Record<string, number>,
  poolWeeks?: number,
): WeeklyPoint {
  return {
    weekStart,
    answers,
    state: answers >= 4 ? 'ok' : answers > 0 ? 'insufficient' : 'none',
    pool: poolWeeks === undefined ? null : { weeks: poolWeeks, from: weekStart, to: weekStart },
    entities: Object.entries(numerators).map(([entityId, numerator]) => ({
      entityId,
      numerator,
      value: answers >= 4 ? numerator / answers : null,
    })),
  };
}

describe('weeklyShares', () => {
  it('weeks come oldest first with their Monday as the label', () => {
    const points = sharesOf([
      weekOf('2026-11-02', 10, [3, 5, 2]),
      weekOf('2026-10-19', 10, [3, 5, 2]),
      weekOf('2026-10-26', 10, [3, 5, 2]),
    ]);
    expect(points.map((entry) => entry.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });

  it('a week with fewer than 4 answers naming a tracked brand has no share', () => {
    const [thin, enough] = sharesOf([weekOf('2026-10-26', 3, [1, 1, 1]), weekOf('2026-11-02', 4, [1, 2, 1])]);
    expect(thin).toMatchObject({ answers: 3, state: 'insufficient' });
    expect(thin?.entities.map((entry) => entry.value)).toEqual([null, null, null]);
    // the count is kept: a thin week can still be pooled
    expect(thin?.entities.map((entry) => entry.numerator)).toEqual([1, 1, 1]);
    expect(enough).toMatchObject({ answers: 4, state: 'ok' });
    expect(enough?.entities.map((entry) => entry.value)).toEqual([0.25, 0.5, 0.25]);
  });

  it('a pooled point keeps its pool weeks for the tooltip', () => {
    const [alone, pooled] = sharesOf([
      weekOf('2026-10-26', 10, [3, 5, 2]),
      weekOf('2026-11-02', 30, [9, 15, 6], pool(3, '2026-10-19', '2026-11-08')),
    ]);
    expect(alone?.pool).toBeNull();
    expect(pooled?.pool).toEqual({ weeks: 3, from: '2026-10-19', to: '2026-11-08' });
  });

  it('is unread without a total block or without the weekly series', () => {
    const noTotal = summaryOf({ prompts: [] });
    expect(weeklyShares(noTotal, CODE, trackedSetOf(noTotal, null))).toEqual({ status: 'unread' });
    const noSeries = summaryOf({ total: [engine(CODE, {})] });
    expect(weeklyShares(noSeries, CODE, trackedSetOf(noSeries, null))).toEqual({ status: 'unread' });
  });
});

describe('foldOthers', () => {
  it('entities beyond the palette fold into Other tracked and the column still adds up to 1', () => {
    const entities = [own(), ...[2, 3, 4, 5, 6, 7, 8].map((n) => competitor(n, `Brand ${n}`))];
    const series = [
      week('2026-11-02', {
        share: share(16, 16),
        entities: entities.map((entity) => entityCells(entity, cell(2, 16), share(2, 16))),
      }),
    ];
    const summary = summaryWith(series, entities);
    const set = trackedSetOf(summary, null);
    const read = weeklyShares(summary, CODE, set);
    if (read.status !== 'read') throw new Error('expected a read');
    const folded = foldOthers(at(read.points, 0), set);
    expect(folded.entities.map((entry) => entry.entityId)).toEqual([1, 2, 3, 4, 5, 6].map(id));
    expect(folded.other).toBeCloseTo(2 / 8, 10);
    const total = folded.entities.reduce((sum, entry) => sum + (entry.value ?? 0), 0) + (folded.other ?? 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('no brand is folded when all fit the palette, and a thin week has nothing to fold', () => {
    const summary = summaryWith([weekOf('2026-10-26', 10, [3, 5, 2]), weekOf('2026-11-02', 3, [1, 1, 1])]);
    const set = trackedSetOf(summary, null);
    const read = weeklyShares(summary, CODE, set);
    if (read.status !== 'read') throw new Error('expected a read');
    expect(foldOthers(at(read.points, 0), set).other).toBeNull();
    expect(foldOthers(at(read.points, 1), set)).toMatchObject({ other: null, state: 'insufficient' });
  });
});

describe('weeklyMention', () => {
  it('weekly mention k and n are the pooled successes over trials', () => {
    const summary = summaryWith([weekOf('2026-11-02', 10, [3, 5, 2])]);
    const read = weeklyMention(summary, CODE, trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('expected a read');
    const hubspot = read.points[0]?.entities.find((entry) => entry.entityId === HUBSPOT);
    expect(hubspot).toMatchObject({ k: 5, n: 10, state: 'ok' });
    expect(hubspot?.value).toBeCloseTo(0.5, 10);
  });

  it('a week with fewer than 4 answers has no mention rate and keeps its counts', () => {
    const summary = summaryWith([weekOf('2026-11-02', 3, [1, 2, 0])]);
    const read = weeklyMention(summary, CODE, trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('expected a read');
    expect(read.points[0]?.entities[1]).toMatchObject({ state: 'insufficient', value: null, k: 2, n: 3 });
  });
});

describe('rankSeries', () => {
  it('ties share the lower rank: 1, 2, 2, 4', () => {
    const [week1] = rankSeries([point('2026-11-02', 10, { [id(1)]: 4, [id(2)]: 2, [id(3)]: 2, [id(4)]: 1 }, 2)]);
    expect(week1?.entities.map((entry) => [entry.entityId, entry.rank])).toEqual([
      [id(1), 1],
      [id(2), 2],
      [id(3), 2],
      [id(4), 4],
    ]);
  });

  it('rank pools the trailing four unpooled weeks and clips at the window start', () => {
    const weeks = [
      point('2026-10-12', 10, { [FYNIX]: 2, [HUBSPOT]: 8 }),
      point('2026-10-19', 10, { [FYNIX]: 2, [HUBSPOT]: 8 }),
      point('2026-10-26', 10, { [FYNIX]: 2, [HUBSPOT]: 8 }),
      point('2026-11-02', 10, { [FYNIX]: 2, [HUBSPOT]: 8 }),
      point('2026-11-09', 10, { [FYNIX]: 9, [HUBSPOT]: 1 }),
    ];
    const ranked = rankSeries(weeks);
    expect(ranked.map((entry) => entry.poolWeeks)).toEqual([1, 2, 3, 4, 4]);
    expect(ranked.map((entry) => entry.answers)).toEqual([10, 20, 30, 40, 40]);
    const last = at(ranked, 4);
    // alone the last week would put Fynix first (9 of 10); over four weeks it is 15 of 40 against 25 of 40
    expect(last.entities.map((entry) => [entry.entityId, entry.rank])).toEqual([
      [FYNIX, 2],
      [HUBSPOT, 1],
    ]);
    expect(last.entities[0]?.share).toBeCloseTo(15 / 40, 10);
    expect(last.entities[0]?.numerator).toBe(15);
  });

  it('a week with fewer than 4 answers naming a tracked brand has no rank', () => {
    const [thin] = rankSeries([point('2026-10-26', 3, { [FYNIX]: 1, [HUBSPOT]: 2 })]);
    expect(thin?.entities.map((entry) => [entry.rank, entry.share])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('rank uses the points as read when any point is pooled', () => {
    const ranked = rankSeries([
      point('2026-10-26', 10, { [FYNIX]: 2, [HUBSPOT]: 8 }),
      point('2026-11-02', 10, { [FYNIX]: 9, [HUBSPOT]: 1 }, 3),
      point('2026-11-09', 10, { [FYNIX]: 2, [HUBSPOT]: 8 }),
    ]);
    // no client pooling: the second week ranks on its own shares, and says it holds the 3 weeks the API pooled
    expect(ranked.map((entry) => entry.poolWeeks)).toEqual([null, 3, null]);
    expect(ranked.map((entry) => entry.entities[0]?.rank)).toEqual([2, 1, 2]);
    expect(ranked.map((entry) => entry.answers)).toEqual([10, 10, 10]);
  });
});
