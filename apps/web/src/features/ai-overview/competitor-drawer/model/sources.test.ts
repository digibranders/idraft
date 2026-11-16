import { describe, expect, it } from 'vitest';

import { compareSources, TOP, type CitedDomain } from './sources';

const domain = (name: string, share: number, thirdParty = true): CitedDomain => ({ domain: name, share, thirdParty });

describe('compareSources', () => {
  it('is the Jaccard overlap of the two top 8 sets', () => {
    const theirs = ['a', 'b', 'c', 'd'].map((name) => domain(name, 0.1));
    const yours = ['c', 'd', 'e', 'f'].map((name) => domain(name, 0.1));
    // Two shared of six in all
    expect(compareSources({ theirs, yours }).overlap).toBeCloseTo(2 / 6);
  });

  it('lists the third-party domains of their top 8 that are not in yours, and no site of a brand', () => {
    const theirs = [
      domain('g2.com', 0.3),
      domain('hubspot.com', 0.2, false),
      domain('reddit.com', 0.1),
      domain('forbes.com', 0.05),
    ];
    const yours = [domain('forbes.com', 0.3), domain('g2.com', 0.2)];
    expect(compareSources({ theirs, yours }).onlyTheirs).toEqual(['reddit.com']);
  });

  it('reads only the first 8 of each list', () => {
    const theirs = Array.from({ length: 10 }, (_, index) => domain(`t${String(index)}.com`, 0.1));
    const yours = [domain(`t${String(TOP + 1)}.com`, 0.5)];
    const result = compareSources({ theirs, yours });
    expect(result.overlap).toBe(0);
    expect(result.onlyTheirs).toHaveLength(TOP);
  });

  it('has no overlap to speak of when both lists are empty, and no NaN', () => {
    expect(compareSources({ theirs: [], yours: [] })).toEqual({ overlap: 0, onlyTheirs: [] });
  });
});
