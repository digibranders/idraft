import { describe, expect, it } from 'vitest';

import { unlinkedPrompts } from './unlinked-model';
import { cell, engine, promptRow } from '../../competitors/model/summary-fixtures';
import type { PromptSummaryRow } from '@/lib/api/types';

/** A prompt on one platform: `n` valid answers, `only` of them mention the brand and cite none of its pages. */
function prompt(id: number, code: string, n: number, only: number): PromptSummaryRow {
  const row = promptRow(id, [
    engine(code, {
      mentioned: cell(only + 1, n),
      outcomes: {
        mentionedAndCited: cell(1, n),
        mentionedOnly: cell(only, n),
        citedOnly: cell(0, n),
        neither: cell(n - only - 1, n),
      },
    }),
  ]);
  return { ...row, text: `Prompt ${String(id)}` };
}

describe('unlinkedPrompts', () => {
  it('lists the prompts with an unlinked mention, the largest share of their answers first, then the most answers', () => {
    const rows = [prompt(1, 'chatgpt_web', 8, 2), prompt(2, 'chatgpt_web', 4, 1), prompt(3, 'chatgpt_web', 10, 5)];
    expect(unlinkedPrompts(rows, ['chatgpt_web']).map((entry) => entry.text)).toEqual([
      'Prompt 3',
      'Prompt 1',
      'Prompt 2',
    ]);
  });

  it('leaves out a prompt with fewer than 4 valid answers or no unlinked mention', () => {
    const rows = [prompt(1, 'chatgpt_web', 3, 2), prompt(2, 'chatgpt_web', 12, 0), prompt(3, 'chatgpt_web', 12, 3)];
    expect(unlinkedPrompts(rows, ['chatgpt_web']).map((entry) => entry.text)).toEqual(['Prompt 3']);
  });

  it('ranks on the equal-weight average of the platforms rates, never on counts added across platforms (R3)', () => {
    // ChatGPT 2 of 6 (33%) and Gemini 3 of 30 (10%): the average is 21.7%; pooled it would be 5 of 36 (14%)
    const both = promptRow(1, [...prompt(1, 'chatgpt_web', 6, 2).engines, ...prompt(1, 'gemini_web', 30, 3).engines]);
    // A second prompt on ChatGPT alone at 25% comes first, above the 21.7% of the first
    const single = { ...prompt(2, 'chatgpt_web', 8, 2), text: 'Single' };
    const [first, second] = unlinkedPrompts([{ ...both, text: 'Both' }, single], ['chatgpt_web', 'gemini_web']);
    expect(first?.text).toBe('Single');
    expect(second?.text).toBe('Both');
    expect(second?.rate).toBeCloseTo((2 / 6 + 3 / 30) / 2);
    expect(second?.counts).toEqual([
      { code: 'chatgpt_web', k: 2, n: 6 },
      { code: 'gemini_web', k: 3, n: 30 },
    ]);
  });

  it('ranks on the one platform when the scope is one platform', () => {
    const both = promptRow(1, [...prompt(1, 'chatgpt_web', 6, 2).engines, ...prompt(1, 'gemini_web', 6, 1).engines]);
    expect(unlinkedPrompts([{ ...both, text: 'Both' }], ['gemini_web'])).toEqual([
      { id: both.prompt_id, text: 'Both', rate: 1 / 6, counts: [{ code: 'gemini_web', k: 1, n: 6 }], leftOut: [] },
    ]);
  });

  it('leaves out, and names, a platform with fewer than 4 valid answers for the prompt', () => {
    const both = promptRow(1, [...prompt(1, 'chatgpt_web', 8, 2).engines, ...prompt(1, 'gemini_web', 3, 2).engines]);
    const [row] = unlinkedPrompts([{ ...both, text: 'Both' }], ['chatgpt_web', 'gemini_web']);
    expect(row?.rate).toBeCloseTo(0.25);
    expect(row?.counts).toEqual([{ code: 'chatgpt_web', k: 2, n: 8 }]);
    expect(row?.leftOut).toEqual(['gemini_web']);
  });

  it('keeps six prompts at most', () => {
    const many = Array.from({ length: 9 }, (_, index) => prompt(index + 1, 'chatgpt_web', 10, 1));
    expect(unlinkedPrompts(many, ['chatgpt_web'])).toHaveLength(6);
  });
});
