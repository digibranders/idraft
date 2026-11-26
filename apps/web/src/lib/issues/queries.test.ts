import { describe, expect, it } from 'vitest';

import { crawlFinishedKeys } from '@/lib/internal-links/queries';
import {
  isIssueListResponse,
  issueKeys,
  issuePagesCsv,
  issuePagesQuery,
  issuesCsv,
  issuesPath,
  issuesQuery,
} from './queries';

const SCOPE = { workspaceId: 'w1', projectId: 'p1' };
const PAGES_PATH = '/api/v1/workspaces/w1/projects/p1/internal-links/pages';
const startsWith = (key: readonly unknown[], prefix: readonly unknown[]): boolean =>
  prefix.every((part, index) => part === key[index]);
const PAGES = { check: 'title-long', q: '', sort: 'path', cursor: null } as const;

describe('the list of checks query', () => {
  it('reads the issues of the project, the latest crawl unless one is chosen', () => {
    expect(issuesQuery(SCOPE).queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'issues', {}]);
    expect(issuesQuery(SCOPE, 'run-1').queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'issues', { run: 'run-1' }]);
  });

  it('is made stale when a crawl turns ready', () => {
    const key = issuesQuery(SCOPE).queryKey;
    expect(crawlFinishedKeys(SCOPE).some((prefix) => startsWith(key, prefix))).toBe(true);
    expect(issueKeys(SCOPE).some((prefix) => startsWith(key, prefix))).toBe(true);
  });

  it('writes the path of the CSV with its ids filled in', () => {
    expect(issuesPath(SCOPE)).toBe('/api/v1/workspaces/w1/projects/p1/issues');
    expect(issuesCsv(SCOPE, null)).toEqual({
      path: '/api/v1/workspaces/w1/projects/p1/issues',
      query: { format: 'csv' },
    });
    expect(issuesCsv(SCOPE, 'run-1').query).toEqual({ run: 'run-1', format: 'csv' });
  });
});

describe('the pages of a check query', () => {
  it('asks the pages list for one check, with the detail and the clicks, 50 at a time', () => {
    const key = issuePagesQuery(SCOPE, PAGES).queryKey;
    expect(key.slice(0, 6)).toEqual(['ws', 'w1', 'p', 'p1', 'internal-links', 'pages']);
    expect(key[6]).toEqual({
      'filter[issue]': 'title-long',
      include: ['issue', 'gsc'],
      limit: 50,
      scope: 'all',
      sort: 'path',
    });
  });

  it('sends the search trimmed and only when it is not empty, and the cursor only when there is one', () => {
    expect(issuePagesQuery(SCOPE, { ...PAGES, q: '  /blog ', cursor: '50' }).queryKey[6]).toMatchObject({
      q: '/blog',
      cursor: '50',
    });
    const key = issuePagesQuery(SCOPE, { ...PAGES, q: '   ' }).queryKey[6];
    expect(key).not.toHaveProperty('q');
    expect(key).not.toHaveProperty('cursor');
  });

  it('keeps a chosen crawl apart from the latest', () => {
    expect(issuePagesQuery(SCOPE, PAGES, 'run-1').queryKey).not.toEqual(issuePagesQuery(SCOPE, PAGES).queryKey);
  });

  it('is made stale when a crawl turns ready', () => {
    const key = issuePagesQuery(SCOPE, PAGES).queryKey;
    expect(crawlFinishedKeys(SCOPE).some((prefix) => startsWith(key, prefix))).toBe(true);
  });

  it('writes the CSV of the pages of a check with the check, the search and the sort, and no paging', () => {
    expect(issuePagesCsv(SCOPE, { ...PAGES, q: ' /blog ', sort: '-clicks' }, null)).toEqual({
      path: PAGES_PATH,
      query: { scope: 'all', sort: '-clicks', 'filter[issue]': 'title-long', q: '/blog', format: 'csv' },
    });
    expect(issuePagesCsv(SCOPE, PAGES, 'run-1').query).not.toHaveProperty('q');
    expect(issuePagesCsv(SCOPE, PAGES, 'run-1').query).toHaveProperty('run', 'run-1');
    expect(issuePagesCsv(SCOPE, { ...PAGES, cursor: '50' }, null).query).not.toHaveProperty('cursor');
  });
});

describe('isIssueListResponse (the list answers JSON or CSV, so its typed answer is unknown)', () => {
  const answer = {
    data: [],
    summary: { pages_crawled: 18, checks_ran: 24, checks_passed: 9 },
    meta: { run_id: 'r', crawled_at: null, links_available: true, gsc: { state: 'ok' } },
  };

  it('accepts the envelope the screens read', () => {
    expect(isIssueListResponse(answer)).toBe(true);
  });

  it('refuses an answer without its data, summary or meta', () => {
    expect(isIssueListResponse(null)).toBe(false);
    expect(isIssueListResponse('a,b')).toBe(false);
    expect(isIssueListResponse({ ...answer, data: null })).toBe(false);
    expect(isIssueListResponse({ ...answer, summary: null })).toBe(false);
    expect(isIssueListResponse({ ...answer, meta: { ...answer.meta, gsc: null } })).toBe(false);
    expect(isIssueListResponse({ ...answer, meta: { ...answer.meta, run_id: 7 } })).toBe(false);
  });
});
