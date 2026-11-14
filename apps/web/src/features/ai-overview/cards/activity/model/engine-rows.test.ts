import { describe, expect, it } from 'vitest';

import { projectEngine } from './activity-fixtures';
import { engineRows } from './engine-rows';

describe('engineRows', () => {
  it('is one row per project engine, in the order the API lists them, with its label and whether it is on', () => {
    const rows = engineRows([
      projectEngine('gemini_web'),
      projectEngine('chatgpt_web', { on: false }),
      projectEngine('google_ai_mode'),
    ]);
    expect(rows.map((row) => [row.code, row.label, row.isOn])).toEqual([
      ['gemini_web', 'Gemini', true],
      ['chatgpt_web', 'ChatGPT', false],
      ['google_ai_mode', 'Google AI Mode', true],
    ]);
  });

  it('marks the cost of an engine that is on as an estimate and of one that is off as if on', () => {
    const [on, off] = engineRows([
      projectEngine('chatgpt_web', { cost: '24.180000' }),
      projectEngine('gemini_web', { on: false, cost: '18.000000' }),
    ]);
    expect(on?.cost).toEqual({ kind: 'estimate', usd: 24.18 });
    expect(off?.cost).toEqual({ kind: 'if_on', usd: 18 });
  });

  it('says unknown, not zero, for a price the book does not have, on or off', () => {
    const [on, off] = engineRows([
      projectEngine('chatgpt_web', { cost: null }),
      projectEngine('gemini_web', { on: false, cost: null }),
    ]);
    expect(on?.cost).toEqual({ kind: 'unknown' });
    expect(off?.cost).toEqual({ kind: 'unknown' });
  });

  it('keeps a real price of zero as zero', () => {
    expect(engineRows([projectEngine('chatgpt_web', { cost: '0.000000' })])[0]?.cost).toEqual({
      kind: 'estimate',
      usd: 0,
    });
  });
});
