import { describe, expect, it } from 'vitest';

import { engineRates, shareOfVoiceTotals, type StripPrompt } from './strip-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { NO_COUNTS, promptCells, topicCells, type Counts } from '@/mocks/prompt-summary';

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

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

const promptOf = (chatgpt: Counts, topicIds: string[] = []): StripPrompt => ({
  topic_term_ids: topicIds,
  engines: [promptCells(CHATGPT, chatgpt), promptCells(GEMINI, NO_COUNTS)],
});

describe('engineRates: the mention and citation rates of an engine over the prompts in scope', () => {
  it('weights each prompt once: the mean of the prompts rates, not the rate of all answers pooled', () => {
    // 1 of 4 (25%) and 10 of 10 (100%): the mean is 62.5%, the pooled 11 of 14 would be 78.6%
    const { mentioned } = engineRates([promptOf(counted(4, 1)), promptOf(counted(10, 10))], CHATGPT);
    expect(mentioned).toEqual({
      state: 'ok',
      value: 0.625,
      answers: 14,
      successes: 11,
      prompts: 2,
      reason: null,
    });
  });

  it('reads Cited the same way, from the cited cells', () => {
    const { cited } = engineRates(
      [promptOf(counted(4, 0, { cited: 2 })), promptOf(counted(4, 0, { cited: 4 }))],
      CHATGPT,
    );
    expect(cited.value).toBeCloseTo(0.75);
    expect(cited.successes).toBe(6);
  });

  it('leaves out a prompt without a valid answer, and counts only prompts that took part', () => {
    const { mentioned } = engineRates(
      [promptOf(counted(4, 2)), promptOf(NO_COUNTS), promptOf(counted(0, 0, { observations: 3 }))],
      CHATGPT,
    );
    expect(mentioned.value).toBe(0.5);
    expect(mentioned.prompts).toBe(1);
    expect(mentioned.answers).toBe(4);
  });

  it('agrees with the Topics row that covers the same prompts, for every rate', () => {
    const members = [
      counted(4, 1, { cited: 1, naming: 3, share: 1.5 }),
      counted(10, 7, { cited: 2, naming: 6, share: 4 }),
      counted(6, 3, { observations: 8, cited: 0, naming: 0, share: 0 }),
    ];
    const rates = engineRates(
      members.map((counts) => promptOf(counts)),
      CHATGPT,
    );
    const topic = topicCells(CHATGPT, members);
    expect(rates.mentioned.value).toBeCloseTo(topic.mentioned.value ?? Number.NaN);
    expect(rates.mentioned.successes).toBe(topic.mentioned.pooled?.successes);
    expect(rates.mentioned.answers).toBe(topic.mentioned.pooled?.trials);
    expect(rates.cited.value).toBeCloseTo(topic.cited.value ?? Number.NaN);
    expect(rates.shareOfVoice.value).toBeCloseTo(topic.share_of_voice.value ?? Number.NaN);
  });

  it('has no answers for an engine a prompt has no cell for', () => {
    const { mentioned } = engineRates([{ topic_term_ids: [], engines: [] }], CHATGPT);
    expect(mentioned).toMatchObject({ state: 'none', value: null, reason: 'noAnswers' });
  });
});

describe('the states of a rate', () => {
  it('is none, with the reason the tables give, when there is nothing to divide by', () => {
    expect(engineRates([promptOf(NO_COUNTS)], CHATGPT).mentioned).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noAnswers',
    });
    expect(engineRates([promptOf(counted(0, 0, { observations: 2 }))], CHATGPT).mentioned).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noneValid',
    });
    expect(engineRates([], CHATGPT).cited).toMatchObject({ state: 'none', reason: 'noAnswers' });
  });

  it('is insufficient under the minimum of valid answers, with no value to show, and ok from the minimum', () => {
    const few = engineRates([promptOf(counted(MIN_OBSERVATIONS - 1, 1))], CHATGPT).mentioned;
    expect(few).toMatchObject({ state: 'insufficient', value: null, answers: MIN_OBSERVATIONS - 1, successes: 1 });
    const enough = engineRates([promptOf(counted(MIN_OBSERVATIONS, 1))], CHATGPT).mentioned;
    expect(enough).toMatchObject({ state: 'ok', value: 0.25, answers: MIN_OBSERVATIONS });
  });

  it('judges the answers of all the prompts together: three prompts with one answer each are three answers', () => {
    const rates = engineRates([promptOf(counted(1, 1)), promptOf(counted(1, 0)), promptOf(counted(1, 1))], CHATGPT);
    expect(rates.mentioned).toMatchObject({ state: 'insufficient', answers: 3, prompts: 3 });
  });

  it('gives a share of voice nobody earned the reason that no brand is named, and the answers reason before it', () => {
    expect(engineRates([promptOf(counted(5, 2))], CHATGPT).shareOfVoice).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noBrandNamed',
    });
    expect(engineRates([promptOf(counted(0, 0, { observations: 2 }))], CHATGPT).shareOfVoice).toMatchObject({
      state: 'none',
      reason: 'noneValid',
    });
    expect(engineRates([promptOf(NO_COUNTS)], CHATGPT).shareOfVoice).toMatchObject({
      state: 'none',
      reason: 'noAnswers',
    });
  });
});

describe('shareOfVoiceTotals: one answer, one weight', () => {
  it('sums the shares and the answers of the prompts, and reads no count out of them', () => {
    const prompts = [
      promptOf(counted(5, 2, { naming: 4, share: 1.5 })),
      promptOf(counted(10, 5, { naming: 6, share: 4.5 })),
    ];
    expect(shareOfVoiceTotals(prompts, CHATGPT)).toEqual({ numerator: 6, denominator: 10 });
    const { shareOfVoice } = engineRates(prompts, CHATGPT);
    expect(shareOfVoice).toEqual({
      state: 'ok',
      value: 0.6,
      answers: 10,
      successes: null,
      prompts: 2,
      reason: null,
    });
  });

  it('is insufficient under the minimum of answers that name a brand', () => {
    const { shareOfVoice } = engineRates([promptOf(counted(9, 4, { naming: 3, share: 1 }))], CHATGPT);
    expect(shareOfVoice).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
  });
});
