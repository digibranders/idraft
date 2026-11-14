import { describe, expect, it } from 'vitest';

import { coverageOf } from './coverage-model';
import { engineCells, promptRow } from './engines-fixtures';
import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';

/** A prompt with `valid` valid answers on each engine given (the mentioned cell is what holds them). */
function prompt(
  id: string,
  valid: Partial<Record<EngineCode, number>>,
  topics: readonly string[] = ['t1'],
): PromptSummaryRow {
  return promptRow(
    id,
    Object.entries(valid).map(([code, n]) => engineCells(code as EngineCode, { mentioned: [0, n, n + 2] })),
    { topics },
  );
}

const BOTH: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];

describe('coverageOf', () => {
  it('per engine the prompts with 4 or more, 1 to 3, and no valid answer add up to the prompts in scope', () => {
    const prompts = [
      prompt('p1', { chatgpt_web: 8, gemini_web: 4 }),
      prompt('p2', { chatgpt_web: 4, gemini_web: 3 }),
      prompt('p3', { chatgpt_web: 3, gemini_web: 1 }),
      prompt('p4', { chatgpt_web: 0, gemini_web: 0 }),
      // No cell on Gemini at all: no valid answer, not a prompt that vanished
      prompt('p5', { chatgpt_web: 1 }),
    ];
    const figures = coverageOf({ prompts, asked: BOTH, branded: 'excluded', withBranded: null });
    expect(figures.prompts).toBe(5);
    expect(figures.engines).toEqual([
      { engineCode: 'chatgpt_web', enough: 2, few: 2, none: 1 },
      { engineCode: 'gemini_web', enough: 1, few: 2, none: 2 },
    ]);
    for (const engine of figures.engines) expect(engine.enough + engine.few + engine.none).toBe(figures.prompts);
  });

  it('only the engines asked have a row, in the order asked', () => {
    const figures = coverageOf({
      prompts: [prompt('p1', { chatgpt_web: 8, gemini_web: 8 })],
      asked: ['gemini_web'],
      branded: 'excluded',
      withBranded: null,
    });
    expect(figures.engines.map((engine) => engine.engineCode)).toEqual(['gemini_web']);
  });

  it('prompts without a topic are counted from topic_term_ids', () => {
    const prompts = [
      prompt('p1', { chatgpt_web: 8 }, []),
      prompt('p2', { chatgpt_web: 8 }, ['t1']),
      prompt('p3', { chatgpt_web: 8 }, []),
    ];
    expect(coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'excluded', withBranded: null }).withoutTopic).toBe(
      2,
    );
  });

  it('branded prompts left out is the second read minus the first', () => {
    const prompts = [prompt('p1', { chatgpt_web: 8 }), prompt('p2', { chatgpt_web: 8 })];
    const figures = coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'excluded', withBranded: 3 });
    expect(figures.branded).toEqual({ kind: 'leftOut', count: 1 });
    // No branded prompt exists: a real 0, because the second read answered
    expect(coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'excluded', withBranded: 2 }).branded).toEqual({
      kind: 'leftOut',
      count: 0,
    });
  });

  it('branded prompts left out is unknown, not 0, while the second read is absent or failed or cannot be the difference', () => {
    const prompts = [prompt('p1', { chatgpt_web: 8 }), prompt('p2', { chatgpt_web: 8 })];
    const absent = coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'excluded', withBranded: null });
    expect(absent.branded).toEqual({ kind: 'unknown' });
    // Fewer prompts with branded included than without is two reads of different scopes: no claim
    const inconsistent = coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'excluded', withBranded: 1 });
    expect(inconsistent.branded).toEqual({ kind: 'unknown' });
  });

  it('with branded included or only the branded row says so and reads nothing', () => {
    const prompts = [prompt('p1', { chatgpt_web: 8 })];
    expect(coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'included', withBranded: 9 }).branded).toEqual({
      kind: 'included',
    });
    expect(coverageOf({ prompts, asked: ['chatgpt_web'], branded: 'only', withBranded: null }).branded).toEqual({
      kind: 'only',
    });
  });
});
