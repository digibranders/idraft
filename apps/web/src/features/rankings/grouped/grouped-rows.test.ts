import { describe, expect, it } from 'vitest';

import {
  applySelectionChange,
  buildGroups,
  GROUP_PREVIEW,
  groupedRows,
  groupMeasures,
  NOT_GROUPED,
  selectionOf,
  shownIdsOf,
  toggleGroupIds,
  trackedIdsOf,
  type GroupedRow,
  type GroupSort,
} from './grouped-rows';
import { pairRows, type PairedRow } from '../keyword-pairs';
import type { TrackedKeywordRow } from '@/lib/api/types';

interface Options {
  device?: 'desktop' | 'mobile';
  location?: number;
  /** Group ids, `null` for a row the API sent with `groups: null`; a repeated id is a repeated reference. */
  groups?: readonly string[] | null;
  rank?: number | null;
  volume?: number | null;
  cpc?: string | null;
  aio?: 'present_cited' | 'absent';
  seen?: string | null;
}

/** The fields of a row the grouped model reads, typed against the API's row. */
interface Fixture extends Pick<TrackedKeywordRow, 'tracked_keyword_id' | 'device' | 'location_id' | 'language_code'> {
  search_engine: 'google';
  keyword: { keyword_id: string; text: string };
  groups: { group_id: string; name: string; path: string }[] | null;
  metrics: { search_volume: { value: number | null }; cpc_usd: string | null };
  state: {
    current: { state: 'ranked' | 'not_checked'; rank: number | null };
    aio: { state: 'present_cited' | 'absent' };
    last_observed_at: string | null;
  };
}

/** A row with only the fields above; the one place the fixture is taken for the API's full row. */
const tracked = (id: string, keyword: string, over: Options = {}): TrackedKeywordRow => {
  const fixture: Fixture = {
    tracked_keyword_id: id,
    keyword: { keyword_id: `k-${keyword}`, text: keyword },
    device: over.device ?? 'desktop',
    location_id: over.location ?? 2356,
    language_code: 'en',
    search_engine: 'google',
    groups:
      over.groups === null
        ? null
        : (over.groups ?? []).map((group) => ({ group_id: group, name: group, path: `Path / ${group}` })),
    metrics: { search_volume: { value: over.volume ?? null }, cpc_usd: over.cpc ?? null },
    state: {
      current:
        over.rank === undefined || over.rank === null
          ? { state: 'not_checked', rank: null }
          : { state: 'ranked', rank: over.rank },
      aio: { state: over.aio ?? 'absent' },
      last_observed_at: over.seen ?? null,
    },
  };
  return fixture as unknown as TrackedKeywordRow;
};

const paired = (rows: readonly TrackedKeywordRow[]): PairedRow[] => pairRows(rows, 'desktop');

const build = (
  rows: readonly PairedRow[],
  over: { expanded?: string[]; showAll?: string[]; sort?: GroupSort } = {},
): GroupedRow[] =>
  groupedRows({
    rows,
    notGroupedLabel: 'Not grouped',
    expanded: new Set(over.expanded ?? []),
    showAll: new Set(over.showAll ?? []),
    ...(over.sort === undefined ? {} : { sort: over.sort }),
  });
const idsOf = (list: readonly GroupedRow[]): string[] => list.map((entry) => entry.id);

const THREE = paired([
  tracked('a-d', 'alpha', { groups: ['G1'], rank: 2 }),
  tracked('b-d', 'bravo', { groups: ['G1', 'G2'], rank: 14 }),
  tracked('c-d', 'charlie'),
]);

describe('buildGroups', () => {
  it('lists a group per direct group, the keyword in several under each, and Not grouped last', () => {
    const groups = buildGroups(THREE, 'Not grouped');

    expect(groups.map((g) => [g.groupId, g.label, g.measures.size])).toEqual([
      ['G1', 'Path / G1', 2],
      ['G2', 'Path / G2', 1],
      [NOT_GROUPED, 'Not grouped', 1],
    ]);
  });

  it('puts a keyword whose groups list is null, or empty, in Not grouped', () => {
    const rows = paired([tracked('x-d', 'xray', { groups: null }), tracked('y-d', 'yankee', { groups: [] })]);

    const groups = buildGroups(rows, 'None');

    expect(groups.map((g) => [g.groupId, g.label, g.rows.length])).toEqual([[NOT_GROUPED, 'None', 2]]);
  });

  it('lists a keyword once under a group that its row names twice', () => {
    const rows = paired([tracked('a-d', 'alpha', { groups: ['G1', 'G1'], volume: 10 })]);

    const [group] = buildGroups(rows, 'Not grouped');

    expect(group?.rows).toHaveLength(1);
    expect(group?.measures).toMatchObject({ size: 1, volume: 10 });
    expect(idsOf(build(rows, { expanded: ['G1'] }))).toEqual(['group:G1', 'G1:a-d']);
  });

  it('counts a keyword tracked in two countries once, by the place it ranks best in', () => {
    const rows = paired([
      tracked('a-d', 'alpha', { groups: ['G1'], rank: 9 }),
      tracked('a-d-us', 'alpha', { groups: ['G1'], rank: 3, location: 2840 }),
    ]);

    const [group] = buildGroups(rows, 'Not grouped');

    expect(group?.rows).toHaveLength(2);
    expect(group?.measures).toMatchObject({ size: 1, top3: 1, top10: 1 });
  });

  it('reaches both devices of each keyword through memberIds', () => {
    const rows = paired([
      tracked('a-d', 'alpha', { groups: ['G1'] }),
      tracked('a-m', 'alpha', { groups: ['G1'], device: 'mobile' }),
      tracked('b-d', 'bravo', { groups: ['G1'] }),
    ]);

    const groups = buildGroups(rows, 'Not grouped');

    expect(groups.map((g) => trackedIdsOf(g).toSorted())).toEqual([['a-d', 'a-m', 'b-d']]);
  });
});

describe('groupMeasures', () => {
  it('counts the rank buckets, sums the volume, averages the CPC and finds the newest check', () => {
    const rows = paired([
      tracked('a-d', 'alpha', {
        rank: 2,
        volume: 100,
        cpc: '1.00',
        aio: 'present_cited',
        seen: '2026-11-01T10:00:00Z',
      }),
      tracked('b-d', 'bravo', { rank: 14, volume: null, cpc: '3.00', seen: '2026-11-03T10:00:00Z' }),
      tracked('c-d', 'charlie', { rank: 40, volume: 50 }),
    ]);

    expect(groupMeasures(rows)).toEqual({
      size: 3,
      top3: 1,
      top10: 1,
      top20: 2,
      volume: 150,
      cpc: 2,
      cited: 1,
      updated: '2026-11-03T10:00:00Z',
    });
  });

  it('has no CPC and no check time when none of the keywords has one', () => {
    expect(groupMeasures(paired([tracked('a-d', 'alpha')]))).toMatchObject({ cpc: null, updated: null, volume: 0 });
  });

  it('skips a CPC of zero, an empty one and one that is not a number', () => {
    const rows = paired([
      tracked('a-d', 'alpha', { cpc: '0.00' }),
      tracked('b-d', 'bravo', { cpc: '' }),
      tracked('c-d', 'charlie', { cpc: 'n/a' }),
      tracked('d-d', 'delta', { cpc: '4.00' }),
    ]);

    expect(groupMeasures(rows).cpc).toBe(4);
    expect(groupMeasures(rows.slice(0, 3)).cpc).toBeNull();
  });

  describe('a keyword tracked in two countries', () => {
    const rank = (best: 'uk' | 'us'): PairedRow[] =>
      paired([
        tracked('a-uk', 'alpha', {
          rank: best === 'uk' ? 2 : 30,
          volume: 1000,
          cpc: '1.00',
          location: 2826,
          seen: '2026-11-01T10:00:00Z',
        }),
        tracked('a-us', 'alpha', {
          rank: best === 'us' ? 2 : 30,
          volume: 50000,
          cpc: '3.00',
          aio: 'present_cited',
          location: 2840,
          seen: '2026-11-04T10:00:00Z',
        }),
      ]);

    it.each(['uk', 'us'] as const)('sums its volume over both countries whichever ranks better (%s)', (best) => {
      expect(groupMeasures(rank(best))).toMatchObject({ size: 1, volume: 51000 });
    });

    it('counts the keyword once in a rank bucket, at the place it ranks best in', () => {
      expect(groupMeasures(rank('uk'))).toMatchObject({ top3: 1, top10: 1, top20: 1 });
      expect(groupMeasures(rank('us'))).toMatchObject({ top3: 1, top10: 1, top20: 1 });
    });

    it('counts it as cited when any country cites the site, once', () => {
      expect(groupMeasures(rank('uk')).cited).toBe(1);
      expect(
        groupMeasures(paired([tracked('a-uk', 'alpha'), tracked('a-us', 'alpha', { location: 2840 })])).cited,
      ).toBe(0);
    });

    it('averages the CPC over both countries and takes the newest check over both', () => {
      expect(groupMeasures(rank('uk'))).toMatchObject({ cpc: 2, updated: '2026-11-04T10:00:00Z' });
    });
  });
});

describe('groupedRows', () => {
  it('shows only the group rows while every group is closed', () => {
    expect(idsOf(build(THREE))).toEqual(['group:G1', 'group:G2', `group:${NOT_GROUPED}`]);
    expect(build(THREE).every((entry) => entry.kind === 'group' && !entry.expanded)).toBe(true);
  });

  it('shows the keywords of an open group under it, best rank first', () => {
    const list = build(THREE, { expanded: ['G1'] });

    expect(list.map((entry) => entry.kind)).toEqual(['group', 'keyword', 'keyword', 'group', 'group']);
    expect(idsOf(list)).toEqual(['group:G1', 'G1:a-d', 'G1:b-d', 'group:G2', `group:${NOT_GROUPED}`]);
  });

  it('puts unranked keywords after ranked ones', () => {
    const rows = paired([
      tracked('u-d', 'unranked', { groups: ['G1'] }),
      tracked('r-d', 'ranked', { groups: ['G1'], rank: 30 }),
    ]);

    expect(idsOf(build(rows, { expanded: ['G1'] }))).toEqual(['group:G1', 'G1:r-d', 'G1:u-d']);
  });

  it('gives a keyword listed under two groups a row id of its own under each', () => {
    const list = build(THREE, { expanded: ['G1', 'G2'] });

    expect(idsOf(list)).toEqual(['group:G1', 'G1:a-d', 'G1:b-d', 'group:G2', 'G2:b-d', `group:${NOT_GROUPED}`]);
    expect(new Set(idsOf(list)).size).toBe(list.length);
  });

  describe('a group with more than eight keywords', () => {
    const many = paired(
      Array.from({ length: GROUP_PREVIEW + 3 }, (_, at) =>
        tracked(`k${String(at)}-d`, `kw ${String(at).padStart(2, '0')}`, { groups: ['G1'], rank: at + 1 }),
      ),
    );

    it('shows the first eight and a row for the rest when it is open', () => {
      const list = build(many, { expanded: ['G1'] });

      expect(list).toHaveLength(1 + GROUP_PREVIEW + 1);
      expect(list.at(-1)).toEqual({ kind: 'more', id: 'more:G1', groupId: 'G1', hidden: 3 });
    });

    it('counts rows (places) in what is hidden, while the group counts keywords', () => {
      const places = paired([
        ...Array.from({ length: GROUP_PREVIEW }, (_, at) =>
          tracked(`p${String(at)}-d`, `p ${String(at)}`, { groups: ['G'], rank: at + 1 }),
        ),
        tracked('q-uk', 'q', { groups: ['G'], location: 2826 }),
        tracked('q-us', 'q', { groups: ['G'], location: 2840 }),
      ]);

      const list = build(places, { expanded: ['G'] });

      expect(list.at(-1)).toMatchObject({ kind: 'more', hidden: 2 });
      expect(list[0]).toMatchObject({ kind: 'group', group: { measures: { size: GROUP_PREVIEW + 1 } } });
    });

    it('shows them all, and no such row, once the group is in showAll', () => {
      const list = build(many, { expanded: ['G1'], showAll: ['G1'] });

      expect(list).toHaveLength(1 + GROUP_PREVIEW + 3);
      expect(list.some((entry) => entry.kind === 'more')).toBe(false);
    });

    it('has no such row while the group is closed', () => {
      expect(build(many, { showAll: [] }).some((entry) => entry.kind === 'more')).toBe(false);
    });

    it('has no such row at exactly eight keywords', () => {
      const eight = paired(
        Array.from({ length: GROUP_PREVIEW }, (_, at) =>
          tracked(`e${String(at)}-d`, `e ${String(at)}`, { groups: ['G'] }),
        ),
      );

      expect(build(eight, { expanded: ['G'] }).some((entry) => entry.kind === 'more')).toBe(false);
    });
  });

  describe('the order of the groups', () => {
    const rows = paired([
      tracked('a1', 'a1', { groups: ['beta'], rank: 7, volume: 10 }),
      tracked('a2', 'a2', { groups: ['beta'], volume: 10 }),
      tracked('b1', 'b1', { groups: ['Alpha'], rank: 3, volume: 5 }),
      tracked('c1', 'c1', { groups: ['Zeta'], volume: 500 }),
      tracked('n1', 'n1'),
    ]);
    const order = (sort: GroupSort): string[] => idsOf(build(rows, { sort }));

    it('is by size, most first, unless told otherwise', () => {
      expect(idsOf(build(rows))[0]).toBe('group:beta');
      expect(order({ by: 'size', desc: false })).toEqual([
        'group:Alpha',
        'group:Zeta',
        'group:beta',
        `group:${NOT_GROUPED}`,
      ]);
    });

    it('is by name with the locale, not by code point', () => {
      expect(order({ by: 'name', desc: false })).toEqual([
        'group:Alpha',
        'group:beta',
        'group:Zeta',
        `group:${NOT_GROUPED}`,
      ]);
      expect(order({ by: 'name', desc: true })).toEqual([
        'group:Zeta',
        'group:beta',
        'group:Alpha',
        `group:${NOT_GROUPED}`,
      ]);
    });

    it('is by volume', () => {
      expect(order({ by: 'volume', desc: true })).toEqual([
        'group:Zeta',
        'group:beta',
        'group:Alpha',
        `group:${NOT_GROUPED}`,
      ]);
    });

    it('is by best rank with the groups that have none last, in either direction', () => {
      expect(order({ by: 'rank', desc: false })).toEqual([
        'group:Alpha',
        'group:beta',
        'group:Zeta',
        `group:${NOT_GROUPED}`,
      ]);
      expect(order({ by: 'rank', desc: true })).toEqual([
        'group:beta',
        'group:Alpha',
        'group:Zeta',
        `group:${NOT_GROUPED}`,
      ]);
    });

    it('keeps Not grouped last whatever the sort', () => {
      const small = paired([tracked('n1', 'n1'), tracked('n2', 'n2'), tracked('g1', 'g1', { groups: ['G'], rank: 1 })]);
      for (const by of ['size', 'name', 'volume', 'rank'] as const) {
        for (const desc of [true, false]) {
          expect(idsOf(build(small, { sort: { by, desc } })).at(-1)).toBe(`group:${NOT_GROUPED}`);
        }
      }
    });
  });
});

describe('selection', () => {
  // G1: alpha (desktop a-d, mobile a-m) and bravo (b-d); G2: bravo; Not grouped: charlie
  const rows = paired([
    tracked('a-d', 'alpha', { groups: ['G1'] }),
    tracked('a-m', 'alpha', { groups: ['G1'], device: 'mobile' }),
    tracked('b-d', 'bravo', { groups: ['G1', 'G2'] }),
    tracked('c-d', 'charlie'),
  ]);
  const open = build(rows, { expanded: ['G1', 'G2'] });
  const group = (id: string): Extract<GroupedRow, { kind: 'group' }> => {
    const found = open.find((entry) => entry.kind === 'group' && entry.group.groupId === id);
    if (found?.kind !== 'group') throw new Error(`no group ${id}`);
    return found;
  };

  describe('selectionOf', () => {
    it('selects nothing when nothing is chosen', () => {
      expect(selectionOf(open, new Set())).toEqual({ selectedIds: new Set(), indeterminateIds: new Set() });
    });

    it('selects every copy of a chosen keyword and leaves the groups partly selected', () => {
      const { selectedIds, indeterminateIds } = selectionOf(open, new Set(['b-d']));

      expect(selectedIds).toEqual(new Set(['G1:b-d', 'G2:b-d', 'group:G2']));
      expect(indeterminateIds).toEqual(new Set(['group:G1']));
    });

    it('selects a group when all its keywords are chosen', () => {
      const { selectedIds, indeterminateIds } = selectionOf(open, new Set(['a-d', 'b-d']));

      expect(selectedIds).toEqual(new Set(['group:G1', 'G1:a-d', 'G1:b-d', 'group:G2', 'G2:b-d']));
      expect(indeterminateIds.size).toBe(0);
    });

    it('counts a keyword chosen through its other device', () => {
      expect(selectionOf(open, new Set(['a-m'])).selectedIds).toEqual(new Set(['G1:a-d']));
    });

    it('never selects a show-all row', () => {
      const withMore = [...open, { kind: 'more', id: 'more:G1', groupId: 'G1', hidden: 2 } as const];

      expect(selectionOf(withMore, new Set(['a-d', 'b-d', 'c-d'])).selectedIds.has('more:G1')).toBe(false);
    });
  });

  describe('trackedIdsOf', () => {
    it('gives the ids of both devices of every keyword, also those of a closed group', () => {
      const closed = build(rows);

      const g1 = closed.find((entry) => entry.kind === 'group' && entry.group.groupId === 'G1');
      expect(g1?.kind === 'group' && trackedIdsOf(g1.group).toSorted()).toEqual(['a-d', 'a-m', 'b-d']);
    });
  });

  describe('shownIdsOf', () => {
    it('gives the shown id of each keyword row of the group, one per row', () => {
      expect(shownIdsOf(group('G1').group).toSorted()).toEqual(['a-d', 'b-d']);
    });
  });

  describe('toggleGroupIds', () => {
    it('adds the shown id of each keyword of a group that is not all chosen, not the other device', () => {
      const next = toggleGroupIds(new Set(['b-d']), group('G1').group);

      expect([...next].toSorted()).toEqual(['a-d', 'b-d']);
      expect([...toggleGroupIds(new Set(), group('G1').group)].toSorted()).toEqual(['a-d', 'b-d']);
    });

    it('removes both devices of every keyword of a group that is all chosen, and nothing else', () => {
      const next = toggleGroupIds(new Set(['a-d', 'a-m', 'b-d', 'c-d']), group('G1').group);

      expect([...next]).toEqual(['c-d']);
    });

    it('does not change the set it was given', () => {
      const chosen = new Set(['c-d']);
      toggleGroupIds(chosen, group('G1').group);

      expect([...chosen]).toEqual(['c-d']);
    });
  });

  describe('applySelectionChange', () => {
    const none = new Set<string>();

    it('adds the keyword of a ticked keyword row', () => {
      const next = applySelectionChange(none, none, new Set(['G1:a-d']), open);

      expect([...next]).toEqual(['a-d']);
    });

    it('adds the shown id of each keyword of a ticked group row, also the keywords not shown', () => {
      const closed = build(rows);

      const next = applySelectionChange(none, none, new Set(['group:G1']), closed);

      expect([...next].toSorted()).toEqual(['a-d', 'b-d']);
    });

    it('keeps the chosen ids a count of keyword rows: a group tick adds one id per row', () => {
      const next = applySelectionChange(none, none, new Set(['group:G1']), open);

      expect(next.size).toBe(group('G1').group.rows.length);
    });

    it('removes a keyword on both devices when its row is unticked', () => {
      const chosen = new Set(['a-d', 'a-m', 'c-d']);
      const previous = selectionOf(open, chosen).selectedIds;
      const nextRows = new Set(previous);
      nextRows.delete('G1:a-d');

      expect([...applySelectionChange(chosen, previous, nextRows, open)]).toEqual(['c-d']);
    });

    it('removes both devices of every keyword of an unticked group row', () => {
      const chosen = new Set(['a-d', 'a-m', 'b-d']);
      const previous = selectionOf(open, chosen).selectedIds;
      const nextRows = new Set(previous);
      nextRows.delete('group:G1');

      expect([...applySelectionChange(chosen, previous, nextRows, open)]).toEqual([]);
    });

    it('clears everything when the table clears its selection', () => {
      const chosen = new Set(['a-d', 'a-m', 'b-d', 'c-d']);
      const previous = selectionOf(open, chosen).selectedIds;

      expect(applySelectionChange(chosen, previous, none, open).size).toBe(0);
    });

    it('leaves the chosen ids of keywords it does not show alone', () => {
      const next = applySelectionChange(new Set(['elsewhere']), none, new Set(['G1:a-d']), open);

      expect([...next].toSorted()).toEqual(['a-d', 'elsewhere']);
    });

    describe('a keyword listed under two groups', () => {
      it('is chosen by ticking either copy, and then both copies show ticked', () => {
        const chosen = applySelectionChange(none, none, new Set(['G2:b-d']), open);

        expect([...chosen]).toEqual(['b-d']);
        expect(selectionOf(open, chosen).selectedIds).toEqual(new Set(['G1:b-d', 'G2:b-d', 'group:G2']));
      });

      it('is unchosen by unticking either copy, so the other copy does not stay ticked', () => {
        const chosen = new Set(['b-d']);
        const previous = selectionOf(open, chosen).selectedIds;
        const nextRows = new Set(previous);
        nextRows.delete('G1:b-d');

        const after = applySelectionChange(chosen, previous, nextRows, open);

        expect(after.size).toBe(0);
        expect(selectionOf(open, after).selectedIds.size).toBe(0);
      });

      it('is unchosen when its other group is unticked', () => {
        const chosen = new Set(['b-d']);
        const previous = selectionOf(open, chosen).selectedIds;
        const nextRows = new Set(previous);
        nextRows.delete('group:G2');

        expect(applySelectionChange(chosen, previous, nextRows, open).size).toBe(0);
      });

      it('lets the removal win when one change adds one copy and removes the other', () => {
        const chosen = new Set(['b-d']);
        const previous = new Set(['G1:b-d']);
        const nextRows = new Set(['G2:b-d']);

        expect(applySelectionChange(chosen, previous, nextRows, open).size).toBe(0);
      });
    });
  });
});
