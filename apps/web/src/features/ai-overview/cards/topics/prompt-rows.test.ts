import { describe, expect, it } from 'vitest';

import { promptEngineRows } from './prompt-rows';
import { cell, engine, promptRow, term } from '@/features/prompts/topics-by-engine/cells-fixtures';

const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const TREE = [term('seo', 'SEO'), term('tech', 'Technical SEO', 'seo', 'SEO / Technical SEO')];

describe('promptEngineRows', () => {
  it('a prompt value per engine from its own cell, in the order of the engines asked', () => {
    const prompt = promptRow(
      'p1',
      'best crawl tools',
      ['tech'],
      [engine('gemini_web', { mentioned: cell(4, 10) }), engine('chatgpt_web', { mentioned: cell(6, 10) })],
    );
    const [row] = promptEngineRows([prompt], CODES, 'mentioned', TREE);
    expect(row?.prompt).toBe(prompt);
    expect(row?.values.map((value) => value.code)).toEqual([...CODES]);
    expect(row?.values.map((value) => value.value)).toEqual([0.6, 0.4, null]);
    // A prompt's cell has whole counts and weights no prompts
    expect(row?.values[0]).toMatchObject({ answers: 10, successes: 6, prompts: null });
  });

  it('the average is over engines with a rate', () => {
    const prompt = promptRow(
      'p1',
      'q',
      [],
      [
        engine('chatgpt_web', { mentioned: cell(8, 10) }),
        engine('gemini_web', { mentioned: cell(4, 10) }),
        engine('google_ai_mode', { mentioned: cell(1, 2) }),
      ],
    );
    const [row] = promptEngineRows([prompt], CODES, 'mentioned', TREE);
    expect(row?.average.engines).toBe(2);
    expect(row?.average.value).toBeCloseTo(0.6, 12);
  });

  it('reads the metric asked', () => {
    const prompt = promptRow('p1', 'q', [], [engine('chatgpt_web', { mentioned: cell(8, 10), cited: cell(2, 10) })]);
    const [row] = promptEngineRows([prompt], ['chatgpt_web'], 'cited', TREE);
    expect(row?.values[0]?.value).toBe(0.2);
  });

  it('the row keeps its last valid time', () => {
    const prompt = { ...promptRow('p1', 'q', []), last_valid_at: '2026-11-10T08:00:00Z' };
    const [row] = promptEngineRows([prompt, promptRow('p2', 'q2', [])], CODES, 'mentioned', TREE);
    expect(row?.lastValidAt).toBe('2026-11-10T08:00:00Z');
    expect(promptEngineRows([promptRow('p2', 'q2', [])], CODES, 'mentioned', TREE)[0]?.lastValidAt).toBeNull();
  });

  it('the topic path comes from the tree or is null', () => {
    const rows = promptEngineRows(
      [promptRow('p1', 'q', ['tech']), promptRow('p2', 'q', ['unknown']), promptRow('p3', 'q', [])],
      CODES,
      'mentioned',
      TREE,
    );
    expect(rows.map((row) => row.path)).toEqual(['SEO / Technical SEO', null, null]);
  });
});
