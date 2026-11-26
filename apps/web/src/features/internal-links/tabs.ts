import { FileText, Grid3x3, History, Link2, type LucideIcon, Sparkles, Waypoints, Workflow } from 'lucide-react';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import type { useTranslations } from 'next-intl';
import { createElement, type ReactNode } from 'react';

import { ChangesTab } from './changes/changes-tab';
import { FlowTab } from './flow/flow-tab';
import { JourneyTab } from './journey/journey-tab';
import { LinksTab } from './links/links-tab';
import { OpportunitiesTab } from './opportunities/opportunities-tab';
import { SkeletonRows } from './crawl-states';
import { PagesTab } from './pages/pages-tab';
import type { LinksState, LinksTabId, SetLinksSearch } from './url-state';
import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';

/** The translator of `internalLinks`, as `useTranslations('internalLinks')` gives it. */
export type LinksTranslate = ReturnType<typeof useTranslations<'internalLinks'>>;

/**
 * The Link map loads when its tab opens: its canvas and ECharts are the heaviest code of the page, and most visits
 * never open it. It draws on a canvas, so it is never rendered on the server.
 */
const MapTab = dynamic(() => import('./map/map-tab').then((module) => module.MapTab), {
  ssr: false,
  loading: () => createElement(SkeletonRows),
});

/** What a tab of the page is handed. */
export interface LinksTabContext {
  scope: LinksScope;
  workspaceSlug: string;
  projectSlug: string;
  timeZone: string;
  host: string;
  state: LinksState;
  /**
   * The crawl every read of every tab is made against: `crawl.run` goes to each reader as its `run` (`null` for the
   * latest crawl, so those reads are unchanged). A tab whose links were dropped (`linksAvailable` false) shows the
   * `410 links_dropped` state of `LinksDropped`, not an error.
   */
  crawl: CrawlInView;
  setSearch: SetLinksSearch;
  tiers: readonly PageTier[];
  /**
   * The page inspector (`?inspect=page:<id>`): `urlId` is the open page's url id, `invalid` the text of an id the
   * address names that the API would refuse (the tab shows not found for it). Neither when no page is open.
   */
  inspect: {
    open: (urlId: string) => void;
    urlId: string | null;
    invalid: string | null;
    /** The visible row order of the tab, for the inspector's position and J and K (the Pages tab reports its rows). */
    setOrder: (urlIds: readonly string[]) => void;
  };
  /** Opens the Journey on a page (spec 7.2 "Open in journey"); the focus pushes a history entry. */
  openJourney: (urlId: string) => void;
  /** Hands the page's Export menu this tab's download, or `null` while it has none. */
  registerExport: (run: (() => Promise<void>) | null) => void;
  /** Opens the alert rules dialog (spec 7.10); `null` for a member who may not change the project's settings. */
  openAlertSettings: (() => void) | null;
  /** A link inside the app that keeps nothing of this page's address. */
  hrefOf: (path: `/${string}`) => Route;
}

export interface LinksTabEntry {
  id: LinksTabId;
  label: (t: LinksTranslate) => string;
  /** The glyph before the label from `xl` up (mock `TABS`). */
  icon: LucideIcon;
  render: (context: LinksTabContext) => ReactNode;
}

const ORDER: Readonly<Record<LinksTabId, number>> = {
  pages: 0,
  links: 1,
  journey: 2,
  map: 3,
  flow: 4,
  changes: 5,
  opportunities: 6,
};

/** The tabs in the page's order; a repeated id is a mistake of the code that lists them. */
export function defineLinksTabs(entries: readonly LinksTabEntry[]): readonly LinksTabEntry[] {
  const seen = new Set<LinksTabId>();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`The internal links tab "${id}" is listed twice`);
    seen.add(id);
  }
  return [...entries].sort((a, b) => ORDER[a.id] - ORDER[b.id]);
}

/** The tabs built so far: each tab's task adds its entry here (Pages, Links, Journey, Link map, Tier flow, Changes, Opportunities). */
export const LINKS_TABS: readonly LinksTabEntry[] = defineLinksTabs([
  {
    id: 'pages',
    label: (t) => t('tabs.pages'),
    icon: FileText,
    render: (context) => createElement(PagesTab, { context }),
  },
  {
    id: 'links',
    label: (t) => t('tabs.links'),
    icon: Link2,
    render: (context) => createElement(LinksTab, { context }),
  },
  {
    id: 'journey',
    label: (t) => t('tabs.journey'),
    icon: Workflow,
    render: (context) => createElement(JourneyTab, { context }),
  },
  {
    id: 'map',
    label: (t) => t('tabs.map'),
    icon: Waypoints,
    render: (context) => createElement(MapTab, { context }),
  },
  {
    id: 'flow',
    label: (t) => t('tabs.flow'),
    icon: Grid3x3,
    render: (context) => createElement(FlowTab, { context }),
  },
  {
    id: 'changes',
    label: (t) => t('tabs.changes'),
    icon: History,
    render: (context) => createElement(ChangesTab, { context }),
  },
  {
    id: 'opportunities',
    label: (t) => t('tabs.opportunities'),
    icon: Sparkles,
    render: (context) => createElement(OpportunitiesTab, { context }),
  },
]);

/** The tabs whose links are read: a crawl whose links were dropped cannot be chosen for them (spec 7.10). */
export const LINK_LEVEL_TABS: ReadonlySet<LinksTabId> = new Set<LinksTabId>([
  'links',
  'journey',
  'map',
  'changes',
  'opportunities',
]);

export const activeLinksTab = (tabs: readonly LinksTabEntry[], wanted: LinksTabId): LinksTabEntry | null =>
  tabs.find((tab) => tab.id === wanted) ?? tabs[0] ?? null;
