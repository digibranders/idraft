import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { detailMessage } from './detail';
import type { CheckId, IssueDetail } from './types';

type Row = Parameters<typeof detailMessage>[1];
const row = (status: number | null, issue: IssueDetail | null = null): Row => ({ status, issue });

interface Case {
  name: string;
  check: CheckId;
  row: Row;
  expected: { key: string; values: Record<string, string | number> } | null;
}

/** One case per key of the table `issues.found`, then the cases where nothing can be said. */
const CASES: readonly Case[] = [
  { name: 'returns', check: 'status-5xx', row: row(503), expected: { key: 'returns', values: { status: 503 } } },
  {
    name: 'returns, sitemap-broken',
    check: 'sitemap-broken',
    row: row(404),
    expected: { key: 'returns', values: { status: 404 } },
  },
  {
    name: 'returns, clicks-page-broken',
    check: 'clicks-page-broken',
    row: row(301),
    expected: { key: 'returns', values: { status: 301 } },
  },
  {
    name: 'returns, redirect-pages without a target',
    check: 'redirect-pages',
    row: row(302, { target_path: null }),
    expected: { key: 'returns', values: { status: 302 } },
  },
  {
    name: 'returnsLinked',
    check: 'status-4xx',
    row: row(404, { count: 4 }),
    expected: { key: 'returnsLinked', values: { status: 404, count: 4 } },
  },
  {
    name: 'redirectsTo',
    check: 'redirect-pages',
    row: row(301, { target_path: '/services/vapt' }),
    expected: { key: 'redirectsTo', values: { target: '/services/vapt' } },
  },
  {
    name: 'redirectsToStatus',
    check: 'redirect-broken',
    row: row(301, { target_path: '/gone', target_status: 404 }),
    expected: { key: 'redirectsToStatus', values: { target: '/gone', targetStatus: 404 } },
  },
  {
    name: 'redirectsAgain',
    check: 'redirect-chain',
    row: row(301, { target_path: '/b' }),
    expected: { key: 'redirectsAgain', values: { target: '/b' } },
  },
  {
    name: 'linksToRedirects',
    check: 'links-to-redirect',
    row: row(200, { count: 2 }),
    expected: { key: 'linksToRedirects', values: { count: 2 } },
  },
  {
    name: 'canonical',
    check: 'canonical-elsewhere',
    row: row(200, { target_path: '/main' }),
    expected: { key: 'canonical', values: { target: '/main' } },
  },
  {
    name: 'canonicalStatus',
    check: 'canonical-broken',
    row: row(200, { target_path: '/main', target_status: 301 }),
    expected: { key: 'canonicalStatus', values: { target: '/main', targetStatus: 301 } },
  },
  {
    name: 'noindexTag',
    check: 'noindex',
    row: row(200, { reason: 'meta_tag' }),
    expected: { key: 'noindexTag', values: {} },
  },
  {
    name: 'noindexHeader',
    check: 'noindex',
    row: row(200, { reason: 'http_header' }),
    expected: { key: 'noindexHeader', values: {} },
  },
  {
    name: 'notIndexableCanonical',
    check: 'sitemap-nonindexable',
    row: row(200, { reason: 'canonical' }),
    expected: { key: 'notIndexableCanonical', values: {} },
  },
  {
    name: 'notIndexableNoindex, meta tag',
    check: 'sitemap-nonindexable',
    row: row(200, { reason: 'meta_tag' }),
    expected: { key: 'notIndexableNoindex', values: {} },
  },
  {
    name: 'notIndexableNoindex, header',
    check: 'sitemap-nonindexable',
    row: row(200, { reason: 'http_header' }),
    expected: { key: 'notIndexableNoindex', values: {} },
  },
  {
    name: 'notIndexableRobots',
    check: 'sitemap-nonindexable',
    row: row(200, { reason: 'robots_txt' }),
    expected: { key: 'notIndexableRobots', values: {} },
  },
  {
    name: 'notIndexable, another reason',
    check: 'sitemap-nonindexable',
    row: row(200, { reason: 'something_new' }),
    expected: { key: 'notIndexable', values: {} },
  },
  {
    name: 'notIndexable, no reason',
    check: 'sitemap-nonindexable',
    row: row(200, { reason: null }),
    expected: { key: 'notIndexable', values: {} },
  },
  { name: 'notInSitemap', check: 'not-in-sitemap', row: row(200), expected: { key: 'notInSitemap', values: {} } },
  {
    name: 'linksToBroken',
    check: 'broken-internal-links',
    row: row(200, { count: 3 }),
    expected: { key: 'linksToBroken', values: { count: 3 } },
  },
  { name: 'noLinksIn, orphans', check: 'orphans', row: row(200), expected: { key: 'noLinksIn', values: {} } },
  {
    name: 'noLinksIn, clicks-page-orphan',
    check: 'clicks-page-orphan',
    row: row(200),
    expected: { key: 'noLinksIn', values: {} },
  },
  {
    name: 'noneEditorial',
    check: 'editorial-orphans',
    row: row(200, { count: 2 }),
    expected: { key: 'noneEditorial', values: { count: 2 } },
  },
  {
    name: 'linksToNonIndexable',
    check: 'links-to-nonindexable',
    row: row(200, { count: 1 }),
    expected: { key: 'linksToNonIndexable', values: { count: 1 } },
  },
  {
    name: 'clicksDeep',
    check: 'deep-pages',
    row: row(200, { count: 5 }),
    expected: { key: 'clicksDeep', values: { count: 5 } },
  },
  {
    name: 'nofollowLinks',
    check: 'nofollow-internal',
    row: row(200, { count: 6 }),
    expected: { key: 'nofollowLinks', values: { count: 6 } },
  },
  { name: 'noTitle', check: 'title-missing', row: row(200), expected: { key: 'noTitle', values: {} } },
  {
    name: 'sameTitle',
    check: 'title-duplicate',
    row: row(200, { target_path: '/other', count: 1 }),
    expected: { key: 'sameTitle', values: { target: '/other' } },
  },
  {
    name: 'sameTitleMore',
    check: 'title-duplicate',
    row: row(200, { target_path: '/other', count: 4 }),
    expected: { key: 'sameTitleMore', values: { target: '/other', more: 3 } },
  },
  {
    name: 'characters, title-long',
    check: 'title-long',
    row: row(200, { count: 72 }),
    expected: { key: 'characters', values: { count: 72 } },
  },
  {
    name: 'characters, title-short',
    check: 'title-short',
    row: row(200, { count: 12 }),
    expected: { key: 'characters', values: { count: 12 } },
  },
  {
    name: 'characters, url-long',
    check: 'url-long',
    row: row(200, { count: 130 }),
    expected: { key: 'characters', values: { count: 130 } },
  },
  {
    name: 'capitals',
    check: 'url-format',
    row: row(200, { reason: 'capitals' }),
    expected: { key: 'capitals', values: {} },
  },
  {
    name: 'underscores',
    check: 'url-format',
    row: row(200, { reason: 'underscores' }),
    expected: { key: 'underscores', values: {} },
  },
  {
    name: 'capitalsAndUnderscores',
    check: 'url-format',
    row: row(200, { reason: 'both' }),
    expected: { key: 'capitalsAndUnderscores', values: {} },
  },
  {
    name: 'rankBroken',
    check: 'rank-page-broken',
    row: row(404, { count: 2 }),
    expected: { key: 'rankBroken', values: { status: 404, count: 2 } },
  },
  {
    name: 'citedBroken',
    check: 'cited-page-broken',
    row: row(301, { count: 3 }),
    expected: { key: 'citedBroken', values: { status: 301, count: 3 } },
  },
  {
    name: 'offTarget',
    check: 'off-target',
    row: row(200, { count: 1 }),
    expected: { key: 'offTarget', values: { count: 1 } },
  },
  // A value the message needs is missing
  { name: 'no status, 5xx', check: 'status-5xx', row: row(null), expected: null },
  { name: 'no count, 4xx', check: 'status-4xx', row: row(404, { count: null }), expected: null },
  { name: 'no detail, 4xx', check: 'status-4xx', row: row(404, null), expected: null },
  {
    name: 'no target, redirect-broken',
    check: 'redirect-broken',
    row: row(301, { target_status: 404 }),
    expected: null,
  },
  {
    name: 'no target status, redirect-broken',
    check: 'redirect-broken',
    row: row(301, { target_path: '/a' }),
    expected: null,
  },
  { name: 'no target, chain', check: 'redirect-chain', row: row(301, null), expected: null },
  { name: 'no target, canonical', check: 'canonical-elsewhere', row: row(200, null), expected: null },
  { name: 'no reason, noindex', check: 'noindex', row: row(200, { reason: null }), expected: null },
  { name: 'another reason, noindex', check: 'noindex', row: row(200, { reason: 'canonical' }), expected: null },
  { name: 'no reason, url-format', check: 'url-format', row: row(200, null), expected: null },
  { name: 'no count, title-long', check: 'title-long', row: row(200, null), expected: null },
  { name: 'no target, duplicate title', check: 'title-duplicate', row: row(200, { count: 2 }), expected: null },
  { name: 'no count, duplicate title', check: 'title-duplicate', row: row(200, { target_path: '/a' }), expected: null },
  { name: 'no status, ranked broken page', check: 'rank-page-broken', row: row(null, { count: 1 }), expected: null },
];

describe('detailMessage', () => {
  it.each(CASES)('$name', ({ check, row: given, expected }) => {
    expect(detailMessage(check, given)).toEqual(expected);
  });

  it('answers a key of issues.found for every message it returns', () => {
    const found = Object.keys(messages.issues.found);
    const keys = CASES.flatMap(({ check, row: given }) => detailMessage(check, given)?.key ?? []);
    expect(keys.filter((key) => !found.includes(key))).toEqual([]);
  });

  it('has a case for every key of issues.found', () => {
    const used = new Set(CASES.flatMap(({ check, row: given }) => detailMessage(check, given)?.key ?? []));
    expect(Object.keys(messages.issues.found).filter((key) => !used.has(key))).toEqual([]);
  });
});
