import { describe, expect, it } from 'vitest';

import { agreementOf } from './agreement-model';
import { engineCells, promptRow } from './engines-fixtures';
import type { EngineCode } from '@/lib/api/types';

const CODES: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

const codeAt = (index: number): EngineCode => {
  const code = CODES[index];
  if (code === undefined) throw new Error(`The fixture has no engine ${String(index)}`);
  return code;
};

/** A prompt with one `[k, n]` per engine in catalog order: `k` of `n` valid answers name the brand. */
const prompt = (id: string, ...counts: readonly (readonly [k: number, n: number])[]): ReturnType<typeof promptRow> =>
  promptRow(
    id,
    counts.map(([k, n], index) => engineCells(codeAt(index), { mentioned: [k, n, n] })),
  );

const TWO = CODES.slice(0, 2);

describe('agreementOf', () => {
  it('names a prompt by an engine when one valid answer names the brand and the engine has 4 or more valid answers on it', () => {
    const model = agreementOf({
      prompts: [
        // one answer of 5 names the brand on ChatGPT, none of 6 on Gemini: named by 1
        prompt('p1', [1, 5], [0, 6]),
        // exactly 4 valid answers is enough to read the engine, and none names the brand: named by 0
        prompt('p2', [0, 4], [0, 4]),
        prompt('p3', [4, 4], [2, 9]),
      ],
      asked: TWO,
    });
    expect(model.kind).toBe('ok');
    if (model.kind !== 'ok') return;
    expect(model.steps.map((step) => [step.named, step.prompts])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('leaves out and counts the prompts with fewer than 4 valid answers on any asked engine, never reading them as not named', () => {
    const model = agreementOf({
      prompts: [
        prompt('thin-on-gemini', [1, 5], [0, 3]),
        // no cell at all for the second engine: unknown, not a miss
        prompt('no-gemini', [1, 5]),
        prompt('ok-and-unnamed', [0, 5], [0, 5]),
      ],
      asked: TWO,
    });
    expect(model.kind).toBe('ok');
    if (model.kind !== 'ok') return;
    expect(model.leftOut).toBe(2);
    expect(model.compared).toBe(1);
    expect(model.steps[0]?.prompts).toBe(1);
  });

  it('does not let a thin answer count on an engine that is not asked leave a prompt out', () => {
    const model = agreementOf({
      prompts: [prompt('p1', [1, 5], [1, 5], [0, 1])],
      asked: TWO,
    });
    expect(model.kind === 'ok' && model.leftOut).toBe(0);
    expect(model.kind === 'ok' && model.steps[2]?.prompts).toBe(1);
  });

  it.each([2, 3])('has steps 0 to N for %i asked engines and the counts add up to the compared prompts', (engines) => {
    const asked = CODES.slice(0, engines);
    const all = Array.from({ length: engines }, () => [1, 6] as const);
    const none = Array.from({ length: engines }, () => [0, 6] as const);
    const model = agreementOf({
      prompts: [
        prompt('a', ...all),
        prompt('b', ...none),
        prompt('c', ...none),
        prompt('thin', [0, 1], ...none.slice(1)),
      ],
      asked,
    });
    expect(model.kind).toBe('ok');
    if (model.kind !== 'ok') return;
    expect(model.engines).toBe(engines);
    expect(model.steps.map((step) => step.named)).toEqual(Array.from({ length: engines + 1 }, (_, index) => index));
    expect(model.steps.reduce((total, step) => total + step.prompts, 0)).toBe(model.compared);
    expect(model.compared + model.leftOut).toBe(model.prompts);
    expect(model.compared).toBe(3);
    expect(model.leftOut).toBe(1);
  });

  it.each([[[]], [['chatgpt_web']]] as const)('is the too few engines state for asked engines %j', (asked) => {
    expect(agreementOf({ prompts: [prompt('p1', [1, 5])], asked }).kind).toBe('tooFewEngines');
  });

  it('is the no prompts state when there is no prompt, and nothing comparable when every prompt is left out', () => {
    expect(agreementOf({ prompts: [], asked: TWO }).kind).toBe('noPrompts');
    expect(agreementOf({ prompts: [prompt('p1', [1, 5], [0, 2])], asked: TWO })).toEqual({
      kind: 'nothingComparable',
      leftOut: 1,
      prompts: 1,
    });
  });

  it('colours the steps seq-3 to seq-6 in order and never with chart-1', () => {
    const three = agreementOf({ prompts: [prompt('p1', [1, 5], [1, 5], [1, 5])], asked: CODES });
    expect(three.kind === 'ok' && three.steps.map((step) => step.scale)).toEqual(['seq-3', 'seq-4', 'seq-5', 'seq-6']);
    const two = agreementOf({ prompts: [prompt('p1', [1, 5], [1, 5])], asked: TWO });
    if (two.kind !== 'ok') throw new Error('Two engines with answers must compare');
    const scales = two.steps.map((step) => step.scale);
    expect(scales[0]).toBe('seq-3');
    expect(scales.at(-1)).toBe('seq-6');
    const place = scales.map((scale) => Number(scale.replace('seq-', '')));
    expect(place).toEqual([...place].sort((a, b) => a - b));
  });
});
