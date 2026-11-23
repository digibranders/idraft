import { describe, expect, it } from 'vitest';

import { joinTrends, weeklyMentionTrend, type TrendRead, type TrendWeek } from './trend';
import {
  competitor,
  engine,
  entityCells,
  id,
  own,
  summaryOf,
  week,
  weighted,
} from '../../cards/competitors/model/summary.test-fixtures';
import { trackedSetOf } from '../../cards/competitors/model/tracked-set';
import type { WeekCells } from '@/lib/api/types';

const HUBSPOT = competitor(2, 'HubSpot');
const ENTITIES = [own(), HUBSPOT];

/** A week of `n` valid answers: you named in `you`, HubSpot in `rival`; `rival: null` is a week the read has no cell for it. */
function weekOf(weekStart: string, n: number, you: number, rival: number | null): WeekCells {
  const cells = [entityCells(own(), weighted(you, n, [you / n]), weighted(you, n, [you / n]))];
  if (rival !== null)
    cells.push(entityCells(HUBSPOT, weighted(rival, n, [rival / n]), weighted(rival, n, [rival / n])));
  return week(weekStart, { entities: cells });
}

function trendOf(byEngine: Record<string, WeekCells[]>, codes: string[], average: boolean) {
  const summary = summaryOf({
    entities: ENTITIES,
    total: Object.entries(byEngine).map(([code, series]) => engine(code, { series })),
  });
  return weeklyMentionTrend(summary, codes, trackedSetOf(summary, null), id(2), average);
}

describe('weeklyMentionTrend', () => {
  it('draws the weekly mention rate of both brands, with the counts of one platform', () => {
    const result = trendOf(
      { chatgpt_web: [weekOf('2026-10-19', 8, 4, 2), weekOf('2026-10-26', 8, 6, 4)] },
      ['chatgpt_web'],
      false,
    );
    expect(result).toEqual({
      status: 'read',
      weeks: [
        {
          weekStart: '2026-10-19',
          own: { value: 0.5, successes: 4, answers: 8 },
          rival: { value: 0.25, successes: 2, answers: 8 },
        },
        {
          weekStart: '2026-10-26',
          own: { value: 0.75, successes: 6, answers: 8 },
          rival: { value: 0.5, successes: 4, answers: 8 },
        },
      ],
    });
  });

  it('averages the platforms week by week on All platforms, with no count', () => {
    const result = trendOf(
      { chatgpt_web: [weekOf('2026-10-19', 8, 4, 2)], gemini_web: [weekOf('2026-10-19', 8, 0, 4)] },
      ['chatgpt_web', 'gemini_web'],
      true,
    );
    expect(result.status).toBe('read');
    const [first] = result.status === 'read' ? result.weeks : [];
    expect(first?.own.value).toBeCloseTo(0.25);
    expect(first?.rival.value).toBeCloseTo(0.375);
    expect(first?.own.answers).toBeNull();
  });

  it('says the competitor is not collected when the weekly read has no cell for it, and draws no line', () => {
    expect(
      trendOf(
        { chatgpt_web: [weekOf('2026-10-19', 8, 4, null), weekOf('2026-10-26', 8, 6, null)] },
        ['chatgpt_web'],
        false,
      ),
    ).toEqual({
      status: 'not_collected',
    });
  });

  it('leaves a week with fewer than 4 valid answers as a gap, and trims the idle weeks at the ends', () => {
    const result = trendOf(
      {
        chatgpt_web: [
          weekOf('2026-10-12', 0, 0, 0),
          weekOf('2026-10-19', 8, 4, 2),
          weekOf('2026-10-26', 3, 1, 1),
          weekOf('2026-11-02', 8, 4, 4),
          weekOf('2026-11-09', 0, 0, 0),
        ],
      },
      ['chatgpt_web'],
      false,
    );
    expect(result.status === 'read' ? result.weeks.map((entry) => [entry.weekStart, entry.own.value]) : null).toEqual([
      ['2026-10-19', 0.5],
      ['2026-10-26', null],
      ['2026-11-02', 0.5],
    ]);
  });

  it('is unread when the summary has no weekly points', () => {
    const summary = summaryOf({ entities: ENTITIES, total: [engine('chatgpt_web')] });
    expect(weeklyMentionTrend(summary, ['chatgpt_web'], trackedSetOf(summary, null), id(2), false)).toEqual({
      status: 'unread',
    });
  });
});

describe('joinTrends', () => {
  const point = { value: 0.5, successes: 4, answers: 8 };
  const weekOn = (weekStart: string, value: number): TrendWeek => ({
    weekStart,
    own: { ...point, value },
    rival: point,
  });
  const read = (...weeks: TrendWeek[]): TrendRead => ({ status: 'read', weeks });

  it('puts the weeks of the previous window first, and a week in both is the current one', () => {
    const joined = joinTrends(
      read(weekOn('2026-10-12', 0.1), weekOn('2026-10-19', 0.2)),
      read(weekOn('2026-10-19', 0.9), weekOn('2026-10-26', 0.3)),
    );
    expect(joined.status === 'read' ? joined.weeks.map((week) => [week.weekStart, week.own.value]) : null).toEqual([
      ['2026-10-12', 0.1],
      ['2026-10-19', 0.9],
      ['2026-10-26', 0.3],
    ]);
  });

  it('is the current window alone when the previous one is not read, or the current one has no rival to draw', () => {
    const current = read(weekOn('2026-10-26', 0.3));
    expect(joinTrends(null, current)).toBe(current);
    expect(joinTrends({ status: 'unread' }, current)).toBe(current);
    expect(joinTrends(current, { status: 'not_collected' })).toEqual({ status: 'not_collected' });
  });
});
