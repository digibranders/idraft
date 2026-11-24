import { describe, expect, it } from 'vitest';

import { readEvidence } from './alert-evidence';

describe('readEvidence', () => {
  it('reads the counts of an AI alert, with the platform', () => {
    expect(
      readEvidence({
        event_kind: 'ai_mention_lost',
        evidence: {
          engine_code: 'chatgpt_web',
          before: { mentioning: 3, valid: 5 },
          after: { mentioning: 0, valid: 5 },
        },
      }),
    ).toEqual({
      kind: 'mention',
      platform: 'chatgpt_web',
      before: { mentioning: 3, valid: 5 },
      after: { mentioning: 0, valid: 5 },
      competitor: null,
    });
  });

  it('reads the competitor the counts are about', () => {
    const evidence = readEvidence({
      event_kind: 'ai_competitor_appeared',
      evidence: {
        before: { mentioning: 0, valid: 5 },
        after: { mentioning: 2, valid: 5 },
        competitor: { id: 'c-1', name: 'CyberNX' },
      },
    });
    expect(evidence).toMatchObject({ kind: 'mention', platform: null, competitor: 'CyberNX' });
  });

  it('reads the ranks of a rank drop', () => {
    expect(
      readEvidence({
        event_kind: 'rank_drop',
        evidence: { from_rank: 4, to_rank: 11, positions_lost: 7, positions: 5 },
      }),
    ).toEqual({ kind: 'rank', from: 4, to: 11, positions: 7 });
  });

  it('gives null for evidence that does not have the shape of its kind', () => {
    expect(readEvidence({ event_kind: 'rank_drop', evidence: { from_rank: 4 } })).toBeNull();
    expect(
      readEvidence({ event_kind: 'ai_mention_lost', evidence: { before: { mentioning: -1, valid: 5 } } }),
    ).toBeNull();
    expect(readEvidence({ event_kind: 'ai_mention_gained', evidence: {} })).toBeNull();
  });
});
