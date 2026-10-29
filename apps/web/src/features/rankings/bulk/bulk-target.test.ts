import { describe, expect, it } from 'vitest';

import { batchSizeFor, bodyFilterOf, bulkTarget, groupsHeldBy, matchCountQuery, targetBatches } from './bulk-target';
import { keywordFilters } from '../rankings-queries';
import type { FilterValues } from '@/components/app/filters/types';
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

  it('sends every rank filter of the list in the body, with the list’s own values, and no other', () => {
    const chosen = (values: FilterValues): ReturnType<typeof bodyFilterOf> =>
      bodyFilterOf(keywordFilters(values, false), '');
    expect(chosen({ rank: { kind: 'enum', values: ['top10'] } })).toEqual({
      is_active: true,
      rank_gte: 4,
      rank_lte: 10,
    });
    expect(chosen({ rank: { kind: 'enum', values: ['beyond'] } })).toEqual({ is_active: true, rank_is_null: true });
    expect(chosen({ chg: { kind: 'enum', values: ['improved'] } })).toEqual({ is_active: true, improved: true });
    expect(chosen({ chg: { kind: 'enum', values: ['declined'] } })).toEqual({ is_active: true, declined: true });
    expect(chosen({ chg: { kind: 'enum', values: ['entered'] } })).toEqual({
      is_active: true,
      rank_change_label_in: ['new'],
    });
    expect(chosen({ chg: { kind: 'enum', values: ['lost'] } })).toEqual({
      is_active: true,
      rank_change_label_in: ['lost'],
    });
    expect(chosen({ stale: { kind: 'enum', values: ['stale'] } })).toEqual({ is_active: true, is_stale: true });
    expect(
      chosen({
        rank: { kind: 'enum', values: ['top3'] },
        chg: { kind: 'enum', values: ['declined'] },
        stale: { kind: 'enum', values: ['stale'] },
      }),
    ).toEqual({ is_active: true, rank_gte: 1, rank_lte: 3, declined: true, is_stale: true });
    expect(
      chosen({
        feat: { kind: 'enum', values: ['video'] },
        featown: { kind: 'enum', values: ['featured_snippet'] },
      }),
    ).toEqual({ is_active: true, feature_present: 'video', feature_owned: 'featured_snippet' });
  });

  it('sends the search as the API takes it: printable and at most 200 characters, and none when nothing is left', () => {
    expect(bodyFilterOf({}, 'seo\tagency')).toEqual({ is_active: true, q: 'seo agency' });
    expect(bodyFilterOf({}, 'x'.repeat(300)).q).toHaveLength(200);
    expect(bodyFilterOf({}, '​ ')).toEqual({ is_active: true });
  });

  it('counts the matches with the list read the screen shows them by: its filters and search, one row', () => {
    expect(matchCountQuery({ 'filter[is_active]': true, 'filter[rank_lte]': 3 }, ' crm ')).toEqual({
      'filter[is_active]': true,
      'filter[rank_lte]': 3,
      'filter[q]': 'crm',
      limit: 1,
    });
    // No search, no `filter[q]`; and the body filter of the same filters names the same keywords
    expect(matchCountQuery({ 'filter[is_active]': false }, '')).toEqual({ 'filter[is_active]': false, limit: 1 });
    expect(matchCountQuery({ 'filter[is_active]': true }, 'x'.repeat(300))['filter[q]']).toHaveLength(200);
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
