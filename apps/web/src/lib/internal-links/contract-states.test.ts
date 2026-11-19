import { describe, expect, it } from 'vitest';

import { ApiProblem } from '@/lib/api/problem';
import { changesAreReady, isLinksDropped, pageChangeState } from './contract-states';
import type { ChangesSummary, PageChange } from './types';

const problem = (code: string, status: number): ApiProblem =>
  new ApiProblem({
    status,
    code,
    title: 'x',
    detail: null,
    requestId: null,
    errors: [],
    retryAfterSeconds: null,
    body: {},
  });

describe('isLinksDropped (410 on a link level read of a crawl past the last four)', () => {
  it('is true only for the links_dropped problem', () => {
    expect(isLinksDropped(problem('links_dropped', 410))).toBe(true);
    expect(isLinksDropped(problem('not_found', 404))).toBe(false);
    expect(isLinksDropped(new Error('links_dropped'))).toBe(false);
    expect(isLinksDropped(null)).toBe(false);
  });
});

describe('changesAreReady (the summary state)', () => {
  const summary = (state: ChangesSummary['state']): Pick<ChangesSummary, 'state'> => ({ state });

  it('is true only when the changes are worked out', () => {
    expect(changesAreReady(summary('ready'))).toBe(true);
    for (const state of ['pending', 'first_crawl', 'unavailable'] as const) {
      expect(changesAreReady(summary(state))).toBe(false);
    }
  });
});

describe('pageChangeState (a null change means the page was not enriched yet)', () => {
  const change = (over: Partial<PageChange>): PageChange => ({
    depth_delta: 0,
    depth_state: null,
    editorial_in_delta: 0,
    equity_points: 0,
    is_new: false,
    ...over,
  });

  it('reads a missing or null change as not known', () => {
    expect(pageChangeState(undefined)).toBe('unknown');
    expect(pageChangeState(null)).toBe('unknown');
  });

  it('reads an all zero change as unchanged', () => {
    expect(pageChangeState(change({}))).toBe('unchanged');
  });

  it('reads a new page as new, even when its numbers are zero', () => {
    expect(pageChangeState(change({ is_new: true }))).toBe('new');
  });

  it('reads any moved figure as moved', () => {
    expect(pageChangeState(change({ editorial_in_delta: -2 }))).toBe('moved');
    expect(pageChangeState(change({ depth_delta: 1 }))).toBe('moved');
    expect(pageChangeState(change({ depth_state: 'lost' }))).toBe('moved');
  });

  it('ignores the change of equity: only links and depth make a page moved', () => {
    expect(pageChangeState(change({ equity_points: 0.4 }))).toBe('unchanged');
    expect(pageChangeState(change({ equity_points: -1.2, editorial_in_delta: 1 }))).toBe('moved');
  });

  it('treats a null delta as nothing moved on that figure', () => {
    expect(pageChangeState(change({ depth_delta: null, editorial_in_delta: null, equity_points: null }))).toBe(
      'unchanged',
    );
  });
});
