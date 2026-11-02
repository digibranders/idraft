'use client';

import { parseAsStringLiteral, useQueryState } from 'nuqs';

/** The two tabs of the page (24-page-templates.md section 9.4, "Tabs, justified"). */
export const DETAIL_TABS = ['overview', 'snapshots'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/**
 * The page's state in the URL (13-filters-search.md section 5, Decision 4 of the plan). Later tasks add
 * their keys here: all go through this one hook, so a link restores the page. An unknown value falls back to
 * the default and never throws; the default is left out of the address.
 */
export function useDetailUrlState(): { tab: DetailTab; setTab: (tab: DetailTab) => Promise<URLSearchParams> } {
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(DETAIL_TABS).withDefault('overview').withOptions({ history: 'push', clearOnDefault: true }),
  );
  return { tab, setTab: (next) => setTab(next) };
}
