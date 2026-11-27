import { createTranslator } from 'next-intl';
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
  {
    name: 'httpResources',
    check: 'mixed-content',
    row: row(200, { count: 2 }),
    expected: { key: 'httpResources', values: { count: 2 } },
  },
  {
    name: 'hreflangProblems',
    check: 'hreflang',
    row: row(200, { count: 1 }),
    expected: { key: 'hreflangProblems', values: { count: 1 } },
  },
  {
    name: 'milliseconds',
    check: 'slow-pages',
    row: row(200, { count: 3600 }),
    expected: { key: 'milliseconds', values: { count: 3600 } },
  },
  {
    name: 'noDescription',
    check: 'description-missing',
    row: row(200),
    expected: { key: 'noDescription', values: {} },
  },
  {
    name: 'sameDescription',
    check: 'description-duplicate',
    row: row(200, { target_path: '/other', count: 1 }),
    expected: { key: 'sameDescription', values: { target: '/other' } },
  },
  {
    name: 'sameDescriptionMore',
    check: 'description-duplicate',
    row: row(200, { target_path: '/other', count: 3 }),
    expected: { key: 'sameDescriptionMore', values: { target: '/other', more: 2 } },
  },
  { name: 'noH1', check: 'h1-missing', row: row(200), expected: { key: 'noH1', values: {} } },
  {
    name: 'h1Count',
    check: 'h1-multiple',
    row: row(200, { count: 2 }),
    expected: { key: 'h1Count', values: { count: 2 } },
  },
  {
    name: 'words',
    check: 'thin-content',
    row: row(200, { count: 90 }),
    expected: { key: 'words', values: { count: 90 } },
  },
  {
    name: 'sameText',
    check: 'duplicate-content',
    row: row(200, { target_path: '/copy', count: 1 }),
    expected: { key: 'sameText', values: { target: '/copy' } },
  },
  {
    name: 'sameTextMore',
    check: 'duplicate-content',
    row: row(200, { target_path: '/copy', count: 2 }),
    expected: { key: 'sameTextMore', values: { target: '/copy', more: 1 } },
  },
  {
    name: 'imagesWithoutAlt',
    check: 'image-alt',
    row: row(200, { count: 3 }),
    expected: { key: 'imagesWithoutAlt', values: { count: 3 } },
  },
  { name: 'noOpenGraph', check: 'social-tags', row: row(200), expected: { key: 'noOpenGraph', values: {} } },
  {
    name: 'jsonldErrors',
    check: 'schema-errors',
    row: row(200, { count: 1 }),
    expected: { key: 'jsonldErrors', values: { count: 1 } },
  },
  // A value the message needs is missing
  { name: 'no count, mixed-content', check: 'mixed-content', row: row(200, null), expected: null },
  { name: 'no count, slow-pages', check: 'slow-pages', row: row(200, null), expected: null },
  { name: 'no target, duplicate content', check: 'duplicate-content', row: row(200, { count: 2 }), expected: null },
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

const t = createTranslator({ locale: 'en', messages, namespace: 'issues.found' });
type FoundKey = Parameters<typeof t>[0];
const isFoundKey = (key: string): key is FoundKey => Object.hasOwn(messages.issues.found, key);
const render = (message: ReturnType<typeof detailMessage>): string | null =>
  message === null ? null : isFoundKey(message.key) ? t(message.key, message.values) : `no message ${message.key}`;

/** The sentence a reader sees for a page of a check, with the ICU plurals of the app's own formatter. */
const TEXTS: readonly { check: CheckId; row: Row; text: string }[] = [
  { check: 'status-5xx', row: row(503), text: 'Returns 503' },
  { check: 'sitemap-broken', row: row(404), text: 'Returns 404' },
  { check: 'redirect-pages', row: row(302, { target_path: null }), text: 'Returns 302' },
  { check: 'status-4xx', row: row(404, { count: 1 }), text: 'Returns 404, linked from 1 page' },
  { check: 'status-4xx', row: row(404, { count: 4 }), text: 'Returns 404, linked from 4 pages' },
  { check: 'redirect-pages', row: row(301, { target_path: '/services/vapt' }), text: 'Redirects to /services/vapt' },
  {
    check: 'redirect-broken',
    row: row(301, { target_path: '/gone', target_status: 404 }),
    text: 'Redirects to /gone (404)',
  },
  { check: 'redirect-chain', row: row(301, { target_path: '/b' }), text: 'Redirects to /b, which redirects again' },
  { check: 'links-to-redirect', row: row(200, { count: 1 }), text: 'Links to 1 address that redirects' },
  { check: 'links-to-redirect', row: row(200, { count: 2 }), text: 'Links to 2 addresses that redirect' },
  { check: 'canonical-elsewhere', row: row(200, { target_path: '/main' }), text: 'Canonical: /main' },
  {
    check: 'canonical-broken',
    row: row(200, { target_path: '/main', target_status: 301 }),
    text: 'Canonical: /main (301)',
  },
  { check: 'noindex', row: row(200, { reason: 'meta_tag' }), text: 'Has a noindex tag' },
  { check: 'noindex', row: row(200, { reason: 'http_header' }), text: 'Sends a noindex header' },
  { check: 'sitemap-nonindexable', row: row(200, { reason: 'canonical' }), text: 'Canonical points to another page' },
  { check: 'sitemap-nonindexable', row: row(200, { reason: 'meta_tag' }), text: 'Set to noindex' },
  { check: 'sitemap-nonindexable', row: row(200, { reason: 'robots_txt' }), text: 'Blocked by robots.txt' },
  { check: 'sitemap-nonindexable', row: row(200, { reason: null }), text: 'Not indexable' },
  { check: 'not-in-sitemap', row: row(200), text: 'Indexable, not in the sitemap' },
  { check: 'broken-internal-links', row: row(200, { count: 1 }), text: 'Links to 1 broken page' },
  { check: 'broken-internal-links', row: row(200, { count: 3 }), text: 'Links to 3 broken pages' },
  { check: 'orphans', row: row(200), text: 'No internal links in' },
  { check: 'editorial-orphans', row: row(200, { count: 1 }), text: '1 linking page, none editorial' },
  { check: 'editorial-orphans', row: row(200, { count: 2 }), text: '2 linking pages, none editorial' },
  { check: 'links-to-nonindexable', row: row(200, { count: 1 }), text: 'Links to 1 non-indexable page' },
  { check: 'links-to-nonindexable', row: row(200, { count: 5 }), text: 'Links to 5 non-indexable pages' },
  { check: 'deep-pages', row: row(200, { count: 5 }), text: '5 clicks from the home page' },
  { check: 'nofollow-internal', row: row(200, { count: 1 }), text: '1 nofollow link to your pages' },
  { check: 'nofollow-internal', row: row(200, { count: 6 }), text: '6 nofollow links to your pages' },
  { check: 'title-missing', row: row(200), text: 'No title' },
  { check: 'title-duplicate', row: row(200, { target_path: '/a', count: 1 }), text: 'Same title as /a' },
  { check: 'title-duplicate', row: row(200, { target_path: '/a', count: 3 }), text: 'Same title as /a and 2 more' },
  { check: 'title-long', row: row(200, { count: 1 }), text: '1 character' },
  { check: 'title-short', row: row(200, { count: 12 }), text: '12 characters' },
  { check: 'url-long', row: row(200, { count: 130 }), text: '130 characters' },
  { check: 'url-format', row: row(200, { reason: 'capitals' }), text: 'Has capitals' },
  { check: 'url-format', row: row(200, { reason: 'underscores' }), text: 'Has underscores' },
  { check: 'url-format', row: row(200, { reason: 'both' }), text: 'Has capitals and underscores' },
  { check: 'rank-page-broken', row: row(404, { count: 1 }), text: 'Returns 404, 1 keyword ranks with it' },
  { check: 'rank-page-broken', row: row(301, { count: 2 }), text: 'Returns 301, 2 keywords rank with it' },
  { check: 'cited-page-broken', row: row(404, { count: 1 }), text: 'Returns 404, cited in 1 answer' },
  { check: 'cited-page-broken', row: row(301, { count: 3 }), text: 'Returns 301, cited in 3 answers' },
  { check: 'off-target', row: row(200, { count: 1 }), text: '1 keyword ranks with another page' },
  { check: 'off-target', row: row(200, { count: 4 }), text: '4 keywords rank with another page' },
  { check: 'mixed-content', row: row(200, { count: 1 }), text: '1 resource loads over HTTP' },
  { check: 'mixed-content', row: row(200, { count: 2 }), text: '2 resources load over HTTP' },
  { check: 'hreflang', row: row(200, { count: 1 }), text: '1 problem in the language links' },
  { check: 'hreflang', row: row(200, { count: 2 }), text: '2 problems in the language links' },
  { check: 'slow-pages', row: row(200, { count: 3600 }), text: '3600 ms' },
  { check: 'description-missing', row: row(200), text: 'No description' },
  { check: 'description-duplicate', row: row(200, { target_path: '/a', count: 1 }), text: 'Same description as /a' },
  {
    check: 'description-duplicate',
    row: row(200, { target_path: '/a', count: 3 }),
    text: 'Same description as /a and 2 more',
  },
  { check: 'h1-missing', row: row(200), text: 'No H1' },
  { check: 'h1-multiple', row: row(200, { count: 2 }), text: '2 H1 headings' },
  { check: 'thin-content', row: row(200, { count: 1 }), text: '1 word' },
  { check: 'thin-content', row: row(200, { count: 90 }), text: '90 words' },
  { check: 'duplicate-content', row: row(200, { target_path: '/a', count: 1 }), text: 'Same text as /a' },
  { check: 'duplicate-content', row: row(200, { target_path: '/a', count: 2 }), text: 'Same text as /a and 1 more' },
  { check: 'image-alt', row: row(200, { count: 1 }), text: '1 image without alt text' },
  { check: 'image-alt', row: row(200, { count: 3 }), text: '3 images without alt text' },
  { check: 'social-tags', row: row(200), text: 'Open Graph tags are missing' },
  { check: 'schema-errors', row: row(200, { count: 1 }), text: '1 block that cannot be read' },
  { check: 'schema-errors', row: row(200, { count: 2 }), text: '2 blocks that cannot be read' },
];

describe('the sentences of "What was found", as the reader sees them', () => {
  it.each(TEXTS)('$check: $text', ({ check, row: given, text }) => {
    expect(render(detailMessage(check, given))).toBe(text);
  });

  it('covers every key of issues.found', () => {
    const used = new Set<string>(TEXTS.flatMap(({ check, row: given }) => detailMessage(check, given)?.key ?? []));
    expect(Object.keys(messages.issues.found).filter((key) => !used.has(key))).toEqual([]);
  });
});

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
    const used = new Set<string>(CASES.flatMap(({ check, row: given }) => detailMessage(check, given)?.key ?? []));
    expect(Object.keys(messages.issues.found).filter((key) => !used.has(key))).toEqual([]);
  });
});
