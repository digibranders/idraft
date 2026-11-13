import { describe, expect, it } from 'vitest';

import { NOT_VALID, type Facts } from './answer-builder';
import {
  cellEntityIds,
  countsOf,
  ENTITY_CELLS_MAX,
  entityCountsOf,
  mondayOf,
  NO_COUNTS,
  NOT_NAMED,
  promptCells,
  promptEntityCells,
  sumCounts,
  summaryWeeks,
  topicEntityCells,
  weekCells,
  weeklySeries,
  type Counts,
  type NamedAnswer,
} from './prompt-summary';
import type { PointPool } from '@/lib/api/types';
import { shiftIsoDate } from './serp-views';

const OWN = 'own-brand';
const C1 = 'competitor-1';
const C2 = 'competitor-2';

/** A valid answer that names `ids` in that order (`OWN` is the own brand, the rest competitors), and `uncertain`. */
function naming(ids: readonly string[], uncertain: readonly string[] = []): NamedAnswer {
  const competitors = ids.filter((id) => id !== OWN);
  const facts: Facts = {
    ...NOT_VALID,
    is_valid: true,
    outcome: ids.includes(OWN) ? 'mentioned_only' : 'neither',
    own_mentioned: ids.includes(OWN),
    tracked_entities_mentioned: ids.length,
    competitor_mentions: competitors,
  };
  return {
    facts,
    mentions: [
      ...ids.map((entity_id, place) => ({ entity_id, mention_order: place + 1 })),
      // An uncertain match is evidence only: it has no number and is not in the set
      ...uncertain.map((entity_id) => ({ entity_id, mention_order: null })),
    ],
  };
}

/** A refused answer, which holds no facts that count, whatever its mentions say. */
const refused: NamedAnswer = { facts: NOT_VALID, mentions: [{ entity_id: OWN, mention_order: 1 }] };

const ANSWERS: readonly NamedAnswer[] = [
  naming([OWN, C1, C2]),
  naming([OWN, C1]),
  naming([C1]),
  naming([C1], [C2]),
  refused,
];
const COUNTS = countsOf(ANSWERS.map((answer) => answer.facts));

describe('the counts of an entity in the answers of one prompt', () => {
  it('count the valid answers that name it, and give it 1 over the entities each names', () => {
    expect(entityCountsOf(OWN, ANSWERS).mentioned).toBe(2);
    expect(entityCountsOf(OWN, ANSWERS).sov_share).toBeCloseTo(1 / 3 + 1 / 2);
    expect(entityCountsOf(C1, ANSWERS).mentioned).toBe(4);
    expect(entityCountsOf(C1, ANSWERS).sov_share).toBeCloseTo(1 / 3 + 1 / 2 + 1 + 1);
    expect(entityCountsOf(C2, ANSWERS)).toEqual({ mentioned: 1, sov_share: 1 / 3 });
  });

  it('leave out an uncertain match, a refused answer and an entity nobody named', () => {
    // C2 is in one numbered mention and one uncertain one; the refusal names the own brand and counts nowhere
    expect(entityCountsOf(C2, ANSWERS).mentioned).toBe(1);
    expect(entityCountsOf(OWN, [refused])).toEqual(NOT_NAMED);
    expect(entityCountsOf('nobody', ANSWERS)).toEqual(NOT_NAMED);
  });

  it('add up to 1 per answer over all the entities it names', () => {
    const sum = [OWN, C1, C2].reduce((total, id) => total + entityCountsOf(id, ANSWERS).sov_share, 0);
    expect(sum).toBeCloseTo(COUNTS.sov_answers);
    expect(COUNTS.sov_answers).toBe(4);
  });
});

describe('the cells of an entity', () => {
  it('equal the engine cells for the only own brand, on a prompt', () => {
    const engine = promptCells('chatgpt_web', COUNTS);
    const own = promptEntityCells(OWN, COUNTS, entityCountsOf(OWN, ANSWERS));
    expect(own.entity_id).toBe(OWN);
    expect(own.mentioned).toEqual(engine.mentioned);
    expect(own.share_of_voice.denominator).toBe(engine.share_of_voice.denominator);
    expect(own.share_of_voice.numerator).toBeCloseTo(engine.share_of_voice.numerator);
    expect(own.share_of_voice.n_observations).toBe(COUNTS.n_observations);
    expect(own.share_of_voice.pooled).toBeNull();
  });

  it('count a competitor over the valid answers of the prompt', () => {
    const cells = promptEntityCells(C1, COUNTS, entityCountsOf(C1, ANSWERS));
    expect(cells.mentioned).toEqual({ value: 1, numerator: 4, denominator: 4, n_observations: 5, pooled: null });
    expect(cells.share_of_voice.value).toBeCloseTo((1 / 3 + 1 / 2 + 1 + 1) / 4);
  });

  it('give no value for a prompt without a valid answer', () => {
    const cells = promptEntityCells(OWN, NO_COUNTS, NOT_NAMED);
    expect(cells.mentioned).toEqual({ value: null, numerator: 0, denominator: 0, n_observations: 0, pooled: null });
    expect(cells.share_of_voice.value).toBeNull();
  });

  it('weigh Mentioned of a topic by prompt, with pooled, and Share of voice by answer', () => {
    const half = {
      counts: { ...NO_COUNTS, n_observations: 3, n_valid: 2, sov_answers: 2 },
      named: { mentioned: 1, sov_share: 0.5 },
    };
    const all = {
      counts: { ...NO_COUNTS, n_observations: 4, n_valid: 4, sov_answers: 3 },
      named: { mentioned: 4, sov_share: 2 },
    };
    const none = { counts: { ...NO_COUNTS, n_observations: 2 }, named: NOT_NAMED };
    const cells = topicEntityCells(OWN, [half, all, none]);
    // Each prompt with a valid answer counts once, as its rate: 1/2 and 4/4; the prompt with none is left out
    expect(cells.mentioned).toEqual({
      value: 0.75,
      numerator: 1.5,
      denominator: 2,
      n_observations: 9,
      pooled: { successes: 5, trials: 6 },
    });
    // One answer one weight: 2.5 of 5 answers, with no pooled
    expect(cells.share_of_voice).toEqual({
      value: 0.5,
      numerator: 2.5,
      denominator: 5,
      n_observations: 9,
      pooled: null,
    });
  });
});

describe('the entities that get cells', () => {
  const tracked = (role: 'own' | 'competitor', id: string): { entity_id: string; role: 'own' | 'competitor' } => ({
    entity_id: id,
    role,
  });

  it('put the own brands first, then the competitors in the order given', () => {
    // The API lists competitors before the own brand; the cells put the own ones first
    expect(
      cellEntityIds([tracked('competitor', 'a'), tracked('competitor', 'b'), tracked('own', 'z'), tracked('own', 'y')]),
    ).toEqual(['z', 'y', 'a', 'b']);
  });

  it('stop at 20, keeping the own brands', () => {
    const many = [
      ...Array.from({ length: 24 }, (_, place) => tracked('competitor', `c${String(place)}`)),
      tracked('own', 'mine'),
    ];
    const ids = cellEntityIds(many);
    expect(ENTITY_CELLS_MAX).toBe(20);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('mine');
    expect(ids.slice(1)).toEqual(many.slice(0, 19).map((entity) => entity.entity_id));
  });
});

describe('the weeks of a series', () => {
  it('start on Monday: a Monday is its own week, a Sunday belongs to the Monday six days before', () => {
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-12')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
  });

  it('cross a year and a leap day', () => {
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
    expect(mondayOf('2024-03-01')).toBe('2024-02-26');
    expect(summaryWeeks('2026-12-30', '2027-01-05')).toEqual(['2026-12-28', '2027-01-04']);
  });

  it('are the Mondays the days touch, the first one before the window when it starts mid week', () => {
    expect(summaryWeeks('2026-11-12', '2026-11-12')).toEqual(['2026-11-09']);
    expect(summaryWeeks('2026-11-09', '2026-11-09')).toEqual(['2026-11-09']);
    expect(summaryWeeks('2026-11-15', '2026-11-15')).toEqual(['2026-11-09']);
    expect(summaryWeeks('2026-11-15', '2026-11-16')).toEqual(['2026-11-09', '2026-11-16']);
    expect(summaryWeeks('2026-10-16', '2026-11-12')).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
    ]);
  });

  it('are at most 14 in 92 days, whatever weekday the window starts on', () => {
    for (let offset = 0; offset < 7; offset += 1) {
      const first = shiftIsoDate('2026-01-01', offset);
      const weeks = summaryWeeks(first, shiftIsoDate(first, 91));
      expect(weeks).toHaveLength(14);
      expect(weeks.every((week) => mondayOf(week) === week)).toBe(true);
    }
  });

  it('give the weekly cells of an engine row: the week, and its Mentioned, Cited and Share of voice', () => {
    const cells = promptCells('chatgpt_web', COUNTS);
    expect(weekCells('2026-11-09', cells)).toEqual({
      week_start: '2026-11-09',
      prompts: 1,
      is_pooled: false,
      mentioned: cells.mentioned,
      cited: cells.cited,
      share_of_voice: cells.share_of_voice,
    });
    expect(weekCells('2026-11-09', cells)).not.toHaveProperty('pool');
  });

  it('give a pooled point the pooled cells, the prompts of its own week and the pool that says what it holds', () => {
    const own = promptCells('chatgpt_web', counts(2, 1));
    const pooled = promptCells('chatgpt_web', counts(6, 3));
    const pool: PointPool = {
      weeks: 3,
      window: { from: '2026-10-16', to: '2026-11-01', timezone: 'UTC' },
      reason: 'prompt_point',
      below_prompts: 10,
    };
    expect(weekCells('2026-10-26', own, { cells: pooled, pool })).toMatchObject({
      week_start: '2026-10-26',
      prompts: 1,
      is_pooled: true,
      pool,
      mentioned: pooled.mentioned,
      cited: pooled.cited,
    });
  });
});

/** The counts of one prompt over a week: `valid` answers, `mentioned` of them naming the brand. */
const counts = (valid: number, mentioned: number): Counts => ({
  ...NO_COUNTS,
  n_observations: valid,
  n_valid: valid,
  mentioned,
});
const RANGE = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const WEEKS = summaryWeeks(RANGE.from, RANGE.to);

describe('the pools of a series, as the API makes them (contract C2, change log C-11)', () => {
  it('add counts', () => {
    expect(sumCounts([])).toEqual(NO_COUNTS);
    expect(sumCounts([counts(2, 1), counts(2, 2), NO_COUNTS])).toEqual(counts(4, 3));
  });

  it('pool a prompt point over the week and the three before it, cut at the window start', () => {
    const series = weeklySeries('chatgpt_web', WEEKS, RANGE, [
      [NO_COUNTS, counts(2, 1), counts(2, 2), counts(2, 0), counts(2, 2)],
    ]);
    expect(series.map((point) => point.week_start)).toEqual(WEEKS);
    expect(series.map((point) => [point.is_pooled, point.pool?.weeks, point.pool?.reason])).toEqual([
      [true, 1, 'prompt_point'],
      [true, 2, 'prompt_point'],
      [true, 3, 'prompt_point'],
      [true, 4, 'prompt_point'],
      [true, 4, 'prompt_point'],
    ]);
    // The week of the 12th opens before the window: the pool starts on the window's first day, and ends with the week
    expect(series[1]?.pool?.window).toEqual({ from: '2026-10-16', to: '2026-10-25', timezone: 'UTC' });
    expect(series[2]?.pool?.window).toEqual({ from: '2026-10-16', to: '2026-11-01', timezone: 'UTC' });
    // The last week ends at the window end, not on its Sunday
    expect(series[4]?.pool?.window).toEqual({ from: '2026-10-19', to: '2026-11-12', timezone: 'UTC' });
    expect(series[4]?.pool?.below_prompts).toBe(10);
    // Answers over answers: the fourth point holds 1 + 2 + 0 of 2 + 2 + 2, the fifth 2 + 0 + 2 of 6 + 2 more
    expect(series[3]?.mentioned).toMatchObject({ numerator: 3, denominator: 6, pooled: null });
    expect(series[4]?.mentioned).toMatchObject({ numerator: 5, denominator: 8, pooled: null });
    // `prompts` is the prompt's own week alone, a pooled point or not
    expect(series.map((point) => point.prompts)).toEqual([0, 1, 1, 1, 1]);
    expect(series[0]?.mentioned).toMatchObject({ numerator: 0, denominator: 0, value: null });
  });

  it('pool a topic point under 10 prompts: each prompt summed over the weeks first, then weighted by prompt', () => {
    const series = weeklySeries(
      'chatgpt_web',
      WEEKS,
      RANGE,
      [
        [NO_COUNTS, counts(2, 2), counts(2, 1)],
        [NO_COUNTS, counts(2, 0), counts(2, 1)],
        [NO_COUNTS, NO_COUNTS, counts(2, 2)],
      ].map((cells) => [...cells, NO_COUNTS, NO_COUNTS]),
      true,
    );
    const point = series[2];
    // Rates over the three weeks: 3 of 4, 1 of 4 and 2 of 2
    expect(point).toMatchObject({
      prompts: 3,
      is_pooled: true,
      pool: { weeks: 3, reason: 'few_prompts', below_prompts: 10 },
      mentioned: { numerator: 2, denominator: 3, pooled: { successes: 6, trials: 10 } },
    });
  });

  it('leave a topic point of 10 prompts or more as the week alone', () => {
    const prompts = Array.from({ length: 10 }, () => [NO_COUNTS, counts(2, 2), counts(2, 0)]);
    const [, first, second] = weeklySeries('chatgpt_web', WEEKS, RANGE, prompts, true);
    expect(first).toMatchObject({ prompts: 10, is_pooled: false, mentioned: { numerator: 10, denominator: 10 } });
    expect(first).not.toHaveProperty('pool');
    // The week after holds 10 prompts again, with none of the answers of the week before
    expect(second).toMatchObject({ prompts: 10, is_pooled: false, mentioned: { numerator: 0, denominator: 10 } });
  });

  it('pool a topic point of 9 prompts, which is under the line', () => {
    const prompts = Array.from({ length: 9 }, () => [NO_COUNTS, counts(2, 2)]);
    expect(weeklySeries('chatgpt_web', WEEKS, RANGE, prompts, true)[1]).toMatchObject({
      prompts: 9,
      is_pooled: true,
      pool: { reason: 'few_prompts' },
    });
  });
});
