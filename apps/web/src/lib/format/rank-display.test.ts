import { describe, expect, it } from 'vitest';

import { changeDisplay, rankDisplay, urlDisplay } from './rank-display';
import type { RankCell, RankChange, UrlRef } from '@/lib/api/types';

const current = (over: Partial<RankCell> = {}): RankCell => ({
  state: 'ranked',
  rank: 3,
  absolute_rank: 4,
  depth_requested: 20,
  observed_at: '2026-10-06T02:00:00Z',
  serp_snapshot_id: null,
  url: null,
  ...over,
});

describe('rank display', () => {
  it('shows a ranked keyword by its number', () => {
    expect(rankDisplay(current(), false)).toEqual({
      kind: 'ranked',
      rank: 3,
      depth: 20,
      observedAt: '2026-10-06T02:00:00Z',
      stale: false,
    });
  });

  it('shows a keyword beyond the depth with the depth that was checked', () => {
    expect(rankDisplay(current({ state: 'beyond_depth', rank: null, depth_requested: 50 }), false)).toEqual({
      kind: 'beyond',
      depth: 50,
      observedAt: '2026-10-06T02:00:00Z',
      stale: false,
    });
  });

  it('shows pending before the first check and a failure as such', () => {
    expect(
      rankDisplay(current({ state: 'not_checked', rank: null, depth_requested: null, observed_at: null }), false),
    ).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ state: 'failed', rank: null }), true)).toEqual({
      kind: 'failed',
      observedAt: '2026-10-06T02:00:00Z',
      stale: true,
    });
  });

  it('marks a stale keyword', () => {
    expect(rankDisplay(current(), true)).toMatchObject({ kind: 'ranked', stale: true });
  });

  it('never shows a number for a ranked cell the API sent incomplete', () => {
    expect(rankDisplay(current({ rank: null }), false)).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ rank: 0 }), false)).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ rank: 2.5 }), false)).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ depth_requested: null }), false)).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ observed_at: null }), false)).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ state: 'beyond_depth', rank: null, depth_requested: null }), false)).toEqual({
      kind: 'pending',
    });
    expect(rankDisplay(current({ state: 'beyond_depth', rank: null, depth_requested: 0 }), false)).toEqual({
      kind: 'pending',
    });
  });

  it('keeps a beyond-depth cell without a check time', () => {
    expect(rankDisplay(current({ state: 'beyond_depth', rank: null, observed_at: null }), false)).toEqual({
      kind: 'beyond',
      depth: 20,
      observedAt: null,
      stale: false,
    });
  });
});

const change = (label: RankChange['label'], value: number | null = null): RankChange => ({
  label,
  value,
  previous_rank: null,
  previous_observed_at: null,
});

describe('change display', () => {
  it('shows an arrow with the amount, and a tone only for a move of more than 2 places', () => {
    expect(changeDisplay(change('numeric', 5))).toEqual({
      kind: 'arrow',
      direction: 'up',
      amount: 5,
      tone: 'positive',
    });
    expect(changeDisplay(change('numeric', -3))).toEqual({
      kind: 'arrow',
      direction: 'down',
      amount: 3,
      tone: 'negative',
    });
    expect(changeDisplay(change('numeric', 3))).toMatchObject({ tone: 'positive' });
    expect(changeDisplay(change('numeric', 1))).toEqual({
      kind: 'arrow',
      direction: 'up',
      amount: 1,
      tone: 'neutral',
    });
    expect(changeDisplay(change('numeric', 2))).toMatchObject({ amount: 2, tone: 'neutral' });
    expect(changeDisplay(change('numeric', -2))).toEqual({
      kind: 'arrow',
      direction: 'down',
      amount: 2,
      tone: 'neutral',
    });
    expect(changeDisplay(change('numeric', 0))).toEqual({ kind: 'flat' });
  });

  it('shows New and Lost, always emphasised, and nothing visible for the rest', () => {
    expect(changeDisplay(change('new'))).toEqual({ kind: 'new' });
    expect(changeDisplay(change('lost'))).toEqual({ kind: 'lost' });
    expect(changeDisplay(change('first_check'))).toEqual({ kind: 'empty', reason: 'firstCheck' });
    expect(changeDisplay(change('unchanged_beyond'))).toEqual({ kind: 'empty', reason: 'stillBeyond' });
    expect(changeDisplay(change('consistent_beyond'))).toEqual({ kind: 'empty', reason: 'stillBeyond' });
  });

  it('gives a numeric change with no value the same as no change', () => {
    expect(changeDisplay(change('numeric', null))).toEqual({ kind: 'flat' });
  });
});

describe('url display', () => {
  const ref: UrlRef = {
    url_id: '7',
    canonical_url: 'https://fynix.digital/pricing',
    host: 'fynix.digital',
    path: '/pricing',
    registrable_domain: 'fynix.digital',
  };

  it('shows the path, the full address and a +1 for a second ranking URL', () => {
    expect(urlDisplay(current({ state: 'ranked', url: ref }), 2)).toEqual({
      kind: 'url',
      path: '/pricing',
      full: 'https://fynix.digital/pricing',
      extra: 1,
    });
    expect(urlDisplay(current({ state: 'ranked', url: ref }), 1)).toMatchObject({ extra: 0 });
    expect(urlDisplay(current({ state: 'ranked', url: ref }), 0)).toMatchObject({ extra: 0 });
    expect(urlDisplay(current({ state: 'ranked', url: ref }), 4)).toMatchObject({ extra: 3 });
  });

  it('shows not ranking when nothing ranks and pending before the first check', () => {
    expect(urlDisplay(current({ state: 'beyond_depth', rank: null }), 0)).toEqual({ kind: 'none' });
    expect(urlDisplay(current({ state: 'not_checked', rank: null }), 0)).toEqual({ kind: 'pending' });
    expect(urlDisplay(current({ state: 'failed', rank: null }), 0)).toEqual({ kind: 'pending' });
  });

  it('shows not ranking for a ranked cell the API sent without a URL', () => {
    expect(urlDisplay(current({ state: 'ranked', url: null }), 0)).toEqual({ kind: 'none' });
  });
});
