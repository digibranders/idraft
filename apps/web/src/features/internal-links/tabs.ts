import type { Route } from 'next';
import type { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { LinksState, LinksTabId, SetLinksSearch } from './url-state';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';

/** The translator of `internalLinks`, as `useTranslations('internalLinks')` gives it. */
export type LinksTranslate = ReturnType<typeof useTranslations<'internalLinks'>>;

/** What a tab of the page is handed. */
export interface LinksTabContext {
  scope: LinksScope;
  workspaceSlug: string;
  projectSlug: string;
  timeZone: string;
  host: string;
  state: LinksState;
  setSearch: SetLinksSearch;
  tiers: readonly PageTier[];
  /**
   * The page inspector (`?inspect=page:<id>`): `urlId` is the open page's url id, `invalid` the text of an id the
   * address names that the API would refuse (the tab shows not found for it). Neither when no page is open.
   */
  inspect: { open: (urlId: string) => void; urlId: string | null; invalid: string | null };
  /** Opens the Journey on a page (spec 7.2 "Open in journey"); the focus pushes a history entry. */
  openJourney: (urlId: string) => void;
  /** Hands the page's Export menu this tab's download, or `null` while it has none. */
  registerExport: (run: (() => Promise<void>) | null) => void;
  /** A link inside the app that keeps nothing of this page's address. */
  hrefOf: (path: `/${string}`) => Route;
}

export interface LinksTabEntry {
  id: LinksTabId;
  label: (t: LinksTranslate) => string;
  render: (context: LinksTabContext) => ReactNode;
}

const ORDER: Readonly<Record<LinksTabId, number>> = { pages: 0, links: 1, journey: 2, flow: 3 };

/** The tabs in the page's order; a repeated id is a mistake of the code that lists them. */
export function defineLinksTabs(entries: readonly LinksTabEntry[]): readonly LinksTabEntry[] {
  const seen = new Set<LinksTabId>();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`The internal links tab "${id}" is listed twice`);
    seen.add(id);
  }
  return [...entries].sort((a, b) => ORDER[a.id] - ORDER[b.id]);
}

/** The tabs built so far: each tab's task adds its entry here (Pages in Task 7, Links 10, Journey 11, Tier flow 12). */
export const LINKS_TABS: readonly LinksTabEntry[] = defineLinksTabs([]);

export const activeLinksTab = (tabs: readonly LinksTabEntry[], wanted: LinksTabId): LinksTabEntry | null =>
  tabs.find((tab) => tab.id === wanted) ?? tabs[0] ?? null;
