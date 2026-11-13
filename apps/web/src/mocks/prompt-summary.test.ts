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
  summaryWeeks,
  topicEntityCells,
  weekCells,
  type NamedAnswer,
} from './prompt-summary';
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
  });
});
