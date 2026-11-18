import { describe, expect, it } from 'vitest';

import { changeParts, comparisonOf } from './page-extras';

describe('comparisonOf', () => {
  it('reads first_crawl from the summary before anything else', () => {
    expect(comparisonOf('first_crawl', 'running')).toBe('first_crawl');
    expect(comparisonOf('first_crawl', 'done')).toBe('first_crawl');
  });

  it('says updating while the summary is pending or the enrichment has not finished', () => {
    expect(comparisonOf('pending', 'running')).toBe('updating');
    expect(comparisonOf(undefined, 'pending')).toBe('updating');
    expect(comparisonOf(undefined, 'running')).toBe('updating');
    expect(comparisonOf(undefined, undefined)).toBe('updating');
  });

  it('says unavailable when the comparison failed, and ready when it is done', () => {
    expect(comparisonOf('unavailable', 'failed')).toBe('unavailable');
    expect(comparisonOf(undefined, 'failed')).toBe('unavailable');
    expect(comparisonOf('ready', 'done')).toBe('ready');
    expect(comparisonOf(undefined, 'done')).toBe('ready');
  });
});

const NONE = { is_new: false, editorial_in_delta: 0, depth_delta: 0, depth_state: null, equity_points: null } as const;

describe('changeParts', () => {
  it('has nothing for a page that did not move', () => {
    expect(changeParts(NONE)).toEqual({ kind: 'none' });
  });

  it('names a new page', () => {
    expect(changeParts({ ...NONE, is_new: true, editorial_in_delta: null })).toEqual({ kind: 'new' });
  });

  it('shows links in with a sign and a tone, and the depth move beside them', () => {
    expect(changeParts({ ...NONE, editorial_in_delta: 2, depth_delta: -1 })).toEqual({
      kind: 'moved',
      links: { text: '+2', tone: 'positive' },
      depth: { state: 'closer', levels: 1 },
    });
    expect(changeParts({ ...NONE, editorial_in_delta: -3 })).toEqual({
      kind: 'moved',
      links: { text: '−3', tone: 'negative' },
      depth: null,
    });
  });

  it('reports reachability and ignores equity points', () => {
    expect(changeParts({ ...NONE, depth_state: 'lost', depth_delta: null })).toEqual({
      kind: 'moved',
      links: null,
      depth: { state: 'lost', levels: 0 },
    });
    expect(changeParts({ ...NONE, equity_points: 4.2 })).toEqual({ kind: 'none' });
  });
});
