import { describe, expect, it } from 'vitest';

import { groupByAnswer, positionOf } from './group-answers';
import type { CitationRow } from './types';

const rowOf = (observationId: string, index: number): CitationRow => ({
  observation_id: observationId,
  observed_at: '2026-11-09T02:00:00Z',
  prompt_id: '11111111-1111-4111-8111-111111111111',
  engine_code: 'chatgpt_web',
  citation_index: index,
  url_id: 100 + index,
  url: `https://example.com/page-${String(index)}`,
  raw_url: `https://example.com/page-${String(index)}`,
  host: 'example.com',
  registrable_domain: 'example.com',
  title: null,
  citation_kind: 'inline',
  domain_role: 'third_party',
  role_entity_id: null,
  occurrences: 1,
});

/** Two whole answers and the start of a third, newest first, as the list gives them. */
const ROWS = [rowOf('30', 1), rowOf('30', 2), rowOf('20', 1), rowOf('20', 2), rowOf('20', 3), rowOf('10', 1)];

describe('groupByAnswer', () => {
  it('keeps whole answers, in the order of the list, with the rows and the count of each', () => {
    const groups = groupByAnswer(ROWS, false);
    expect(groups.map((group) => [group.observationId, group.count])).toEqual([
      ['30', 2],
      ['20', 3],
      ['10', 1],
    ]);
    expect(groups[1]?.rows.map((row) => row.citation_index)).toEqual([1, 2, 3]);
  });

  it('drops the last answer when more rows follow, because it may be cut', () => {
    const groups = groupByAnswer(ROWS, true);
    expect(groups.map((group) => group.observationId)).toEqual(['30', '20']);
  });

  it('gives nothing for a page of one answer that may go on, and nothing for no row', () => {
    expect(groupByAnswer([rowOf('30', 1), rowOf('30', 2)], true)).toEqual([]);
    expect(groupByAnswer([], false)).toEqual([]);
    expect(groupByAnswer([], true)).toEqual([]);
  });
});

describe('positionOf', () => {
  it('counts the rows of the answer', () => {
    const answer = groupByAnswer(ROWS, false)[1]?.rows ?? [];
    expect(positionOf(rowOf('20', 2), answer)).toEqual({ index: 2, count: 3 });
  });

  it('counts a source listed twice as two rows, as the list does', () => {
    const answer = [rowOf('20', 1), rowOf('20', 2), { ...rowOf('20', 3), url_id: 101 }];
    expect(positionOf(rowOf('20', 3), answer)).toEqual({ index: 3, count: 3 });
  });
});
