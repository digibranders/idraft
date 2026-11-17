import { describe, expect, it } from 'vitest';

import { FOCUS_KEY, cardKey, groupKey, moreKey } from './journey-layout';
import { openExclusive, openTogether, parseCardKey, type OpenSets } from './journey-open';

const sets = (open: string[], groups: string[] = [], more: [string, number][] = []): OpenSets => ({
  open: new Set(open),
  groups: new Set(groups),
  more: new Map(more),
});

describe('parseCardKey', () => {
  it('reads the side and the path of ids', () => {
    expect(parseCardKey(cardKey('out', ['12', '34']))).toEqual({ side: 'o', ids: ['12', '34'] });
    expect(parseCardKey(cardKey('in', ['7']))).toEqual({ side: 'i', ids: ['7'] });
    expect(parseCardKey('f')).toBeNull();
    expect(parseCardKey('g:o:f:template')).toBeNull();
  });
});

describe('openExclusive', () => {
  const a = cardKey('out', ['1']);
  const ab = cardKey('out', ['1', '2']);
  const c = cardKey('out', ['3']);
  const left = cardKey('in', ['9']);

  it('opens a card and keeps the cards on its own path open', () => {
    const next = openExclusive(sets([a]), ab);
    expect([...next.open].sort()).toEqual([a, ab].sort());
  });

  it('closes every other opened card on its side', () => {
    const next = openExclusive(sets([a, ab]), c);
    expect([...next.open]).toEqual([c]);
  });

  it('leaves the other side alone', () => {
    const next = openExclusive(sets([a, left]), c);
    expect([...next.open].sort()).toEqual([c, left].sort());
  });

  it('drops groups and more counts of cards that closed, and keeps those on the path', () => {
    const onPath = groupKey('out', a, 'template');
    const elsewhere = groupKey('out', c, 'auto_generated');
    const next = openExclusive(
      sets(
        [a, c],
        [onPath, elsewhere],
        [
          [moreKey(a), 8],
          [moreKey(c), 16],
        ],
      ),
      ab,
    );
    expect([...next.groups]).toEqual([onPath]);
    expect([...next.more]).toEqual([[moreKey(a), 8]]);
    expect([...next.open].sort()).toEqual([a, ab].sort());
  });

  it('reads the more keys the layout really makes (side, bar, card key, tier suffix, group key)', () => {
    const group = groupKey('out', a, 'template');
    const next = openExclusive(
      sets(
        [a, c],
        [group],
        [
          [moreKey(`o|${a}`), 8],
          [moreKey(`o|${a}|t2`), 8],
          [moreKey(group), 8],
          [moreKey(`o|${c}`), 16],
          [moreKey('o|f'), 8],
        ],
      ),
      ab,
    );
    expect([...next.more.keys()].sort()).toEqual(
      [moreKey(`o|${a}`), moreKey(`o|${a}|t2`), moreKey(group), moreKey('o|f')].sort(),
    );
  });

  it('closes a card that is open (a second press)', () => {
    const next = openExclusive(sets([a, ab]), ab);
    expect([...next.open]).toEqual([a]);
  });

  it('closing a card removes it and its descendants only, not cards opened beside it', () => {
    const b = cardKey('out', ['2']);
    const next = openExclusive(sets([a, b, c]), a);
    expect([...next.open].sort()).toEqual([b, c].sort());
    const withChild = openExclusive(sets([a, ab, b]), a);
    expect([...withChild.open]).toEqual([b]);
  });

  it('closing a card drops the groups and more counts hanging under it and its descendants', () => {
    const group = groupKey('out', ab, 'template');
    const other = groupKey('out', c, 'template');
    const next = openExclusive(
      sets(
        [a, ab, c],
        [group, other],
        [
          [moreKey(`o|${ab}`), 8],
          [moreKey(group), 8],
          [moreKey(`o|${c}`), 8],
        ],
      ),
      a,
    );
    expect([...next.open]).toEqual([c]);
    expect([...next.groups]).toEqual([other]);
    expect([...next.more.keys()]).toEqual([moreKey(`o|${c}`)]);
  });

  it('presses a group card by only toggling that group', () => {
    const group = groupKey('out', a, 'template');
    const opened = openExclusive(sets([a, ab, c]), group);
    expect([...opened.open].sort()).toEqual([a, ab, c].sort());
    expect([...opened.groups]).toEqual([group]);
    const closed = openExclusive(opened, group);
    expect([...closed.groups]).toEqual([]);
    expect([...closed.open].sort()).toEqual([a, ab, c].sort());
  });

  it('returns the current sets for a key that is neither a card nor a group', () => {
    const current = sets([a], [], [[moreKey('o|f'), 8]]);
    expect(openExclusive(current, FOCUS_KEY)).toBe(current);
    expect(openExclusive(current, moreKey('o|f'))).toBe(current);
  });

  it('matches whole ids on the path: o:1 is not on the path of o:12', () => {
    const one = cardKey('out', ['1']);
    const twelve = cardKey('out', ['12']);
    expect([...openExclusive(sets([one]), twelve).open]).toEqual([twelve]);
    expect([...openExclusive(sets([twelve]), one).open]).toEqual([one]);
    expect([...openExclusive(sets([one, twelve]), one).open]).toEqual([twelve]);
  });

  it('leaves the other side groups and more counts alone', () => {
    const leftGroup = groupKey('in', left, 'template');
    const next = openExclusive(sets([left, c], [leftGroup], [[moreKey(`i|${left}`), 8]]), a);
    expect([...next.groups]).toEqual([leftGroup]);
    expect([...next.more.keys()]).toEqual([moreKey(`i|${left}`)]);
  });

  it('does not change the sets it is given', () => {
    const current = sets([a, c], [groupKey('out', a, 'template')], [[moreKey(`o|${a}`), 8]]);
    openExclusive(current, ab);
    openExclusive(current, a);
    expect([...current.open]).toEqual([a, c]);
    expect(current.groups.size).toBe(1);
    expect(current.more.size).toBe(1);
  });
});

describe('openTogether', () => {
  it('opens several cards without closing others', () => {
    const a = cardKey('out', ['1']);
    const b = cardKey('out', ['2']);
    const c = cardKey('out', ['3']);
    const next = openTogether(sets([a]), [b, c]);
    expect([...next.open].sort()).toEqual([a, b, c].sort());
  });
});
