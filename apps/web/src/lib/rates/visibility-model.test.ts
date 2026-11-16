import { describe, expect, it } from 'vitest';

import {
  averageVisibility,
  platformVisibility,
  visibilityCell,
  visibilityOfEngine,
  visibilityOfPrompts,
  type PlatformVisibility,
} from './visibility-model';
import type { StripPrompt } from './strip-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { NO_COUNTS, promptCells, topicCells, type Counts } from '@/mocks/prompt-summary';

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

/** `valid` valid answers split into the four outcomes; `observations` counts the failed ones too. */
const outcomes = (
  valid: number,
  { both = 0, named = 0, cited = 0, observations = valid }: Partial<Record<string, number>> = {},
): Counts => ({
  ...NO_COUNTS,
  n_valid: valid,
  n_observations: observations,
  mentioned: both + named,
  cited: both + cited,
  mentioned_and_cited: both,
  mentioned_only: named,
  cited_only: cited,
  neither: valid - both - named - cited,
});

const promptOf = (chatgpt: Counts, gemini: Counts = NO_COUNTS): StripPrompt => ({
  topic_term_ids: [],
  engines: [promptCells(CHATGPT, chatgpt), promptCells(GEMINI, gemini)],
});

describe('visibilityCell: the three outcomes that are not "neither"', () => {
  it('adds named and cited, named only and cited only over the answers they share', () => {
    const cell = visibilityCell(promptCells(CHATGPT, outcomes(10, { both: 2, named: 3, cited: 1 })).outcomes);
    expect(cell).toMatchObject({ numerator: 6, denominator: 10, value: 0.6, n_observations: 10, pooled: null });
  });

  it('is 100% minus "neither"', () => {
    const counts = outcomes(8, { both: 1, named: 2, cited: 2 });
    const cell = visibilityCell(promptCells(CHATGPT, counts).outcomes);
    expect(cell.numerator).toBe(counts.n_valid - counts.neither);
  });

  it('has no value, not 0, when there is no valid answer', () => {
    const cell = visibilityCell(promptCells(CHATGPT, NO_COUNTS).outcomes);
    expect(cell).toMatchObject({ numerator: 0, denominator: 0, value: null });
  });

  it('adds the pooled counts of a prompt weighted cell (a topic)', () => {
    const topic = topicCells(CHATGPT, [outcomes(4, { both: 1, named: 1 }), outcomes(8, { cited: 4 })]);
    const cell = visibilityCell(topic.outcomes);
    expect(cell.pooled).toEqual({ successes: 2 + 4, trials: 12 });
    expect(cell.numerator).toBeCloseTo(0.5 + 0.5);
    expect(cell.denominator).toBe(2);
  });
});

describe('visibilityOfEngine: one engine of a prompt or a topic', () => {
  it('reads the rate with its counts', () => {
    const reading = visibilityOfEngine(promptCells(CHATGPT, outcomes(10, { both: 1, named: 2, cited: 1 })));
    expect(reading).toMatchObject({ state: 'ok', value: 0.4, answers: 10, successes: 4 });
  });

  it('is insufficient under the minimum of valid answers', () => {
    const reading = visibilityOfEngine(promptCells(CHATGPT, outcomes(MIN_OBSERVATIONS - 1, { named: 2 })));
    expect(reading).toMatchObject({ state: 'insufficient', value: null, answers: MIN_OBSERVATIONS - 1 });
  });

  it('is none without an engine or without a valid answer', () => {
    expect(visibilityOfEngine(undefined)).toMatchObject({ state: 'none', value: null, reason: 'noAnswers' });
    const failed = visibilityOfEngine(promptCells(CHATGPT, outcomes(0, { observations: 3 })));
    expect(failed).toMatchObject({ state: 'none', reason: 'noneValid' });
  });
});

describe('visibilityOfPrompts: a platform over the prompts in scope', () => {
  it('weights each prompt once, not the answers pooled', () => {
    // 1 of 4 (25%) and 10 of 10 (100%): the mean is 62.5%, the pooled 11 of 14 would be 78.6%
    const figure = visibilityOfPrompts(
      [promptOf(outcomes(4, { named: 1 })), promptOf(outcomes(10, { both: 10 }))],
      CHATGPT,
    );
    expect(figure).toMatchObject({ state: 'ok', value: 0.625, answers: 14, successes: 11, prompts: 2 });
  });

  it('leaves out a prompt that has no cells on the platform', () => {
    const only = promptOf(outcomes(4, { named: 2 }));
    const none: StripPrompt = { topic_term_ids: [], engines: [promptCells(GEMINI, outcomes(4, { named: 4 }))] };
    expect(visibilityOfPrompts([only, none], CHATGPT)).toMatchObject({ value: 0.5, prompts: 1 });
  });

  it('is insufficient when the pooled answers are under the minimum, and none for no prompt', () => {
    const thin = visibilityOfPrompts(
      [promptOf(outcomes(2, { named: 1 })), promptOf(outcomes(1, { named: 1 }))],
      CHATGPT,
    );
    expect(thin).toMatchObject({ state: 'insufficient', value: null });
    expect(visibilityOfPrompts([], CHATGPT)).toMatchObject({ state: 'none', value: null });
  });
});

const ok = (code: string, value: number, answers: number): PlatformVisibility => ({
  code,
  state: 'ok',
  value,
  answers,
  successes: Math.round(value * answers),
});
const thin = (code: string, answers: number): PlatformVisibility => ({
  code,
  state: 'insufficient',
  value: null,
  answers,
  successes: null,
});
const unknown = (code: string): PlatformVisibility => ({
  code,
  state: 'unknown',
  value: null,
  answers: 0,
  successes: null,
});

describe('platformVisibility', () => {
  it('keeps the value and the counts only for a rate that shows', () => {
    const reading = visibilityOfEngine(promptCells(CHATGPT, outcomes(10, { named: 3 })));
    expect(platformVisibility(CHATGPT, reading)).toEqual({
      code: CHATGPT,
      state: 'ok',
      value: 0.3,
      answers: 10,
      successes: 3,
    });
  });

  it('maps no answers to unknown and too few to insufficient, with no value for either', () => {
    expect(platformVisibility(CHATGPT, visibilityOfEngine(undefined))).toMatchObject({ state: 'unknown', value: null });
    const few = visibilityOfEngine(promptCells(CHATGPT, outcomes(3, { named: 3 })));
    expect(platformVisibility(CHATGPT, few)).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
  });
});

describe('averageVisibility: All platforms', () => {
  it('is the mean of the platforms values, not the pooled ratio', () => {
    // 50% of 100 and 100% of 4: the mean is 75%, the pooled 54 of 104 would be 51.9%
    const average = averageVisibility([ok(CHATGPT, 0.5, 100), ok(GEMINI, 1, 4)]);
    expect(average).toEqual({ state: 'ok', value: 0.75, used: 2, names: [CHATGPT, GEMINI], of: 2, answers: 104 });
  });

  it('is the platform itself when only one platform is asked', () => {
    const average = averageVisibility([ok(CHATGPT, 0.4, 20)]);
    expect(average).toMatchObject({ state: 'ok', value: 0.4, used: 1, names: [CHATGPT], of: 1 });
  });

  it('leaves out a platform without a rate of its own, and says how many took part', () => {
    const average = averageVisibility([ok(CHATGPT, 0.2, 10), thin(GEMINI, 3), unknown('google_ai_mode')]);
    expect(average).toMatchObject({ state: 'ok', value: 0.2, used: 1, names: [CHATGPT], of: 3, answers: 10 });
  });

  it('is unknown, not 0%, when no platform has a valid answer, and for no platform at all', () => {
    expect(averageVisibility([unknown(CHATGPT), unknown(GEMINI)])).toEqual({
      state: 'unknown',
      value: null,
      used: 0,
      names: [],
      of: 2,
      answers: 0,
    });
    expect(averageVisibility([])).toMatchObject({ state: 'unknown', value: null, used: 0, of: 0 });
  });

  it('is insufficient when every platform with answers is under the minimum, naming the largest count', () => {
    const average = averageVisibility([thin(CHATGPT, 2), thin(GEMINI, 3), unknown('google_ai_mode')]);
    expect(average).toEqual({ state: 'insufficient', value: null, used: 0, names: [], of: 3, answers: 3 });
  });
});
