import type { Route } from 'next';

import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import type { EdgeWorklist, LinksScope, PageSort, PageTier } from '@/lib/internal-links/types';
import type { PagesKey, PagesState } from '@/lib/pages/url-state';

/** What the pages table needs from its host: the Pages screen. */
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
