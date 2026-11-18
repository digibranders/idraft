import { describe, expect, it } from 'vitest';

import { withDecision } from './use-opportunity-decisions';
import type { Opportunity, OpportunityPage, OpportunityStatus } from '@/lib/internal-links/types';

const row = (index: number, status: OpportunityStatus): Opportunity => ({
  key: `${String(index)}>${String(100 + index)}`,
  source: {
    url_id: String(index),
    url: `https://example.test/s${String(index)}`,
    path: `/s${String(index)}`,
    tier: null,
  },
  target: {
    url_id: String(100 + index),
    url: `https://example.test/t${String(index)}`,
    path: `/t${String(index)}`,
    tier: null,
  },
  phrase: 'phrase',
  context: 'A sentence with a phrase in it.',
  anchor: 'phrase',
  source_equity_share: null,
  status,
  origin: 'keyword',
});

/** Rows 1 to 5: open, open, accepted, dismissed, open; counts and total as the list reads them. */
const page = (filter: OpportunityStatus | null): OpportunityPage => {
  const all = [row(1, 'open'), row(2, 'open'), row(3, 'accepted'), row(4, 'dismissed'), row(5, 'open')];
  const data = filter === null ? all : all.filter((candidate) => candidate.status === filter);
  return {
    data,
    meta: {
      run_id: '0192e4a0-1000-7000-8000-000000000001',
      total: data.length,
      counts: { open: 3, accepted: 1, dismissed: 1 },
    },
  };
};

const keys = (...indexes: number[]): Set<string> => new Set(indexes.map((index) => row(index, 'open').key));

describe('the list as it reads once rows are decided', () => {
  it('moves an open row to accepted under no filter: the row stays, the counts move, the total does not', () => {
    const next = withDecision(page(null), keys(1), 'accepted', null);
    expect(next.data.map((candidate) => candidate.status)).toEqual([
      'accepted',
      'open',
      'accepted',
      'dismissed',
      'open',
    ]);
    expect(next.meta.counts).toEqual({ open: 2, accepted: 2, dismissed: 1 });
    expect(next.meta.total).toBe(5);
  });

  it('takes a row out of the Open list when it is accepted, and lowers the total', () => {
    const next = withDecision(page('open'), keys(1), 'accepted', 'open');
    expect(next.data.map((candidate) => candidate.key)).toEqual([row(2, 'open').key, row(5, 'open').key]);
    expect(next.meta.counts).toEqual({ open: 2, accepted: 2, dismissed: 1 });
    expect(next.meta.total).toBe(2);
  });

  it('puts a reopened row out of the Accepted list', () => {
    const next = withDecision(page('accepted'), keys(3), 'open', 'accepted');
    expect(next.data).toEqual([]);
    expect(next.meta.counts).toEqual({ open: 4, accepted: 0, dismissed: 1 });
    expect(next.meta.total).toBe(0);
  });

  it('dismisses under the Open filter and keeps a dismissed row in the Dismissed list', () => {
    const gone = withDecision(page('open'), keys(2), 'dismissed', 'open');
    expect(gone.meta).toMatchObject({ total: 2, counts: { open: 2, accepted: 1, dismissed: 2 } });
    const stays = withDecision(page('accepted'), keys(3), 'dismissed', 'dismissed');
    expect(stays.data).toHaveLength(1);
    expect(stays.data[0]?.status).toBe('dismissed');
    expect(stays.meta.total).toBe(1);
  });

  it('decides several rows at once, and counts each only once', () => {
    const next = withDecision(page('open'), keys(1, 2, 5), 'accepted', 'open');
    expect(next.data).toEqual([]);
    expect(next.meta.counts).toEqual({ open: 0, accepted: 4, dismissed: 1 });
    expect(next.meta.total).toBe(0);
  });

  it('changes nothing for rows already in the status, rows not on the page, and an unchanged page object shape', () => {
    const before = page(null);
    const same = withDecision(before, keys(3, 99), 'accepted', null);
    expect(same.data).toEqual(before.data);
    expect(same.meta).toEqual(before.meta);
    const filtered = withDecision(page('accepted'), keys(3), 'accepted', 'accepted');
    expect(filtered.meta.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
  });

  it('does not change the page it is given', () => {
    const before = page('open');
    const snapshot = JSON.stringify(before);
    withDecision(before, keys(1), 'accepted', 'open');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
