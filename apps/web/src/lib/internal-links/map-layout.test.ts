import { describe, expect, it } from 'vitest';

import { layoutMap, roundsFor, type LayoutInput } from './map-layout';

/** A hub with `leaves` pages around it, two pages that link to each other, and `loose` pages with no link. */
function input(leaves: number, loose: number, below = false): LayoutInput {
  const nodes = [
    { id: 'hub', links: leaves, group: 1 },
    ...Array.from({ length: leaves }, (_, i) => ({ id: `leaf-${String(i).padStart(3, '0')}`, links: 1, group: 2 })),
    { id: 'pair-a', links: 1, group: 2 },
    { id: 'pair-b', links: 1, group: 2 },
    ...Array.from({ length: loose }, (_, i) => ({
      id: `loose-${String(i).padStart(3, '0')}`,
      links: 0,
      group: (i % 2) + 1,
    })),
  ];
  const edges = [
    ...Array.from({ length: leaves }, (_, i) => ({ from: 'hub', to: `leaf-${String(i).padStart(3, '0')}` })),
    { from: 'pair-a', to: 'pair-b' },
  ];
  return { nodes, edges, below };
}

type Spot = readonly [string, number, number];
const distance = (a: Spot, b: Spot): number => Math.hypot(a[1] - b[1], a[2] - b[2]);

describe('layoutMap', () => {
  it('places every page once, at a finite spot', () => {
    const { positions } = layoutMap(input(12, 9));

    expect(positions).toHaveLength(12 + 1 + 2 + 9);
    expect(new Set(positions.map(([id]) => id)).size).toBe(positions.length);
    expect(positions.every(([, x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('is the same on every run', () => {
    expect(layoutMap(input(12, 9))).toEqual(layoutMap(input(12, 9)));
  });

  it('keeps linked pages apart', () => {
    const linked = layoutMap(input(20, 0)).positions;

    for (let a = 0; a < linked.length; a += 1) {
      for (let b = a + 1; b < linked.length; b += 1) {
        const first = linked[a];
        const second = linked[b];
        if (first === undefined || second === undefined) throw new Error('a position is missing');
        expect(distance(first, second)).toBeGreaterThanOrEqual(25.9);
      }
    }
  });

  it('puts the unlinked pages in a block to the right, one grid per group in order', () => {
    const { positions, groups } = layoutMap(input(12, 9));
    const linkedRight = Math.max(...positions.filter(([id]) => !id.startsWith('loose')).map(([, x]) => x));
    const loose = positions.filter(([id]) => id.startsWith('loose'));

    expect(loose.every(([, x]) => x > linkedRight + 200)).toBe(true);
    expect(groups.map((group) => [group.key, group.count])).toEqual([
      [1, 5],
      [2, 4],
    ]);
    expect((groups[1]?.y ?? 0) > (groups[0]?.y ?? 0)).toBe(true);
  });

  it('puts the block under the map on a tall canvas', () => {
    const { positions } = layoutMap(input(12, 9, true));
    const linkedBottom = Math.max(...positions.filter(([id]) => !id.startsWith('loose')).map(([, , y]) => y));

    expect(positions.filter(([id]) => id.startsWith('loose')).every(([, , y]) => y > linkedBottom)).toBe(true);
  });

  it('lays out a crawl with no links at all', () => {
    const { positions, groups } = layoutMap({ nodes: [{ id: 'a', links: 0, group: 1 }], edges: [], below: false });

    expect(positions).toEqual([['a', expect.any(Number), expect.any(Number)]]);
    expect(groups).toHaveLength(1);
  });
});

describe('roundsFor', () => {
  it('spends fewer rounds on a bigger map', () => {
    expect(roundsFor(150)).toEqual({ force: 400, separation: 80 });
    expect(roundsFor(300)).toEqual({ force: 400, separation: 80 });
    expect(roundsFor(1000)).toEqual({ force: 120, separation: 30 });
    expect(roundsFor(3000)).toEqual({ force: 120, separation: 30 });
  });
});
