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

  it('counts only the platforms in scope, adds their counts, and keeps six prompts at most', () => {
    const both = promptRow(1, [...prompt(1, 'chatgpt_web', 6, 2).engines, ...prompt(1, 'gemini_web', 6, 1).engines]);
    expect(unlinkedPrompts([{ ...both, text: 'Both' }], ['chatgpt_web', 'gemini_web'])).toEqual([
      { id: both.prompt_id, text: 'Both', unlinked: 3, answers: 12 },
    ]);
    expect(unlinkedPrompts([{ ...both, text: 'Both' }], ['gemini_web'])).toEqual([
      { id: both.prompt_id, text: 'Both', unlinked: 1, answers: 6 },
    ]);
    const many = Array.from({ length: 9 }, (_, index) => prompt(index + 1, 'chatgpt_web', 10, 1));
    expect(unlinkedPrompts(many, ['chatgpt_web'])).toHaveLength(6);
  });
});
