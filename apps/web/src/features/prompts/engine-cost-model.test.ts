import { describe, expect, it } from 'vitest';

import { engineCostChange } from './engine-cost-model';
import type { ProjectEngine } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';

function engineOf(
  code: keyof typeof ENGINE_FACTS,
  { on, price }: { on: boolean; price: string | null },
): ProjectEngine {
  return {
    engine: ENGINE_FACTS[code],
    is_configured: on,
    is_enabled: on,
    location_ids: on ? [2840] : [],
    replicates: 1,
    provider_code: 'dataforseo',
    active_prompts: 150,
    estimated_monthly_cost_usd: price,
  };
}

describe('engineCostChange', () => {
  it('adds the price of the engine turned on to the total of the engines already on', () => {
    const engines = [
      engineOf('chatgpt_web', { on: true, price: '1.560000' }),
      engineOf('gemini_web', { on: false, price: '0.500000' }),
      engineOf('google_ai_mode', { on: true, price: '2.000000' }),
    ];
    const change = engineCostChange(engines, 'gemini_web', true);
    expect(change.delta).toBeCloseTo(0.5);
    expect(change.enabledTotal).toBeCloseTo(4.06);
    expect(change.enabledCount).toBe(3);
  });

  it('takes the price of the engine turned off out of the total, whether the list still has it on or not', () => {
    const before = [
      engineOf('chatgpt_web', { on: true, price: '1.560000' }),
      engineOf('google_ai_mode', { on: true, price: '2.000000' }),
    ];
    const after = [
      engineOf('chatgpt_web', { on: false, price: '1.560000' }),
      engineOf('google_ai_mode', { on: true, price: '2.000000' }),
    ];
    for (const list of [before, after]) {
      const change = engineCostChange(list, 'chatgpt_web', false);
      expect(change.delta).toBeCloseTo(-1.56);
      expect(change.enabledTotal).toBeCloseTo(2);
      expect(change.enabledCount).toBe(1);
    }
  });

  it('counts the engine turned on once, also when the list already holds it as on', () => {
    const engines = [engineOf('chatgpt_web', { on: true, price: '1.560000' })];
    expect(engineCostChange(engines, 'chatgpt_web', true)).toEqual({
      delta: 1.56,
      enabledTotal: 1.56,
      enabledCount: 1,
    });
  });

  it('has a total of zero for no engine on, which is known and not missing', () => {
    const engines = [engineOf('chatgpt_web', { on: true, price: '1.560000' })];
    expect(engineCostChange(engines, 'chatgpt_web', false)).toEqual({
      delta: -1.56,
      enabledTotal: 0,
      enabledCount: 0,
    });
  });

  it('has no change and no total when the price of the engine switched is missing: unknown is never zero', () => {
    const engines = [
      engineOf('chatgpt_web', { on: true, price: '1.560000' }),
      engineOf('gemini_web', { on: false, price: null }),
    ];
    const change = engineCostChange(engines, 'gemini_web', true);
    expect(change.delta).toBeNull();
    expect(change.enabledTotal).toBeNull();
    expect(change.enabledCount).toBe(2);
  });

  it('has a change but no total when the price of another engine that is on is missing', () => {
    const engines = [
      engineOf('chatgpt_web', { on: true, price: null }),
      engineOf('gemini_web', { on: false, price: '0.500000' }),
    ];
    const change = engineCostChange(engines, 'gemini_web', true);
    expect(change.delta).toBeCloseTo(0.5);
    expect(change.enabledTotal).toBeNull();
    expect(change.enabledCount).toBe(2);
  });

  it('ignores the price of an engine that is off when it is not the one switched', () => {
    const engines = [
      engineOf('chatgpt_web', { on: true, price: '1.560000' }),
      engineOf('gemini_web', { on: false, price: null }),
    ];
    const change = engineCostChange(engines, 'chatgpt_web', false);
    expect(change.delta).toBeCloseTo(-1.56);
    expect(change.enabledTotal).toBe(0);
    expect(change.enabledCount).toBe(0);
  });

  it('treats a price that is not a money string as missing', () => {
    const engines = [engineOf('chatgpt_web', { on: false, price: 'free' })];
    expect(engineCostChange(engines, 'chatgpt_web', true).delta).toBeNull();
  });

  it('has no change for an engine the list does not hold', () => {
    const engines = [engineOf('chatgpt_web', { on: true, price: '1.560000' })];
    const change = engineCostChange(engines, 'google_ai_mode', true);
    expect(change.delta).toBeNull();
    expect(change.enabledTotal).toBeNull();
  });
});
