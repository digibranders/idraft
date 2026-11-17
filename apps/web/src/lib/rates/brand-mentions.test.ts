import { describe, expect, it } from 'vitest';

import { brandMentionCounts, shareOfCounts } from './brand-mentions';
import type { EngineSummary, MetricCell } from '@/lib/api/types';

const cell = (numerator: number, denominator: number, pooled?: { successes: number; trials: number }): MetricCell =>
  ({ numerator, denominator, n_observations: denominator, value: null, ...(pooled ? { pooled } : {}) }) as MetricCell;

const engineOf = (entities: EngineSummary['entities']): EngineSummary =>
  ({ engine_code: 'chatgpt_web', entities }) as EngineSummary;

const OWN = 'own-1';
const RIVAL = 'rival-1';

describe('brandMentionCounts', () => {
  it('is the own brand mentions over the mentions of every tracked brand', () => {
    const engine = engineOf([
      { entity_id: OWN, mentioned: cell(6, 20), share_of_voice: cell(0, 0) },
      { entity_id: RIVAL, mentioned: cell(10, 20), share_of_voice: cell(0, 0) },
    ] as EngineSummary['entities']);
    expect(brandMentionCounts(engine, new Set([OWN]))).toEqual({ k: 6, n: 16 });
  });

  it('counts the pooled successes of a prompt weighted cell, not its sum of rates', () => {
    const engine = engineOf([
      { entity_id: OWN, mentioned: cell(1.5, 2, { successes: 6, trials: 20 }), share_of_voice: cell(0, 0) },
      { entity_id: RIVAL, mentioned: cell(1.9, 2, { successes: 10, trials: 20 }), share_of_voice: cell(0, 0) },
    ] as EngineSummary['entities']);
    expect(brandMentionCounts(engine, new Set([OWN]))).toEqual({ k: 6, n: 16 });
  });

  it('is null, not collected, without entity cells or without a cell of the own brand', () => {
    expect(brandMentionCounts(undefined, new Set([OWN]))).toBeNull();
    expect(brandMentionCounts(engineOf(undefined), new Set([OWN]))).toBeNull();
    const rivalOnly = engineOf([
      { entity_id: RIVAL, mentioned: cell(4, 10), share_of_voice: cell(0, 0) },
    ] as EngineSummary['entities']);
    expect(brandMentionCounts(rivalOnly, new Set([OWN]))).toBeNull();
  });
});

describe('shareOfCounts', () => {
  it('is k over n from 4 brand mentions and none below', () => {
    expect(shareOfCounts({ k: 6, n: 16 })).toBe(0.375);
    expect(shareOfCounts({ k: 2, n: 3 })).toBeNull();
  });
});
