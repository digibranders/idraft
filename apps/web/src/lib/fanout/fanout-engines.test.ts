import { describe, expect, it } from 'vitest';

import { engineSplit, exposingEngines, withoutFanout } from './fanout-engines';
import type { EngineCode, ProjectEngine } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';

function engine(code: EngineCode, enabled = true, exposes = ENGINE_FACTS[code].exposes_fanout): ProjectEngine {
  return {
    active_prompts: 10,
    engine: { ...ENGINE_FACTS[code], exposes_fanout: exposes },
    estimated_monthly_cost_usd: null,
    is_configured: true,
    is_enabled: enabled,
    location_ids: [2276],
    provider_code: code,
    replicates: 1,
  };
}

const codes = (engines: readonly ProjectEngine[]): EngineCode[] => engines.map((entry) => entry.engine.engine_code);

const ALL = [engine('gemini_web'), engine('chatgpt_web'), engine('google_ai_mode')];

describe('exposingEngines', () => {
  it("lists only enabled engines whose engine.exposes_fanout is true, in the project's order", () => {
    expect(codes(exposingEngines(ALL))).toEqual(['chatgpt_web']);
    const two = [engine('google_ai_mode', true, true), engine('chatgpt_web'), engine('gemini_web')];
    expect(codes(exposingEngines(two))).toEqual(['google_ai_mode', 'chatgpt_web']);
  });

  it('leaves out an engine that exposes it but is off', () => {
    expect(exposingEngines([engine('chatgpt_web', false), engine('gemini_web')])).toEqual([]);
  });

  it('is empty while the engines are still loading', () => {
    expect(exposingEngines([])).toEqual([]);
  });
});

describe('withoutFanout', () => {
  it('lists the enabled engines that do not expose it, in order, never an engine that is off', () => {
    expect(codes(withoutFanout(ALL))).toEqual(['gemini_web', 'google_ai_mode']);
    expect(
      codes(withoutFanout([engine('gemini_web', false), engine('google_ai_mode'), engine('chatgpt_web')])),
    ).toEqual(['google_ai_mode']);
  });
});

describe('engineSplit', () => {
  it('reads an empty choice as every enabled engine', () => {
    const split = engineSplit(ALL, []);
    expect(codes(split.exposing)).toEqual(['chatgpt_web']);
    expect(codes(split.without)).toEqual(['gemini_web', 'google_ai_mode']);
  });

  it('puts a chosen engine that does not expose it in without, never in exposing', () => {
    const split = engineSplit(ALL, ['chatgpt_web', 'gemini_web']);
    expect(codes(split.exposing)).toEqual(['chatgpt_web']);
    expect(codes(split.without)).toEqual(['gemini_web']);
  });

  it('gives exposing: [] when none chosen exposes it', () => {
    const split = engineSplit(ALL, ['google_ai_mode', 'gemini_web']);
    expect(split.exposing).toEqual([]);
    expect(codes(split.without)).toEqual(['gemini_web', 'google_ai_mode']);
  });

  it('ignores a chosen engine that is off or not in the project', () => {
    const some = [engine('chatgpt_web', false), engine('gemini_web')];
    const split = engineSplit(some, ['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(split.exposing).toEqual([]);
    expect(codes(split.without)).toEqual(['gemini_web']);
  });
});
