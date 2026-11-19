import { describe, expect, it } from 'vitest';

import { citedPagesQueryParams, gapsQuery, nextOffset, overviewQuery, sharedParams } from './board-queries';

const PROJECT = { workspaceId: 'w1', projectId: 'p1' };
const SCOPE = { runs: 2 as const, engines: ['chatgpt_web' as const], term: 't1' };

describe('the Citations v2 query wrappers', () => {
  it('sends runs, the engines and the term, and leaves the term out for every group', () => {
    expect(sharedParams(SCOPE)).toEqual({ runs: 2, 'filter[engine_code_in]': ['chatgpt_web'], 'filter[term]': 't1' });
    expect(sharedParams({ ...SCOPE, term: null })).not.toHaveProperty('filter[term]');
  });

  it('keys two scopes apart', () => {
    expect(overviewQuery(PROJECT, SCOPE).queryKey).not.toEqual(overviewQuery(PROJECT, { ...SCOPE, runs: 4 }).queryKey);
  });

  it('asks the gap list for the competitors in the order given', () => {
    expect(gapsQuery(PROJECT, SCOPE, ['c2', 'c1']).queryKey).toContainEqual(
      expect.objectContaining({ 'filter[competitor_id_in]': ['c2', 'c1'] }),
    );
  });

  it('pages Cited pages by 200 with the role, the search and the sort', () => {
    expect(citedPagesQueryParams(SCOPE, { role: 'third_party', q: 'g2', sort: '-change' }, 400)).toMatchObject({
      'filter[domain_role_in]': 'third_party',
      q: 'g2',
      sort: '-change',
      offset: 400,
      limit: 200,
    });
    expect(citedPagesQueryParams(SCOPE, { role: null, q: '', sort: '-citations' }, 0)).not.toHaveProperty('q');
  });

  it('reads the next page until the total is reached', () => {
    expect(nextOffset({ offset: 0, limit: 200, total: 450 }, 200)).toBe(200);
    expect(nextOffset({ offset: 400, limit: 200, total: 450 }, 50)).toBeUndefined();
  });
});
