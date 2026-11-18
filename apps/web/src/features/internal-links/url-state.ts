'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import type { InspectorTarget } from '@/lib/inspector/placement';
import {
  parseKeySet,
  parseLanes,
  parseLayoutMode,
  parseMore,
  type LayoutMode,
} from '@/lib/internal-links/journey-codec';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { checkUrlId, UrlIdError } from '@/lib/internal-links/queries';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import type { ChangeScope, EdgeWorklist, OpportunityStatus, PageSort, PageWorklist } from '@/lib/internal-links/types';

/**
 * What Internal links keeps in its address (the URL state table of plan 03): the tab, the link scope, the
 * worklists, the sort and searches, and the journey. The filter bars keep their own keys (`useUrlFilters`).
 * `parseLinksSearch` is pure; `useLinksState` only reads and writes the address.
 */

export type LinksTabId = 'pages' | 'links' | 'journey' | 'flow' | 'changes' | 'opportunities';

export type LinksKey =
  | 'tab'
  | 'run'
  | 'cs'
  | 'os'
  | 'ot'
  | 'oq'
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
  | 'jl'
  | 'jt'
  | 'dir'
  | 'open'
  | 'grp'
  | 'more'
  | 'topen'
  // The inspector's own keys: a write that leaves the page's list (Open in journey) closes the inspector with it
  | 'inspect'
  | 'itab';
export type LinksSearch = Readonly<Partial<Record<LinksKey, string | null | undefined>>>;

const TABS: readonly LinksTabId[] = ['pages', 'links', 'journey', 'flow', 'changes', 'opportunities'];
const OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = ['open', 'accepted', 'dismissed'];
const OPPORTUNITY_TIERS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', 'none'];
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKLISTS: readonly PageWorklist[] = [
  'under_linked_t1',
  'orphans',
  'editorial_orphans',
  'deep_only_through_auto',
  'lost_links_top',
  'weak_outlinks',
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
  'change',
  '-change',
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
  /**
   * The Links tab narrowed to the links from or to one page (the inspector's "View all in Links"), and the
   * Journey's focus: each a url id the API would take, or `null` when the address names none or names one that is
   * not an id. A hand-edited id is no reason to fall back to the home page.
   */
  source: string | null;
  target: string | null;
  focus: string | null;
  /**
   * The text of an id the address names and the API would refuse (`src`, `tgt`, `focus`), else `null`. The tab
   * that reads the id shows not found for it (a page that does not exist), instead of reading it as no choice.
   */
  invalid: { src: string | null; tgt: string | null; focus: string | null; run: string | null };
  /**
   * The crawl the address chooses (`run`, a crawl id), or `null` for the latest. A malformed id is `null` here and
   * its text is in `invalid.run`; an id that is well formed but names no crawl of the project is settled by the
   * crawl list (`crawlInView`), not here.
   */
  run: string | null;
  /** The Changes tab's lost links scope (`cs`). */
  changesScope: ChangeScope;
  /** The Opportunities tab's filters: status (`os`), target tier position or `none` (`ot`) and search (`oq`). */
  oppStatus: OpportunityStatus | null;
  oppTier: string | null;
  oppQuery: string | null;
  journeyView: 'canvas' | 'tree';
  treeDir: Direction;
  /** The canvas layout (`jl`): By step unless the address says `tier`. */
  layout: LayoutMode;
  /** The tier lanes turned off in By tier (`jt`), as tier positions; 99 is Untiered. */
  hiddenLanes: Set<number>;
  open: Set<string>;
  groups: Set<string>;
  more: Map<string, number>;
  treeOpen: Set<string>;
}

/** A search as the address and the API hold it: trimmed, 1 to 200 characters, or `null` for none. */
export const searchText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, MAX_SEARCH_LENGTH);
};
const text = searchText;

/**
 * A url id the address names, as the id when the API would take it, as `invalid` with its text when it would
 * refuse it, and as neither when the address names nothing (the key is missing or empty).
 */
function readUrlId(value: string | null | undefined): { id: string | null; invalid: string | null } {
  if (value === null || value === undefined || value === '') return { id: null, invalid: null };
  try {
    return { id: checkUrlId(value), invalid: null };
  } catch (error) {
    if (error instanceof UrlIdError) return { id: null, invalid: value };
    throw error;
  }
}

/** A crawl id the address names: the id when it is a UUID, else its text as `invalid` (never thrown on). */
function readRunId(value: string | null | undefined): { id: string | null; invalid: string | null } {
  if (value === null || value === undefined || value === '') return { id: null, invalid: null };
  // Lowercase, as the API writes ids: the crawl list is matched by equality and the cache key holds the id
  return RUN_ID.test(value) ? { id: value.toLowerCase(), invalid: null } : { id: null, invalid: value };
}

/** The page the inspector names (`?inspect=page:<id>`), in the same terms: a url id, or the text of one not an id. */
export function inspectedPage(target: InspectorTarget | null): { urlId: string | null; invalid: string | null } {
  if (target?.type !== 'page') return { urlId: null, invalid: null };
  const { id, invalid } = readUrlId(target.id);
  return { urlId: id, invalid };
}

export function parseLinksSearch(search: LinksSearch): LinksState {
  const src = readUrlId(search.src);
  const tgt = readUrlId(search.tgt);
  const focus = readUrlId(search.focus);
  const run = readRunId(search.run);
  const tab = TABS.find((candidate) => candidate === search.tab) ?? 'pages';
  const edgeWorklist = EDGE_WORKLISTS.find((list) => list === search.lview) ?? null;
  // The link worklists count links of every scope, so a hand typed address that names none reads All links. Editorial
  // is then written out (`scope=editorial`) by the scope menu, so choosing it is still possible.
  const scopeUnset = search.scope === null || search.scope === undefined || search.scope === '';
  return {
    tab,
    scope: tab === 'links' && edgeWorklist !== null && scopeUnset ? 'all' : parseLinkScope(search.scope),
    worklist: WORKLISTS.find((list) => list === search.view) ?? null,
    edgeWorklist,
    sort: PAGE_SORTS.find((sort) => sort === search.sort) ?? DEFAULT_SORT,
    q: text(search.q),
    lq: text(search.lq),
    source: src.id,
    target: tgt.id,
    focus: focus.id,
    invalid: { src: src.invalid, tgt: tgt.invalid, focus: focus.invalid, run: run.invalid },
    run: run.id,
    changesScope: search.cs === 'all' ? 'all' : 'editorial',
    oppStatus: OPPORTUNITY_STATUSES.find((status) => status === search.os) ?? null,
    oppTier: OPPORTUNITY_TIERS.find((tier) => tier === search.ot) ?? null,
    oppQuery: text(search.oq),
    journeyView: search.jv === 'tree' ? 'tree' : 'canvas',
    treeDir: search.dir === 'in' ? 'in' : 'out',
    layout: parseLayoutMode(search.jl),
    hiddenLanes: parseLanes(search.jt),
    open: parseKeySet(search.open),
    groups: parseKeySet(search.grp),
    more: parseMore(search.more),
    treeOpen: parseKeySet(search.topen),
  };
}

const PARSERS = {
  tab: parseAsString,
  run: parseAsString,
  cs: parseAsString,
  os: parseAsString,
  ot: parseAsString,
  oq: parseAsString,
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
  jl: parseAsString,
  jt: parseAsString,
  dir: parseAsString,
  open: parseAsString,
  grp: parseAsString,
  more: parseAsString,
  topen: parseAsString,
  inspect: parseAsString,
  itab: parseAsString,
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
