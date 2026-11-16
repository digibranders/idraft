import { describe, expect, it } from 'vitest';

import { weeklySharesAcross } from './scope-weekly';
import { at, competitor, engine, entityCells, own, share, summaryOf, week } from './summary-fixtures';
import { trackedSetOf } from './tracked-set';

const HUBSPOT = competitor(2, 'HubSpot');
const ENTITIES = [own(), HUBSPOT];

/** A week whose `answers` name a tracked brand, you taking `you` of them. */
const point = (weekStart: string, you: number, answers: number) =>
  week(weekStart, {
    share: share(you, answers),
    entities: [
      entityCells(own(), share(you, answers), share(you, answers)),
      entityCells(HUBSPOT, share(answers - you, answers), share(answers - you, answers)),
    ],
  });

const summaryOfSeries = (series: Record<string, ReturnType<typeof point>[]>) =>
  summaryOf({
    entities: ENTITIES,
    total: Object.entries(series).map(([code, weeks]) => engine(code, { series: weeks })),
  });

describe('weeklySharesAcross', () => {
  it('is the points of the one platform when one is asked', () => {
    const summary = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 6, 10)] });
    const read = weeklySharesAcross(summary, ['chatgpt_web'], trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('unread');
    expect(at(at(read.points, 0).entities, 0).value).toBeCloseTo(0.6);
  });

  it('averages the platforms week by week, each counting once, and the shares still add up to 1', () => {
    const summary = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 6, 10)],
      gemini_web: [point('2026-10-19', 1, 100)],
    });
    const read = weeklySharesAcross(summary, ['chatgpt_web', 'gemini_web'], trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('unread');
    const [you, them] = at(read.points, 0).entities;
    expect(you?.value).toBeCloseTo(0.305);
    expect((you?.value ?? 0) + (them?.value ?? 0)).toBeCloseTo(1);
  });

  it('leaves a platform with fewer than 4 answers out of that week only', () => {
    const summary = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 6, 10), point('2026-10-26', 5, 10)],
      gemini_web: [point('2026-10-19', 1, 3), point('2026-10-26', 3, 10)],
    });
    const read = weeklySharesAcross(summary, ['chatgpt_web', 'gemini_web'], trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('unread');
    expect(at(at(read.points, 0).entities, 0).value).toBeCloseTo(0.6);
    expect(at(at(read.points, 1).entities, 0).value).toBeCloseTo(0.4);
  });

  it('is a gap, never an average of nothing, when no platform has a share in a week', () => {
    const summary = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 1, 3)],
      gemini_web: [point('2026-10-19', 1, 2)],
    });
    const read = weeklySharesAcross(summary, ['chatgpt_web', 'gemini_web'], trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('unread');
    expect(at(read.points, 0).state).toBe('insufficient');
    expect(at(at(read.points, 0).entities, 0).value).toBeNull();
  });

  it('is unread when no platform carries a series', () => {
    const summary = summaryOf({ entities: ENTITIES, total: [engine('chatgpt_web')] });
    expect(weeklySharesAcross(summary, ['chatgpt_web'], trackedSetOf(summary, null)).status).toBe('unread');
  });
});
