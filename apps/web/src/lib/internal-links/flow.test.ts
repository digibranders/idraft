import { describe, expect, it } from 'vitest';

import { flowLevel, strongestSenderToT1, tierShares } from './flow';

const T1 = { tier_id: 'a', code: 'T1', name: 'Money pages' };
const T2 = { tier_id: 'b', code: 'T2', name: 'Supporting pages' };

describe('tier flow (spec 7.6, mock il-flow.js)', () => {
  it('leaves a zero cell without fill and bins the rest into six steps of the sequential scale', () => {
    expect(flowLevel(0, 26)).toBeNull();
    expect(flowLevel(1, 26)).toBe(1);
    expect(flowLevel(26, 26)).toBe(6);
    expect(flowLevel(14, 26)).toBe(4);
    expect(flowLevel(3, 0)).toBeNull();
  });

  it('leaves a cell that is not a number without fill', () => {
    expect(flowLevel(Number.NaN, 10)).toBeNull();
    expect(flowLevel(5, Number.POSITIVE_INFINITY)).toBeNull();
    expect(tierShares([{ tier: T1, pages: Number.NaN, average_depth: null }]).rows[0]?.share).toBe(0);
  });

  it('finds the tier, other than T1, that sends the most links to T1', () => {
    const cells = [
      { from_tier: T1, to_tier: T1, links: 26 },
      { from_tier: T2, to_tier: T1, links: 22 },
      { from_tier: null, to_tier: T1, links: 1 },
    ];
    expect(strongestSenderToT1(cells)).toEqual({ from: T2, links: 22, top: T1 });
    expect(strongestSenderToT1([{ from_tier: T2, to_tier: T1, links: 0 }])).toEqual({ from: null, links: 0, top: T1 });
    expect(strongestSenderToT1([])).toBeNull();
  });

  it('breaks a tie between senders by tier position, Untiered last, whatever the order of the cells', () => {
    const T3 = { tier_id: 'c', code: 'T3', name: 'Archive' };
    const tie = [
      { from_tier: null, to_tier: T1, links: 5 },
      { from_tier: T3, to_tier: T1, links: 5 },
      { from_tier: T2, to_tier: T1, links: 5 },
    ];
    expect(strongestSenderToT1(tie)?.from).toBe(T2);
    expect(strongestSenderToT1([...tie].reverse())?.from).toBe(T2);
    expect(strongestSenderToT1(tie.slice(0, 1))?.from).toBeNull();
    expect(strongestSenderToT1(tie.slice(0, 2).reverse())?.from).toBe(T3);
  });

  it('gives each tier its share of the pages', () => {
    const shares = tierShares([
      { tier: T1, pages: 14, average_depth: 1.5 },
      { tier: null, pages: 26, average_depth: null },
    ]);
    expect(shares.total).toBe(40);
    expect(shares.rows.map((row) => row.share)).toEqual([0.35, 0.65]);
  });
});
