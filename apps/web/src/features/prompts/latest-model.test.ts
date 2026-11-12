import { describe, expect, it } from 'vitest';

import { isValidAnswer, latestPerEngine, mentionOrderKey } from './latest-model';
import type { ObservationSummary } from '@/lib/api/types';

type Facts = NonNullable<ObservationSummary['facts']>;

const facts = (valid: boolean): Facts => ({
  competitor_cited: [],
  competitor_mentions: [],
  derivation_id: 1,
  had_structured_list: false,
  is_valid: valid,
  outcome: valid ? 'neither' : null,
  own_citation_count: 0,
  own_domain_cited: false,
  own_mention_order: null,
  own_mentioned: false,
  own_prominence: null,
  total_citation_count: 0,
  tracked_entities_mentioned: 0,
});

/** One row of the answers list; `valid` null is an answer whose facts are not read yet. */
const answer = (
  id: string,
  engine: string,
  observedAt: string,
  valid: boolean | null,
  status: ObservationSummary['status'] = 'complete',
): ObservationSummary =>
  ({
    observation_id: id,
    engine_code: engine,
    observed_at: observedAt,
    status,
    facts: valid === null ? null : facts(valid),
  }) as ObservationSummary;

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

describe('a valid answer', () => {
  it('is one whose facts are read and say it is valid', () => {
    expect(isValidAnswer(answer('1', CHATGPT, '2026-11-12T02:00:00Z', true))).toBe(true);
    expect(isValidAnswer(answer('2', CHATGPT, '2026-11-12T02:00:00Z', false))).toBe(false);
    expect(isValidAnswer(answer('3', CHATGPT, '2026-11-12T02:00:00Z', null))).toBe(false);
  });
});

describe('the latest answer of each engine', () => {
  it('is the newest valid one, whatever order the list comes in', () => {
    const picks = latestPerEngine(
      [
        answer('1', CHATGPT, '2026-11-05T02:00:00Z', true),
        answer('3', CHATGPT, '2026-11-12T02:00:00Z', true),
        answer('2', GEMINI, '2026-11-09T02:00:00Z', true),
      ],
      [CHATGPT, GEMINI],
    );
    expect(picks.map((pick) => [pick.engineCode, pick.observation?.observation_id, pick.valid])).toEqual([
      [CHATGPT, '3', true],
      [GEMINI, '2', true],
    ]);
  });

  it('keeps the order of the engines asked for, and gives an engine with no answer none', () => {
    const picks = latestPerEngine([answer('1', GEMINI, '2026-11-12T02:00:00Z', true)], [CHATGPT, GEMINI]);
    expect(picks).toEqual([
      { engineCode: CHATGPT, observation: null, valid: false },
      { engineCode: GEMINI, observation: expect.objectContaining({ observation_id: '1' }), valid: true },
    ]);
  });

  it('skips a newer answer that is not valid, and falls back to the newest one only when none is valid', () => {
    const [skipped] = latestPerEngine(
      [
        answer('2', CHATGPT, '2026-11-12T02:00:00Z', false, 'error'),
        answer('1', CHATGPT, '2026-11-09T02:00:00Z', true),
      ],
      [CHATGPT],
    );
    expect(skipped?.observation?.observation_id).toBe('1');
    expect(skipped?.valid).toBe(true);
    const [none] = latestPerEngine(
      [
        answer('1', CHATGPT, '2026-11-09T02:00:00Z', null),
        answer('2', CHATGPT, '2026-11-12T02:00:00Z', false, 'error'),
      ],
      [CHATGPT],
    );
    expect(none?.observation?.observation_id).toBe('2');
    expect(none?.valid).toBe(false);
  });

  it('leaves out the answers of an engine that is not asked for', () => {
    expect(latestPerEngine([answer('1', GEMINI, '2026-11-12T02:00:00Z', true)], [CHATGPT])).toEqual([
      { engineCode: CHATGPT, observation: null, valid: false },
    ]);
  });
});

describe('the mention order in words', () => {
  it('names the first three places and leaves the rest to a number', () => {
    expect([1, 2, 3, 4, 11].map(mentionOrderKey)).toEqual(['first', 'second', 'third', 'other', 'other']);
  });
});
