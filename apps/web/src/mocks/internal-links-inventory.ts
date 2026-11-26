import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageRow, PageView, PagesOverview, TierRef } from '@/lib/internal-links/types';

/**
 * The words of the Pages screens as the mock counts them (contract C1 and C2): one predicate per view, so the
 * Overview's numbers and the list's `meta.total` for the same view cannot differ (decision D8). A live page is an
 * HTML page with status 200, as the backend counts it (a `PageRow` carries both `resource_type` and `status_code`).
 * The fixture crawl has no variants: no row is one.
 */

export const PAGE_VIEWS: readonly PageView[] = [
  'live',
  'indexable',
  'not_indexable',
  'redirects',
  'errors',
  'client_errors',
  'server_errors',
  'blocked',
  'other',
  'variants',
  'in_sitemap_indexable',
  'not_in_sitemap',
  'sitemap_not_live',
  'sitemap_not_indexable',
  'reachable',
  'unreachable',
];

/** `BLOCKED_STATUSES` of backend/src/idraft/crawl/status.py */
const BLOCKED: ReadonlySet<number> = new Set([401, 403, 429]);
const SECTIONS_MAX = 50;
const DEPTH_ROWS = 7;

/** C3: a page with one segment or none is in `/`; a folder's own index is in `/` too. */
export function sectionOfPath(path: string): string {
  const parts = path.split('/');
  const first = parts[1] ?? '';
  return (parts[2] ?? '') === '' ? '/' : `/${first}/`;
}

const isLive = (row: PageRow): boolean => row.status_code === 200 && row.resource_type === 'html';
const isRedirected = (row: PageRow): boolean =>
  row.status_code !== null && row.status_code >= 300 && row.status_code < 400;
const isBlocked = (row: PageRow): boolean => row.status_code !== null && BLOCKED.has(row.status_code);
const isClientError = (row: PageRow): boolean =>
  row.status_code !== null && row.status_code >= 400 && row.status_code < 500 && !isBlocked(row);
const isServerError = (row: PageRow): boolean =>
  row.status_code !== null && row.status_code >= 500 && row.status_code < 600;
const isOther = (row: PageRow): boolean =>
  !(isLive(row) || isRedirected(row) || isBlocked(row) || isClientError(row) || isServerError(row));
const isIndexable = (row: PageRow): boolean => isLive(row) && row.is_indexable;

export function viewMatches(row: PageRow, view: PageView): boolean {
  switch (view) {
    case 'live':
      return isLive(row);
    case 'indexable':
      return isIndexable(row);
    case 'not_indexable':
      return isLive(row) && !row.is_indexable;
    case 'redirects':
      return isRedirected(row);
    case 'errors':
      return isClientError(row) || isServerError(row);
    case 'client_errors':
      return isClientError(row);
    case 'server_errors':
      return isServerError(row);
    case 'blocked':
      return isBlocked(row);
    case 'other':
      return isOther(row);
    case 'variants':
      return false;
    case 'in_sitemap_indexable':
      return isIndexable(row) && row.in_sitemap;
    case 'not_in_sitemap':
      return isIndexable(row) && !row.in_sitemap;
    case 'sitemap_not_live':
      return row.in_sitemap && !isLive(row);
    case 'sitemap_not_indexable':
      return isLive(row) && row.in_sitemap && !row.is_indexable;
    case 'reachable':
      return isLive(row) && row.click_depth !== null;
    case 'unreachable':
      return isLive(row) && row.click_depth === null;
  }
}

const count = (rows: readonly PageRow[], view: PageView): number => rows.filter((row) => viewMatches(row, view)).length;
const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function overviewOf(
  rows: readonly PageRow[],
  run: { run_id: string; finished_at: string | null; sitemap: boolean },
): PagesOverview {
  const live = rows.filter((row) => viewMatches(row, 'live'));
  const depth = Array.from({ length: DEPTH_ROWS }, (_, clicks) => ({
    clicks,
    pages: live.filter((row) => row.click_depth !== null && Math.min(row.click_depth, DEPTH_ROWS - 1) === clicks)
      .length,
  }));
  const tiers = new Map<string, { tier: TierRef | null; pages: number }>();
  for (const row of live) {
    const key = row.tier?.tier_id ?? 'none';
    tiers.set(key, { tier: row.tier, pages: (tiers.get(key)?.pages ?? 0) + 1 });
  }
  const sections = new Map<string, number>();
  for (const row of live) sections.set(sectionOfPath(row.path), (sections.get(sectionOfPath(row.path)) ?? 0) + 1);
  const sorted = [...sections].sort((a, b) => b[1] - a[1] || byteOrder(a[0], b[0]));
  return {
    run_id: run.run_id,
    crawled_at: run.finished_at,
    addresses: rows.length,
    status: {
      live: live.length,
      variant: count(rows, 'variants'),
      redirected: count(rows, 'redirects'),
      client_error: count(rows, 'client_errors'),
      server_error: count(rows, 'server_errors'),
      blocked: count(rows, 'blocked'),
      other: count(rows, 'other'),
    },
    indexable: count(rows, 'indexable'),
    not_indexable: count(rows, 'not_indexable'),
    reachable: count(rows, 'reachable'),
    unreachable: count(rows, 'unreachable'),
    orphans: rows.filter((row) => row.flags.includes('orphan')).length,
    sitemap: run.sitemap
      ? {
          state: 'read',
          indexable_in_sitemap: count(rows, 'in_sitemap_indexable'),
          indexable_missing: count(rows, 'not_in_sitemap'),
          listed_not_live: count(rows, 'sitemap_not_live'),
          listed_not_indexable: count(rows, 'sitemap_not_indexable'),
        }
      : {
          state: 'no_sitemap',
          indexable_in_sitemap: null,
          indexable_missing: null,
          listed_not_live: null,
          listed_not_indexable: null,
        },
    depth,
    tiers: [...tiers.values()].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier)),
    sections: sorted.slice(0, SECTIONS_MAX).map(([section, pages]) => ({ section, pages })),
    sections_total: sorted.length,
  };
}
