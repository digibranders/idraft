import { describe, expect, it } from 'vitest';

import { bodyFilterOf, bulkTarget, targetBatches } from './bulk-target';

describe('bulk targets', () => {
  it('sends the list filters as a body filter, active by default, with the search as q', () => {
    expect(
      bodyFilterOf(
        { 'filter[is_active]': false, 'filter[intent_in]': ['commercial'], 'filter[priority_lte]': 2 },
        ' crm ',
      ),
    ).toEqual({ is_active: false, intent_in: ['commercial'], priority_lte: 2, q: 'crm' });
    expect(bodyFilterOf({}, '')).toEqual({ is_active: true });
  });

  it('chooses ids, or the filters for every match', () => {
    expect(bulkTarget({ ids: new Set(['a', 'b']), allMatching: false }, {}, '')).toEqual({ ids: ['a', 'b'] });
    expect(bulkTarget({ ids: new Set(['a']), allMatching: true }, { 'filter[is_active]': true }, '')).toEqual({
      filter: { is_active: true },
    });
  });

  it('splits ids into requests the API takes, and sends a filter once', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `id-${String(index)}`);
    expect(targetBatches({ ids }, 5).map((batch) => ('ids' in batch ? batch.ids.length : 0))).toEqual([5, 5, 2]);
    expect(targetBatches({ filter: { is_active: true } })).toEqual([{ filter: { is_active: true } }]);
  });
});
