import { describe, expect, it } from 'vitest';

import { UNTIERED_LANE, direction, laneOf, laneSet, placeOnce } from './tier-lanes';

describe('laneOf', () => {
  it('is the tier position, and 99 for Untiered', () => {
    expect(laneOf(1)).toBe(1);
    expect(laneOf(null)).toBe(UNTIERED_LANE);
  });
});

describe('direction', () => {
  it('goes up toward T1, down to a lower tier, or sideways', () => {
    expect(direction(3, 1)).toBe('up');
    expect(direction(UNTIERED_LANE, 4)).toBe('up');
    expect(direction(1, 2)).toBe('down');
    expect(direction(2, UNTIERED_LANE)).toBe('down');
    expect(direction(2, 2)).toBe('side');
  });
});

describe('laneSet', () => {
  const tiers = [1, 2, 3, 4];

  it('lists lanes from the lowest tier on the left to T1 on the right, Untiered first', () => {
    const lanes = laneSet({ tiers, inView: new Set([1, 3, UNTIERED_LANE]), focusLane: 3, hidden: new Set() });
    expect(lanes.map((lane) => lane.pos)).toEqual([UNTIERED_LANE, 4, 3, 2, 1]);
  });

  it('shows the Untiered lane only when an untiered page is in view', () => {
    const lanes = laneSet({ tiers, inView: new Set([1, 3]), focusLane: 3, hidden: new Set() });
    expect(lanes.map((lane) => lane.pos)).toEqual([4, 3, 2, 1]);
  });

  it('turns a lane off with a chip but never the focus page lane', () => {
    const lanes = laneSet({ tiers, inView: new Set([1, 3]), focusLane: 3, hidden: new Set([3, 4]) });
    expect(lanes.map((lane) => lane.pos)).toEqual([3, 2, 1]);
  });

  it('makes one lane of a position given twice, Untiered included', () => {
    const lanes = laneSet({
      tiers: [1, 2, 2, UNTIERED_LANE],
      inView: new Set([UNTIERED_LANE]),
      focusLane: 1,
      hidden: new Set(),
    });
    expect(lanes.map((lane) => lane.pos)).toEqual([UNTIERED_LANE, 2, 1]);
  });

  it('always shows an Untiered focus lane, even when it is turned off and nothing untiered is in view', () => {
    const lanes = laneSet({ tiers, inView: new Set(), focusLane: UNTIERED_LANE, hidden: new Set([UNTIERED_LANE]) });
    expect(lanes.map((lane) => lane.pos)).toEqual([UNTIERED_LANE, 4, 3, 2, 1]);
  });

  it('hides the Untiered lane with its chip when it is not the focus lane', () => {
    const lanes = laneSet({ tiers, inView: new Set([UNTIERED_LANE]), focusLane: 1, hidden: new Set([UNTIERED_LANE]) });
    expect(lanes.map((lane) => lane.pos)).toEqual([4, 3, 2, 1]);
  });

  it('copes with no tiers: only the focus lane remains', () => {
    expect(laneSet({ tiers: [], inView: new Set(), focusLane: UNTIERED_LANE, hidden: new Set() })).toHaveLength(1);
    expect(laneSet({ tiers: [], inView: new Set(), focusLane: 3, hidden: new Set() }).map((lane) => lane.pos)).toEqual([
      3,
    ]);
    expect(
      laneSet({ tiers: [], inView: new Set([UNTIERED_LANE]), focusLane: 3, hidden: new Set() }).map((lane) => lane.pos),
    ).toEqual([UNTIERED_LANE, 3]);
  });

  it('does not change its inputs', () => {
    const given = [3, 1, 2];
    const hidden = new Set([2]);
    laneSet({ tiers: given, inView: new Set([1]), focusLane: 1, hidden });
    expect(given).toEqual([3, 1, 2]);
    expect([...hidden]).toEqual([2]);
  });

  it('marks the focus lane and counts the pages in each lane, empty lanes included', () => {
    const lanes = laneSet({ tiers, inView: new Set([1]), focusLane: 1, hidden: new Set(), counts: new Map([[1, 4]]) });
    const t1 = lanes.find((lane) => lane.pos === 1);
    const t2 = lanes.find((lane) => lane.pos === 2);
    expect(t1).toMatchObject({ isFocus: true, count: 4, empty: false });
    expect(t2).toMatchObject({ isFocus: false, count: 0, empty: true });
  });
});

describe('placeOnce', () => {
  it('puts a page on the canvas once however many links reach it, and aliases the others', () => {
    const placed = placeOnce([
      { key: 'o:1', urlId: '1' },
      { key: 'i:2', urlId: '2' },
      { key: 'o:1.2', urlId: '2' },
      { key: 'o:1.3', urlId: '3' },
    ]);
    expect(placed.cards.map((card) => card.key)).toEqual(['o:1', 'i:2', 'o:1.3']);
    expect(placed.alias.get('o:1.2')).toBe('i:2');
    expect(placed.alias.has('o:1')).toBe(false);
  });

  it('keeps the focus page as the first placement', () => {
    const placed = placeOnce([{ key: 'o:5', urlId: '9' }], { key: 'f', urlId: '9' });
    expect(placed.cards).toEqual([]);
    expect(placed.alias.get('o:5')).toBe('f');
  });
});
