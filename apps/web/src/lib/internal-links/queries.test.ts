import { describe, expect, it } from 'vitest';

import {
  changeLinksExportQuery,
  changeLinksParams,
  changeLinksPath,
  changeLinksQuery,
  changesSummaryQuery,
  isChangeLinkPage,
  isOpportunityPage,
  moreIncludes,
  movedPagesQuery,
  opportunitiesExportQuery,
  opportunitiesParams,
  opportunitiesPath,
  opportunitiesQuery,
  plannedExportQuery,
  routesQuery,
  tierSuggestionsQuery,
  withRun,
  worklistsQuery,
  crawlKeys,
  crawlsQuery,
  CRAWL_LIMIT,
  CRAWL_SCREEN_LIMIT,
  DEFAULT_EDGE_QUERY,
  DEFAULT_PAGE_QUERY,
  edgeParams,
  edgesQuery,
  internalLinksKeys,
  isEdgeRowPage,
  isPageRowPage,
  linkSettingsQuery,
  neighborsQuery,
  pageDetailQuery,
  pageFilterOf,
  pageParams,
  pagesQuery,
  publicSummaryQuery,
  sharesQuery,
  tierFlowQuery,
  tierRulesQuery,
  tierRulePreviewQuery,
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
    expect(startsWith(pagesQuery(SCOPE, DEFAULT_PAGE_QUERY, null).queryKey, reads)).toBe(true);
    expect(startsWith(tierRulesQuery(SCOPE).queryKey, rules)).toBe(true);
    expect(startsWith(pageTiersQuery('w1').queryKey, tiers)).toBe(true);
  });

  it('keys a rule preview under the rules, one key per rule as typed', () => {
    const startsWith = (key: readonly unknown[], prefix: readonly unknown[] | undefined): boolean =>
      prefix !== undefined && prefix.every((part, index) => key[index] === part);
    const input = { matchType: 'prefix' as const, value: '/a/', position: 1, ruleId: null };
    const key = tierRulePreviewQuery(SCOPE, input).queryKey;
    // A rule change refreshes it through the rules prefix, and it stays out of the pages reads
    expect(startsWith(key, internalLinksKeys(SCOPE)[1])).toBe(true);
    expect(startsWith(key, internalLinksKeys(SCOPE)[0])).toBe(false);
    expect(tierRulePreviewQuery(SCOPE, { ...input, value: '/b/' }).queryKey).not.toEqual(key);
    expect(tierRulePreviewQuery(SCOPE, { ...input, position: 2 }).queryKey).not.toEqual(key);
    expect(tierRulePreviewQuery(SCOPE, { ...input, ruleId: 'r1' }).queryKey).not.toEqual(key);
    expect(tierRulePreviewQuery(SCOPE, { ...input }).queryKey).toEqual(key);
  });

  it('keys the tier flow under the reads that a tier change or a finished crawl makes stale', () => {
    const startsWith = (key: readonly unknown[], prefix: readonly unknown[] | undefined): boolean =>
      prefix !== undefined && prefix.every((part, index) => key[index] === part);
    const key = tierFlowQuery(SCOPE, 'editorial', null).queryKey;
    expect(startsWith(key, internalLinksKeys(SCOPE)[0])).toBe(true);
    expect(crawlFinishedKeys(SCOPE).some((prefix) => startsWith(key, prefix))).toBe(true);
    // One key per scope: a scope never reads the answer of another
    expect(tierFlowQuery(SCOPE, 'all', null).queryKey).not.toEqual(key);
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
    expect(pageDetailQuery(SCOPE, '9007199254740993', 'editorial', null).queryKey).toContain('9007199254740993');
    expect(
      neighborsQuery(SCOPE, { urlId: '9007199254740993', direction: 'out', linkScope: 'editorial', offset: 0 }, null)
        .queryKey,
    ).toContainEqual(expect.objectContaining({ url_id: '9007199254740993' }));
    expect(() => edgeParams({ ...DEFAULT_EDGE_QUERY, source: '9223372036854775808' })).toThrow(UrlIdError);
    expect(() => pageDetailQuery(SCOPE, '0', 'editorial', null)).toThrow(UrlIdError);
    expect(() =>
      neighborsQuery(SCOPE, { urlId: 'x', direction: 'out', linkScope: 'editorial', offset: 0 }, null),
    ).toThrow(UrlIdError);
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

const startsWith = (key: readonly unknown[], prefix: readonly unknown[] | undefined): boolean =>
  prefix !== undefined && prefix.every((part, index) => key[index] === part);

describe('the run parameter (a chosen crawl, none for the latest)', () => {
  it('adds run only when a crawl is chosen', () => {
    expect(withRun({ scope: 'editorial' }, null)).toEqual({ scope: 'editorial' });
    expect(withRun({ scope: 'editorial' }, 'abc')).toEqual({ scope: 'editorial', run: 'abc' });
  });

  it('is part of the key of every read that takes it, and absent from the key of the latest', () => {
    const latest = pagesQuery(SCOPE, DEFAULT_PAGE_QUERY, null).queryKey;
    const older = pagesQuery(SCOPE, DEFAULT_PAGE_QUERY, 'r1').queryKey;
    expect(older).not.toEqual(latest);
    expect(JSON.stringify(older)).toContain('"run":"r1"');
    expect(JSON.stringify(latest)).not.toContain('run');
    expect(pageDetailQuery(SCOPE, '7', 'editorial', 'r1').queryKey).toContainEqual(
      expect.objectContaining({ run: 'r1' }),
    );
    expect(edgesQuery(SCOPE, DEFAULT_EDGE_QUERY, 'r1').queryKey).toContainEqual(expect.objectContaining({ run: 'r1' }));
    expect(
      neighborsQuery(SCOPE, { urlId: '7', direction: 'in', linkScope: 'all', offset: 0 }, 'r1').queryKey,
    ).toContainEqual(expect.objectContaining({ run: 'r1' }));
    expect(tierFlowQuery(SCOPE, 'all', 'r1').queryKey).toContainEqual(expect.objectContaining({ run: 'r1' }));
    expect(worklistsQuery(SCOPE, 'r1').queryKey).toContainEqual(expect.objectContaining({ run: 'r1' }));
    expect(worklistsQuery(SCOPE, null).queryKey).not.toEqual(worklistsQuery(SCOPE, 'r1').queryKey);
  });
});

describe('the pages list extras (include)', () => {
  it('asks for the parts the visible columns need, in the API order', () => {
    expect(moreIncludes(['change', 'rank', 'citations', 'anchors', 'matches', 'clicks'])).toEqual([
      'changes',
      'keywords',
      'citations',
      'anchors',
      'gsc',
    ]);
    // There is no equity column: an id that is not a column asks for nothing
    expect(moreIncludes(['equityChange', 'keywords', 'impressions'])).toEqual(['keywords', 'gsc']);
    expect(moreIncludes(['page', 'tier'])).toEqual([]);
  });

  it('sends include only when a part is asked for', () => {
    expect(pageParams({ ...DEFAULT_PAGE_QUERY, include: ['changes', 'anchors'] }).include).toEqual([
      'changes',
      'anchors',
    ]);
    expect(pageParams(DEFAULT_PAGE_QUERY)).not.toHaveProperty('include');
  });

  it('keeps include out of the bulk filter', () => {
    expect(pageFilterOf({ ...DEFAULT_PAGE_QUERY, include: ['changes'] })).toEqual({});
  });
});

describe('changes reads', () => {
  const base = { change: 'lost' as const, linkScope: 'all' as const, only: 'top' as const, offset: 0, limit: 50 };

  it('builds the lost links parameters', () => {
    expect(changeLinksParams(base, 'r1')).toEqual({
      change: 'lost',
      link_scope: 'all',
      only: 'top',
      offset: 0,
      limit: 50,
      run: 'r1',
    });
    expect(changeLinksParams({ ...base, change: 'added', only: 'all', offset: 50 }, null)).toEqual({
      change: 'added',
      link_scope: 'all',
      only: 'all',
      offset: 50,
      limit: 50,
    });
  });

  it('exports every row of the same selection as CSV, without a window', () => {
    expect(changeLinksExportQuery(base, 'r1')).toEqual({
      change: 'lost',
      link_scope: 'all',
      only: 'top',
      run: 'r1',
      format: 'csv',
    });
    expect(changeLinksExportQuery(base, null)).not.toHaveProperty('run');
  });

  it('names the CSV download with its ids filled in', () => {
    expect(changeLinksPath(SCOPE)).toBe('/api/v1/workspaces/w1/projects/p1/internal-links/changes/links');
  });

  it('keys the reads under the links of the project, so a tier change and a finished crawl reach them', () => {
    const keys = [
      changesSummaryQuery(SCOPE, null).queryKey,
      changeLinksQuery(SCOPE, base, null).queryKey,
      movedPagesQuery(SCOPE, null, 8).queryKey,
    ];
    for (const key of keys) {
      expect(startsWith(key, internalLinksKeys(SCOPE)[0])).toBe(true);
      expect(crawlFinishedKeys(SCOPE).some((prefix) => startsWith(key, prefix))).toBe(true);
    }
    expect(changesSummaryQuery(SCOPE, 'r1').queryKey).not.toEqual(changesSummaryQuery(SCOPE, null).queryKey);
    expect(changeLinksQuery(SCOPE, { ...base, change: 'added' }, null).queryKey).not.toEqual(keys[1]);
    expect(movedPagesQuery(SCOPE, null, 20).queryKey).not.toEqual(keys[2]);
  });

  it('checks the lost links answer, typed unknown because its 200 declares a CSV body too', () => {
    const answer = { data: [], meta: { run_id: 'r', total: 0, change: 'lost', truncated: false } };
    expect(isChangeLinkPage(answer)).toBe(true);
    expect(isChangeLinkPage('a,b\n')).toBe(false);
    expect(isChangeLinkPage(null)).toBe(false);
    expect(isChangeLinkPage({ meta: answer.meta })).toBe(false);
    expect(isChangeLinkPage({ ...answer, data: 'x' })).toBe(false);
    expect(isChangeLinkPage({ ...answer, meta: { total: 0 } })).toBe(false);
    expect(isChangeLinkPage({ ...answer, meta: { ...answer.meta, total: 'many' } })).toBe(false);
  });
});

describe('opportunities reads', () => {
  it('builds the parameters and leaves unset filters out', () => {
    expect(opportunitiesParams({ status: null, tier: null, q: null, offset: 0, limit: 50 }, null)).toEqual({
      offset: 0,
      limit: 50,
    });
    expect(opportunitiesParams({ status: 'open', tier: '1', q: 'soc', offset: 50, limit: 50 }, 'r1')).toEqual({
      status: 'open',
      'filter[target_tier]': '1',
      q: 'soc',
      offset: 50,
      limit: 50,
      run: 'r1',
    });
  });

  it('exports the filtered rows, and the planned fixes with only the crawl', () => {
    expect(opportunitiesExportQuery({ status: 'open', tier: 'none', q: null, offset: 50, limit: 50 }, null)).toEqual({
      status: 'open',
      'filter[target_tier]': 'none',
      format: 'csv',
    });
    expect(plannedExportQuery(null)).toEqual({ export: 'planned' });
    expect(plannedExportQuery('r1')).toEqual({ export: 'planned', run: 'r1' });
  });

  it('names the CSV download with its ids filled in', () => {
    expect(opportunitiesPath(SCOPE)).toBe('/api/v1/workspaces/w1/projects/p1/internal-links/opportunities');
  });

  it('keys the reads under the links of the project, one key per filter', () => {
    const query = { status: null, tier: null, q: null, offset: 0, limit: 50 };
    const key = opportunitiesQuery(SCOPE, query, null).queryKey;
    expect(startsWith(key, internalLinksKeys(SCOPE)[0])).toBe(true);
    expect(opportunitiesQuery(SCOPE, { ...query, status: 'open' }, null).queryKey).not.toEqual(key);
    expect(opportunitiesQuery(SCOPE, query, 'r1').queryKey).not.toEqual(key);
  });

  it('checks the answer, typed unknown because its 200 declares a CSV body too', () => {
    const answer = {
      data: [],
      meta: { run_id: 'r', total: 0, counts: { open: 0, accepted: 0, dismissed: 0 } },
    };
    expect(isOpportunityPage(answer)).toBe(true);
    expect(isOpportunityPage('a,b\n')).toBe(false);
    expect(isOpportunityPage({ ...answer, data: null })).toBe(false);
    expect(isOpportunityPage({ ...answer, meta: { run_id: 'r', total: 0 } })).toBe(false);
    expect(isOpportunityPage({ ...answer, meta: { ...answer.meta, run_id: 1 } })).toBe(false);
  });
});

describe('tier suggestions and paths', () => {
  it('keys the suggestions under the links of the project, so a tier change refreshes them', () => {
    expect(startsWith(tierSuggestionsQuery(SCOPE).queryKey, internalLinksKeys(SCOPE)[0])).toBe(true);
  });

  it('reads the routes to a page, checking the id first', () => {
    expect(routesQuery(SCOPE, '9007199254740993', null).queryKey).toContainEqual(
      expect.objectContaining({ url_id: '9007199254740993' }),
    );
    expect(routesQuery(SCOPE, '7', 'r1').queryKey).toContainEqual(expect.objectContaining({ run: 'r1' }));
    expect(() => routesQuery(SCOPE, '0', null)).toThrow(UrlIdError);
  });
});

describe('the share link reads', () => {
  it('keys the project links under the project, and the public summary by its token without retries', () => {
    expect(sharesQuery(SCOPE).queryKey.slice(0, 4)).toEqual(['ws', SCOPE.workspaceId, 'p', SCOPE.projectId]);
    const read = publicSummaryQuery('abc');
    expect(read.queryKey).toContain('abc');
    expect(read.retry).toBe(false);
  });
});
