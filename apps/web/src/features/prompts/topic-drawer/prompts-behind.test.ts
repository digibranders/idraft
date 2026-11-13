import { describe, expect, it } from 'vitest';

import { promptsBehindCell } from './prompts-behind';
import { cell, engine, promptRow } from '@/features/prompts/topics-by-engine/cells-fixtures';

const CHATGPT_ANSWERED = (k: number, n: number) => engine('chatgpt_web', { mentioned: cell(k, n), cited: cell(1, n) });
const GEMINI_ONLY = engine('gemini_web', { mentioned: cell(2, 4) });

describe('promptsBehindCell', () => {
  it('keeps the prompts with an answer on the engine', () => {
    const answered = promptRow('a', 'Answered', [], [CHATGPT_ANSWERED(2, 5)]);
    const otherEngine = promptRow('b', 'Other engine', [], [GEMINI_ONLY]);
    const silent = promptRow('c', 'Never asked', [], []);
    expect(
      promptsBehindCell([answered, otherEngine, silent], 'chatgpt_web', 'mentioned').map((row) => row.prompt_id),
    ).toEqual(['a']);
  });

  it('keeps a prompt whose answers were all invalid, since the engine did answer it', () => {
    const invalid = promptRow('a', 'Invalid', [], [engine('chatgpt_web', { mentioned: cell(0, 0, 2) })]);
    expect(promptsBehindCell([invalid], 'chatgpt_web', 'mentioned')).toHaveLength(1);
  });

  it('orders by the chosen metric on that engine, a prompt without a rate last', () => {
    const low = promptRow('low', 'Low', [], [CHATGPT_ANSWERED(1, 5)]);
    const high = promptRow('high', 'High', [], [CHATGPT_ANSWERED(5, 5)]);
    const thin = promptRow('thin', 'Thin', [], [CHATGPT_ANSWERED(1, 2)]);
    expect(promptsBehindCell([thin, low, high], 'chatgpt_web', 'mentioned').map((row) => row.prompt_id)).toEqual([
      'high',
      'low',
      'thin',
    ]);
    // Cited is 1 of 5 for every prompt that has 5 answers: the order follows the chosen metric, then the text
    expect(promptsBehindCell([low, high], 'chatgpt_web', 'cited').map((row) => row.prompt_id)).toEqual(['high', 'low']);
  });

  it('breaks a tie by text', () => {
    const b = promptRow('b', 'Beta', [], [CHATGPT_ANSWERED(2, 5)]);
    const a = promptRow('a', 'Alpha', [], [CHATGPT_ANSWERED(2, 5)]);
    expect(promptsBehindCell([b, a], 'chatgpt_web', 'mentioned').map((row) => row.prompt_id)).toEqual(['a', 'b']);
  });

  it('does not change the list it is given', () => {
    const rows = [
      promptRow('b', 'Beta', [], [CHATGPT_ANSWERED(1, 5)]),
      promptRow('a', 'Alpha', [], [CHATGPT_ANSWERED(5, 5)]),
    ];
    promptsBehindCell(rows, 'chatgpt_web', 'mentioned');
    expect(rows.map((row) => row.prompt_id)).toEqual(['b', 'a']);
  });
});
