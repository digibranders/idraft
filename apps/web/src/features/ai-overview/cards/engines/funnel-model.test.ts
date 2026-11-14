import { describe, expect, it } from 'vitest';

import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { funnelOf, funnelScale, type EngineFunnel, type FunnelStepId } from './funnel-model';
import { buildAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';

/** A prompt on one engine: `named` of `valid` valid answers name the brand, `both` of them also cite it. */
function prompt(
  id: string,
  { valid, named, both, observations }: { valid: number; named: number; both: number; observations?: number },
  code: EngineCode = 'chatgpt_web',
): PromptSummaryRow {
  const seen = observations ?? valid;
  return promptRow(id, [
    engineCells(code, { mentioned: [named, valid, seen], outcomes: { mentionedAndCited: [both, valid, seen] } }),
  ]);
}

const ASKED: readonly EngineCode[] = ['chatgpt_web'];
const IDS: readonly FunnelStepId[] = ['answers', 'valid', 'named', 'cited'];

function only(funnels: readonly EngineFunnel[]): EngineFunnel {
  const [funnel] = funnels;
  if (funnel === undefined) throw new Error('expected a funnel');
  return funnel;
}

describe('funnelOf', () => {
  it('steps are answers, valid, named, named and cited per engine, each a subset of the step before', () => {
    const prompts = [
      prompt('p1', { valid: 20, named: 8, both: 3, observations: 24 }),
      prompt('p2', { valid: 10, named: 0, both: 0, observations: 10 }),
      prompt('p3', { valid: 30, named: 20, both: 11, observations: 32 }),
    ];
    const funnel = only(funnelOf(prompts, ASKED));
    expect(funnel.steps.map((step) => step.id)).toEqual(IDS);
    expect(funnel.steps.map((step) => step.count)).toEqual([66, 60, 28, 14]);
    // The guard: no step is larger than the one before it
    const counts = funnel.steps.map((step) => step.count ?? 0);
    counts.forEach((count, index) => {
      if (index > 0) expect(count).toBeLessThanOrEqual(counts[index - 1] ?? 0);
    });
    expect(funnel.notValid).toBe(6);
  });

  it('a share is the count over the step before: 612 of 1,800 valid answers', () => {
    const funnel = only(funnelOf([prompt('p1', { valid: 1800, named: 612, both: 270, observations: 1836 })], ASKED));
    const [answers, valid, named, cited] = funnel.steps;
    expect(answers).toMatchObject({ count: 1836, of: null, share: null, thin: false });
    expect(valid).toMatchObject({ count: 1800, of: 1836, thin: false });
    expect(valid?.share).toBeCloseTo(1800 / 1836, 12);
    expect(named).toMatchObject({ count: 612, of: 1800, share: 612 / 1800, thin: false });
    expect(cited).toMatchObject({ count: 270, of: 612, share: 270 / 612, thin: false });
  });

  it('the share under a step with fewer than 4 answers is thin, with no share', () => {
    const funnel = only(funnelOf([prompt('p1', { valid: 3, named: 2, both: 1, observations: 3 })], ASKED));
    const [, valid, named, cited] = funnel.steps;
    // 3 answers are the step before "valid", and 3 valid answers the step before "named"
    expect(valid).toMatchObject({ thin: true, share: null, of: 3 });
    expect(named).toMatchObject({ count: 2, thin: true, share: null, of: 3 });
    // Named has 2 answers: the share of those that also cite is thin too
    expect(cited).toMatchObject({ count: 1, thin: true, share: null, of: 2 });
  });

  it('not valid answers are shown as collection loss and never as a miss', () => {
    const funnel = only(funnelOf([prompt('p1', { valid: 0, named: 0, both: 0, observations: 10 })], ASKED));
    const [answers, valid, named, cited] = funnel.steps;
    expect(answers?.count).toBe(10);
    // Every answer failed: the valid step is a real 0, and what follows is unknown, not "named in 0%"
    expect(valid?.count).toBe(0);
    expect(funnel.notValid).toBe(10);
    expect(named?.count).toBeNull();
    expect(cited?.count).toBeNull();
    expect(named?.share).toBeNull();
  });

  it('an engine with no answer at all has no count on any step, never a 0', () => {
    const funnel = only(funnelOf([promptRow('p1', [engineCells('chatgpt_web')])], ASKED));
    expect(funnel.steps.map((step) => step.count)).toEqual([null, null, null, null]);
    expect(funnel.notValid).toBe(0);
  });

  it('pools answers while the strip is prompt weighted, and the two differ when prompts have different answer counts', () => {
    const prompts = [prompt('p1', { valid: 4, named: 4, both: 4 }), prompt('p2', { valid: 96, named: 0, both: 0 })];
    const funnel = only(funnelOf(prompts, ASKED));
    const aggregates = buildAggregates({
      current: summaryOf(prompts),
      previous: null,
      engines: [projectEngine('chatgpt_web')],
      chosenEngines: null,
      topicsKept: null,
      sources: null,
      fanout: null,
    });
    const strip = aggregates.engines.find((engine) => engine.engineCode === 'chatgpt_web');
    // Same counts as the strip (R12)
    expect(funnel.steps[1]?.count).toBe(strip?.mentioned.answers);
    expect(funnel.steps[2]?.count).toBe(strip?.mentioned.successes);
    expect(funnel.steps[3]?.count).toBe(strip?.mentionedAndCited.successes);
    expect(funnel.steps[0]?.count).toBe(strip?.allAnswers);
    // 4 of 100 pooled, against the strip's mean of 100% and 0%
    expect(funnel.steps[2]?.share).toBeCloseTo(4 / 100, 12);
    expect(strip?.mentioned.value).toBeCloseTo(0.5, 12);
  });

  it('engines are never pooled: each engine has its own steps, in the order asked', () => {
    const prompts = [
      prompt('p1', { valid: 10, named: 5, both: 2 }, 'chatgpt_web'),
      prompt('p2', { valid: 20, named: 4, both: 1 }, 'gemini_web'),
    ];
    const funnels = funnelOf(prompts, ['chatgpt_web', 'gemini_web']);
    expect(funnels.map((funnel) => funnel.engineCode)).toEqual(['chatgpt_web', 'gemini_web']);
    expect(funnels.map((funnel) => funnel.steps[2]?.count)).toEqual([5, 4]);
  });
});

describe('funnelScale', () => {
  it('is the largest count of any engine, so lengths compare across engines', () => {
    const funnels = funnelOf(
      [
        prompt('p1', { valid: 10, named: 5, both: 2 }, 'chatgpt_web'),
        prompt('p2', { valid: 40, named: 4, both: 1, observations: 50 }, 'gemini_web'),
      ],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(funnelScale(funnels)).toBe(50);
  });

  it('is 0 when no engine has an answer, which the card does not draw', () => {
    expect(funnelScale(funnelOf([promptRow('p1', [engineCells('chatgpt_web')])], ASKED))).toBe(0);
  });
});
