'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { parseKeySet, parseMore } from '@/lib/internal-links/journey-codec';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { checkUrlId, UrlIdError } from '@/lib/internal-links/queries';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import type { EdgeWorklist, PageSort, PageWorklist } from '@/lib/internal-links/types';

/**
 * What Internal links keeps in its address (the URL state table of plan 03): the tab, the link scope, the
 * worklists, the sort and searches, and the journey. The filter bars keep their own keys (`useUrlFilters`).
 * `parseLinksSearch` is pure; `useLinksState` only reads and writes the address.
 */

export type LinksTabId = 'pages' | 'links' | 'journey' | 'flow';

export type LinksKey =
  | 'tab'
  | 'scope'
  | 'view'
  | 'lview'
  | 'sort'
  | 'q'
  | 'lq'
  | 'src'
  | 'tgt'
  | 'focus'
  | 'jv'
  | 'dir'
  | 'open'
  | 'grp'
  | 'more'
  | 'topen';
export type LinksSearch = Readonly<Partial<Record<LinksKey, string | null | undefined>>>;

const TABS: readonly LinksTabId[] = ['pages', 'links', 'journey', 'flow'];
const WORKLISTS: readonly PageWorklist[] = [
  'under_linked_t1',
  'orphans',
  'editorial_orphans',
  'deep_only_through_auto',
];
const EDGE_WORKLISTS: readonly EdgeWorklist[] = ['broken_and_redirected', 'links_to_non_indexable'];
export const PAGE_SORTS: readonly PageSort[] = [
  'path',
  '-path',
  'status_code',
  '-status_code',
  'click_depth',
  '-click_depth',
  'linking_pages',
  '-linking_pages',
  'outlinks',
  '-outlinks',
];
export const DEFAULT_SORT: PageSort = '-linking_pages';
/** The longest search text the API takes (1 to 200 characters). */
const MAX_SEARCH_LENGTH = 200;

export interface LinksState {
  tab: LinksTabId;
  scope: LinkScope;
  worklist: PageWorklist | null;
  edgeWorklist: EdgeWorklist | null;
  sort: PageSort;
  q: string | null;
  lq: string | null;
  /** The Links tab narrowed to the links from or to one page (the inspector's "View all in Links"). */
  source: string | null;
  target: string | null;
  focus: string | null;
  journeyView: 'canvas' | 'tree';
  treeDir: Direction;
  open: Set<string>;
  groups: Set<string>;
  more: Map<string, number>;
  treeOpen: Set<string>;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, MAX_SEARCH_LENGTH);
};

/** The id when the API would take it as a url id, else `null`: an address that names no page falls back. */
function urlIdOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    return checkUrlId(value);
  } catch (error) {
    if (error instanceof UrlIdError) return null;
    throw error;
  }
}

export function parseLinksSearch(search: LinksSearch): LinksState {
  return {
    tab: TABS.find((tab) => tab === search.tab) ?? 'pages',
    scope: parseLinkScope(search.scope),
    worklist: WORKLISTS.find((list) => list === search.view) ?? null,
    edgeWorklist: EDGE_WORKLISTS.find((list) => list === search.lview) ?? null,
    sort: PAGE_SORTS.find((sort) => sort === search.sort) ?? DEFAULT_SORT,
    q: text(search.q),
    lq: text(search.lq),
    source: urlIdOrNull(search.src),
    target: urlIdOrNull(search.tgt),
    focus: urlIdOrNull(search.focus),
    journeyView: search.jv === 'tree' ? 'tree' : 'canvas',
    treeDir: search.dir === 'in' ? 'in' : 'out',
    open: parseKeySet(search.open),
    groups: parseKeySet(search.grp),
    more: parseMore(search.more),
    treeOpen: parseKeySet(search.topen),
  };
}

const PARSERS = {
  tab: parseAsString,
  scope: parseAsString,
  view: parseAsString,
  lview: parseAsString,
  sort: parseAsString,
  q: parseAsString,
  lq: parseAsString,
  src: parseAsString,
  tgt: parseAsString,
  focus: parseAsString,
  jv: parseAsString,
  dir: parseAsString,
  open: parseAsString,
  grp: parseAsString,
  more: parseAsString,
  topen: parseAsString,
} satisfies Record<LinksKey, typeof parseAsString>;

export type SetLinksSearch = (
  values: Partial<Record<LinksKey, string | null>>,
  options?: { history?: 'push' | 'replace' },
) => void;

/** The page's state from the address; nothing is written on load. */
export function useLinksState(): { state: LinksState; setSearch: SetLinksSearch } {
  const [search, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parseLinksSearch(search), [search]);
  const setSearch = useCallback<SetLinksSearch>(
    (values, { history = 'replace' } = {}) => {
      void setState(values, { history });
    },
    [setState],
  );
  return { state, setSearch };
}
