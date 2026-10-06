import { describe, expect, it } from 'vitest';

import { MAX_FILTER_VALUES, keywordFilters } from './rankings-queries';
import { mockId } from '@/mocks/mock-ids';

describe('the filters sent to the API', () => {
  it('sends at most 100 tags or topics, the most a list filter takes, whatever a link names', () => {
    const terms = Array.from({ length: 150 }, (_, index) => mockId('term', index + 1));
    const sent = keywordFilters({ tag: { kind: 'enum', values: terms } }, false)['filter[term]'];
    expect(MAX_FILTER_VALUES).toBe(100);
    expect(sent).toEqual(terms.slice(0, 100));
  });

  it('sends a rank filter only when its chip is chosen, and never an empty one', () => {
    expect(Object.keys(keywordFilters({}, false))).toEqual(['filter[is_active]']);
    const sent = keywordFilters(
      { rank: { kind: 'enum', values: ['top3'] }, intent: { kind: 'enum', values: ['commercial'] } },
      true,
    );
    expect(sent).toEqual({
      'filter[is_active]': false,
      'filter[intent_in]': ['commercial'],
      'filter[rank_gte]': 1,
      'filter[rank_lte]': 3,
    });
  });

  it('sends the values of a hand-edited link that are ids, and leaves the rest out', () => {
    const [first] = [mockId('term', 1)];
    expect(keywordFilters({ tag: { kind: 'enum', values: ['nonsense', first ?? ''] } }, false)['filter[term]']).toEqual(
      [first],
    );
    expect(keywordFilters({ tag: { kind: 'enum', values: ['nonsense'] } }, false)).not.toHaveProperty('filter[term]');
  });
});
