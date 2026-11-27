import { PAGE_SORTS } from '@/lib/internal-links/page-sorts';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import { searchText } from '@/lib/internal-links/search-text';
import type { PageSort, PageView, PageWorklist } from '@/lib/internal-links/types';
import { isUuid } from '@/lib/routes/paths';

/**
 * What the Pages screens keep in the address. Pure, with no client-only import: the redirect of the old Pages
 * tab reads it on the server. `folder` is not here: it is a key of the filter bar (`useUrlFilters`).
 */

export interface PagesState {
  /** The crawl the address chooses, or null for the latest; a malformed id is in `invalidRun`. */
  run: string | null;
  invalidRun: string | null;
  scope: LinkScope;
  /** `view` of the address as a server view, or as one of the six page worklists. Never both. */
  view: PageView | null;
  worklist: PageWorklist | null;
  sort: PageSort;
  q: string | null;
  depth: number | null;
  variants: boolean;
}

export type PagesKey = 'run' | 'scope' | 'view' | 'sort' | 'q' | 'depth' | 'variants' | 'inspect' | 'itab';

export const PAGES_DEFAULT_SORT: PageSort = 'path';

/** The keys only the old Pages tab of Internal links wrote (spec 5.3). */
export const PAGES_REDIRECT_KEYS: readonly string[] = [
  'view',
  'sort',
  'q',
  'tier',
  'tag',
  'status',
  'idx',
  'flag',
  'cols',
  'density',
];

// Records, not arrays: a view or a worklist added to the API breaks the build here until it is listed
const VIEWS = {
  live: true,
  indexable: true,
  not_indexable: true,
  redirects: true,
  errors: true,
  client_errors: true,
  server_errors: true,
  blocked: true,
  other: true,
  variants: true,
  in_sitemap_indexable: true,
  not_in_sitemap: true,
  sitemap_not_live: true,
  sitemap_not_indexable: true,
  reachable: true,
  unreachable: true,
} satisfies Record<PageView, true>;
const WORKLISTS = {
  under_linked_t1: true,
  orphans: true,
  editorial_orphans: true,
  deep_only_through_auto: true,
  lost_links_top: true,
  weak_outlinks: true,
} satisfies Record<PageWorklist, true>;

const DEPTH_MAX = 6;

const isView = (value: string): value is PageView => Object.hasOwn(VIEWS, value);
const isWorklist = (value: string): value is PageWorklist => Object.hasOwn(WORKLISTS, value);

export function parsePagesSearch(search: Readonly<Partial<Record<PagesKey, string | null | undefined>>>): PagesState {
  const run = search.run ?? '';
  const view = search.view ?? '';
  const depth = /^\d$/.test(search.depth ?? '') ? Number(search.depth) : null;
  return {
    // Lower case, as the API writes ids: the crawl list is matched by equality and the cache key holds the id
    run: isUuid(run) ? run.toLowerCase() : null,
    invalidRun: run !== '' && !isUuid(run) ? run : null,
    scope: parseLinkScope(search.scope),
    view: isView(view) ? view : null,
    worklist: isWorklist(view) ? view : null,
    sort: PAGE_SORTS.find((sort) => sort === search.sort) ?? PAGES_DEFAULT_SORT,
    q: searchText(search.q),
    depth: depth !== null && depth <= DEPTH_MAX ? depth : null,
    variants: search.variants === '1',
  };
}
