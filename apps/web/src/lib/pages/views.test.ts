import { describe, expect, it } from 'vitest';

import type { PagesOverview, Worklists } from '@/lib/internal-links/types';

import { PAGE_VIEW_MENU, viewCounts, visibleViews, type ViewId } from './views';

const OVERVIEW: PagesOverview = {
  run_id: '11111111-1111-4111-8111-111111111111',
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
  depth: [],
  tiers: [],
  sections: [],
  sections_total: 0,
};

const WORKLISTS: Worklists = {
  run_id: OVERVIEW.run_id,
  may_be_incomplete: false,
  under_linked_t1: 3,
  orphans: 244,
  editorial_orphans: 5,
  deep_only_through_auto: 6,
  lost_links_top: 0,
  weak_outlinks: 8,
  broken_and_redirected: 9,
  links_to_non_indexable: 10,
};

describe('the View menu', () => {
  it('lists the views in the order of the table of spec 7.3', () => {
    const ids = (section: string): ViewId[] =>
      PAGE_VIEW_MENU.filter((entry) => entry.section === section && !entry.onlyWhenActive).map((entry) => entry.id);
    expect(ids('pages')).toEqual([
      'all',
      'live',
      'indexable',
      'not_indexable',
      'redirects',
      'errors',
      'variants',
      'untiered',
    ]);
    expect(ids('sitemap')).toEqual([
      'in_sitemap_indexable',
      'not_in_sitemap',
      'sitemap_not_live',
      'sitemap_not_indexable',
    ]);
    expect(ids('reach')).toEqual(['reachable', 'unreachable']);
    expect(ids('linkProblems')).toEqual([
      'under_linked_t1',
      'orphans',
      'editorial_orphans',
      'deep_only_through_auto',
      'lost_links_top',
      'weak_outlinks',
      'broken_and_redirected',
      'links_to_non_indexable',
    ]);
  });

  it('marks the four views reached only from the Overview', () => {
    expect(PAGE_VIEW_MENU.filter((entry) => entry.onlyWhenActive).map((entry) => entry.id)).toEqual([
      'client_errors',
      'server_errors',
      'blocked',
      'other',
    ]);
  });
});

describe('viewCounts', () => {
  const counts = viewCounts(OVERVIEW, WORKLISTS, 12);

  it('counts All pages as the addresses less the variants', () => {
    expect(counts.all).toBe(405);
  });

  it('takes every other view from the field of contract C2', () => {
    expect(counts).toMatchObject({
      live: 389,
      indexable: 372,
      not_indexable: 17,
      redirects: 6,
      errors: 8,
      client_errors: 7,
      server_errors: 1,
      blocked: 2,
      other: 0,
      variants: 15,
      in_sitemap_indexable: 330,
      not_in_sitemap: 42,
      sitemap_not_live: 4,
      sitemap_not_indexable: 9,
      reachable: 117,
      unreachable: 272,
    });
  });

  it('takes the worklists from the worklists read and Untiered from its own read', () => {
    expect(counts).toMatchObject({
      under_linked_t1: 3,
      orphans: 244,
      editorial_orphans: 5,
      deep_only_through_auto: 6,
      lost_links_top: 0,
      weak_outlinks: 8,
      broken_and_redirected: 9,
      links_to_non_indexable: 10,
      untiered: 12,
    });
  });

  it('leaves Untiered out while its count is unknown', () => {
    expect('untiered' in viewCounts(OVERVIEW, WORKLISTS, null)).toBe(false);
  });

  it('leaves the sitemap views out when the crawl found no sitemap', () => {
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
    expect('in_sitemap_indexable' in viewCounts(none, WORKLISTS, null)).toBe(false);
  });
});

describe('visibleViews', () => {
  const counts = viewCounts(OVERVIEW, WORKLISTS, 12);
  const idsOf = (active: ViewId, hasSitemap = true, from = counts): ViewId[] =>
    visibleViews(from, active, hasSitemap).map((entry) => entry.id);

  it('always lists All pages', () => {
    expect(idsOf('live', true, {})).toContain('all');
  });

  it('hides a view whose count is 0 unless it is the active one', () => {
    expect(idsOf('all')).not.toContain('lost_links_top');
    expect(idsOf('lost_links_top')).toContain('lost_links_top');
  });

  it('lists the four Overview-only views only while one of them is active', () => {
    expect(idsOf('all')).not.toContain('client_errors');
    expect(idsOf('client_errors')).toContain('client_errors');
    expect(idsOf('client_errors')).not.toContain('server_errors');
    expect(idsOf('other')).toContain('other');
  });

  it('hides the sitemap section when the crawl found no sitemap', () => {
    expect(idsOf('all', false)).not.toContain('not_in_sitemap');
    expect(idsOf('all', true)).toContain('not_in_sitemap');
  });

  it('hides Parameter variants when there are none', () => {
    const noVariants = viewCounts({ ...OVERVIEW, status: { ...OVERVIEW.status, variant: 0 } }, WORKLISTS, 12);
    expect(idsOf('all', true, noVariants)).not.toContain('variants');
  });
});
