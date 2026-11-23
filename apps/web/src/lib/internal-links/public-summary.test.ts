import { describe, expect, it } from 'vitest';

import { summaryInputOf } from './public-summary';
import type { ClientSummary } from './types';

const labels = { untiered: 'Untiered', worklist: (key: string): string => `list:${key}` };
const options = { locale: 'en', timeZone: 'UTC', labels };

const SUMMARY: ClientSummary = {
  crawled_at: '2026-11-18T10:00:00Z',
  generated_at: '2026-11-19T10:00:00Z',
  host: 'example.com',
  important_max_position: null,
  pages: 7,
  tiers: [
    { code: 'T1', name: 'Money', pages: 3, average_depth: 1.5 },
    { code: null, name: null, pages: 4, average_depth: null },
  ],
  flow: [
    { from_code: 'T1', to_code: null, links: 5 },
    { from_code: null, to_code: 'T1', links: 2 },
  ],
  worklists: [
    { key: 'weak_outlinks', count: 1 },
    { key: 'orphans', count: 3 },
  ],
  lost: { state: 'available', total: 25, links: [{ from_path: '/a', to_path: '/b', anchor: 'b page' }] },
};

describe('summaryInputOf', () => {
  it('maps tiers, a matrix with 0 for the cells left out, and the worklists in the file order', () => {
    const input = summaryInputOf(SUMMARY, options);
    expect(input.tiers.map((tier) => tier.label)).toEqual(['T1 Money', 'Untiered']);
    expect(input.matrix).toEqual([
      [0, 5],
      [2, 0],
    ]);
    expect(input.worklists.map((list) => list.count)).toEqual([0, 3, 0, 0, 0, 0, 1]);
    expect(input.crawledOn).toBe('Nov 18, 2026');
  });

  it('keeps the lost links with their total, and defaults the important tiers to T1 and T2', () => {
    const input = summaryInputOf(SUMMARY, options);
    expect(input.lost).toEqual([{ from: '/a', to: '/b', anchor: 'b page' }]);
    expect(input.lostTotal).toBe(25);
    expect(input.importantMaxPosition).toBe(2);
  });

  it('reads an unavailable lost section as its reason', () => {
    const dropped = summaryInputOf({ ...SUMMARY, lost: { state: 'dropped', total: null, links: [] } }, options);
    expect(dropped.lost).toBeNull();
    expect(dropped.lostReason).toBe('dropped');
    const first = summaryInputOf({ ...SUMMARY, lost: { state: 'no_comparison', total: null, links: [] } }, options);
    expect(first.lostReason).toBe('no-comparison');
  });
});
