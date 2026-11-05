import { describe, expect, it, vi } from 'vitest';

import { groupedRows } from './grouped-rows';
import { chosenCount, keywordActions, keywordOrder, treeOf, unrenderedCount } from './use-grouped-table';
import { memberIds, pairRows, type PairedRow } from '../keyword-pairs';
import type { RecordAction } from '@/components/app/data-table/types';
import type { TrackedKeywordRow } from '@/lib/api/types';

/** A row with the fields the grouped model reads; the one place it is taken for the API's full row. */
const tracked = (id: string, keyword: string, groups: readonly string[], device: 'desktop' | 'mobile' = 'desktop') =>
  ({
    tracked_keyword_id: id,
    keyword: { keyword_id: `k-${keyword}`, text: keyword },
    device,
    location_id: 2276,
    language_code: 'en',
    search_engine: 'google',
    groups: groups.map((group) => ({ group_id: group, name: group, path: group })),
    metrics: null,
    state: { current: { state: 'not_checked', rank: null }, aio: { state: 'absent' }, last_observed_at: null },
  }) as unknown as TrackedKeywordRow;

const API_ROWS = [
  tracked('t1', 'alpha', ['g1']),
  tracked('m1', 'alpha', ['g1'], 'mobile'),
  tracked('t2', 'beta', ['g1', 'g2']),
  tracked('t3', 'gamma', ['g2']),
];
const rows: PairedRow[] = pairRows(API_ROWS, 'desktop');
const list = (expanded: readonly string[]) =>
  groupedRows({ rows, notGroupedLabel: 'Not grouped', expanded: new Set(expanded), showAll: new Set() });

describe('the By group table', () => {
  it('places groups at level 1 and the rows of an open group at level 2, counted within that group', () => {
    const tree = treeOf(list(['g1']));
    expect(tree.get('group:g1')).toEqual({ level: 1, expanded: true, setSize: 2, posInSet: 1 });
    expect(tree.get('group:g2')).toEqual({ level: 1, expanded: false, setSize: 2, posInSet: 2 });
    expect(tree.get('g1:t1')).toEqual({ level: 2, setSize: 2, posInSet: 1 });
    expect(tree.get('g1:t2')).toEqual({ level: 2, setSize: 2, posInSet: 2 });
  });

  it('steps through keyword rows only, a keyword in two groups once', () => {
    const shown = list(['g1', 'g2']);
    expect(
      keywordOrder(
        shown,
        shown.map((row) => row.id),
      ),
    ).toEqual(['t1', 't2', 't3']);
  });

  it('counts a keyword chosen on either device once, and the chosen keywords no row shows', () => {
    expect(chosenCount(new Set(['t1', 'm1', 't3']), memberIds(rows))).toBe(2);
    expect(unrenderedCount(list(['g1']), rows, new Set(['t1', 't3']))).toBe(1);
    expect(unrenderedCount(list(['g1', 'g2']), rows, new Set(['t1', 't3']))).toBe(0);
  });

  it('runs a flat action on the chosen keywords, whatever rows the table hands over', () => {
    const onSelect = vi.fn();
    const action: RecordAction<PairedRow> = { id: 'archive', label: 'Archive', group: 'destructive', onSelect };
    const [grouped] = keywordActions([action], rows, new Set(['t3']));
    grouped?.onSelect(list(['g2']), { ids: new Set(['group:g2']), allMatching: true });
    expect(onSelect).toHaveBeenCalledWith([rows[2]], { ids: new Set(['t3']), allMatching: false });
  });
});
