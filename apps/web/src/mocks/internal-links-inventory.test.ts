import { describe, expect, it } from 'vitest';

import { crawledPages, MOCK_RUN_ID, pageRow } from './internal-links-world';
import { overviewOf, PAGE_VIEWS, sectionOfPath, viewMatches } from './internal-links-inventory';
import type { PageRow, PageView } from '@/lib/internal-links/types';

const FIXTURE = crawledPages().map((page) => pageRow(page, 'all'));
const BASE = FIXTURE[0];
if (BASE === undefined) throw new Error('The fixture crawl has no page');
const row = (patch: Partial<PageRow>): PageRow => ({ ...BASE, ...patch });
const RUN = { run_id: MOCK_RUN_ID, finished_at: '2026-11-17T09:00:00Z', sitemap: true };

describe('the section of a path', () => {
  it.each([
    ['/', '/'],
    ['/pricing', '/'],
    ['/blog/', '/'],
    ['/blog/post', '/blog/'],
    ['/blog/2026/post', '/blog/'],
  ])('puts %s in %s', (path, section) => {
    expect(sectionOfPath(path)).toBe(section);
  });
});

describe('the views', () => {
  const cases: readonly [PageRow, readonly PageView[]][] = [
    [
      row({ status_code: 200, is_indexable: true, in_sitemap: true, click_depth: 2 }),
      ['live', 'indexable', 'in_sitemap_indexable', 'reachable'],
    ],
    [
      row({ status_code: 200, is_indexable: false, in_sitemap: true, click_depth: null }),
      ['live', 'not_indexable', 'sitemap_not_indexable', 'unreachable'],
    ],
    [
      row({ status_code: 200, is_indexable: true, in_sitemap: false, click_depth: 1 }),
      ['live', 'indexable', 'not_in_sitemap', 'reachable'],
    ],
    [row({ status_code: 301, in_sitemap: true }), ['redirects', 'sitemap_not_live']],
    [row({ status_code: 404, in_sitemap: false }), ['errors', 'client_errors']],
    [row({ status_code: 503, in_sitemap: false }), ['errors', 'server_errors']],
    [row({ status_code: 403, in_sitemap: false }), ['blocked']],
    [row({ status_code: null, in_sitemap: false }), ['other']],
    [row({ status_code: 204, in_sitemap: false }), ['other']],
  ];

  it.each(cases)('matches a row of status %#', (page, expected) => {
    expect(PAGE_VIEWS.filter((view) => viewMatches(page, view))).toEqual(
      PAGE_VIEWS.filter((view) => expected.includes(view)),
    );
  });
});

describe('the overview of the fixture crawl', () => {
  const overview = overviewOf(FIXTURE, RUN);

  it('keeps the invariants of the Overview', () => {
    const { status } = overview;
    expect(Object.values(status).reduce((sum, part) => sum + part, 0)).toBe(overview.addresses);
    expect(overview.indexable + overview.not_indexable).toBe(status.live);
    expect(overview.reachable + overview.unreachable).toBe(status.live);
    expect(overview.depth).toHaveLength(7);
    expect(overview.depth.reduce((sum, part) => sum + part.pages, 0)).toBe(overview.reachable);
    expect(overview.tiers.reduce((sum, part) => sum + part.pages, 0)).toBe(status.live);
    expect(overview.sections.reduce((sum, part) => sum + part.pages, 0)).toBe(status.live);
    expect(overview.sections).toHaveLength(overview.sections_total);
  });

  it('has no sitemap numbers when the crawl read no sitemap', () => {
    expect(overviewOf(FIXTURE, { ...RUN, sitemap: false }).sitemap).toEqual({
      state: 'no_sitemap',
      indexable_in_sitemap: null,
      indexable_missing: null,
      listed_not_live: null,
      listed_not_indexable: null,
    });
  });

  it('puts a page at depth 9 in the row of 6 and orders sections by size, then name', () => {
    const deep = [
      row({ path: '/b/x', click_depth: 9 }),
      row({ path: '/a/x', click_depth: 0 }),
      row({ path: '/a/y', click_depth: 3 }),
    ];
    const read = overviewOf(deep, RUN);
    expect(read.depth[6]).toEqual({ clicks: 6, pages: 1 });
    expect(read.sections).toEqual([
      { section: '/a/', pages: 2 },
      { section: '/b/', pages: 1 },
    ]);
  });
});
