import { describe, expect, it } from 'vitest';

import {
  crawlKeys,
  crawlsQuery,
  CRAWL_LIMIT,
  CRAWL_SCREEN_LIMIT,
  DEFAULT_EDGE_QUERY,
  DEFAULT_PAGE_QUERY,
  edgeParams,
  internalLinksKeys,
  isEdgeRowPage,
  isPageRowPage,
  linkSettingsQuery,
  neighborsQuery,
  pageDetailQuery,
  pageFilterOf,
  pageParams,
  pagesQuery,
  tierFlowQuery,
  tierRulesQuery,
  pageTiersQuery,
  checkUrlId,
  crawlFinishedKeys,
  edgesPath,
  pagesPath,
  UrlIdError,
} from './queries';

const SCOPE = { workspaceId: 'w1', projectId: 'p1' };

describe('the pages query (the backend OpenAPI)', () => {
  it('sends only what is set, with an explicit sort (never the server default, decision W5)', () => {
    expect(pageParams({ ...DEFAULT_PAGE_QUERY })).toEqual({ scope: 'editorial', sort: '-linking_pages', limit: 100 });
  });

  it('sends lists as arrays the client joins with commas', () => {
    expect(
      pageParams({
        ...DEFAULT_PAGE_QUERY,
        scope: 'all',
        tierIds: ['none', 'b5f7f0a0-0000-7000-8000-000000000001'],
        status: ['4xx'],
        indexable: false,
        flags: ['orphan'],
        worklist: 'orphans',
        q: '/blog',
        cursor: 'abc',
      }),
    ).toEqual({
      scope: 'all',
      sort: '-linking_pages',
      limit: 100,
      'filter[tier]': ['none', 'b5f7f0a0-0000-7000-8000-000000000001'],
      'filter[status]': ['4xx'],
      'filter[indexable]': false,
      'filter[flags]': ['orphan'],
      'filter[worklist]': 'orphans',
      q: '/blog',
      cursor: 'abc',
    });
  });

  it('turns the same filters into the bulk body filter, on the latest crawl', () => {
    expect(pageFilterOf({ ...DEFAULT_PAGE_QUERY, tierIds: ['none'], q: '/blog' })).toEqual({
      tier_ids: ['none'],
      q: '/blog',
    });
    expect(pageFilterOf(DEFAULT_PAGE_QUERY)).toEqual({});
  });

  it('keys every read under the project, so a tier change reaches all of them', () => {
    const [reads, rules, tiers] = internalLinksKeys(SCOPE);
    const startsWith = (key: readonly unknown[], prefix: readonly unknown[] | undefined): boolean =>
      prefix !== undefined && prefix.every((part, index) => key[index] === part);
    expect(startsWith(pagesQuery(SCOPE, DEFAULT_PAGE_QUERY).queryKey, reads)).toBe(true);
    expect(startsWith(tierRulesQuery(SCOPE).queryKey, rules)).toBe(true);
    expect(startsWith(pageTiersQuery('w1').queryKey, tiers)).toBe(true);
  });

  it('keys the tier flow under the reads that a tier change or a finished crawl makes stale', () => {
    const startsWith = (key: readonly unknown[], prefix: readonly unknown[] | undefined): boolean =>
      prefix !== undefined && prefix.every((part, index) => key[index] === part);
    const key = tierFlowQuery(SCOPE, 'editorial').queryKey;
    expect(startsWith(key, internalLinksKeys(SCOPE)[0])).toBe(true);
    expect(crawlFinishedKeys(SCOPE).some((prefix) => startsWith(key, prefix))).toBe(true);
    // One key per scope: a scope never reads the answer of another
    expect(tierFlowQuery(SCOPE, 'all').queryKey).not.toEqual(key);
  });
});

describe('url ids (the API takes digit strings of at most int64)', () => {
  it('passes a positive int64 on as the same string, however large', () => {
    expect(checkUrlId('111')).toBe('111');
    expect(checkUrlId('9007199254740993')).toBe('9007199254740993');
    expect(checkUrlId('9223372036854775807')).toBe('9223372036854775807');
  });

  it('refuses an id above int64, by value and not by length', () => {
    expect(() => checkUrlId('9223372036854775808')).toThrow(UrlIdError);
    expect(() => checkUrlId('9999999999999999999')).toThrow(UrlIdError);
    expect(() => checkUrlId('100000000000000000000')).toThrow(UrlIdError);
  });

  it('refuses text that is not a positive whole number without a leading zero', () => {
    for (const bad of ['0', '00', '01', '-1', '+1', ' 7', '7 ', '', '1.5', '1e3', 'abc', '１２']) {
      expect(() => checkUrlId(bad)).toThrow(new UrlIdError(`Not a url id: ${bad}`));
    }
  });

  it('is what every request with an id uses, and each sends the string', () => {
    expect(edgeParams({ ...DEFAULT_EDGE_QUERY, source: '12', target: '9223372036854775807' })).toMatchObject({
      'filter[source]': '12',
      'filter[target]': '9223372036854775807',
    });
    expect(pageDetailQuery(SCOPE, '9007199254740993', 'editorial').queryKey).toContain('9007199254740993');
    expect(
      neighborsQuery(SCOPE, { urlId: '9007199254740993', direction: 'out', linkScope: 'editorial', offset: 0 })
        .queryKey,
    ).toContainEqual(expect.objectContaining({ url_id: '9007199254740993' }));
    expect(() => edgeParams({ ...DEFAULT_EDGE_QUERY, source: '9223372036854775808' })).toThrow(UrlIdError);
    expect(() => pageDetailQuery(SCOPE, '0', 'editorial')).toThrow(UrlIdError);
    expect(() => neighborsQuery(SCOPE, { urlId: 'x', direction: 'out', linkScope: 'editorial', offset: 0 })).toThrow(
      UrlIdError,
    );
  });

  it('names the two CSV downloads with their ids filled in', () => {
    expect(pagesPath(SCOPE)).toBe('/api/v1/workspaces/w1/projects/p1/internal-links/pages');
    expect(edgesPath(SCOPE)).toBe('/api/v1/workspaces/w1/projects/p1/internal-links/edges');
  });
});

describe('crawls and settings (the backend OpenAPI)', () => {
  it('reads the latest crawls under the project, and crawlKeys reaches them', () => {
    const query = crawlsQuery(SCOPE);
    expect(query.queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'link-crawls', { limit: CRAWL_LIMIT }]);
    expect(crawlKeys(SCOPE)).toEqual([['ws', 'w1', 'p', 'p1', 'link-crawls']]);
  });

  it('reads more crawls for the Internal links screen than the settings list does, under the same keys', () => {
    expect(CRAWL_SCREEN_LIMIT).toBeGreaterThan(CRAWL_LIMIT);
    const query = crawlsQuery(SCOPE, CRAWL_SCREEN_LIMIT);
    expect(query.queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'link-crawls', { limit: CRAWL_SCREEN_LIMIT }]);
    expect(query.queryKey.slice(0, 5)).toEqual(crawlKeys(SCOPE)[0]);
  });

  it('makes a crawl that turns ready stale for the crawl list, every read of the links and the settings', () => {
    expect(crawlFinishedKeys(SCOPE)).toEqual([
      ['ws', 'w1', 'p', 'p1', 'link-crawls'],
      ...internalLinksKeys(SCOPE),
      ['ws', 'w1', 'p', 'p1', 'settings'],
    ]);
  });

  it('reads the internal links settings from the project settings, the key the keyword defaults use', () => {
    expect(linkSettingsQuery(SCOPE).queryKey).toEqual(['ws', 'w1', 'p', 'p1', 'settings', {}]);
  });
});

describe('isEdgeRowPage (the edges answer is typed unknown too)', () => {
  const answer = {
    data: [],
    page: { limit: 100, next_cursor: 'c', has_more: true },
    meta: { run_id: 'r', scope: 'editorial', total: 0 },
  };

  it('takes a page with a cursor text or none, and refuses a CSV text or a missing run id', () => {
    expect(isEdgeRowPage(answer)).toBe(true);
    expect(isEdgeRowPage({ ...answer, page: { ...answer.page, next_cursor: null } })).toBe(true);
    expect(isEdgeRowPage('a,b\n')).toBe(false);
    expect(isEdgeRowPage({ ...answer, meta: { total: 0 } })).toBe(false);
    expect(isEdgeRowPage({ ...answer, page: { ...answer.page, next_cursor: 4 } })).toBe(false);
  });
});

describe('isPageRowPage (the pages answer is typed unknown: its 200 declares a CSV body too)', () => {
  const answer = {
    data: [],
    page: { limit: 100, next_cursor: null, has_more: false },
    meta: { run_id: 'r', scope: 'editorial', total: 0 },
  };

  it('takes a page of rows with its cursor facts and its meta', () => {
    expect(isPageRowPage(answer)).toBe(true);
  });

  it('refuses what is not one: a CSV text, nothing, a list, or an answer missing a part', () => {
    expect(isPageRowPage('url,path\n')).toBe(false);
    expect(isPageRowPage(null)).toBe(false);
    expect(isPageRowPage(undefined)).toBe(false);
    expect(isPageRowPage([])).toBe(false);
    expect(isPageRowPage({ ...answer, data: 'x' })).toBe(false);
    expect(isPageRowPage({ data: [], meta: answer.meta })).toBe(false);
    expect(isPageRowPage({ data: [], page: answer.page })).toBe(false);
    expect(isPageRowPage({ ...answer, page: { limit: 100 } })).toBe(false);
    expect(isPageRowPage({ ...answer, meta: { total: 'many' } })).toBe(false);
    expect(isPageRowPage({ ...answer, page: { ...answer.page, next_cursor: 7 } })).toBe(false);
    expect(isPageRowPage({ ...answer, page: { has_more: false, limit: 100 } })).toBe(false);
  });

  it('takes a next cursor that is text', () => {
    expect(isPageRowPage({ ...answer, page: { ...answer.page, next_cursor: 'abc', has_more: true } })).toBe(true);
  });
});
