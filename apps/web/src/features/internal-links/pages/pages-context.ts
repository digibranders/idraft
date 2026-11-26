import type { Route } from 'next';

import { DEFAULT_SORT, type LinksKey } from '../url-state';
import type { LinksTabContext } from '../tabs';
import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import type { EdgeWorklist, LinksScope, PageSort, PageTier } from '@/lib/internal-links/types';
import type { PagesKey, PagesState } from '@/lib/pages/url-state';

const TAXONOMY_PATH = '/settings/taxonomy';
/** The keys of the tab's address that the Pages screens share. */
const SHARED_KEYS = ['run', 'scope', 'view', 'sort', 'q', 'inspect', 'itab'] as const satisfies readonly (LinksKey &
  PagesKey)[];

/** What the pages table needs from its host: Internal links today, the Pages screens next. */
export interface PagesContext {
  scope: LinksScope;
  host: string;
  timeZone: string;
  crawl: CrawlInView;
  tiers: readonly PageTier[];
  state: PagesState;
  /** The sort the address leaves out. */
  defaultSort: PageSort;
  setSearch: (values: Partial<Record<PagesKey, string | null>>, options?: { history?: 'push' | 'replace' }) => void;
  inspect: {
    open: (urlId: string) => void;
    urlId: string | null;
    invalid: string | null;
    setOrder: (urlIds: readonly string[]) => void;
  };
  openJourney: (urlId: string) => void;
  /** Opens Internal links > Links on a link worklist, on All links. */
  openEdgeWorklist: (worklist: EdgeWorklist) => void;
  registerExport: (run: (() => Promise<void>) | null) => void;
  taxonomyHref: Route;
}

/** Until the Pages tab leaves Internal links (Task 16): the table's context from a tab's. */
export function pagesContextOf(context: LinksTabContext): PagesContext {
  const { state } = context;
  return {
    scope: context.scope,
    host: context.host,
    timeZone: context.timeZone,
    crawl: context.crawl,
    tiers: context.tiers,
    state: {
      run: state.run,
      invalidRun: state.invalid.run,
      scope: state.scope,
      view: null,
      worklist: state.worklist,
      sort: state.sort,
      q: state.q,
      depth: null,
      variants: false,
    },
    defaultSort: DEFAULT_SORT,
    setSearch: (values, options) => {
      // The tab's address has no depth or variants key
      const own: Partial<Record<LinksKey, string | null>> = {};
      for (const key of SHARED_KEYS) {
        const value = values[key];
        if (value !== undefined) own[key] = value;
      }
      context.setSearch(own, options);
    },
    inspect: context.inspect,
    openJourney: context.openJourney,
    openEdgeWorklist: (worklist) =>
      context.setSearch({ tab: 'links', lview: worklist, scope: 'all' }, { history: 'push' }),
    registerExport: context.registerExport,
    taxonomyHref: context.hrefOf(TAXONOMY_PATH),
  };
}
