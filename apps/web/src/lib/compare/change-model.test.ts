import { describe, expect, it } from 'vitest';

import { averageChangeOf, deltaInput, engineChangeOf, rateChange, stripChangeOf } from './change-model';
import type { EngineSummary, MetricCell, Schemas } from '@/lib/api/types';
import type { RateReading, StripPrompt } from '@/lib/rates/strip-model';

type EngineCells = Schemas['EngineCells'];

/** A rate of `k` of `n` valid answers, as a reading the change model takes. */
const reading = (k: number, n: number, value: number = k / n): RateReading => ({
  state: 'ok',
  value,
  answers: n,
  successes: k,
  reason: null,
});
const INSUFFICIENT: RateReading = { state: 'insufficient', value: null, answers: 3, successes: null, reason: null };
const NONE: RateReading = { state: 'none', value: null, answers: 0, successes: null, reason: 'noAnswers' };

/** A prompt's cell: `k` of `n` valid answers. */
const cell = (k: number, n: number): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: n,
  pooled: null,
});
const EMPTY = cell(0, 0);
const OUTCOMES = { cited_only: EMPTY, mentioned_and_cited: EMPTY, mentioned_only: EMPTY, neither: EMPTY };
const cellsOf = (mentioned: MetricCell, cited: MetricCell = EMPTY, shareOfVoice: MetricCell = EMPTY): EngineCells => ({
  mentioned,
  cited,
  share_of_voice: shareOfVoice,
  outcomes: OUTCOMES,
});
const engine = (code: string, now: EngineCells, previous: EngineCells | null): EngineSummary => ({
  engine_code: code,
  ...now,
  previous,
});

describe('rateChange', () => {
  it('is the difference of the two rates in points on the 0 to 1 scale', () => {
    const change = rateChange(reading(30, 60), reading(12, 60), 'mentioned');
    expect(change?.points).toBeCloseTo(0.3, 10);
    expect(change?.now).toEqual({ value: 0.5, answers: 60, successes: 30, prompts: null });
    expect(change?.before).toEqual({ value: 0.2, answers: 60, successes: 12, prompts: null });
    expect(change?.engines).toBe(1);
  });

  it('has no value when either side has under 4 valid answers', () => {
    expect(rateChange(INSUFFICIENT, reading(12, 60), 'mentioned')).toBeNull();
    expect(rateChange(reading(30, 60), INSUFFICIENT, 'mentioned')).toBeNull();
    expect(rateChange(NONE, reading(12, 60), 'mentioned')).toBeNull();
    expect(rateChange(reading(30, 60), NONE, 'cited')).toBeNull();
  });

  it('is detectable for 30 of 60 against 12 of 60', () => {
    expect(rateChange(reading(30, 60), reading(12, 60), 'mentioned')?.detectable).toBe(true);
  });

  it('is not detectable for 31 of 60 against 27 of 60', () => {
    expect(rateChange(reading(31, 60), reading(27, 60), 'mentioned')?.detectable).toBe(false);
  });

  it('reads a fall as a detectable change too', () => {
    const change = rateChange(reading(12, 60), reading(30, 60), 'cited');
    expect(change?.points).toBeCloseTo(-0.3, 10);
    expect(change?.detectable).toBe(true);
  });

  it('never tells share of voice detectable, whatever the counts', () => {
    const change = rateChange(reading(30, 60), reading(12, 60), 'share_of_voice');
    expect(change?.points).toBeCloseTo(0.3, 10);
    expect(change?.detectable).toBeNull();
  });

  it('leaves a change with unknown counts untested', () => {
    const unknown: RateReading = { ...reading(30, 60), successes: null };
    expect(rateChange(unknown, reading(12, 60), 'mentioned')?.detectable).toBeNull();
    expect(rateChange(reading(30, 60), unknown, 'mentioned')?.detectable).toBeNull();
  });

  it('does not tell a change whose weighted points and pooled difference move opposite ways (null)', () => {
    // The weighted rates rose (0.50 to 0.55 is +5 points) while the pooled answers fell (30 of 100 against 60 of 100)
    const change = rateChange(reading(30, 100, 0.55), reading(60, 100, 0.5), 'mentioned');
    expect(change?.points).toBeCloseTo(0.05, 10);
    expect(change?.detectable).toBeNull();
  });

  it('is not detectable and not guarded when both rates are the same', () => {
    expect(rateChange(reading(30, 60), reading(30, 60), 'mentioned')?.detectable).toBe(false);
  });

  it('carries the prompts a topic cell weights', () => {
    const topic: RateReading & { prompts: number } = { ...reading(30, 60), prompts: 5 };
    const change = rateChange(topic, { ...reading(12, 60), prompts: 4 }, 'mentioned');
    expect(change?.now.prompts).toBe(5);
    expect(change?.before.prompts).toBe(4);
  });
});

describe('engineChangeOf', () => {
  it('reads one engine against its previous cells', () => {
    const cells = [engine('a', cellsOf(cell(30, 60)), cellsOf(cell(12, 60)))];
    const change = engineChangeOf(cells, 'a', 'mentioned');
    expect(change?.points).toBeCloseTo(0.3, 10);
    expect(change?.detectable).toBe(true);
    expect(change?.now.answers).toBe(60);
    expect(change?.before.answers).toBe(60);
  });

  it('is null without a previous, for an engine the row lacks and without cells', () => {
    expect(engineChangeOf([engine('a', cellsOf(cell(30, 60)), null)], 'a', 'mentioned')).toBeNull();
    expect(engineChangeOf([engine('a', cellsOf(cell(30, 60)), cellsOf(cell(12, 60)))], 'b', 'mentioned')).toBeNull();
    expect(engineChangeOf(undefined, 'a', 'mentioned')).toBeNull();
  });

  it('counts the answers behind a topic cell and the prompts it weights', () => {
    const topic = (k: number, n: number, prompts: number): MetricCell => ({
      ...cell(0, prompts),
      value: k / n,
      pooled: { successes: k, trials: n },
    });
    const cells = [engine('a', cellsOf(topic(30, 60, 5)), cellsOf(topic(12, 60, 4)))];
    const change = engineChangeOf(cells, 'a', 'mentioned');
    expect(change?.now).toEqual({ value: 0.5, answers: 60, successes: 30, prompts: 5 });
    expect(change?.before).toEqual({ value: 0.2, answers: 60, successes: 12, prompts: 4 });
  });

  it('follows the metric asked for', () => {
    const cells = [engine('a', cellsOf(cell(30, 60), cell(6, 60)), cellsOf(cell(12, 60), cell(6, 60)))];
    expect(engineChangeOf(cells, 'a', 'cited')?.points).toBeCloseTo(0, 10);
    expect(engineChangeOf(cells, 'a', 'cited')?.detectable).toBe(false);
  });
});

describe('averageChangeOf', () => {
  const cells = [
    engine('a', cellsOf(cell(30, 60)), cellsOf(cell(24, 60))),
    // No answer in the previous period: this engine takes no part on either side
    engine('b', cellsOf(cell(10, 10)), null),
    engine('c', cellsOf(cell(20, 40)), cellsOf(cell(22, 40))),
    // Too few answers now: no rate, so it takes no part either
    engine('d', cellsOf(cell(1, 3)), cellsOf(cell(20, 40))),
  ];

  it('takes only the engines that have a rate in both windows and counts them', () => {
    const change = averageChangeOf(cells, ['a', 'b', 'c', 'd'], 'mentioned');
    expect(change?.engines).toBe(2);
    // Equal weight over a and c: (0.5 + 0.5) / 2 now, (0.4 + 0.55) / 2 before
    expect(change?.now.value).toBeCloseTo(0.5, 10);
    expect(change?.before.value).toBeCloseTo(0.475, 10);
    expect(change?.points).toBeCloseTo(0.025, 10);
    // The test runs on the answers of those two engines together
    expect(change?.now).toMatchObject({ answers: 100, successes: 50 });
    expect(change?.before).toMatchObject({ answers: 100, successes: 46 });
    expect(change?.detectable).toBe(false);
  });

  it('tests the pooled answers of the engines it took', () => {
    const wide = [
      engine('a', cellsOf(cell(60, 100)), cellsOf(cell(30, 100))),
      engine('b', cellsOf(cell(70, 100)), cellsOf(cell(40, 100))),
    ];
    const change = averageChangeOf(wide, ['a', 'b'], 'mentioned');
    expect(change?.engines).toBe(2);
    expect(change?.points).toBeCloseTo(0.3, 10);
    expect(change?.detectable).toBe(true);
  });

  it("with one engine equals that engine's change", () => {
    const only = [cells[0] as EngineSummary, cells[1] as EngineSummary];
    expect(averageChangeOf(only, ['a', 'b'], 'mentioned')).toEqual(engineChangeOf(only, 'a', 'mentioned'));
  });

  it('is null when no engine has a rate in both', () => {
    expect(averageChangeOf(cells, ['b', 'd'], 'mentioned')).toBeNull();
    expect(averageChangeOf(cells, [], 'mentioned')).toBeNull();
    expect(averageChangeOf(cells, ['x'], 'mentioned')).toBeNull();
    expect(averageChangeOf(undefined, ['a'], 'mentioned')).toBeNull();
  });

  it('leaves out an engine that is not in the codes asked for', () => {
    expect(averageChangeOf(cells, ['a'], 'mentioned')?.engines).toBe(1);
  });

  it('never tests share of voice, and leaves the count of its answers unknown', () => {
    const share = [
      engine('a', cellsOf(cell(30, 60), EMPTY, cell(40, 60)), cellsOf(cell(12, 60), EMPTY, cell(10, 60))),
      engine('c', cellsOf(cell(20, 40), EMPTY, cell(30, 40)), cellsOf(cell(24, 40), EMPTY, cell(5, 40))),
    ];
    const change = averageChangeOf(share, ['a', 'c'], 'share_of_voice');
    expect(change?.engines).toBe(2);
    expect(change?.points).toBeGreaterThan(0.4);
    expect(change?.now.successes).toBeNull();
    expect(change?.detectable).toBeNull();
  });

  it('does not tell a pooled test when the averages and the pooled answers move opposite ways', () => {
    // The equal weight averages rose (0.45 to 0.5) while the pooled answers fell (81 of 110 to 19 of 110)
    const split = [
      engine('a', cellsOf(cell(9, 10)), cellsOf(cell(1, 10))),
      engine('b', cellsOf(cell(10, 100)), cellsOf(cell(80, 100))),
    ];
    const change = averageChangeOf(split, ['a', 'b'], 'mentioned');
    expect(change?.points).toBeCloseTo(0.05, 10);
    expect(change?.detectable).toBeNull();
  });
});

describe('stripChangeOf', () => {
  const prompt = (now: EngineCells, previous: EngineCells | null): StripPrompt => ({
    topic_term_ids: [],
    engines: [engine('a', now, previous)],
  });
  const prompts = [
    prompt(cellsOf(cell(8, 10)), cellsOf(cell(5, 10))),
    prompt(cellsOf(cell(6, 10)), cellsOf(cell(7, 10))),
    // No answer on the engine in the previous period: it is in the figure now and has no part in the one before
    prompt(cellsOf(cell(10, 10)), null),
  ];

  it("is the weighted rate of the previous cells minus the chip's figure and leaves out a prompt whose previous is null", () => {
    const change = stripChangeOf(prompts, 'a', 'mentioned');
    // Now: the mean of 0.8, 0.6 and 1 over 3 prompts and 30 answers; before: the mean of 0.5 and 0.7 over 2 and 20
    expect(change?.now).toMatchObject({ answers: 30, successes: 24, prompts: 3 });
    expect(change?.now.value).toBeCloseTo(0.8, 10);
    expect(change?.before).toMatchObject({ answers: 20, successes: 12, prompts: 2 });
    expect(change?.before.value).toBeCloseTo(0.6, 10);
    expect(change?.points).toBeCloseTo(0.2, 10);
    expect(change?.detectable).toBe(false);
    expect(change?.engines).toBe(1);
  });

  it('is null when no prompt has a previous cell, or one side has under 4 valid answers', () => {
    expect(stripChangeOf([prompt(cellsOf(cell(8, 10)), null)], 'a', 'mentioned')).toBeNull();
    expect(stripChangeOf([prompt(cellsOf(cell(8, 10)), cellsOf(cell(1, 3)))], 'a', 'mentioned')).toBeNull();
    expect(stripChangeOf([], 'a', 'mentioned')).toBeNull();
    expect(stripChangeOf(prompts, 'zz', 'mentioned')).toBeNull();
  });

  it('is detectable when the pooled answers say so', () => {
    const wide = [prompt(cellsOf(cell(60, 100)), cellsOf(cell(30, 100)))];
    const change = stripChangeOf(wide, 'a', 'mentioned');
    expect(change?.points).toBeCloseTo(0.3, 10);
    expect(change?.detectable).toBe(true);
  });

  it('never tests share of voice', () => {
    const wide = [prompt(cellsOf(EMPTY, EMPTY, cell(60, 100)), cellsOf(EMPTY, EMPTY, cell(30, 100)))];
    const change = stripChangeOf(wide, 'a', 'share_of_voice');
    expect(change?.points).toBeCloseTo(0.3, 10);
    expect(change?.detectable).toBeNull();
  });
});

describe('deltaInput', () => {
  it('has value null for no change and isDetectable from the change', () => {
    expect(deltaInput(null)).toEqual({
      value: null,
      unit: 'points',
      polarity: 'higher_is_better',
      isDetectable: null,
    });
    const detectable = rateChange(reading(30, 60), reading(12, 60), 'mentioned');
    expect(deltaInput(detectable)).toEqual({
      value: detectable?.points,
      unit: 'points',
      polarity: 'higher_is_better',
      isDetectable: true,
    });
    const within = rateChange(reading(31, 60), reading(27, 60), 'mentioned');
    expect(deltaInput(within).isDetectable).toBe(false);
    const untested = rateChange(reading(31, 60), reading(27, 60), 'share_of_voice');
    expect(deltaInput(untested).isDetectable).toBeNull();
  });
});
