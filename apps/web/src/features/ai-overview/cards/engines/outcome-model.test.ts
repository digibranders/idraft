import { describe, expect, it } from 'vitest';

import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { OUTCOME_PARTS, outcomeFigures, outcomeMix } from './outcome-model';
import { buildAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';

type Parts = readonly [namedAndCited: number, namedOnly: number, citedOnly: number, neither: number];

/** A prompt on one engine written as the counts of its four outcomes; the other cells follow from them. */
function prompt(id: string, parts: Parts, code: EngineCode = 'chatgpt_web', observations?: number): PromptSummaryRow {
  const [both, named, cited, neither] = parts;
  const n = both + named + cited + neither;
  return promptRow(id, [
    engineCells(code, {
      mentioned: [both + named, n, observations ?? n],
      cited: [both + cited, n, observations ?? n],
      outcomes: {
        mentionedAndCited: [both, n, observations ?? n],
        mentionedOnly: [named, n, observations ?? n],
        citedOnly: [cited, n, observations ?? n],
        neither: [neither, n, observations ?? n],
      },
    }),
  ]);
}

const ASKED: readonly EngineCode[] = ['chatgpt_web'];

describe('outcomeMix', () => {
  it('the four shares of an engine add up to 1 over the prompts with a valid answer, each prompt counting once', () => {
    const prompts = [
      prompt('p1', [10, 5, 5, 20]),
      prompt('p2', [0, 2, 1, 2]),
      prompt('p3', [8, 8, 8, 8]),
      // Answered but never valid: no prompt of the shares
      prompt('p4', [0, 0, 0, 0], 'chatgpt_web', 6),
    ];
    const [mix] = outcomeMix(prompts, ASKED);
    expect(mix).toMatchObject({ engineCode: 'chatgpt_web', state: 'ok', prompts: 3 });
    if (mix?.state !== 'ok') throw new Error('expected shares');
    expect(mix.shares.reduce((total, entry) => total + entry.share, 0)).toBeCloseTo(1, 12);
    // The mean of the prompts' own shares: (10/40 + 0/5 + 8/32) / 3, not the pooled 18 of 77
    expect(mix.shares[0]?.share).toBeCloseTo((10 / 40 + 0 + 8 / 32) / 3, 12);
    expect(mix.shares[0]?.share).not.toBeCloseTo(18 / 77, 3);
  });

  it('segment order is fixed: named and cited, named only, cited only, neither', () => {
    expect(OUTCOME_PARTS).toEqual(['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither']);
    const [mix] = outcomeMix([prompt('p1', [1, 2, 3, 4])], ASKED);
    if (mix?.state !== 'ok') throw new Error('expected shares');
    expect(mix.shares.map((entry) => entry.part)).toEqual(OUTCOME_PARTS);
  });

  it('legend counts are pooled answers: 270 of 1,296', () => {
    const prompts = ['p1', 'p2', 'p3'].map((id) => prompt(id, [100, 90, 50, 192]));
    const [mix] = outcomeMix(prompts, ASKED);
    if (mix?.state !== 'ok') throw new Error('expected shares');
    expect(mix.answers).toBe(1296);
    expect(mix.shares.find((entry) => entry.part === 'mentioned_only')?.k).toBe(270);
  });

  it('named and cited equals aggregates mentionedAndCited for the same scope (R12)', () => {
    const prompts = [
      prompt('p1', [3, 2, 1, 4]),
      prompt('p2', [0, 5, 2, 9]),
      prompt('p3', [7, 1, 0, 0]),
      prompt('p4', [1, 1, 0, 0]),
    ];
    const aggregates = buildAggregates({
      current: summaryOf(prompts),
      previous: null,
      engines: [projectEngine('chatgpt_web')],
      chosenEngines: null,
      topicsKept: null,
      sources: null,
      fanout: null,
    });
    const strip = aggregates.engines.find((engine) => engine.engineCode === 'chatgpt_web')?.mentionedAndCited;
    const [mix] = outcomeMix(prompts, ASKED);
    if (mix?.state !== 'ok') throw new Error('expected shares');
    expect(mix.shares[0]?.share).toBe(strip?.value);
    expect(mix.shares[0]?.k).toBe(strip?.successes);
    expect(mix.answers).toBe(strip?.answers);
    expect(mix.prompts).toBe(strip?.prompts);
  });

  it('fewer than 4 valid answers is thin and has no shares', () => {
    const [mix] = outcomeMix([prompt('p1', [1, 1, 0, 1])], ASKED);
    expect(mix).toEqual({ engineCode: 'chatgpt_web', state: 'insufficient', answers: 3 });
  });

  it('no answer is none, with no bar and no zero share', () => {
    const noAnswers = promptRow('p1', [engineCells('chatgpt_web')]);
    const gemini = prompt('p2', [2, 2, 2, 2], 'gemini_web');
    const mixes = outcomeMix([noAnswers, gemini], ['chatgpt_web', 'gemini_web']);
    expect(mixes[0]).toEqual({ engineCode: 'chatgpt_web', state: 'none' });
    expect(mixes[1]?.state).toBe('ok');
  });

  it('an engine that has no cell on any prompt is none, and engines are never pooled', () => {
    const prompts = [prompt('p1', [4, 0, 0, 0], 'chatgpt_web'), prompt('p2', [0, 0, 0, 8], 'gemini_web')];
    const [chatgpt, gemini, aiMode] = outcomeMix(prompts, ['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(chatgpt?.state === 'ok' && chatgpt.shares[0]?.share).toBe(1);
    expect(gemini?.state === 'ok' && gemini.shares[3]?.share).toBe(1);
    expect(aiMode?.state).toBe('none');
  });
});

describe('outcomeFigures (the six line trick of buildAggregates)', () => {
  it('reads each outcome part as a mentioned cell, so a part is the strip rate of that part', () => {
    const prompts = [prompt('p1', [3, 2, 1, 4]), prompt('p2', [0, 5, 2, 9])];
    const figures = outcomeFigures(prompts, 'chatgpt_web');
    expect(figures.mentioned_and_cited.value).toBeCloseTo((3 / 10 + 0) / 2, 12);
    expect(figures.neither.successes).toBe(13);
    expect(figures.neither.answers).toBe(26);
  });
});
