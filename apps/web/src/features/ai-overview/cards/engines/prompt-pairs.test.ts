import { describe, expect, it } from 'vitest';

import { engineCells, promptRow } from './engines-fixtures';
import { engineCounts, hasEnoughAnswers, pairPrompts, rateOf } from './prompt-pairs';

const BOTH = ['chatgpt_web', 'gemini_web'] as const;

describe('pairPrompts', () => {
  it('joins the prompts of the two windows by prompt_id and lists a prompt of one window only as added or left', () => {
    const now = [
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [3, 8] })]),
      promptRow('p2', [engineCells('chatgpt_web', { mentioned: [1, 5] })]),
    ];
    const before = [
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [2, 6] })]),
      promptRow('p3', [engineCells('chatgpt_web', { mentioned: [4, 4] })]),
    ];
    const pairs = pairPrompts(now, before, ['chatgpt_web']);
    expect(pairs.prompts.map((prompt) => [prompt.promptId, prompt.presence])).toEqual([
      ['p1', 'both'],
      ['p2', 'nowOnly'],
      ['p3', 'beforeOnly'],
    ]);
    expect(pairs.presence).toEqual({ both: 1, nowOnly: 1, beforeOnly: 1 });
  });

  it('keeps the counts of an engine in both windows side by side, with the mention and citation numerators', () => {
    const now = [promptRow('p1', [engineCells('chatgpt_web', { mentioned: [3, 8, 9], cited: [5, 8, 9] })])];
    const before = [promptRow('p1', [engineCells('chatgpt_web', { mentioned: [2, 6], cited: [1, 6] })])];
    const [prompt] = pairPrompts(now, before, ['chatgpt_web']).prompts;
    expect(prompt?.engines.chatgpt_web).toEqual({
      now: { valid: 8, citedValid: 8, observations: 9, mentioned: 3, cited: 5 },
      before: { valid: 6, citedValid: 6, observations: 6, mentioned: 2, cited: 1 },
    });
  });

  it('keeps the valid answers of the citation cell apart from those of the mention cell', () => {
    const row = promptRow('p1', [engineCells('chatgpt_web', { mentioned: [3, 8, 9], cited: [2, 5, 9] })]);
    expect(engineCounts(row, 'chatgpt_web')).toEqual({
      valid: 8,
      citedValid: 5,
      observations: 9,
      mentioned: 3,
      cited: 2,
    });
  });

  it('keeps both prompt sets when the windows ask different prompts, and the text of the newer window', () => {
    const now = [promptRow('p1', [engineCells('chatgpt_web', { mentioned: [1, 4] })], { text: 'Now text' })];
    const before = [
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [1, 4] })], { text: 'Old text' }),
      promptRow('p9', [engineCells('chatgpt_web', { mentioned: [1, 4] })], { text: 'Gone' }),
    ];
    const pairs = pairPrompts(now, before, ['chatgpt_web']);
    expect(pairs.prompts.map((prompt) => prompt.text)).toEqual(['Now text', 'Gone']);
  });

  it('has no cell of an engine that is not asked, and null for a window where the prompt has no cell of an asked one', () => {
    const now = [
      promptRow('p1', [
        engineCells('chatgpt_web', { mentioned: [1, 4] }),
        engineCells('gemini_web', { mentioned: [2, 4] }),
      ]),
    ];
    const before = [promptRow('p1', [engineCells('gemini_web', { mentioned: [2, 4] })])];
    const [prompt] = pairPrompts(now, before, ['chatgpt_web']).prompts;
    expect(Object.keys(prompt?.engines ?? {})).toEqual(['chatgpt_web']);
    expect(prompt?.engines.chatgpt_web?.before).toBeNull();
    const [both] = pairPrompts(now, before, BOTH).prompts;
    expect(Object.keys(both?.engines ?? {})).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('is deterministic: the same rows give the same pairs, now first then the left ones', () => {
    const now = [promptRow('b', [engineCells('chatgpt_web', { mentioned: [1, 4] })])];
    const before = [promptRow('a', [engineCells('chatgpt_web', { mentioned: [1, 4] })])];
    expect(pairPrompts(now, before, ['chatgpt_web'])).toEqual(pairPrompts(now, before, ['chatgpt_web']));
    expect(pairPrompts(now, before, ['chatgpt_web']).prompts.map((prompt) => prompt.promptId)).toEqual(['b', 'a']);
  });
});

describe('the helpers of a pair', () => {
  it('engineCounts is null for an engine the prompt has no cell of', () => {
    const row = promptRow('p1', [engineCells('chatgpt_web', { mentioned: [1, 4] })]);
    expect(engineCounts(row, 'gemini_web')).toBeNull();
  });

  it('rateOf is k over n and null for no valid answer, never 0', () => {
    expect(rateOf(3, 4)).toBe(0.75);
    expect(rateOf(0, 4)).toBe(0);
    expect(rateOf(0, 0)).toBeNull();
  });

  it('hasEnoughAnswers is true from 4 valid answers and false for fewer or no cell', () => {
    expect(hasEnoughAnswers({ valid: 4, citedValid: 4, observations: 4, mentioned: 0, cited: 0 })).toBe(true);
    expect(hasEnoughAnswers({ valid: 3, citedValid: 3, observations: 9, mentioned: 0, cited: 0 })).toBe(false);
    expect(hasEnoughAnswers(null)).toBe(false);
  });
});
