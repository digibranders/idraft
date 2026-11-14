import { describe, expect, it } from 'vitest';

import { assertUniqueIds, chosenTab, placeAfter } from './shared';

const item = (id: string): { id: string } => ({ id });
const idOf = (entry: { id: string }): string => entry.id;
const base: readonly { id: string }[] = ['a', 'b', 'c'].map(item);
const ids = (entries: readonly { id: string }[]): string[] => entries.map(idOf);

describe('placeAfter', () => {
  it('puts the items after their anchor', () => {
    expect(ids(placeAfter(base, [{ after: 'a', items: [item('x'), item('y')] }], idOf))).toEqual([
      'a',
      'x',
      'y',
      'b',
      'c',
    ]);
  });

  it('puts the items at the end without an anchor', () => {
    expect(ids(placeAfter(base, [{ items: [item('x')] }], idOf))).toEqual(['a', 'b', 'c', 'x']);
    expect(ids(placeAfter(base, [{ after: undefined, items: [item('x')] }], idOf))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('keeps two insertions after one anchor in the order they were given', () => {
    const placed = placeAfter(
      base,
      [
        { after: 'a', items: [item('x')] },
        { after: 'a', items: [item('y')] },
      ],
      idOf,
    );
    expect(ids(placed)).toEqual(['a', 'x', 'y', 'b', 'c']);
  });

  it('can anchor on an item an earlier insertion placed', () => {
    const placed = placeAfter(
      base,
      [
        { after: 'b', items: [item('x')] },
        { after: 'x', items: [item('y')] },
      ],
      idOf,
    );
    expect(ids(placed)).toEqual(['a', 'b', 'x', 'y', 'c']);
  });

  it('leaves the base as it was', () => {
    placeAfter(base, [{ after: 'a', items: [item('x')] }], idOf);
    expect(ids(base)).toEqual(['a', 'b', 'c']);
  });

  it('throws when the anchor names no item, and names it', () => {
    expect(() => placeAfter(base, [{ after: 'nowhere', items: [item('x')] }], idOf)).toThrow(/nowhere/);
  });

  it('throws when an id repeats, an inserted one or one the base holds', () => {
    expect(() => placeAfter(base, [{ items: [item('a')] }], idOf)).toThrow(/"a"/);
    expect(() => placeAfter(base, [{ items: [item('x'), item('x')] }], idOf)).toThrow(/"x"/);
  });
});

describe('assertUniqueIds', () => {
  it('passes for distinct ids', () => {
    expect(() => assertUniqueIds(['a', 'b'], 'tabs')).not.toThrow();
  });

  it('throws naming the id and what it is of', () => {
    expect(() => assertUniqueIds(['a', 'b', 'a'], 'tabs')).toThrow('tabs: the id "a" is used twice');
  });
});

describe('chosenTab', () => {
  const tabs = ['latest', 'history'].map(item);

  it('returns the requested id when it is shown', () => {
    expect(chosenTab(tabs, 'history')).toBe('history');
  });

  it('returns the first tab otherwise', () => {
    expect(chosenTab(tabs, 'stats')).toBe('latest');
    expect(chosenTab(tabs, '')).toBe('latest');
  });
});
