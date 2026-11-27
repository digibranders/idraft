import type { EdgeWorklist, PageView, PageWorklist, PagesOverview, Worklists } from '@/lib/internal-links/types';

/** `all` is no filter, `untiered` writes `tier=none`; the rest are server views and worklists. */
export type ViewId = 'all' | 'untiered' | PageView | PageWorklist | EdgeWorklist;
export type ViewSection = 'pages' | 'sitemap' | 'reach' | 'linkProblems';
export interface ViewEntry {
  id: ViewId;
  section: ViewSection;
  /** Reached only from the Overview: listed while it is the active view. */
  onlyWhenActive: boolean;
}

const entry = (section: ViewSection, id: ViewId, onlyWhenActive = false): ViewEntry => ({
  id,
  section,
  onlyWhenActive,
});

/** The order of the table of spec 7.3. */
export const PAGE_VIEW_MENU: readonly ViewEntry[] = [
  entry('pages', 'all'),
  entry('pages', 'live'),
  entry('pages', 'indexable'),
  entry('pages', 'not_indexable'),
  entry('pages', 'redirects'),
  entry('pages', 'errors'),
  entry('pages', 'variants'),
  entry('pages', 'untiered'),
  entry('pages', 'client_errors', true),
  entry('pages', 'server_errors', true),
  entry('pages', 'blocked', true),
  entry('pages', 'other', true),
  entry('sitemap', 'in_sitemap_indexable'),
  entry('sitemap', 'not_in_sitemap'),
  entry('sitemap', 'sitemap_not_live'),
  entry('sitemap', 'sitemap_not_indexable'),
  entry('reach', 'reachable'),
  entry('reach', 'unreachable'),
  entry('linkProblems', 'under_linked_t1'),
  entry('linkProblems', 'orphans'),
  entry('linkProblems', 'editorial_orphans'),
  entry('linkProblems', 'deep_only_through_auto'),
  entry('linkProblems', 'lost_links_top'),
  entry('linkProblems', 'weak_outlinks'),
  entry('linkProblems', 'broken_and_redirected'),
  entry('linkProblems', 'links_to_non_indexable'),
];

/**
 * The count beside each view. Every server view takes the Overview field of contract C2, so the number beside a
 * view is the total of its list; `untiered` comes from its own read and is absent while that is unknown.
 */
export function viewCounts(
  overview: PagesOverview,
  worklists: Worklists,
  untiered: number | null,
): Partial<Record<ViewId, number>> {
  const { status, sitemap } = overview;
  const counts: Partial<Record<ViewId, number>> = {
    all: overview.addresses - status.variant,
    live: status.live,
    indexable: overview.indexable,
    not_indexable: overview.not_indexable,
    redirects: status.redirected,
    errors: status.client_error + status.server_error,
    client_errors: status.client_error,
    server_errors: status.server_error,
    blocked: status.blocked,
    other: status.other,
    variants: status.variant,
    reachable: overview.reachable,
    unreachable: overview.unreachable,
    under_linked_t1: worklists.under_linked_t1,
    orphans: worklists.orphans,
    editorial_orphans: worklists.editorial_orphans,
    deep_only_through_auto: worklists.deep_only_through_auto,
    lost_links_top: worklists.lost_links_top,
    weak_outlinks: worklists.weak_outlinks,
    broken_and_redirected: worklists.broken_and_redirected,
    links_to_non_indexable: worklists.links_to_non_indexable,
  };
  if (untiered !== null) counts.untiered = untiered;
  if (sitemap.state === 'read') {
    counts.in_sitemap_indexable = sitemap.indexable_in_sitemap ?? 0;
    counts.not_in_sitemap = sitemap.indexable_missing ?? 0;
    counts.sitemap_not_live = sitemap.listed_not_live ?? 0;
    counts.sitemap_not_indexable = sitemap.listed_not_indexable ?? 0;
  }
  return counts;
}

/** The entries the menu lists: a view without a known count stays, one counting 0 hides unless it is active. */
export function visibleViews(
  counts: Partial<Record<ViewId, number>>,
  active: ViewId,
  hasSitemap: boolean,
): ViewEntry[] {
  return PAGE_VIEW_MENU.filter((item) => {
    if (item.section === 'sitemap' && !hasSitemap) return false;
    if (item.id === 'all' || item.id === active) return true;
    return !item.onlyWhenActive && counts[item.id] !== 0;
  });
}
