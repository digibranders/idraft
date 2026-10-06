import { describe, expect, it } from 'vitest';

import { batchSizeFor, bodyFilterOf, bulkTarget, groupsHeldBy, targetBatches } from './bulk-target';
import type { TrackedKeywordRow } from '@/lib/api/types';

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

  it('sizes a batch of ids so that ids times the groups and terms named stay within 200,000', () => {
    expect(batchSizeFor(0)).toBe(5_000);
    expect(batchSizeFor(1)).toBe(5_000);
    expect(batchSizeFor(40)).toBe(5_000);
    // 5,000 chosen and 50 groups named: 4,000 at a time
    expect(batchSizeFor(50)).toBe(4_000);
    expect(batchSizeFor(101)).toBe(1_980);
    expect(batchSizeFor(400)).toBe(500);
    expect(batchSizeFor(1_000_000)).toBe(1);
  });

  describe('the groups the keywords of a target are in', () => {
    const row = (
      id: string,
      groups: string[] | null | undefined,
    ): Pick<TrackedKeywordRow, 'tracked_keyword_id' | 'groups'> => ({
      tracked_keyword_id: id,
      ...(groups === undefined
        ? {}
        : {
            groups: groups === null ? null : groups.map((group_id) => ({ group_id, name: group_id, path: group_id })),
          }),
    });
    const rows = [row('a', ['g1', 'g2']), row('b', ['g2']), row('c', []), row('d', ['g3'])];

    it('is the union of the chosen rows’ groups, and nothing for rows that are in none', () => {
      expect(groupsHeldBy({ ids: ['a', 'b'] }, rows, false)).toEqual(new Set(['g1', 'g2']));
      expect(groupsHeldBy({ ids: ['c'] }, rows, false)).toEqual(new Set());
    });

    it('is not known when a chosen row is not loaded or was read without its groups', () => {
      expect(groupsHeldBy({ ids: ['a', 'elsewhere'] }, rows, true)).toBeNull();
      expect(groupsHeldBy({ ids: ['x'] }, [row('x', undefined)], true)).toBeNull();
      expect(groupsHeldBy({ ids: ['x'] }, [row('x', null)], true)).toBeNull();
    });

    it('is the union over every row for a filter, and only when the rows are all its matches', () => {
      const filter = { filter: { is_active: true } };
      expect(groupsHeldBy(filter, rows, true)).toEqual(new Set(['g1', 'g2', 'g3']));
      expect(groupsHeldBy(filter, rows, false)).toBeNull();
      expect(groupsHeldBy(filter, [...rows, row('e', undefined)], true)).toBeNull();
    });
  });

  it('splits ids into requests the API takes, and sends a filter once', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `id-${String(index)}`);
    expect(targetBatches({ ids }, 5).map((batch) => ('ids' in batch ? batch.ids.length : 0))).toEqual([5, 5, 2]);
    expect(targetBatches({ filter: { is_active: true } })).toEqual([{ filter: { is_active: true } }]);
  });
});
