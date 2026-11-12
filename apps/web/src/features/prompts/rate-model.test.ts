import { describe, expect, it } from 'vitest';

import { averageRate, cellFigure, engineRatesOf, sortByKeys, topEngine, type SortValue } from './rate-model';
import type { MetricCell } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { NO_COUNTS, promptCells, topicCells, type Counts } from '@/mocks/prompt-summary';

/** `valid` valid answers of which `mentioned` name the brand, `cited` cite it and `naming` name a tracked brand. */
const counted = (
  valid: number,
  mentioned: number,
  { observations = valid, cited = 0, naming = 0, share = 0 }: Partial<Record<string, number>> = {},
): Counts => ({
  ...NO_COUNTS,
  n_valid: valid,
  n_observations: observations,
  mentioned,
  cited,
  sov_answers: naming,
  sov_share: share,
});

const mentionedOf = (counts: Counts): MetricCell => promptCells('chatgpt_web', counts).mentioned;

describe('averageRate: the equal weight average of the engines in scope', () => {
  it('averages the engines rates, each engine once, and says how many took part', () => {
    // 1 of 4 (25%) and 8 of 8 (100%) average 62.5%; the 9 of 12 answers pooled would be 75%
    const average = averageRate([mentionedOf(counted(4, 1)), mentionedOf(counted(8, 8))]);
    expect(average).toEqual({
      state: 'ok',
      value: 0.625,
      engines: 2,
      answers: 12,
      successes: 9,
      reason: null,
      observations: 12,
    });
  });

  it('takes only the engines that show a rate of their own: one under the minimum of valid answers is left out', () => {
    // 1 of 2 answers is a pill in its own column, so it takes no part: "avg of 1", the other engine's rate
    const average = averageRate([mentionedOf(counted(2, 1)), mentionedOf(counted(8, 2))]);
    expect(average).toMatchObject({ state: 'ok', value: 0.25, engines: 1, answers: 8, successes: 2 });
  });

  it('leaves out an engine without a rate rather than counting it as 0, and counts the ones that took part', () => {
    const average = averageRate([mentionedOf(counted(4, 2)), mentionedOf(NO_COUNTS), undefined]);
    expect(average.value).toBe(0.5);
    expect(average.engines).toBe(1);
  });

  it('is insufficient when no engine shows a rate, and shows the answers of the engine that has most', () => {
    const average = averageRate([mentionedOf(counted(1, 1)), mentionedOf(counted(MIN_OBSERVATIONS - 1, 1))]);
    expect(average).toMatchObject({ state: 'insufficient', value: null, engines: 0, answers: MIN_OBSERVATIONS - 1 });
  });

  it('is insufficient for two engines of two valid answers each, though together they reach the minimum', () => {
    const engines = [counted(2, 1), counted(2, 2)].map((counts) => promptCells('chatgpt_web', counts));
    expect(engines.map((engine) => cellFigure(engine, 'mentioned').state)).toEqual(['insufficient', 'insufficient']);
    expect(averageRate(engines.map((engine) => engine.mentioned))).toMatchObject({
      state: 'insufficient',
      value: null,
      engines: 0,
      answers: 2,
    });
  });

  it('reads a topic cell by the answers behind it (pooled), and its value as the prompt weighted rate', () => {
    // Two prompts: 1 of 4 and 10 of 10; the topic's rate is the mean 62.5% over 14 answers
    const topic = topicCells('chatgpt_web', [counted(4, 1), counted(10, 10)]).mentioned;
    expect(averageRate([topic])).toEqual({
      state: 'ok',
      value: 0.625,
      engines: 1,
      answers: 14,
      successes: 11,
      reason: null,
      observations: 14,
    });
  });

  it('says why there is no rate: no answer at all, or none of them valid', () => {
    expect(averageRate([mentionedOf(NO_COUNTS), undefined])).toMatchObject({
      state: 'none',
      value: null,
      engines: 0,
      reason: 'noAnswers',
    });
    expect(averageRate([mentionedOf(counted(0, 0, { observations: 3 }))])).toMatchObject({
      state: 'none',
      reason: 'noneValid',
      observations: 3,
    });
    expect(averageRate([])).toMatchObject({ state: 'none', reason: 'noAnswers' });
  });
});

describe('cellFigure: one engine cell as a rate figure', () => {
  it('gives the rate and the counts behind it for Mentioned and Cited', () => {
    const engine = promptCells('chatgpt_web', counted(8, 6, { cited: 2 }));
    expect(cellFigure(engine, 'mentioned')).toMatchObject({ state: 'ok', value: 0.75, answers: 8, successes: 6 });
    expect(cellFigure(engine, 'cited')).toMatchObject({ state: 'ok', value: 0.25, answers: 8, successes: 2 });
  });

  it('counts the answers that name a brand for share of voice, and has no count of successes', () => {
    const engine = promptCells('chatgpt_web', counted(8, 6, { naming: 5, share: 2.5 }));
    expect(cellFigure(engine, 'share_of_voice')).toEqual({
      state: 'ok',
      value: 0.5,
      answers: 5,
      successes: null,
      reason: null,
    });
  });

  it('is insufficient under the minimum, and says there is no brand named where answers are valid but none names one', () => {
    expect(cellFigure(promptCells('chatgpt_web', counted(2, 1)), 'mentioned')).toMatchObject({
      state: 'insufficient',
      value: null,
      answers: 2,
    });
    expect(cellFigure(promptCells('chatgpt_web', counted(6, 1)), 'share_of_voice')).toMatchObject({
      state: 'none',
      reason: 'noBrandNamed',
    });
  });

  it('says no answers for a cell that is not there, none valid for answers that were all invalid', () => {
    expect(cellFigure(undefined, 'mentioned')).toMatchObject({ state: 'none', reason: 'noAnswers' });
    expect(cellFigure(promptCells('chatgpt_web', counted(0, 0, { observations: 2 })), 'cited')).toMatchObject({
      state: 'none',
      reason: 'noneValid',
    });
  });
});

describe('topEngine: the engine with the highest mention rate, a pointer and not a ranking', () => {
  it('picks the highest rate', () => {
    expect(
      topEngine([
        { code: 'a', rate: 0.2 },
        { code: 'b', rate: 0.7 },
        { code: 'c', rate: 0.5 },
      ]),
    ).toEqual({ code: 'b', rate: 0.7 });
  });

  it('breaks a tie by the order of the engines', () => {
    expect(
      topEngine([
        { code: 'a', rate: 0.5 },
        { code: 'b', rate: 0.5 },
      ]),
    ).toEqual({ code: 'a', rate: 0.5 });
  });

  it('skips an engine without a rate, and is null when none has one', () => {
    expect(
      topEngine([
        { code: 'a', rate: null },
        { code: 'b', rate: 0.1 },
      ]),
    ).toEqual({ code: 'b', rate: 0.1 });
    expect(topEngine([{ code: 'a', rate: null }])).toBeNull();
    expect(topEngine([])).toBeNull();
  });

  it('is null when the best rate is 0: no engine names the brand, so none is the top one', () => {
    expect(
      topEngine([
        { code: 'a', rate: null },
        { code: 'b', rate: 0 },
        { code: 'c', rate: 0 },
      ]),
    ).toBeNull();
  });
});

describe('engineRatesOf: the mention rate of each engine in scope, in the order of the engines', () => {
  it('has a rate only where the engine has enough valid answers, and none for an engine without a cell', () => {
    const cells = [promptCells('b', counted(8, 2)), promptCells('a', counted(2, 2))];
    expect(engineRatesOf(['a', 'b', 'c'], cells)).toEqual([
      { code: 'a', rate: null },
      { code: 'b', rate: 0.25 },
      { code: 'c', rate: null },
    ]);
  });
});

describe('sortByKeys: sorting rows by the keys of the address', () => {
  interface Row {
    name: string;
    value: SortValue;
    other: SortValue;
  }
  const rows: Row[] = [
    { name: 'Delta', value: 0.5, other: 1 },
    { name: 'Alpha', value: null, other: 2 },
    { name: 'Charlie', value: 0.5, other: 2 },
    { name: 'Bravo', value: 0.9, other: 3 },
    { name: 'Echo', value: null, other: 1 },
  ];
  const valueOf = (row: Row, id: string): SortValue => (id === 'value' ? row.value : row.other);
  const names = (sorted: readonly Row[]): string[] => sorted.map((row) => row.name);

  it('sorts high to low with the rows without a value last, and ties by name', () => {
    expect(names(sortByKeys(rows, [{ id: 'value', desc: true }], valueOf, (row) => row.name))).toEqual([
      'Bravo',
      'Charlie',
      'Delta',
      'Alpha',
      'Echo',
    ]);
  });

  it('keeps the rows without a value last when the sort runs low to high', () => {
    expect(names(sortByKeys(rows, [{ id: 'value', desc: false }], valueOf, (row) => row.name))).toEqual([
      'Charlie',
      'Delta',
      'Bravo',
      'Alpha',
      'Echo',
    ]);
  });

  it('takes a second key before the name', () => {
    expect(
      names(
        sortByKeys(
          rows,
          [
            { id: 'value', desc: true },
            { id: 'other', desc: false },
          ],
          valueOf,
          (row) => row.name,
        ),
      ),
    ).toEqual(['Bravo', 'Delta', 'Charlie', 'Echo', 'Alpha']);
  });

  it('sorts text A to Z and leaves the rows it is given alone', () => {
    const before = names(rows);
    const sorted = sortByKeys(
      rows,
      [{ id: 'text', desc: false }],
      (row) => row.name.toLowerCase(),
      (row) => row.name,
    );
    expect(names(sorted)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect(names(rows)).toEqual(before);
  });
});
