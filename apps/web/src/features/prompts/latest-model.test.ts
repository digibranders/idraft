import { describe, expect, it } from 'vitest';

import { isValidAnswer, mentionOrderKey } from './latest-model';
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
const answer = (valid: boolean | null): ObservationSummary =>
  ({ facts: valid === null ? null : facts(valid) }) as ObservationSummary;

describe('a valid answer', () => {
  it('is one whose facts are read and say it is valid', () => {
    expect(isValidAnswer(answer(true))).toBe(true);
    expect(isValidAnswer(answer(false))).toBe(false);
    expect(isValidAnswer(answer(null))).toBe(false);
  });
});

describe('the mention order in words', () => {
  it('names the first three places and leaves the rest to a number', () => {
    expect([1, 2, 3, 4, 11].map(mentionOrderKey)).toEqual(['first', 'second', 'third', 'other', 'other']);
  });
});
