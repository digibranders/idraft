import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import type { PagesOverview, Worklists } from '@/lib/internal-links/types';

import { overviewModel, SECTIONS_SHOWN, type OverviewRow } from './overview-model';
import { viewCounts } from './views';

const RUN = '11111111-1111-4111-8111-111111111111';

const section = (name: string, pages: number): { section: string; pages: number } => ({ section: name, pages });

const OVERVIEW: PagesOverview = {
  run_id: RUN,
  crawled_at: '2026-11-25T09:12:00Z',
  addresses: 420,
  status: { live: 389, variant: 15, redirected: 6, client_error: 7, server_error: 1, blocked: 2, other: 0 },
  indexable: 372,
  not_indexable: 17,
  reachable: 117,
  unreachable: 272,
  orphans: 244,
  sitemap: {
    state: 'read',
    indexable_in_sitemap: 330,
    indexable_missing: 42,
    listed_not_live: 4,
    listed_not_indexable: 9,
  },
  depth: [
    { clicks: 0, pages: 1 },
    { clicks: 1, pages: 24 },
    { clicks: 2, pages: 61 },
    { clicks: 3, pages: 20 },
    { clicks: 4, pages: 8 },
    { clicks: 5, pages: 2 },
    { clicks: 6, pages: 1 },
  ],
  tiers: [
    { tier: { tier_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: 'T1', name: 'Money pages' }, pages: 12 },
    { tier: null, pages: 310 },
  ],
  sections: [
    section('/cybersecurity/', 151),
    section('/blog/', 80),
    section('/docs/', 60),
    section('/', 40),
    section('/a/', 20),
    section('/b/', 15),
    section('/c/', 10),
    section('/d/', 5),
    section('/e/', 3),
    section('/f/', 2),
  ],
  sections_total: 14,
};

const WORKLISTS: Worklists = {
  run_id: RUN,
  may_be_incomplete: false,
  under_linked_t1: 0,
  orphans: 244,
  editorial_orphans: 0,
  deep_only_through_auto: 0,
  lost_links_top: 0,
  weak_outlinks: 0,
  broken_and_redirected: 0,
  links_to_non_indexable: 0,
};

/** The screen's builder: the address of All pages with the run when one is chosen. */
const allPagesFor =
  (run: string | null) =>
  (query: Record<string, string>): Route => {
    const params = new URLSearchParams(run === null ? query : { ...query, run });
    return `/w/p/seo/pages/all?${params.toString()}` as Route;
  };

const model = (run: string | null = null, data: PagesOverview = OVERVIEW): ReturnType<typeof overviewModel> =>
  overviewModel(data, allPagesFor(run));

const byId = (rows: readonly OverviewRow[], id: string): OverviewRow => {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
};

describe('overviewModel strip', () => {
  it('has five rows, each linking to its list', () => {
    const { strip } = model();
    expect(strip.map((row) => [row.id, row.count, row.href])).toEqual([
      ['addresses', 420, '/w/p/seo/pages/all?variants=1'],
      ['live', 389, '/w/p/seo/pages/all?view=live'],
      ['indexable', 372, '/w/p/seo/pages/all?view=indexable'],
      ['orphans', 244, '/w/p/seo/pages/all?view=orphans'],
      ['errors', 8, '/w/p/seo/pages/all?view=errors'],
    ]);
  });
});

describe('overviewModel status', () => {
  it('has seven rows, shares of the addresses, each linking to the view of contract C2', () => {
    const { status } = model();
    expect(status.map((row) => row.id)).toEqual([
      'live',
      'variant',
      'redirected',
      'client_error',
      'server_error',
      'blocked',
      'other',
    ]);
    expect(status.map((row) => row.href)).toEqual([
      '/w/p/seo/pages/all?view=live',
      '/w/p/seo/pages/all?view=variants',
      '/w/p/seo/pages/all?view=redirects',
      '/w/p/seo/pages/all?view=client_errors',
      '/w/p/seo/pages/all?view=server_errors',
      '/w/p/seo/pages/all?view=blocked',
      '/w/p/seo/pages/all?view=other',
    ]);
    expect(byId(status, 'live').share).toBeCloseTo(389 / 420);
    expect(status.every((row) => row.base === 'addresses')).toBe(true);
  });

  it('keeps a group of 0 as a row with a count of 0', () => {
    const other = byId(model().status, 'other');
    expect(other.count).toBe(0);
    expect(other.share).toBe(0);
  });

  it('has no share when there are no addresses', () => {
    const empty: PagesOverview = {
      ...OVERVIEW,
      addresses: 0,
      status: { live: 0, variant: 0, redirected: 0, client_error: 0, server_error: 0, blocked: 0, other: 0 },
    };
    expect(byId(model(null, empty).status, 'live').share).toBeNull();
  });
});

describe('overviewModel funnel', () => {
  it('has four rows, shares of live pages except the addresses', () => {
    const { funnel } = model();
    expect(funnel.map((row) => [row.id, row.count])).toEqual([
      ['addresses', 420],
      ['live', 389],
      ['indexable', 372],
      ['in_sitemap_indexable', 330],
    ]);
    expect(byId(funnel, 'indexable').base).toBe('live');
    expect(byId(funnel, 'indexable').share).toBeCloseTo(372 / 389);
    expect(byId(funnel, 'in_sitemap_indexable').href).toBe('/w/p/seo/pages/all?view=in_sitemap_indexable');
  });

  it('has three rows when the crawl found no sitemap', () => {
    const none: PagesOverview = {
      ...OVERVIEW,
      sitemap: {
        state: 'no_sitemap',
        indexable_in_sitemap: null,
        indexable_missing: null,
        listed_not_live: null,
        listed_not_indexable: null,
      },
    };
    expect(model(null, none).funnel.map((row) => row.id)).toEqual(['addresses', 'live', 'indexable']);
  });
});

describe('overviewModel sections', () => {
  it('shows the 8 largest, then one folded row of the live pages that are left', () => {
    const { sections } = model();
    expect(sections).toHaveLength(SECTIONS_SHOWN + 1);
    const shown = OVERVIEW.sections.slice(0, SECTIONS_SHOWN).reduce((sum, row) => sum + row.pages, 0);
    const folded = sections[SECTIONS_SHOWN];
    expect(folded).toMatchObject({ count: 389 - shown, href: null, folded: 14 - SECTIONS_SHOWN, base: 'live' });
  });

  it('links a section to the live pages of that folder, with shares of live pages', () => {
    const first = model().sections[0];
    expect(first?.id).toBe('/cybersecurity/');
    expect(first?.href).toBe('/w/p/seo/pages/all?view=live&folder=%2Fcybersecurity%2F');
    expect(first?.share).toBeCloseTo(151 / 389);
  });

  it('has no folded row with 8 sections or fewer', () => {
    const few: PagesOverview = { ...OVERVIEW, sections: OVERVIEW.sections.slice(0, 8), sections_total: 8 };
    const { sections } = model(null, few);
    expect(sections).toHaveLength(8);
    expect(sections.some((row) => row.folded !== undefined)).toBe(false);
  });
});

describe('overviewModel tiers', () => {
  it('links a tier to its live pages and Untiered to tier none', () => {
    const { tiers } = model();
    expect(tiers[0]).toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      count: 12,
      href: '/w/p/seo/pages/all?view=live&tier=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      base: 'live',
    });
    expect(tiers[1]).toMatchObject({
      id: 'untiered',
      count: 310,
      href: '/w/p/seo/pages/all?view=live&tier=none',
      tier: null,
    });
  });
});

describe('overviewModel depth', () => {
  it('has seven rows of depth=n, then the unreachable pages in the warning tone', () => {
    const { depth } = model();
    expect(depth).toHaveLength(8);
    expect(depth.slice(0, 7).map((row) => row.href)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((n) => `/w/p/seo/pages/all?depth=${n}`),
    );
    expect(depth[7]).toMatchObject({
      id: 'unreachable',
      count: 272,
      tone: 'warning',
      href: '/w/p/seo/pages/all?view=unreachable',
    });
  });
});

describe('overviewModel sitemap', () => {
  it('has the four sitemap views', () => {
    expect(model().sitemap?.map((row) => [row.id, row.count, row.href])).toEqual([
      ['in_sitemap_indexable', 330, '/w/p/seo/pages/all?view=in_sitemap_indexable'],
      ['not_in_sitemap', 42, '/w/p/seo/pages/all?view=not_in_sitemap'],
      ['sitemap_not_live', 4, '/w/p/seo/pages/all?view=sitemap_not_live'],
      ['sitemap_not_indexable', 9, '/w/p/seo/pages/all?view=sitemap_not_indexable'],
    ]);
  });

  it('is null when the crawl found no sitemap', () => {
    const none: PagesOverview = {
      ...OVERVIEW,
      sitemap: {
        state: 'no_sitemap',
        indexable_in_sitemap: null,
        indexable_missing: null,
        listed_not_live: null,
        listed_not_indexable: null,
      },
    };
    expect(model(null, none).sitemap).toBeNull();
  });
});

describe('overviewModel run', () => {
  it('puts the run in every href when one is given', () => {
    const everyHref = Object.values(model(RUN))
      .flat()
      .map((row: OverviewRow) => row.href)
      .filter((href): href is Route => href !== null);
    expect(everyHref.length).toBeGreaterThan(20);
    expect(everyHref.every((href) => href.includes(`run=${RUN}`))).toBe(true);
  });

  it('puts no run in an href when it is null', () => {
    const everyHref = Object.values(model())
      .flat()
      .map((row: OverviewRow) => row.href)
      .filter((href): href is Route => href !== null);
    expect(everyHref.some((href) => href.includes('run='))).toBe(false);
  });
});

describe('overviewModel and the view counts (D8, the web half)', () => {
  it('gives every row with a view the count of the field contract C2 names', () => {
    const counts = viewCounts(OVERVIEW, WORKLISTS, null);
    const data = model();
    const rows = [...data.strip, ...data.status, ...data.funnel, ...(data.sitemap ?? []), ...data.depth.slice(7)];
    let checked = 0;
    for (const row of rows) {
      const view = row.href === null ? null : new URL(row.href, 'http://x').searchParams.get('view');
      if (view === null || view === 'orphans') continue;
      expect(row.count, `${row.id} opens ${view}`).toBe(counts[view as keyof typeof counts]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(15);
  });
});
