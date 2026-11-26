/** The tabs of the page drawer, in the owner's order (spec 9.4). */
export const PAGE_DRAWER_TABS = ['overview', 'search', 'outline', 'issues', 'ai', 'links', 'notes'] as const;
export type PageDrawerTab = (typeof PAGE_DRAWER_TABS)[number];

const KNOWN: ReadonlySet<string> = new Set(PAGE_DRAWER_TABS);

/** The tab an `itab` value names; anything unknown reads as Overview. */
export const pageDrawerTab = (value: string): PageDrawerTab =>
  KNOWN.has(value) ? (value as PageDrawerTab) : 'overview';
