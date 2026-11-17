import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EDGE_QUERY,
  DEFAULT_PAGE_QUERY,
  edgeParams,
  internalLinksKeys,
  neighborsQuery,
  pageDetailQuery,
  pageFilterOf,
  pageParams,
  pagesQuery,
  tierRulesQuery,
  pageTiersQuery,
  UrlIdError,
  urlIdNumber,
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
});

describe('url ids (the API takes numbers, the answers give strings)', () => {
  it('reads a plain positive integer', () => {
    expect(urlIdNumber('111')).toBe(111);
    expect(urlIdNumber('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses text that is not an id', () => {
    for (const bad of ['0', '-1', '01', '1.5', '1e3', ' 7', 'abc', '']) {
      expect(() => urlIdNumber(bad)).toThrow(new UrlIdError(`Not a url id: ${bad}`));
    }
  });

  it('refuses an id that a number cannot hold exactly, instead of sending a different page', () => {
    expect(() => urlIdNumber('9007199254740993')).toThrow(UrlIdError);
    expect(() => urlIdNumber('9223372036854775807')).toThrow('too large');
  });

  it('is what every request with an id uses', () => {
    expect(edgeParams({ ...DEFAULT_EDGE_QUERY, source: '12', target: '34' })).toMatchObject({
      'filter[source]': 12,
      'filter[target]': 34,
    });
    expect(() => edgeParams({ ...DEFAULT_EDGE_QUERY, source: '9007199254740993' })).toThrow(UrlIdError);
    expect(() => pageDetailQuery(SCOPE, '9007199254740993', 'editorial')).toThrow(UrlIdError);
    expect(() => neighborsQuery(SCOPE, { urlId: 'x', direction: 'out', linkScope: 'editorial', offset: 0 })).toThrow(
      UrlIdError,
    );
  });
});
