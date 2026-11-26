import type { Route } from 'next';

import type { PagesOverview, TierRef } from '@/lib/internal-links/types';

export interface OverviewRow {
  /** The message key Task 21 uses; no visible text in this module. */
  id: string;
  count: number;
  /** 0 to 1, of `base`; null when the base is 0. */
  share: number | null;
  base: 'addresses' | 'live';
  href: Route | null;
  tone?: 'warning';
  /** The folded sections row: how many sections it holds. */
  folded?: number;
  tier?: TierRef | null;
}

export interface OverviewModel {
  strip: OverviewRow[];
  status: OverviewRow[];
  funnel: OverviewRow[];
  sections: OverviewRow[];
  tiers: OverviewRow[];
  depth: OverviewRow[];
  sitemap: OverviewRow[] | null;
}

export const SECTIONS_SHOWN = 8;

/** `allPages` builds the address of All pages for a query (the screen passes `pagesTabPath` and the run). */
export function overviewModel(data: PagesOverview, allPages: (query: Record<string, string>) => Route): OverviewModel {
  const { status, sitemap } = data;
  const live = status.live;
  const row = (
    id: string,
    count: number,
    base: OverviewRow['base'],
    query: Record<string, string> | null,
    extra: Partial<OverviewRow> = {},
  ): OverviewRow => {
    const total = base === 'addresses' ? data.addresses : live;
    return {
      id,
      count,
      share: total === 0 ? null : count / total,
      base,
      href: query === null ? null : allPages(query),
      ...extra,
    };
  };
  const view = (name: string): Record<string, string> => ({ view: name });

  const sitemapRows =
    sitemap.state === 'read'
      ? [
          row('in_sitemap_indexable', sitemap.indexable_in_sitemap ?? 0, 'live', view('in_sitemap_indexable')),
          row('not_in_sitemap', sitemap.indexable_missing ?? 0, 'live', view('not_in_sitemap')),
          row('sitemap_not_live', sitemap.listed_not_live ?? 0, 'addresses', view('sitemap_not_live')),
          row('sitemap_not_indexable', sitemap.listed_not_indexable ?? 0, 'live', view('sitemap_not_indexable')),
        ]
      : null;

  const shown = data.sections.slice(0, SECTIONS_SHOWN);
  const sections = shown.map((item) => row(item.section, item.pages, 'live', { view: 'live', folder: item.section }));
  if (data.sections_total > SECTIONS_SHOWN) {
    const left = live - shown.reduce((sum, item) => sum + item.pages, 0);
    sections.push(row('other_sections', left, 'live', null, { folded: data.sections_total - SECTIONS_SHOWN }));
  }

  return {
    strip: [
      row('addresses', data.addresses, 'addresses', { variants: '1' }),
      row('live', live, 'addresses', view('live')),
      row('indexable', data.indexable, 'live', view('indexable')),
      row('orphans', data.orphans, 'live', view('orphans')),
      row('errors', status.client_error + status.server_error, 'addresses', view('errors')),
    ],
    status: [
      row('live', live, 'addresses', view('live')),
      row('variant', status.variant, 'addresses', view('variants')),
      row('redirected', status.redirected, 'addresses', view('redirects')),
      row('client_error', status.client_error, 'addresses', view('client_errors')),
      row('server_error', status.server_error, 'addresses', view('server_errors')),
      row('blocked', status.blocked, 'addresses', view('blocked')),
      row('other', status.other, 'addresses', view('other')),
    ],
    funnel: [
      row('addresses', data.addresses, 'addresses', { variants: '1' }),
      row('live', live, 'addresses', view('live')),
      row('indexable', data.indexable, 'live', view('indexable')),
      ...(sitemapRows === null ? [] : sitemapRows.slice(0, 1)),
    ],
    sections,
    tiers: data.tiers.map((item) =>
      row(
        item.tier === null ? 'untiered' : item.tier.tier_id,
        item.pages,
        'live',
        {
          view: 'live',
          tier: item.tier === null ? 'none' : item.tier.tier_id,
        },
        { tier: item.tier },
      ),
    ),
    depth: [
      ...data.depth.map((item) => row(`depth_${item.clicks}`, item.pages, 'live', { depth: String(item.clicks) })),
      row('unreachable', data.unreachable, 'live', view('unreachable'), { tone: 'warning' }),
    ],
    sitemap: sitemapRows,
  };
}
